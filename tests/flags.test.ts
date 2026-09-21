// Redteam probes B.3–B.9 for apps/flags, made reproducible as vitest tests.
// Covers: fixtures, create, staging (immediate), production approvals
// (dualControl + eng_admin-restricted), stale-version rejection, idempotency,
// the mock-service failure path (key ending 'F'), archive rules, input hygiene,
// sandbox data mode, and the intentionally-unscoped row visibility.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { eq, and, isNull, lt, desc } from 'drizzle-orm';
import { z } from 'zod';
import { executeAction } from '@platform/actions/mutate';
import { getDb, type DB } from '@platform/data/client';
import { query } from '@platform/data/query';
import { auditLog, approvalRequests } from '@platform/data/schema';
import { sensitiveFieldNames } from '@platform/policy/sensitive-fields';
import { flags, flagChanges } from '../apps/flags/schema';
import { flagsActions, STALE_AFTER_DAYS } from '../apps/flags/actions';
import { flagsManifest } from '../apps/flags/manifest';
import type { SeedUser } from '@platform/policy/roles';

// Seeded users (decideApproval re-checks requester perms, so requesters must
// be real seeded accounts). engAdmin doubles as the "second engineer".
const analyst: SeedUser = { id: 'u-analyst', name: 'Ana', role: 'analyst', teamId: 'kyc' };
const support: SeedUser = { id: 'u-support', name: 'Sue', role: 'support_agent', teamId: 'support' };
const engDev: SeedUser = { id: 'u-engdev', name: 'Dev', role: 'eng_dev', teamId: 'eng' };
const engAdmin: SeedUser = { id: 'u-engadmin', name: 'Ada', role: 'eng_admin', teamId: 'eng' };

let db: DB;
beforeAll(async () => {
  db = await getDb('sandbox');
});

async function latestAudit(actionId: string) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.actionId, actionId))
    .orderBy(desc(auditLog.id))
    .limit(1);
  return rows[0];
}

async function changesFor(flagId: string) {
  return db.select().from(flagChanges).where(eq(flagChanges.flagId, flagId));
}

async function makeFlag(
  over: Partial<typeof flags.$inferInsert> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(flags).values({
    id,
    key: `probe-${crypto.randomUUID().slice(0, 8)}`,
    description: 'Probe flag',
    ownerTeam: 'eng',
    tags: '',
    version: 0,
    lastChangedBy: 'u-engdev',
    lastChangedAt: new Date(),
    ...over,
  });
  return id;
}

const envInput = (id: string, version = 0) => ({
  id,
  expectedVersion: version,
  enabled: true,
  rollout: 50,
});

describe('flags app — happy paths', () => {
  it('fixtures loaded: >=30 flags, >=40 flag_changes', async () => {
    const allFlags = await db.select().from(flags);
    const allChanges = await db.select().from(flagChanges);
    expect(allFlags.length).toBeGreaterThanOrEqual(30);
    expect(allChanges.length).toBeGreaterThanOrEqual(40);
  });

  it('create: engDev creates a flag, off everywhere, history row written', async () => {
    const res = await executeAction(engDev, 'flags.create', {
      key: `probe-create-${Date.now()}`,
      description: 'A probe flag',
      ownerTeam: 'eng',
      tags: 'payments',
    });
    expect(res.status).toBe('ok');
    const flagId = res.status === 'ok' ? (res.data as { id: string }).id : '';
    const [row] = await db.select().from(flags).where(eq(flags.id, flagId));
    expect(row.stagingEnabled).toBe(false);
    expect(row.productionEnabled).toBe(false);
    expect(row.version).toBe(0);
    const changes = await changesFor(flagId);
    expect(changes.length).toBe(1);
    expect(changes[0].change).toBe('created');
  });

  it('setStaging: applies immediately, bumps version, writes toggled + rollout history', async () => {
    const id = await makeFlag();
    const res = await executeAction(engDev, 'flags.setStaging', envInput(id));
    expect(res.status).toBe('ok');
    const [row] = await db.select().from(flags).where(eq(flags.id, id));
    expect(row.stagingEnabled).toBe(true);
    expect(row.stagingRollout).toBe(50);
    expect(row.version).toBe(1);
    expect(row.lastChangedBy).toBe('u-engdev');
    expect(Date.now() - row.lastChangedAt.getTime()).toBeLessThan(60_000);
    const changes = await changesFor(id);
    const toggled = changes.filter((c) => c.change === 'toggled');
    expect(toggled.length).toBe(1);
    expect(toggled[0].actorId).toBe('u-engdev');
    expect(toggled[0].approverId).toBeNull();
    expect(toggled[0].environment).toBe('staging');
    // rollout changed 0 → 50, so a 'rollout' history row exists too.
    expect(changes.some((c) => c.change === 'rollout')).toBe(true);
  });
});

