// Serves the built reference (`dist/`) and nothing else. For a machine or a container; on Cloudflare
// the same files go up as static assets (wrangler.jsonc) and the same `_headers` apply.
//
//   PORT=8788 node serve.mjs
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site =
  process.env.SITE_DIR ??
  (existsSync(join(here, "dist")) ? join(here, "dist") : join(here, "site"));
const port = Number(process.env.PORT ?? 8788);

if (!existsSync(join(site, "index.html")))
  throw new Error(
    `Nothing to serve in ${site}. Build it first: bun run --filter @alimentation/reference build`,
  );

/** The headers for every file, from the `_headers` file that Cloudflare reads too. */
const headers = {};
for (const line of readFileSync(join(site, "_headers"), "utf8").split("\n")) {
  const m = /^\s+([a-z-]+):\s*(.+)$/.exec(line);
  if (m) headers[m[1]] = m[2];
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

createServer((req, res) => {
  const send = (status, body, extra = {}) => {
    res.writeHead(status, { ...headers, ...extra });
    res.end(req.method === "HEAD" ? undefined : body);
  };
  if (req.method !== "GET" && req.method !== "HEAD")
    return send(405, "Read only.", { allow: "GET, HEAD", "content-type": "text/plain" });

  let path;
  try {
    path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    return send(400, "Bad request.", { "content-type": "text/plain" });
  }
  if (path === "/healthz") return send(200, "ok", { "content-type": "text/plain" });
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(site, path));
  // Never outside the site, and never the headers file itself.
  if (!file.startsWith(site + sep) || file.endsWith(`${sep}_headers`))
    return send(404, "Not found.", { "content-type": "text/plain" });
  if (!existsSync(file) || !statSync(file).isFile())
    return send(404, "Not found.", { "content-type": "text/plain" });

  const hashed = path.startsWith("/scalar/chunks/");
  res.writeHead(200, {
    ...headers,
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": statSync(file).size,
    // Chunks are named for their contents, so they never change; the rest is checked each time.
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}).listen(port, "0.0.0.0", () => console.log(`API reference on http://localhost:${port}`));
