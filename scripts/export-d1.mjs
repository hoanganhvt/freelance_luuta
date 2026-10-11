import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { checkPassword, hashPassword } from '../shared/passwords.mjs';

const db = new DatabaseSync('data/luuta.sqlite', { readOnly: true });
const quote = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const schema = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all();
const sql = ['PRAGMA defer_foreign_keys=ON;'];
sql.push(...schema.filter(item => item.type === 'table').map(item => item.sql + ';'));
for (const item of schema.filter(item => item.type === 'table')) {
  if (item.name === 'sessions') continue;
  const rows = db.prepare(`SELECT * FROM "${item.name}"`).all();
  for (const row of rows) {
    if (item.name === 'users') {
      if (!await checkPassword('Luuta@2026', row.password)) throw new Error(`Tài khoản ${row.username} không dùng mật khẩu demo; cần chuyển riêng để giữ thông tin đăng nhập.`);
      row.password = await hashPassword('Luuta@2026');
    }
    sql.push(`INSERT INTO "${item.name}"(${Object.keys(row).map(key => `"${key}"`).join(',')}) VALUES(${Object.values(row).map(quote).join(',')});`);
  }
}
sql.push(...schema.filter(item => item.type !== 'table').map(item => item.sql + ';'));
sql.push('CREATE TABLE app_revision(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);', 'INSERT INTO app_revision VALUES(1,0);');
const output=process.argv[2]||'artifacts/d1-export.sql';
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, sql.join('\n')+'\n', { flag: 'wx' });
db.close();
console.log('Đã xuất dữ liệu local và chuyển mật khẩu demo sang PBKDF2.');
