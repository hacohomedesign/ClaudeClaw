import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 15_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${process.env.DASHBOARD_PORT || '3141'}`,
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
