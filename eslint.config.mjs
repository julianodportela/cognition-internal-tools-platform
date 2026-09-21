import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import internalTools from './platform/guard/eslint-plugin-internal-tools.js';

export const appGuardRules = {
  'internal-tools/no-raw-db': 'error',
  'internal-tools/no-raw-sql': 'error',
  'internal-tools/no-http': 'error',
  'internal-tools/no-server-directives': 'error',
  'internal-tools/no-console': 'error',
  'internal-tools/no-env': 'error',
  'internal-tools/only-platform-imports': 'error',
  'internal-tools/sensitive-must-be-declared': 'error',
  'internal-tools/no-dangerous-globals': 'error',
};

export default defineConfig([
  globalIgnores(['.next/**', 'node_modules/**', 'drizzle/**', 'test-results/**', 'playwright-report/**', '.data/**', 'next-env.d.ts', 'tests/guard/fixtures/**']),
  ...nextVitals,
  ...nextTs,
  {
    files: ['apps/**/*.{js,mjs,cjs,ts,tsx,mts,cts}', 'templates/**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: { 'internal-tools': internalTools },
    rules: appGuardRules,
  },
]);