describe('flags redteam probes', () => {
  it('B.3 permission: analyst create and support setStaging are denied + audited', async () => {
    const createRes = await executeAction(analyst, 'flags.create', {
      key: `probe-denied-${Date.now()}`,
      description: 'nope',
      ownerTeam: 'eng',
    });
    expect(createRes.status).toBe('failed');
    expect(createRes.status === 'failed' ? createRes.code : '').toBe('permission_denied');
    const createAudit = await latestAudit('flags.create');
    expect(createAudit.status).toBe('failed:permission_denied');

    const id = await makeFlag();
    const res = await executeAction(support, 'flags.setStaging', envInput(id));
    expect(res.status).toBe('failed');
    expect(res.status === 'failed' ? res.code : '').toBe('permission_denied');
  });

  it('B.5 production: dualControl on untagged flag; self-approve fails; admin approves', async () => {
    const id = await makeFlag();
    const res = await executeAction(engDev, 'flags.setProduction', envInput(id));
    expect(res.status).toBe('needs_approval');
    const requestId = res.status === 'needs_approval' ? res.requestId : '';

    const self = await executeAction(engDev, 'platform.approve', { requestId });
    expect(self.status).toBe('failed');

    const decided = await executeAction(engAdmin, 'platform.approve', { requestId });
    expect(decided.status).toBe('ok');
    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    expect(req.status).toBe('executed');
    const [row] = await db.select().from(flags).where(eq(flags.id, id));
    expect(row.productionEnabled).toBe(true);
    const changes = await changesFor(id);
    expect(changes.some((c) => c.approverId === 'u-engadmin')).toBe(true);

    const again = await executeAction(engAdmin, 'platform.approve', { requestId });
    expect(again.status).toBe('failed');
  });

  it('B.5 approval bypass: payments-tagged flag via setProduction fails even after approval', async () => {
    const id = await makeFlag({ tags: 'payments' });
    const res = await executeAction(engDev, 'flags.setProduction', envInput(id));
    // dualControl() always triggers — the policy cannot see the tags, the run() can.
    expect(res.status).toBe('needs_approval');
    const requestId = res.status === 'needs_approval' ? res.requestId : '';

    const decided = await executeAction(engAdmin, 'platform.approve', { requestId });
    // run() throws "tagged payments — use flags.setProductionRestricted"; the
    // whole decision transaction rolls back → approve reports failure.
    expect(decided.status).toBe('failed');
    const [row] = await db.select().from(flags).where(eq(flags.id, id));
    expect(row.productionEnabled).toBe(false);
    expect(row.version).toBe(0);
    const audit = await latestAudit('platform.approve');
    expect(audit.status.startsWith('failed:')).toBe(true);
  });

  it('B.5 restricted path: payments flag needs eng_admin; untagged flag is refused', async () => {
    const id = await makeFlag({ tags: 'payments' });
    const res = await executeAction(engDev, 'flags.setProductionRestricted', envInput(id));
    expect(res.status).toBe('needs_approval');
    const requestId = res.status === 'needs_approval' ? res.requestId : '';

    // engDev lacks the eng_admin role → cannot decide.
    const devDecide = await executeAction(engDev, 'platform.approve', { requestId });
    expect(devDecide.status).toBe('failed');

    const decided = await executeAction(engAdmin, 'platform.approve', { requestId });
    expect(decided.status).toBe('ok');
    const [row] = await db.select().from(flags).where(eq(flags.id, id));
    expect(row.productionEnabled).toBe(true);

    // Wrong direction: restricted action on an UNtagged flag → run() refuses.
    const plain = await makeFlag();
    const r2 = await executeAction(engDev, 'flags.setProductionRestricted', envInput(plain));
    expect(r2.status).toBe('needs_approval');
    const req2 = r2.status === 'needs_approval' ? r2.requestId : '';
    const d2 = await executeAction(engAdmin, 'platform.approve', { requestId: req2 });
    expect(d2.status).toBe('failed');
    const [plainRow] = await db.select().from(flags).where(eq(flags.id, plain));
    expect(plainRow.productionEnabled).toBe(false);
    expect(plainRow.version).toBe(0);
  });

  it('B.5 stale version: expectedVersion mismatch fails, row unchanged', async () => {
    const id = await makeFlag();
    const res = await executeAction(engDev, 'flags.setStaging', envInput(id, 5));
    expect(res.status).toBe('failed');
    expect(res.status === 'failed' ? res.code : '').toBe('run_error');
    const [row] = await db.select().from(flags).where(eq(flags.id, id));
    expect(row.stagingEnabled).toBe(false);
    expect(row.version).toBe(0);
  });

  it('B.6 idempotency: same setStaging input twice → cached result, one history row', async () => {
    const id = await makeFlag();
    const input = envInput(id);
    const first = await executeAction(engDev, 'flags.setStaging', input);
    expect(first.status).toBe('ok');
    const second = await executeAction(engDev, 'flags.setStaging', input);
    expect(second.status).toBe('ok');
    const [row] = await db.select().from(flags).where(eq(flags.id, id));
    expect(row.version).toBe(1);
    const changes = await changesFor(id);
    expect(changes.filter((c) => c.change === 'toggled').length).toBe(1);
  });

  it('B.7 failure path: mock flag service rejects keys ending in F; nothing recorded', async () => {
    const id = await makeFlag({ key: `probe-reject-${crypto.randomUUID().slice(0, 6)}F` });
    const res = await executeAction(engDev, 'flags.setStaging', envInput(id));
    expect(res.status).toBe('failed');
    expect(res.status === 'failed' ? res.code : '').toBe('run_error');
    const [row] = await db.select().from(flags).where(eq(flags.id, id));
    expect(row.stagingEnabled).toBe(false);
    expect(row.version).toBe(0);
    const audit = await latestAudit('flags.setStaging');
    expect(audit.status).toBe('failed:run_error');
    const changes = await changesFor(id);
    expect(changes.length).toBe(0);
  });

  it('archive: only all-off flags archive; archived flags are read-only and kept', async () => {
    const onId = await makeFlag({ stagingEnabled: true, stagingRollout: 25 });
    const refused = await executeAction(engDev, 'flags.archive', { id: onId });
    expect(refused.status).toBe('failed');

    const id = await makeFlag();
    const res = await executeAction(engDev, 'flags.archive', { id });
    expect(res.status).toBe('ok');
    const [row] = await db.select().from(flags).where(eq(flags.id, id));
    expect(row.archivedAt).not.toBeNull();
    const changes = await changesFor(id);
    expect(changes.some((c) => c.change === 'archived')).toBe(true);

    // Archived: no further changes, no double-archive. Row is never deleted.
    const touch = await executeAction(engDev, 'flags.setStaging', { ...envInput(id), expectedVersion: 1 });
    expect(touch.status).toBe('failed');
    const again = await executeAction(engDev, 'flags.archive', { id });
    expect(again.status).toBe('failed');
    const stillThere = await db.select().from(flags).where(eq(flags.id, id));
    expect(stillThere.length).toBe(1);
  });

  it('B.8 input hygiene: no action input field name is a sensitive field', async () => {
    const names = new Set<string>(sensitiveFieldNames);
    for (const a of flagsActions) {
      const shape = (a.input as unknown as z.ZodObject<z.ZodRawShape>).shape;
      for (const field of Object.keys(shape)) {
        expect(names.has(field), `${a.id} input '${field}'`).toBe(false);
      }
    }
  });

  it('B.9 sandbox only: dataMode sandbox and no promotions file', async () => {
    expect(flagsManifest.dataMode).toBe('sandbox');
    expect(fs.existsSync('promotions/flags.yaml')).toBe(false);
  });

  it('stale: fixture flags older than 90d, unarchived, match the page predicate', async () => {
    const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86400000);
    const staleRows = await db
      .select()
      .from(flags)
      .where(and(isNull(flags.archivedAt), lt(flags.lastChangedAt, cutoff)));
    expect(staleRows.length).toBeGreaterThanOrEqual(5);
    const { rows } = await query(
      { db, user: engAdmin },
      flags,
      { where: and(isNull(flags.archivedAt), lt(flags.lastChangedAt, cutoff)), limit: 50 },
    );
    expect(rows.length).toBe(staleRows.length);
  });

  it('B.4 scope: flags have no owner/team column — analyst sees every flag (intended)', async () => {
    const { rows } = await query({ db, user: analyst }, flags, { limit: 50 });
    expect(rows.length).toBeGreaterThanOrEqual(30);
  });
});
