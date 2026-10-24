import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { nodeOpenDb } from './db/node.ts';
import { PgDatabasePlacement } from './placement/pgdatabase.ts';
import { createRuntime } from './runtime.ts';

/**
 * The Node server: the API, and the built web app from WEB_DIR when it exists.
 * The same application runs on Cloudflare Workers through `worker.ts`.
 */
const env = process.env;
const placement = env.PLACEMENT_ADMIN_URL
  ? new PgDatabasePlacement({ adminUrl: env.PLACEMENT_ADMIN_URL })
  : null;
const { app, deps } = await createRuntime({
  env,
  openDb: nodeOpenDb(),
  placement,
  log: (line) => console.log(JSON.stringify(line)),
});

const root = new Hono();
root.route('/', app);

const webDir = resolve(env.WEB_DIR ?? '../web/dist');
if (existsSync(webDir)) {
  const rel = relative(process.cwd(), webDir) || '.';
  root.use('*', serveStatic({ root: rel }));
  root.get('*', serveStatic({ root: rel, path: 'index.html' })); // the app routes itself
}

const port = Number(env.PORT ?? 8787);
const server = serve({ fetch: root.fetch, port }, (info) => {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      msg: 'listening',
      port: info.port,
      web: existsSync(webDir),
    }),
  );
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void deps.gate.flush().finally(() => server.close(() => process.exit(0)));
  });
}
