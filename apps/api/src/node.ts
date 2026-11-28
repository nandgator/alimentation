import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { nodeOpenDb } from "./db/node.ts";
import { selfHost } from "./instance.ts";
import { scheduleHousekeeping } from "./lifecycle/housekeeping.ts";
import { PgDatabasePlacement } from "./placement/pgdatabase.ts";
import { createRuntime } from "./runtime.ts";

/**
 * The Node server: the API, and the built web app from WEB_DIR when it exists (or, with WEB_AT, a way to it).
 * The same application runs on Cloudflare Workers through `worker.ts`.
 */
const env = await selfHost(process.env);
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
root.route("/", app);

const webDir = resolve(env.WEB_DIR ?? "../web/dist");
if (env.WEB_AT) {
  // The page is served somewhere else (by Vite, while developing): a browser that asks this server for a page is sent
  // there, where the page is current and its writes are its own site's, and not shown an old build whose every
  // write would be refused as coming from another site.
  const at = env.WEB_AT;
  root.get("*", (c) => {
    const url = new URL(c.req.url);
    if (/^\/(api|auth)(\/|$)/.test(url.pathname)) return c.notFound();
    return c.redirect(new URL(url.pathname + url.search, at).href, 302);
  });
} else if (existsSync(webDir)) {
  const rel = relative(process.cwd(), webDir) || ".";
  root.use("*", serveStatic({ root: rel }));
  root.get("*", serveStatic({ root: rel, path: "index.html" })); // the app routes itself
}

// Finishes wipes, removes old copies and frees stalled moves: on Workers a cron does this.
const stopHousekeeping = scheduleHousekeeping(deps.platform, {
  onReport: (r) => {
    if (
      r.wipesFinished ||
      r.wipedAgain ||
      r.movedCopiesWiped ||
      r.oldCopiesRemoved ||
      r.stalledMovesReleased ||
      r.needAttention.length ||
      r.errors.length
    )
      console.log(JSON.stringify({ t: new Date().toISOString(), msg: "housekeeping", ...r }));
  },
  onError: (e) =>
    console.error(
      JSON.stringify({
        t: new Date().toISOString(),
        msg: "housekeeping failed",
        error: String((e as Error).message).slice(0, 200),
      }),
    ),
});

const port = Number(env.PORT ?? 8787);
const server = serve({ fetch: root.fetch, port }, (info) => {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      msg: "listening",
      port: info.port,
      web: existsSync(webDir),
    }),
  );
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopHousekeeping();
    void deps.gate.flush().finally(() => server.close(() => process.exit(0)));
  });
}
