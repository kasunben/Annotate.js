import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 25_000,
  retries: process.env.CI ? 2 : 0,
  webServer: {
    command: 'node server/index.js',
    url: 'http://localhost:3000/demo/demo.html',
    env: { DATABASE_PATH: ':memory:' },
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
