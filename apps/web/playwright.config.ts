import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Drives the built app through a real browser, against the real server and a real Postgres:
 *   bun run --filter @alimentation/web test:e2e
 * Needs Postgres (ALIMENTATION_TEST_PG, a role able to create databases and roles). Locally,
 * PLAYWRIGHT_CHROMIUM_PATH can point at an installed Chromium.
 */
const PORT = Number(process.env.E2E_PORT ?? 18900);
const PG = process.env.ALIMENTATION_TEST_PG ?? "postgres://pgadmin@127.0.0.1:5432/postgres";
/** A second instance, for the specs that move a kitchen from one instance to another. */
const OTHER_PORT = Number(process.env.E2E_OTHER_PORT ?? 18901);
const OTHER_ORIGIN = `http://localhost:${OTHER_PORT}`;
const OTHER_TOKEN = "e2e-migration-token-0123456789abcdef";
const launchOptions = { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined };

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  // Reduced motion: the site honours it, and nothing is measured halfway through a fade.
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions,
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, launchOptions },
    },
    { name: "phone", use: { ...devices["Pixel 7"], launchOptions } },
  ],
  webServer: [
    {
      command: "node ../api/dist/node.mjs",
      url: `http://localhost:${PORT}/api/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        PORT: String(PORT),
        APP_ORIGIN: `http://localhost:${PORT}`,
        NODE_ENV: "development",
        AUTH_DEV: "1",
        SIGNUP: "open",
        WEB_DIR: "./dist",
        INSTANCE_DIR: mkdtempSync(join(tmpdir(), "alim-e2e-")),
        PLACEMENT_ADMIN_URL: PG,
        OPERATOR_EMAILS: "operator@example.org",
      },
    },
    {
      command: "node ../api/dist/node.mjs",
      url: `${OTHER_ORIGIN}/api/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        PORT: String(OTHER_PORT),
        APP_ORIGIN: OTHER_ORIGIN,
        NODE_ENV: "development",
        AUTH_DEV: "1",
        SIGNUP: "open",
        WEB_DIR: "./dist",
        INSTANCE_DIR: mkdtempSync(join(tmpdir(), "alim-e2e-other-")),
        PLACEMENT_ADMIN_URL: PG,
        MIGRATION_TOKEN: OTHER_TOKEN,
      },
    },
  ],
});
