import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const internalTools = require('../../platform/guard/eslint-plugin-internal-tools.js');
const tsParser = require('@typescript-eslint/parser');

const RULES = [
  'no-raw-db',
  'no-raw-sql',
  'no-http',
  'no-server-directives',
  'no-dangerous-globals',
  'no-console',
  'no-env',
  'only-platform-imports',
  'sensitive-must-be-declared',
];

async function lint(target: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
        plugins: { 'internal-tools': internalTools },
        rules: Object.fromEntries(RULES.map((r) => [`internal-tools/${r}`, 'error'])),
      },
    ],
  });
  return eslint.lintFiles([target]);
}

function violations(results: Awaited<ReturnType<typeof lint>>): Set<string> {
  return new Set(
    results
      .flatMap((r) => r.messages)
      .map((m) => `${(m.ruleId ?? '').replace('internal-tools/', '')}:${m.line}`),
  );
}

const BAD = path.join(__dirname, 'fixtures', 'bad-app');
const ROOT = path.join(__dirname, '..', '..');

describe('guard eslint rules (negative fixtures)', () => {
  it('route.ts — no-server-directives fires on the file', async () => {
    const v = violations(await lint(path.join(BAD, 'route.ts')));
    expect(v.has('no-server-directives:1')).toBe(true);
  });

  it('raw-db.ts — client import + banned drizzle imports + dynamic/require', async () => {
    const v = violations(await lint(path.join(BAD, 'raw-db.ts')));
    expect(v.has('no-raw-db:3')).toBe(true); // @platform/data/client import
    expect(v.has('no-raw-db:4')).toBe(true); // sql not in operator allowlist
    expect(v.has('no-raw-db:8')).toBe(true); // dynamic import() of client
    expect(v.has('no-raw-db:9')).toBe(true); // require() of client
    // sql named import also trips no-raw-sql
    expect(v.has('no-raw-sql:4')).toBe(true);
  });

  it('raw-sql.ts — sql import + tagged template', async () => {
    const v = violations(await lint(path.join(BAD, 'raw-sql.ts')));
    expect(v.has('no-raw-sql:2')).toBe(true);
    expect(v.has('no-raw-sql:4')).toBe(true);
  });

  it('http.ts — banned modules + fetch + XMLHttpRequest', async () => {
    const v = violations(await lint(path.join(BAD, 'http.ts')));
    expect(v.has('no-http:2')).toBe(true); // axios
    expect(v.has('no-http:3')).toBe(true); // fs
    expect(v.has('no-http:4')).toBe(true); // node:net
    expect(v.has('no-http:7')).toBe(true); // fetch()
    expect(v.has('no-http:8')).toBe(true); // XMLHttpRequest
    // fetch/XHR are also dangerous globals
    expect(v.has('no-dangerous-globals:7')).toBe(true);
  });

  it('globals.ts — every dangerous global incl. computed member access', async () => {
    const v = violations(await lint(path.join(BAD, 'globals.ts')));
    for (const line of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(v.has(`no-dangerous-globals:${line}`), `line ${line}`).toBe(true);
    }
  });

  it('server-action.ts — use server inside a function body', async () => {
    const v = violations(await lint(path.join(BAD, 'server-action.ts')));
    expect(v.has('no-server-directives:3')).toBe(true);
  });

  it('relative-import.ts — .. traversal + non-allowlisted package', async () => {
    const v = violations(await lint(path.join(BAD, 'relative-import.ts')));
    expect(v.has('only-platform-imports:2')).toBe(true); // ../outside
    expect(v.has('only-platform-imports:3')).toBe(true); // some-random-package
  });

  it('client-comp.tsx — client component importing server APIs', async () => {
    const v = violations(await lint(path.join(BAD, 'client-comp.tsx')));
    expect(v.has('only-platform-imports:3')).toBe(true); // zod banned in client
    expect(v.has('only-platform-imports:4')).toBe(true); // @platform/data/read banned
  });

  it('env.ts — process.env banned', async () => {
    const v = violations(await lint(path.join(BAD, 'env.ts')));
    expect(v.has('no-env:2')).toBe(true);
    expect(v.has('no-dangerous-globals:2')).toBe(true);
  });

  it('schema.ts — undeclared sensitive columns + computed keys', async () => {
    const v = violations(await lint(path.join(BAD, 'schema.ts')));
    expect(v.has('sensitive-must-be-declared:7')).toBe(true); // ssn
    expect(v.has('sensitive-must-be-declared:9')).toBe(true); // cardLast4 → card_last4
    expect(v.has('sensitive-must-be-declared:13')).toBe(true); // computed key
    // taxId is wrapped — must NOT fire on line 11
    expect(v.has('sensitive-must-be-declared:11')).toBe(false);
  });
});

describe('good apps produce zero guard errors', () => {
  it('templates/app and apps/refunds are clean', async () => {
    const results = await lint(path.join(ROOT, 'templates', 'app'));
    const results2 = await lint(path.join(ROOT, 'apps', 'refunds'));
    const errors = [...results, ...results2].flatMap((r) => r.messages).filter((m) => m.severity === 2);
    expect(errors.map((e) => `${e.ruleId}:${e.line}`)).toEqual([]);
  });
});
