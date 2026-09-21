/**
 * pnpm guard:structure — verifies repo layout invariants:
 *  - every apps/<id>/ and templates/app/ dir contains only allowed files
 *    (any other file — of any extension — is a violation; .js/.mjs/.cjs/.json
 *    files are called out explicitly as config/bypass smuggles)
 *  - no unexpected top-level entries
 *  - app dirs are registered in apps/index.ts
 *  - production db connections are only opened from the allowed platform modules
 */
import fs from 'fs';
import path from 'path';

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
const SMUGGLE_EXT = /\.(js|mjs|cjs|json)$/;

// production db may only be opened by the allowed platform modules
const PROD_ALLOWED = new Set([
  'platform/data/client.ts',
  'platform/data/internal.ts',
]);
// built dynamically so this checker does not match itself
const PROD_CALL = new RegExp('get' + "Db\\(\\s*['\"]production['\"]");

function checkAppDir(root: string, dir: string, label: string, indexFile: string | null, failures: string[]) {
  for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
    if (sub.isDirectory()) {
      if (!APP_ALLOWED_DIRS.has(sub.name)) {
        failures.push(`${label}/${sub.name}: directory not allowed (pages/, components/ only)`);
        continue;
      }
      for (const f of fs.readdirSync(path.join(dir, sub.name))) {
        if (SMUGGLE_EXT.test(f)) {
          failures.push(`${label}/${sub.name}/${f}: .js/.mjs/.cjs/.json files are not allowed in app code`);
        } else if (!f.endsWith('.tsx')) {
          failures.push(`${label}/${sub.name}/${f}: only .tsx files allowed`);
        }
      }
    } else if (SMUGGLE_EXT.test(sub.name)) {
      failures.push(`${label}/${sub.name}: .js/.mjs/.cjs/.json files are not allowed in app code`);
    } else if (!APP_ALLOWED_FILES.has(sub.name)) {
      failures.push(`${label}/${sub.name}: file not in allowed set (${[...APP_ALLOWED_FILES].join(', ')})`);
    }
  }
  if (indexFile) {
    const idx = fs.readFileSync(indexFile, 'utf8');
    const id = path.basename(dir);
    if (!new RegExp(`['"\`]${id}['"\`]`).test(idx) && !idx.includes(`./${id}/`)) {
      failures.push(`${label}: not registered in apps/index.ts`);
    }
  }
}

/** Core structure check — returns a list of violation messages (empty = OK). */
export function checkStructure(root: string): string[] {
  const failures: string[] = [];

  const appsDir = path.join(root, 'apps');
  if (fs.existsSync(appsDir)) {
    for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (entry.name === 'index.ts') continue;
      if (!entry.isDirectory()) {
        failures.push(`apps/${entry.name}: only directories and index.ts allowed`);
        continue;
      }
      checkAppDir(root, path.join(appsDir, entry.name), `apps/${entry.name}`, path.join(appsDir, 'index.ts'), failures);
    }
  }

  const templateDir = path.join(root, 'templates', 'app');
  if (fs.existsSync(templateDir)) {
    checkAppDir(root, templateDir, 'templates/app', null, failures);
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (['node_modules', '.git', '.data', '.next', '.nvm', 'test-results', 'playwright-report'].includes(entry.name)) continue;
    if (entry.isDirectory()) {
      if (!ALLOWED_TOP.has(entry.name) && !entry.name.startsWith('.')) {
        failures.push(`top-level directory '${entry.name}/' not in allowlist`);
      }
    } else if (!ROOT_FILES_OK(entry.name)) {
      failures.push(`top-level file '${entry.name}' not in allowlist`);
    }
  }

  const scan = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.next', '.git', '.data'].includes(e.name)) continue;
        scan(p);
      } else if (/\.tsx?$/.test(e.name)) {
        const rel = path.relative(root, p).split(path.sep).join('/');
        if (rel.startsWith('tests/')) continue;
        const src = fs.readFileSync(p, 'utf8');
        if (PROD_CALL.test(src) && !PROD_ALLOWED.has(rel)) {
          failures.push(`${rel}: opens the production db outside the allowed platform modules`);
        }
      }
    }
  };
  scan(root);

  return failures;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const failures = checkStructure(process.cwd());
  for (const m of failures) console.error(`✗ ${m}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} structure violation(s). See AGENTS.md §Invariants.`);
    process.exit(1);
  }
  console.log('guard:structure OK');
}
