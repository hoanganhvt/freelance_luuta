import { bindings, defineConfig } from 'cf/config';
import * as entrypoint from './server/worker.mjs' with { type: 'cf-worker' };

export default defineConfig({
  accountId: '70e2d94c24874f1ce5ea0a85777b52a2',
  worker: {
    name: 'luuta-production',
    compatibilityDate: '2026-10-11',
    entrypoint,
    assets: { notFoundHandling: 'single-page-application', runWorkerFirst: ['/api/*'] },
    env: { DB: bindings.d1({ name: 'luuta-production', id: 'b29fb563-4d6b-46ec-a119-9c49a2556b7e' }), ASSETS: bindings.assets() },
    observability: { enabled: true, traces: { enabled: true } },
  },
});
