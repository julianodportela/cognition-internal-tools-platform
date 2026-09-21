import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@platform': path.resolve(__dirname, 'platform'),
      '@apps': path.resolve(__dirname, 'apps'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: { SANDBOX_DATABASE_URL: 'memory://' },
  },
});
