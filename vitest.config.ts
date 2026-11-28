import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app's "@/..." alias (apps/web/vite.config.ts, tsconfig.json), for tests that import its components.
  resolve: { alias: { "@": join(import.meta.dirname, "apps/web/src") } },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/api/test/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "apps/reference/test/**/*.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
