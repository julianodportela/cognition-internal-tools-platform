import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const internalTools = require('../../platform/guard/eslint-plugin-internal-tools.js');

const RULES = [
  'no-raw-db',
  'no-raw-sql',
  'no-http',
  'no-server-directives',
  'no-console',
  'no-env',
  'only-platform-imports',
  'sensitive-must-be-declared',
];

async function lintFile(file: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        plugins: { 'internal-tools': internalTools },
        rules: Object.fromEntries(RULES.map((r) => [`internal-tools/${r}`, 'error'])),
      },
    ],
  });
  return eslint.lintFiles([file]);
}

describe('guard eslint rules (negative fixtures)', () => {
  it('every rule fires at least once on the bad-app fixture', async () => {
    const dir = path.join(__dirname, 'fixtures', 'bad-app');
    const results = await lintFile(dir);
    const fired = new Set(
      results.flatMap((r) => r.messages).map((m) => (m.ruleId ?? '').replace('internal-tools/', '')),
    );
    for (const rule of RULES) {
      expect(fired, `rule ${rule} did not fire`).toContain(rule);
    }
  });
});
