/**
 * pnpm guard:structure — verifies repo layout invariants:
 *  - every apps/<id>/ dir contains only allowed files
 *  - no unexpected top-level entries
 *  - app dirs are registered in apps/index.ts
 *  - production db connections are only opened from the allowed platform modules
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
let failures = 0;
const fail = (m: string) => {
  failures++;
  console.error(`✗ ${m}`);
};

const ALLOWED_TOP = new Set([
  'app', 'apps', 'platform', 'templates', 'tests', 'scripts', 'promotions',
  'drizzle', '.agents', '.github', 'docs',
]);

const ROOT_FILES_OK = (f: string) =>
  f.startsWith('.') ||
  /\.(json|ts|mjs|js|md|yml|yaml|toml|lock|tsbuildinfo)$/.test(f) ||
  ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'next.config.ts', 'eslint.config.mjs',
   'postcss.config.mjs', 'vitest.config.ts', 'playwright.config.ts', 'drizzle.config.ts',
   'AGENTS.md', 'CLAUDE.md', 'CODEOWNERS', '.gitleaks.toml'].includes(f);

const APP_ALLOWED_FILES = new Set(['manifest.ts', 'schema.ts', 'actions.ts', 'fixtures.ts', 'APP_SPEC.md']);
const APP_ALLOWED_DIRS = new Set(['pages', 'components']);

const appsDir = path.join(ROOT, 'apps');
if (fs.existsSync(appsDir)) {
  for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (entry.name === 'index.ts') continue;
    if (!entry.isDirectory()) {
      fail(`apps/${entry.name}: only directories and index.ts allowed`);
      continue;
    }
    for (const sub of fs.readdirSync(path.join(appsDir, entry.name), { withFileTypes: true })) {
      if (sub.isDirectory()) {
        if (!APP_ALLOWED_DIRS.has(sub.name)) {
          fail(`apps/${entry.name}/${sub.name}: directory not allowed (pages/, components/ only)`);
          continue;
        }
        const ext = sub.name === 'pages' ? '.tsx' : '.tsx';
        for (const f of fs.readdirSync(path.join(appsDir, entry.name, sub.name))) {
          if (!f.endsWith(ext)) {
            fail(`apps/${entry.name}/${sub.name}/${f}: only ${ext} files allowed`);
          }
        }
      } else if (!APP_ALLOWED_FILES.has(sub.name)) {
        fail(`apps/${entry.name}/${sub.name}: file not in allowed set (${[...APP_ALLOWED_FILES].join(', ')})`);
      }
    }
    // every app dir must be registered in apps/index.ts
    const idx = fs.readFileSync(path.join(appsDir, 'index.ts'), 'utf8');
    if (!new RegExp(`['"\`]${entry.name}['"\`]`).test(idx) && !idx.includes(`./${entry.name}/`)) {
      fail(`apps/${entry.name}: not registered in apps/index.ts`);
    }
  }
}

for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (entry.name.startsWith('node_modules') || entry.name === '.git' || entry.name === '.data' || entry.name === '.next' || entry.name === '.nvm' || entry.name === 'test-results' || entry.name === 'playwright-report') continue;
  if (entry.isDirectory()) {
    if (!ALLOWED_TOP.has(entry.name) && !entry.name.startsWith('.')) {
      fail(`top-level directory '${entry.name}/' not in allowlist`);
    }
  } else {
    if (!ROOT_FILES_OK(entry.name)) {
      fail(`top-level file '${entry.name}' not in allowlist`);
    }
  }
}

// production db may only be opened by the allowed platform modules
const PROD_ALLOWED = new Set([
  'platform/data/read.ts',
  'platform/actions/mutate.ts',
  'platform/data/client.ts',
]);
// built dynamically so this checker does not match itself
const PROD_CALL = new RegExp('get' + "Db\\(\\s*['\"]production['\"]");
function scan(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.next', '.git', '.data'].includes(e.name)) continue;
      scan(p);
    } else if (/\.tsx?$/.test(e.name)) {
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (rel.startsWith('tests/')) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (PROD_CALL.test(src) && !PROD_ALLOWED.has(rel)) {
        fail(`${rel}: opens the production db outside the allowed platform modules`);
      }
    }
  }
}
scan(ROOT);

if (failures > 0) {
  console.error(`\n${failures} structure violation(s). See AGENTS.md §Invariants.`);
  process.exit(1);
}
console.log('guard:structure OK');
