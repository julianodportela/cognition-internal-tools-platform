/**
 * Shared promotion-gate validation — used by `pnpm guard:promotions` (build
 * time) AND platform/data/internal.ts (runtime, before any production handle
 * is handed out). Returns a list of failure messages; empty = valid.
 */
import fs from 'fs';
import path from 'path';
import type { AppManifest } from '../registry';

const ENGINEERS = new Set(['eng_dev', 'eng_admin']);
const SECURITY_ROLES = new Set(['eng_admin', 'compliance_readonly']);

export function parseYamlLite(src: string): Record<string, unknown> {
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

export function validatePromotion(
  app: Pick<AppManifest, 'id' | 'dataMode' | 'dataClass' | 'sources'>,
  root: string,
): string[] {
  const failures: string[] = [];
  if (app.dataMode !== 'production') return failures;
  const f = path.join(root, 'promotions', `${app.id}.yaml`);
  if (!fs.existsSync(f)) {
    return [`apps/${app.id}: dataMode 'production' but promotions/${app.id}.yaml missing`];
  }
  const y = parseYamlLite(fs.readFileSync(f, 'utf8'));
  const approvers = (Array.isArray(y.approved_by) ? (y.approved_by as string[]) : [y.approved_by].filter(Boolean)) as string[];
  if (approvers.length < 1) failures.push(`${app.id}: promotions yaml needs >=1 approver`);
  const engOk = approvers.some((a) => ENGINEERS.has(a) || a.startsWith('u-eng'));
  if (!engOk) failures.push(`${app.id}: needs at least one engineering approver`);
  if (app.dataClass === 'sensitive') {
    const secOk = approvers.some((a) => SECURITY_ROLES.has(a) || a.includes('compliance'));
    if (approvers.length < 2 || !secOk) {
      failures.push(`${app.id}: sensitive app needs >=2 approvers incl. security/compliance`);
    }
  }
  if (!y.approved_at) failures.push(`${app.id}: missing approved_at`);
  if (!y.commit) failures.push(`${app.id}: missing commit`);
  const declared = (Array.isArray(y.sources) ? y.sources : []).map(String).sort();
  const manifest = [...(app.sources ?? [])].sort();
  if (JSON.stringify(declared) !== JSON.stringify(manifest)) {
    failures.push(`${app.id}: sources mismatch yaml=${JSON.stringify(declared)} manifest=${JSON.stringify(manifest)}`);
  }
  if (y.redteam_passed !== 'true') failures.push(`${app.id}: redteam_passed must be true`);
  return failures;
}
