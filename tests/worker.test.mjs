import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { openD1Store } from '../server/d1-store.mjs';
import { createWorkbook } from '../shared/excel.mjs';
import { today } from '../shared/domain.mjs';

test('Workers + D1: đăng nhập, dữ liệu, ghi nguyên tử, xung đột và Excel', async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: resolve('.cloudflare/output/v0/workers/default/bundle/index.js'),
    compatibilityDate: '2026-10-11',
    d1Databases: { DB: 'test-luuta' },
    assets: { directory: resolve('.cloudflare/output/v0/workers/default/assets'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
  }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  await db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
  const request = async (path, body, cookie, method='POST') => {
    const response = await mf.dispatchFetch('https://luuta.test/api'+path, {
      method: body===undefined?'GET':method,
      headers: { ...(cookie?{Cookie:cookie}:{}), ...(body?{'Content-Type':'application/json',Origin:'https://luuta.test'}:{}) },
      body: body===undefined?undefined:JSON.stringify(body),
    });
    const bodyText=await response.text();
    assert.ok(bodyText,`Empty response: ${path}, status ${response.status}`);
    assert.ok(bodyText.startsWith('{'),bodyText);
    return { status:response.status, data:JSON.parse(bodyText), cookie:response.headers.get('set-cookie')?.split(';')[0], headers:response.headers };
  };
  assert.equal((await request('/state')).status,401);
  assert.equal((await request('/login',{username:'giamdoc',password:'wrong'})).status,401);
  const login=await request('/login',{username:'giamdoc',password:'Luuta@2026'});
  assert.equal(login.status,200,JSON.stringify(login.data));
  assert.match(login.headers.get('set-cookie'),/Secure/i);
  const admin=login.cookie;
  assert.equal((await request('/me',undefined,admin)).status,200);
  const before=await request('/state',undefined,admin);
  assert.equal(before.status,200);
  const created=await request('/orders',{customer:'Worker test',product_id:1,received:today(),deadline:today(),owner_id:2,variants:[{color:'Đen',size:'M',qty:3,line:1}]},admin);
  assert.equal(created.status,201,JSON.stringify(created.data));
  const state=(await request('/state',undefined,admin)).data;
  const variant=state.variants.find(v=>v.order_id===created.data.id);
  for(const stage of ['npl','pattern','cut','sew','qc','pack','ship']) {
    const result=await request('/entries',{variant_id:variant.id,employee_id:stage==='qc'?4:5,stage,date:today(),qty:3,rate:100,failed:0},admin);
    assert.equal(result.status,201,JSON.stringify(result.data));
  }
  assert.equal((await request(`/orders/${created.data.id}/complete`,{},admin)).status,200);
  const employee=await request('/login',{username:'nhanvien',password:'Luuta@2026'});
  const report=await request('/export/payroll?format=json&employee=8',undefined,employee.cookie);
  assert.equal(report.status,200);
  assert.ok(report.data.rows.every(row=>row.employee==='Nguyễn Mai'));
  const production=await request('/export/production?format=json',undefined,employee.cookie);
  assert.ok(production.data.rows.every(row=>row.rate===undefined&&row.amount===undefined));
  const buffer=await createWorkbook(report.data);
  assert.equal(Buffer.from(buffer).subarray(0,2).toString(),'PK');

  // Both writers read the same revision; only one complete batch can win.
  const first=await openD1Store(db), second=await openD1Store(db);
  await first.db.prepare('UPDATE products SET rate=? WHERE id=?').run(111,1);
  await second.db.prepare('UPDATE products SET rate=? WHERE id=?').run(222,1);
  await second.log(1,'Conflict test','Product','must roll back');
  await first.commit();
  await assert.rejects(()=>second.commit(),error=>error.status===409);
  assert.equal((await db.prepare('SELECT rate FROM products WHERE id=1').first()).rate,111);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM logs WHERE action='Conflict test'").first()).n,0);
  const rollback=await openD1Store(db);
  await rollback.db.prepare('UPDATE products SET rate=? WHERE id=?').run(333,1);
  await rollback.db.prepare('INSERT INTO colors VALUES(?,?)').run('Đen','#000000');
  await assert.rejects(()=>rollback.commit());
  assert.equal((await db.prepare('SELECT rate FROM products WHERE id=1').first()).rate,111);
});
