import { defineConfig } from '@playwright/test';

try {
  process.loadEnvFile('.env');
} catch {
  /* CI provides env directly */
}

/**
 * End-to-end journeys against a running stack seeded with `npm run seed:demo`.
 * Uses the locally installed Chrome (channel: 'chrome') so no browser download is needed;
 * in CI run `npx playwright install chromium` and drop the channel.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
