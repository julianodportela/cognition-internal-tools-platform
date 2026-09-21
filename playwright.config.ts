import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: process.env.E2E_BASE ?? 'http://localhost:3000' },
  // E2E_BASE set → run against an externally started server (CI prod build).
  webServer: process.env.E2E_BASE
    ? undefined
    : {
        command: 'pnpm dev',
        port: 3000,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
