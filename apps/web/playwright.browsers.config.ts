import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.ts';

/**
 * The parts of the app that are newest, in Firefox and in WebKit (which is Safari's engine), on a desktop:
 *   npx playwright install firefox webkit
 *   npm run test:browsers -w @alimentation/web
 * The rest of the suite is Chromium, desktop and a phone. What a browser cannot do is skipped and says so
 * (a page that glides into the next, and leave to read the clipboard). The app is started as it is for that suite.
 */
export default defineConfig({
  ...base,
  // The Chromium that the other suite is pointed at is not for these.
  use: { ...base.use, launchOptions: {} },
  testMatch: ['**/docs.spec.ts', '**/kitchens.spec.ts'],
  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 900 } },
    },
  ],
});
