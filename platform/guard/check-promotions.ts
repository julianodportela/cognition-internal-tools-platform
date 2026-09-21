/**
 * pnpm guard:promotions — every app manifest with dataMode:'production' must
 * have a matching promotions/<appId>.yaml with required approvers, matching
 * sources, commit, approved_at, and redteam_passed: true.
 */
import path from 'path';
import { getApps } from '../registry';
import { validatePromotion } from './promotion';

/** Core check — returns a list of violation messages (empty = OK). */
export function checkPromotions(root: string): string[] {
  const failures: string[] = [];
  for (const app of getApps()) {
    for (const m of validatePromotion(app, root)) failures.push(m);
  }
  return failures;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const failures = checkPromotions(process.cwd());
  for (const m of failures) console.error(`✗ ${m}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} promotion-gate violation(s).`);
    process.exit(1);
  }
  console.log('guard:promotions OK');
}
