import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { createApp } from './app.mjs';
import { openD1Store } from './d1-store.mjs';

const requests = new AsyncLocalStorage();
const store = {
  db: { prepare: sql => requests.getStore().db.prepare(sql) },
  tx: fn => requests.getStore().tx(fn),
  log: (...args) => requests.getStore().log(...args),
};
const app = createApp(store);
const handler = httpServerHandler(createServer(app));

export default {
  async fetch(request, env, ctx) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const currentStore = await openD1Store(env.DB);
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.set('host', url.host);
      headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
      headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') || '127.0.0.1');
      const forwarded = new Request(request, { headers });
      const response = await requests.run(currentStore, () => handler.fetch(forwarded, env, ctx));
      if (response.ok) await currentStore.commit();
      return response;
    } catch (error) {
      console.error(JSON.stringify({ event: 'api_error', path: new URL(request.url).pathname, message: error.message }));
      return Response.json({ error: error.status ? error.message : 'Không thể lưu dữ liệu. Vui lòng thử lại.' }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
