import type { ExecutionContext } from '@cloudflare/workers-types';
import { housekeeping } from './lifecycle/housekeeping.ts';
import { neonOpenDb, useLocalProxy } from './db/neon.ts';
import { NeonPlacement } from './placement/neon.ts';
import { createRuntime } from './runtime.ts';

/**
 * The Cloudflare Workers entry. Static files (the web app) are served by the
 * platform without running this code; only the API paths reach it. See wrangler.jsonc.
 *
 * Settings are Worker variables and secrets, all strings:
 *   the ones in config.ts, and for the shared service
 *   NEON_API_KEY, NEON_REGION (for example aws-ap-southeast-1), NEON_ORG_ID (optional),
 *   NEON_QUOTA_JSON (optional, per-project caps Neon enforces)
 *   NEON_WS_PROXY, only to run on one machine against plain Postgres (see db/neon.ts)
 */

type Bindings = Record<string, unknown>;

let built: ReturnType<typeof build> | undefined;
let current: ExecutionContext | undefined;

function build(bindings: Bindings) {
  const env = Object.fromEntries(
    Object.entries(bindings).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  if (env.NEON_WS_PROXY) useLocalProxy(env.NEON_WS_PROXY);
  const openDb = neonOpenDb();
  const placement = env.NEON_API_KEY
    ? new NeonPlacement({
        apiKey: env.NEON_API_KEY,
        regionId: env.NEON_REGION ?? 'aws-ap-southeast-1',
        orgId: env.NEON_ORG_ID,
        openDb,
        quota: env.NEON_QUOTA_JSON ? JSON.parse(env.NEON_QUOTA_JSON) : undefined,
        onError: (detail) =>
          console.log(JSON.stringify({ t: new Date().toISOString(), msg: 'neon', detail })),
      })
    : null;
  return createRuntime({
    env,
    openDb,
    placement,
    log: (line) => console.log(JSON.stringify(line)),
    // The request in progress when something asks for work to run after its response.
    schedule: (p) => current?.waitUntil(p),
  });
}

export default {
  async fetch(request: Request, bindings: Bindings, ctx: ExecutionContext): Promise<Response> {
    built ??= build(bindings);
    const { app } = await built;
    current = ctx;
    return app.fetch(request, bindings, ctx);
  },

  /** On a schedule: finish wipes, remove old copies, drop counts nobody reads. */
  async scheduled(_event: unknown, bindings: Bindings, ctx: ExecutionContext): Promise<void> {
    built ??= build(bindings);
    const { deps } = await built;
    current = ctx;
    ctx.waitUntil(
      housekeeping(deps.platform).then((r) =>
        console.log(JSON.stringify({ t: new Date().toISOString(), msg: 'housekeeping', ...r })),
      ),
    );
  },
};
