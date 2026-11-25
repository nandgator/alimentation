import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// In development the API runs separately (bun run dev:api) and is reached through this server,
// so cookies and the Origin header are those of the page.
const api = process.env.API_ORIGIN ?? "http://localhost:8787";
// The API reference is a site of its own; given its address (dev/local.sh dev does), it is reached at
// /reference/ here too, as it is behind the proxy in front of a deployment.
const reference = process.env.REFERENCE_ORIGIN;

/**
 * The guides and the documentation are static pages made by the build, not routes of the app, so the dev server
 * serves them from the last build: /guides/, /docs/ and the text files for models. When there is no build yet it
 * makes one in the background, once, and says so on the page until it is there.
 */
function builtPages(): Plugin {
  const dist = join(import.meta.dirname, "dist");
  const mine = /^\/(guides|docs)(\/|$)|^\/llms(-full)?\.txt$|^\/(doc-)?assets\//;
  let building = false;
  const ready = () => existsSync(join(dist, "guides", "index.html"));
  return {
    name: "built-pages",
    configureServer(server) {
      const build = () => {
        if (building || ready()) return;
        building = true;
        const child = spawn("bun", ["run", "build"], {
          cwd: import.meta.dirname,
          stdio: "inherit",
        });
        child.on("exit", () => {
          building = false;
        });
      };
      build();
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
        if (!mine.test(path)) return next();
        if (/^\/(doc-)?assets\//.test(path) && !existsSync(join(dist, path))) return next();
        if (!ready()) {
          build();
          res.statusCode = 503;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end("The guides are being built for the first time. Reload in a minute.");
          return;
        }
        let file = join(dist, path);
        if (!file.startsWith(dist)) return next();
        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
        else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
        if (!existsSync(file)) return next();
        const types: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".txt": "text/plain; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".svg": "image/svg+xml",
          ".json": "application/json",
        };
        res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  resolve: { alias: { "@": join(import.meta.dirname, "src") } },
  plugins: [
    tailwindcss(),
    react(),
    builtPages(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Alimentation",
        short_name: "Alimentation",
        description: "Mess and tiffin accounts for small kitchens.",
        start_url: "/app",
        scope: "/",
        display: "standalone",
        background_color: "#fbfaf7",
        theme_color: "#3442a6",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        // A classic script, which is how it is registered. The module build the plugin offers by default passes an
        // option that the bundler now deprecates, so the warning is removed by not using it, not by hiding it.
        rollupFormat: "iife",
        // Only the Latin letters of the fonts are kept for offline use, and the Devanagari ones that carry the rupee sign.
        globPatterns: [
          "**/*.{js,css,html,svg,png}",
          "**/*-latin-*.woff2",
          "**/noto-sans-devanagari-devanagari-*.woff2",
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/auth": { target: api, changeOrigin: false },
      ...(reference
        ? {
            "^/reference/": {
              target: reference,
              rewrite: (path: string) => path.slice("/reference".length),
            },
          }
        : {}),
    },
  },
  build: { target: "es2023", sourcemap: false },
});
