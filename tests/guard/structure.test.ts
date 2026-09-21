import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkStructure } from '../../platform/guard/check-structure';

function tmpRoot(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itp-struct-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'apps'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps', 'index.ts'), 'export const appManifests = [];');
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

describe('check-structure', () => {
  it('clean minimal repo → no violations', () => {
    const root = tmpRoot({ 'apps/demo/manifest.ts': 'export {}' });
    fs.writeFileSync(path.join(root, 'apps/index.ts'), "import './demo/manifest';");
    expect(checkStructure(root)).toEqual([]);
  });

  it('non-allowlisted file under apps/<id>/ flagged', () => {
    const root = tmpRoot({
      'apps/demo/manifest.ts': 'export {}',
      'apps/demo/sneaky.ts': 'export {}',
    });
    fs.writeFileSync(path.join(root, 'apps/index.ts'), "import './demo/manifest';");
    expect(checkStructure(root).join('\n')).toContain('sneaky.ts');
  });

  it('.js/.json files in app dirs are violations', () => {
    const root = tmpRoot({
      'apps/demo/manifest.ts': 'export {}',
      'apps/demo/config.json': '{}',
      'apps/demo/pages/hack.js': 'x',
    });
    fs.writeFileSync(path.join(root, 'apps/index.ts'), "import './demo/manifest';");
    const fails = checkStructure(root).join('\n');
    expect(fails).toContain('config.json');
    expect(fails).toContain('hack.js');
  });

  it('non-allowlisted file under templates/app/ flagged', () => {
    const root = tmpRoot({
      'templates/app/manifest.ts': 'export {}',
      'templates/app/evil.ts': 'export {}',
    });
    expect(checkStructure(root).join('\n')).toContain('templates/app/evil.ts');
  });

  it('unregistered app dir flagged', () => {
    const root = tmpRoot({ 'apps/orphan/manifest.ts': 'export {}' });
    expect(checkStructure(root).join('\n')).toContain('not registered');
  });

  it("getDb('production') outside allowed modules flagged", () => {
    const root = tmpRoot({
      'platform/evil.ts': "export const x = getDb('production');",
    });
    fs.mkdirSync(path.join(root, 'platform'), { recursive: true });
    expect(checkStructure(root).join('\n')).toContain('platform/evil.ts');
  });
});

describe('check-promotions (validatePromotion core)', () => {
  it('production app without yaml fails; valid yaml passes', async () => {
    const { validatePromotion } = await import('../../platform/guard/promotion');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'itp-promo-'));
    const app = { id: 'p1', dataMode: 'production' as const, dataClass: 'internal' as const, sources: ['t1'] };
    expect(validatePromotion(app, root).join()).toContain('missing');
    fs.mkdirSync(path.join(root, 'promotions'));
    fs.writeFileSync(
      path.join(root, 'promotions', 'p1.yaml'),
      'approved_by:\n  - eng_dev\napproved_at: 2026-01-01\ncommit: abc\nsources:\n  - t1\nredteam_passed: true\n',
    );
    expect(validatePromotion(app, root)).toEqual([]);
  });
  it('sensitive prod app needs >=2 approvers incl. security/compliance', async () => {
    const { validatePromotion } = await import('../../platform/guard/promotion');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'itp-promo2-'));
    fs.mkdirSync(path.join(root, 'promotions'));
    const app = { id: 'p2', dataMode: 'production' as const, dataClass: 'sensitive' as const, sources: [] };
    fs.writeFileSync(
      path.join(root, 'promotions', 'p2.yaml'),
      'approved_by:\n  - eng_dev\napproved_at: 2026-01-01\ncommit: abc\nsources: []\nredteam_passed: true\n',
    );
    const fails = validatePromotion(app, root).join('\n');
    expect(fails).toContain('>=2 approvers');
    // sandbox apps skip validation entirely
    expect(validatePromotion({ id: 's', dataMode: 'sandbox', dataClass: 'internal', sources: [] }, root)).toEqual([]);
  });
});
