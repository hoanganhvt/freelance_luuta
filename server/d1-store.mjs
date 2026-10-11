// One request's writes are committed together. The revision rejects stale writes
// (including production quantities and payroll locks) instead of overwriting them.
export async function openD1Store(binding) {
  const session = binding.withSession('first-primary');
  const { version } = await session.prepare('SELECT version FROM app_revision WHERE id=1').first();
  const writes = [];
  const ids = new Map();
  const idTables = new Set(['users', 'products', 'orders', 'variants', 'entries', 'logs']);
  const prepare = sql => ({
    async get(...values) { return (await session.prepare(sql).bind(...values).first()) ?? undefined; },
    async all(...values) { return (await session.prepare(sql).bind(...values).all()).results; },
    async run(...values) {
      let lastInsertRowid;
      const insert = sql.match(/^INSERT INTO (\w+)\(/i);
      if (insert && idTables.has(insert[1])) {
        const table = insert[1];
        if (!ids.has(table)) ids.set(table, (await session.prepare(`SELECT COALESCE(MAX(id),0) id FROM ${table}`).first()).id);
        lastInsertRowid = ids.get(table) + 1;
        ids.set(table, lastInsertRowid);
        sql = sql.replace(`INSERT INTO ${table}(`, `INSERT INTO ${table}(id,`).replace(/VALUES\(/i, 'VALUES(?,');
        values = [lastInsertRowid, ...values];
      }
      writes.push({ sql, values });
      return { lastInsertRowid, changes: 1 };
    },
  });
  return {
    db: { prepare },
    async tx(fn) {
      const checkpoint = writes.length;
      try { return await fn(); } catch (error) { writes.splice(checkpoint); throw error; }
    },
    log: (user, action, entity, detail) => prepare('INSERT INTO logs(user_id,action,entity,detail,created_at) VALUES(?,?,?,?,?)').run(user, action, entity, detail, new Date().toISOString()),
    async commit() {
      if (!writes.length) return;
      const statements = [session.prepare('UPDATE app_revision SET version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=1').bind(version)];
      // Combine adjacent inserts to keep large size/color matrices within D1's
      // free-plan query and 100-bound-parameter limits.
      for (let i = 0; i < writes.length; i++) {
        const { sql, values } = writes[i];
        let combinedSql = sql;
        const combinedValues = [...values];
        const insert = sql.match(/^(INSERT INTO \w+\([^)]*\) VALUES)(\([^)]*\))$/i);
        while (insert && i + 1 < writes.length && writes[i + 1].sql === sql && combinedValues.length + writes[i + 1].values.length <= 100) {
          combinedSql += ',' + insert[2];
          combinedValues.push(...writes[++i].values);
        }
        statements.push(session.prepare(combinedSql).bind(...combinedValues));
      }
      try { await session.batch(statements); }
      catch (error) {
        if (error.message.includes('app_revision.version')) {
          const conflict = new Error('Dữ liệu vừa được người khác cập nhật. Tải lại trang rồi thử lưu lại.');
          conflict.status = 409;
          throw conflict;
        }
        throw error;
      }
    },
  };
}
