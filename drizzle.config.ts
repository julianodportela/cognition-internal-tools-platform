import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  driver: 'pglite',
  schema: './platform/data/schema.ts',
  out: './drizzle',
  dbCredentials: { url: './.data/sandbox' },
});
