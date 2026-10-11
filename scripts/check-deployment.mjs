import assert from 'node:assert/strict';
import { createWorkbook } from '../shared/excel.mjs';

const base = process.argv[2] || 'https://luuta-production.luuta-uranus.workers.dev';
const page = await fetch(base);
assert.equal(page.status, 200);
const html = await page.text();
for (const [, asset] of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) {
  const response = await fetch(base + asset);
  assert.equal(response.status, 200, asset);
  assert.ok(!response.headers.get('content-type').includes('text/html'), asset);
}
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'giamdoc', password: 'Luuta@2026' }) });
assert.equal(login.status, 200, await login.clone().text());
const cookie = login.headers.get('set-cookie').split(';')[0];
assert.match(login.headers.get('set-cookie'), /Secure/);
const state = await fetch(base + '/api/state', { headers: { Cookie: cookie } });
assert.equal(state.status, 200, await state.clone().text());
const data = await state.json();
assert.ok(data.orders.length && data.products.length && data.users.length);
const report = await fetch(base + '/api/export/orders?format=json', { headers: { Cookie: cookie } });
assert.equal(report.status, 200);
const workbook = await createWorkbook(await report.json());
assert.equal(Buffer.from(workbook).subarray(0, 2).toString(), 'PK');
const logout = await fetch(base + '/api/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
assert.equal(logout.status, 200);
assert.equal((await fetch(base + '/api/me', { headers: { Cookie: cookie } })).status, 401);
console.log(JSON.stringify({ url: base, assets: 'OK', login: 'OK', orders: data.orders.length, D1: 'OK', excel: 'OK', logout: 'OK' }));
