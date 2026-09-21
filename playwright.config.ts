import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://localhost:3100' },
  webServer: {
    command: 'pnpm dev -p 3100',
    port: 3100,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
