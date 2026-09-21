/**
 * pnpm guard:promotions — every app manifest with dataMode:'production' must
 * have a matching promotions/<appId>.yaml with required approvers, matching
 * sources, commit, approved_at, and redteam_passed: true.
 */
import fs from 'fs';
import path from 'path';
import { getApps } from '../registry';

const ROOT = process.cwd();
let failures = 0;
const fail = (m: string) => {
  failures++;
  console.error(`✗ ${m}`);
};

const ENGINEERS = new Set(['eng_dev', 'eng_admin']);
const SECURITY_ROLES = new Set(['eng_admin', 'compliance_readonly']);

function parseYamlLite(src: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let key = '';
  for (const line of src.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const v = kv[2].trim();
      out[key] = v === '' ? [] : v.replace(/^["']|["']$/g, '');
    } else {
      const item = line.match(/^\s+-\s*(.+)$/);
      if (item && key) {
        (out[key] as string[]).push(item[1].trim().replace(/^["']|["']$/g, ''));
      }
    }
  }
  return out;
}

for (const app of getApps()) {
  if (app.dataMode !== 'production') continue;
  const f = path.join(ROOT, 'promotions', `${app.id}.yaml`);
  if (!fs.existsSync(f)) {
    fail(`apps/${app.id}: dataMode 'production' but promotions/${app.id}.yaml missing`);
    continue;
  }
  const y = parseYamlLite(fs.readFileSync(f, 'utf8'));
  const approvers = Array.isArray(y.approved_by) ? y.approved_by as string[] : [y.approved_by].filter(Boolean) as string[];
  if (approvers.length < 1) fail(`${app.id}: promotions yaml needs >=1 approver`);
  // require at least one engineering approver — approvers listed as role ids or user ids
  const engOk = approvers.some((a) => ENGINEERS.has(a) || a.startsWith('u-eng'));
  if (!engOk) fail(`${app.id}: needs at least one engineering approver`);
  if (app.dataClass === 'sensitive') {
    const secOk = approvers.some((a) => SECURITY_ROLES.has(a) || a.includes('compliance'));
    if (approvers.length < 2 || !secOk) {
      fail(`${app.id}: sensitive app needs >=2 approvers incl. security/compliance`);
    }
  }
  if (!y.approved_at) fail(`${app.id}: missing approved_at`);
  if (!y.commit) fail(`${app.id}: missing commit`);
  const declared = (Array.isArray(y.sources) ? y.sources : []).map(String).sort();
  const manifest = [...(app.sources ?? [])].sort();
  if (JSON.stringify(declared) !== JSON.stringify(manifest)) {
    fail(`${app.id}: sources mismatch yaml=${JSON.stringify(declared)} manifest=${JSON.stringify(manifest)}`);
  }
  if (y.redteam_passed !== 'true') fail(`${app.id}: redteam_passed must be true`);
}

if (failures > 0) {
  console.error(`\n${failures} promotion-gate violation(s).`);
  process.exit(1);
}
console.log('guard:promotions OK');
