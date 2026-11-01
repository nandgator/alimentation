import { defineConfig, devices } from '@playwright/test';

/**
 * Signing in through a real identity provider, run on this machine by `dev/idp/idp.sh up <provider>`:
 *   IDP=authelia npm run test:idp -w @alimentation/web
 * It drives the running instance, so nothing is started here. APP_URL is where that is (the default
 * is the compose file's). The provider's certificate comes from the local authority that idp.sh made,
 * which a browser has not been told to trust, hence ignoreHTTPSErrors: it is for this one machine.
 */
const launchOptions = { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined };

export default defineConfig({
  testDir: './e2e-idp',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:8787',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    launchOptions,
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, launchOptions },
    },
  ],
});
