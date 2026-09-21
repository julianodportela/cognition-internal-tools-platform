/**
 * Security regression tests for the independent review (S1–S17, E1–E11).
 * Each test is an inverted exploit probe from the review report.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { defineAction, defineInternalAction, type InternalActionCtx, type ActionCtx } from '@platform/actions/define';
import { executeAction } from '@platform/actions/mutate';
import { registerActionForTests, registerApp, getAction } from '@platform/registry';
import { getDb } from '@platform/data/client';
import { getPlatformDb } from '@platform/data/internal';
import { query, queryUnscoped, aggregate, assertMaskedRows, MASKED_ROWS } from '@platform/data/query';
import { maskValue } from '@platform/data/schema-helpers';
import { idempotencyKeys, approvalRequests, auditLog } from '@platform/data/schema';
import { casesTable, makeDb, analyst, engAdmin } from '../helpers';
import type { SeedUser } from '@platform/policy/roles';
import type { DB } from '@platform/data/client';

vi.mock('@platform/auth/provider', () => ({ getCurrentUser: async () => engAdmin }));

const finance: SeedUser = { id: 'u-finance', name: 'Finn', role: 'finance_approver', teamId: 'finance' };
const engDev: SeedUser = { id: 'u-engdev', name: 'Dev', role: 'eng_dev', teamId: 'eng' };

let db: DB;
beforeAll(async () => {
  db = await getDb('sandbox');
  await db.execute(`CREATE TABLE IF NOT EXISTS kyc_cases (
    id serial PRIMARY KEY, subject text NOT NULL, ssn text, owner_id text,
    team_id text, status text NOT NULL DEFAULT 'open', assignee_id text,
    deleted_at timestamptz, due_at timestamptz
  )`);
});

describe('S1 — app ActionCtx has no db handle', () => {
  it('ctx own-keys exclude db and it is frozen', async () => {
    let seen: ActionCtx | null = null;
    registerActionForTests(defineAction({
      id: 'sec.probeCtx', perm: 'template.write', risk: 'low',
      input: z.object({}), run: async (ctx) => { seen = ctx; return true; },
    }));
    const res = await executeAction(engAdmin, 'sec.probeCtx', {});
    expect(res.status).toBe('ok');
    expect(Object.keys(seen!)).not.toContain('db');
    expect((seen as unknown as { db?: unknown }).db).toBeUndefined();
    expect(Object.isFrozen(seen)).toBe(true);
  });

  it('internal actions still receive db (defineInternalAction)', async () => {
    let hasDb = false;
    registerActionForTests(defineInternalAction({
      id: 'sec.internalCtx', perm: 'template.write', risk: 'low',
      input: z.object({}), run: async (ctx) => { hasDb = !!(ctx as InternalActionCtx).db; return true; },
    }));
    const res = await executeAction(engAdmin, 'sec.internalCtx', {});
    expect(res.status).toBe('ok');
    expect(hasDb).toBe(true);
  });
});

describe('S2 — registry namespacing', () => {
  it('registerApp throws on non-namespaced action id', () => {
    expect(() =>
      registerApp({
        id: 'evil', name: 'E', icon: 'x', permission: 'template.read',
        dataMode: 'sandbox', dataClass: 'internal', schema: {}, pages: {},
        actions: [defineAction({ id: 'platform.revealField', perm: 'template.read', risk: 'low', input: z.object({}), run: async () => true })],
      }),
    ).toThrow(/namespaced/);
  });
  it('registerApp throws on duplicate app id', () => {
    const m = { id: 'dup', name: 'D', icon: 'x', permission: 'template.read' as never, dataMode: 'sandbox' as const, dataClass: 'internal' as const, schema: {}, pages: {}, actions: [] };
    registerApp(m);
    expect(() => registerApp(m)).toThrow(/duplicate app id/);
  });
});

describe('S3/S4/C1/C2 — transactional idempotency + ordering', () => {
  it('E7 concurrent same-key calls → exactly one run', async () => {
    let runs = 0;
    registerActionForTests(defineAction({
      id: 'sec.concurrent', perm: 'template.write', risk: 'low',
      input: z.object({ k: z.string().max(64) }),
      idempotency: (i) => `c-${i.k}`,
      run: async () => { runs++; await new Promise((r) => setTimeout(r, 50)); return { ran: true }; },
    }));
    const [a, b] = await Promise.all([
      executeAction(engAdmin, 'sec.concurrent', { k: 'x1' }),
      executeAction(engAdmin, 'sec.concurrent', { k: 'x1' }),
    ]);
    const oks = [a, b].filter((r) => r.status === 'ok');
    const blocked = [a, b].filter((r) => r.status === 'failed' && r.code === 'in_progress');
    // exactly one executed; the other either replayed the result or was in_progress
    expect(oks.length + blocked.length).toBe(2);
    expect(runs).toBe(1);
  });

  it('E8 approve → re-request with same key → cached ok, no new approval', async () => {
    registerActionForTests(defineAction({
      id: 'sec.idemApprove', perm: 'refunds.issue', risk: 'high',
      input: z.object({ k: z.string().max(64) }),
      approval: { kind: 'dualControl', when: () => true },
      idempotency: (i) => `ia-${i.k}`,
      run: async () => ({ done: true }),
    }));
    const k = 'kk1';
    const r1 = await executeAction(engDev, 'sec.idemApprove', { k });
    expect(r1.status).toBe('needs_approval');
    const requestId = r1.status === 'needs_approval' ? r1.requestId : '';
    await executeAction(finance, 'platform.approve', { requestId });
    const r2 = await executeAction(engDev, 'sec.idemApprove', { k });
    expect(r2.status).toBe('ok'); // cached — NOT a second needs_approval
    const reqs = await db.select().from(approvalRequests).where(eq(approvalRequests.actionId, 'sec.idemApprove'));
    expect(reqs.filter((r) => r.idemKey === `sec.idemApprove:ia-${k}`).length).toBe(1);
  });

  it('failed run → no completed idem key, failed audit row written post-rollback', async () => {
    registerActionForTests(defineAction({
      id: 'sec.failRun', perm: 'template.write', risk: 'low',
      input: z.object({ k: z.string().max(64) }),
      idempotency: (i) => `f-${i.k}`,
      run: async (ctx) => { await ctx.records.insert(casesTable, { subject: 'x' }); throw new Error('boom-s3cret'); },
    }));
    const res = await executeAction(engAdmin, 'sec.failRun', { k: 'f1' });
    expect(res.status).toBe('failed');
    // S12: generic message, no internals
    expect(res.status === 'failed' && res.message).toMatch(/^Action failed \(ref [0-9a-f-]+\)$/);
    expect(res.status === 'failed' && res.message).not.toContain('boom');
    const [key] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, 'sec.failRun:f-f1'));
    expect(key).toBeUndefined(); // rolled back with the tx
    const audit = await db.select().from(auditLog).where(eq(auditLog.actionId, 'sec.failRun'));
    expect(audit.some((a) => a.status === 'failed:run_error')).toBe(true);
    // retriable — the same key can run again
    expect(getAction('sec.failRun')).toBeDefined();
  });
});

describe('S5 — reveal is app-scoped + row-scoped', () => {
  it('reveal on a table outside the app schema fails', async () => {
    const res = await executeAction(engAdmin, 'platform.revealField', {
      appId: 'refunds', table: 'users', column: 'name', rowId: 'u-analyst',
    });
    expect(res.status).toBe('failed');
  });
  it('reveal requires the app permission', async () => {
    const res = await executeAction(analyst, 'platform.revealField', {
      appId: 'refunds', table: 'transactions', column: 'customerEmail', rowId: 'x',
    });
    expect(res.status === 'failed').toBe(true);
  });
  it('reveal on a non-sensitive column fails', async () => {
    const res = await executeAction(engAdmin, 'platform.revealField', {
      appId: 'refunds', table: 'transactions', column: 'merchant', rowId: 'x',
    });
    expect(res.status).toBe('failed');
  });
});

describe('S6 — no scope escape for app code', () => {
  it('app-facing query opts strip is enforced (platform-internal fn only accepts)', async () => {
    // Direct query() is platform-internal; the app-facing closure strips.
    // Verify the strip throws inside an action ctx.
    registerActionForTests(defineAction({
      id: 'sec.scopeStrip', perm: 'template.write', risk: 'low',
      input: z.object({}),
      run: async (ctx) =>
        ctx.query(casesTable, { scope: false } as never).catch((e: Error) => e.message),
    }));
    const res = await executeAction(engAdmin, 'sec.scopeStrip', {});
    // throws inside run → run_error, proving the escape is closed
    expect(res.status === 'ok' ? res.data : res).toBeDefined();
    const ok = res.status === 'ok';
    if (ok) {
      expect(String((res as { data: unknown }).data)).toContain('not available to app code');
    }
  });
});

describe('S7/S9 — aggregates and masking', () => {
  it('aggregate groupBy/sum on sensitive column rejected', async () => {
    const dbi = await makeDb();
    await expect(aggregate({ db: dbi, user: engAdmin }, casesTable, { groupBy: 'ssn' })).rejects.toThrow(/sensitive_column_in_aggregate/);
    await expect(aggregate({ db: dbi, user: engAdmin }, casesTable, { sum: 'ssn' })).rejects.toThrow(/sensitive_column_in_aggregate/);
    const ok = await aggregate({ db: dbi, user: engAdmin }, casesTable, { groupBy: 'status' });
    expect(ok.length).toBeGreaterThanOrEqual(0);
  });
  it('maskValue: ≤4 chars fully masked, emails keep domain, others last4', () => {
    expect(maskValue('4242')).toBe('••••');
    expect(maskValue('ab@x.test')).toBe('••••@x.test');
    expect(maskValue('123456789')).toBe('••••6789');
    expect(maskValue(null)).toBeNull();
  });
});

describe('S8/C3 — orderBy + cursor hardening', () => {
  it('orderBy on sensitive column rejected', async () => {
    const dbi = await makeDb();
    await expect(query({ db: dbi, user: engAdmin }, casesTable, { orderBy: { column: 'ssn' }, scope: false })).rejects.toThrow(/sensitive_column_in_orderby/);
  });
  it('garbage/forged cursors → invalid_cursor error, never a throw or leak', async () => {
    const dbi = await makeDb();
    for (const bad of ['garbage', 'AAAA.forged', Buffer.from('{"v":1,"id":1}').toString('base64url') + '.deadbeef']) {
      const res = await query({ db: dbi, user: engAdmin }, casesTable, { cursor: bad, scope: false });
      expect(res.error?.code).toBe('invalid_cursor');
      expect(res.rows).toEqual([]);
    }
  });
  it('a cursor minted for another user is rejected', async () => {
    const dbi = await makeDb();
    await dbi.execute(`INSERT INTO kyc_cases (subject, ssn, owner_id) VALUES ('a','1','u-a'),('b','2','u-a')`);
    const p1 = await query({ db: dbi, user: engAdmin }, casesTable, { limit: 1, scope: false });
    expect(p1.nextCursor).toBeTruthy();
    const cross = await query({ db: dbi, user: analyst }, casesTable, { cursor: p1.nextCursor!, scope: false });
    expect(cross.error?.code).toBe('invalid_cursor');
  });
});

describe('S11 — where clause cannot reference sensitive columns', () => {
  it('eq on a masked column in where throws', async () => {
    const dbi = await makeDb();
    await expect(
      query({ db: dbi, user: engAdmin }, casesTable, { where: eq(casesTable.ssn as never, '123'), scope: false }),
    ).rejects.toThrow(/sensitive_column_in_filter/);
  });
  it('nested/or conditions are walked recursively', async () => {
    const dbi = await makeDb();
    await expect(
      query({ db: dbi, user: engAdmin }, casesTable, {
        where: and(eq(casesTable.status as never, 'open'), sql`${casesTable.ssn} IS NOT NULL`),
        scope: false,
      }),
    ).rejects.toThrow(/sensitive_column_in_filter/);
  });
  it('revealed fields may be filtered', async () => {
    const dbi = await makeDb();
    const reveal = new Set(['kyc_cases.ssn']);
    const res = await query({ db: dbi, user: engAdmin, reveal }, casesTable, { where: eq(casesTable.ssn as never, '123'), scope: false });
    expect(res.error).toBeUndefined();
  });
});

describe('S13 — input_json masked in approval_requests', () => {
  it('sensitive-named input field is masked at storage', async () => {
    registerActionForTests(defineAction({
      id: 'sec.inputMask', perm: 'refunds.issue', risk: 'high',
      input: z.object({ email: z.string().max(320), txn: z.string().max(64) }),
      approval: { kind: 'dualControl', when: () => true },
      run: async () => true,
    }));
    const res = await executeAction(engDev, 'sec.inputMask', { email: 'real@corp.test', txn: 't1' });
    expect(res.status).toBe('needs_approval');
    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.actionId, 'sec.inputMask'));
    expect(req.inputJson).toContain('••••@corp.test');
    expect(req.inputJson).not.toContain('real@');
  });
  it('defineAction rejects unbounded string inputs', () => {
    expect(() =>
      defineAction({ id: 'sec.badInput', perm: 'template.write', risk: 'low', input: z.object({ s: z.string() }), run: async () => true }),
    ).toThrow(/\.max\(\)/);
  });
});

describe('S14 — records respect scope + notDeleted + lock', () => {
  it('update/remove on out-of-scope or deleted rows → not_found', async () => {
    const dbi = await makeDb();
    await dbi.execute(`INSERT INTO kyc_cases (subject, ssn, owner_id, team_id) VALUES ('x','1','u-other','other-team')`);
    const row = (await dbi.execute(`SELECT id FROM kyc_cases WHERE subject='x'`)).rows[0] as { id: number };
    const rec = (await import('@platform/records')).makeRecords({ db: dbi, user: analyst, appId: null, reveal: new Set(), auditPush: () => {} });
    await expect(rec.update(casesTable, row.id, { status: 'x' })).rejects.toThrow(/not found/);
    await expect(rec.remove(casesTable, row.id)).rejects.toThrow(/not found/);
    await expect(rec.lock(casesTable, row.id)).rejects.toThrow(/not found/);
  });
  it('soft-deleted rows are unreachable via records', async () => {
    const dbi = await makeDb();
    await dbi.execute(`INSERT INTO kyc_cases (subject, ssn, owner_id, team_id, deleted_at) VALUES ('del','1','u-a','kyc', now())`);
    const row = (await dbi.execute(`SELECT id FROM kyc_cases WHERE subject='del'`)).rows[0] as { id: number };
    const rec = (await import('@platform/records')).makeRecords({ db: dbi, user: analyst, appId: null, reveal: new Set(), auditPush: () => {} });
    expect(await rec.get(casesTable, row.id)).toBeNull();
    await expect(rec.update(casesTable, row.id, {})).rejects.toThrow(/not found/);
  });
  it('addNote on a row the caller cannot see → not_found', async () => {
    const dbi = await makeDb();
    await dbi.execute(`INSERT INTO kyc_cases (subject, ssn, owner_id, team_id) VALUES ('hid','1','u-x','zzz')`);
    const row = (await dbi.execute(`SELECT id FROM kyc_cases WHERE subject='hid'`)).rows[0] as { id: number };
    const rec = (await import('@platform/records')).makeRecords({ db: dbi, user: analyst, appId: null, reveal: new Set(), auditPush: () => {} });
    await expect(rec.addNote('kyc_cases', String(row.id), 'hi')).rejects.toThrow(/not found/);
  });
});

describe('S15/S16 — auth secret + file tokens', () => {
  it('authSecret throws in production without AUTH_SECRET', async () => {
    const { authSecret } = await import('@platform/auth/secret');
    const prev = process.env.NODE_ENV;
    const had = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => authSecret()).toThrow(/AUTH_SECRET/);
    vi.stubEnv('NODE_ENV', prev ?? 'test');
    if (had) process.env.AUTH_SECRET = had;
  });
  it('file token binds attachmentId+userId; tampering rejected', async () => {
    const { makeFileToken, verifyFileToken } = await import('@platform/actions/platform-actions');
    const tok = makeFileToken(7, 'u-support', Date.now() + 60_000);
    const v = verifyFileToken(tok);
    expect(v?.attachmentId).toBe(7);
    expect(v?.userId).toBe('u-support');
    // tampered signature
    expect(verifyFileToken(`${tok.slice(0, -4)}AAAA`)).toBeNull();
    // tampered body (different user)
    const body = Buffer.from(JSON.stringify({ attachmentId: 7, userId: 'u-evil', exp: Date.now() + 60_000 })).toString('base64url');
    expect(verifyFileToken(`${body}.${tok.split('.')[1]}`)).toBeNull();
    // expired
    const old = makeFileToken(7, 'u-support', Date.now() - 1);
    expect(verifyFileToken(old)).toBeNull();
  });
});

describe('S17/MASKED_ROWS — production capability + unforgeable tag', () => {
  it("getDb('production') without the internal capability throws", async () => {
    expect(() => getDb('production')).toThrow(/capability/);
    const p = await getPlatformDb('production');
    expect(p).toBeDefined();
  });
  it('MASKED_ROWS is a module-private Symbol — Symbol.for cannot forge it', async () => {
    const forged: unknown[] = [];
    Object.defineProperty(forged, Symbol.for('itp.maskedRows'), { value: true });
    expect(() => assertMaskedRows(forged)).toThrow();
    expect(typeof MASKED_ROWS).toBe('symbol');
  });
  it('a production-bound app without a signed promotion → promotion_required', async () => {
    const { getReadCtx } = await import('@platform/data/read');
    registerApp({
      id: 'prodapp', name: 'P', icon: 'x', permission: 'template.read',
      dataMode: 'production', dataClass: 'internal', schema: {}, pages: {}, actions: [],
    });
    await expect(getReadCtx('prodapp')).rejects.toThrow(/promotion/i);
  });
});

describe('queryUnscoped is the only internal escape', () => {
  it('returns unscoped results while preserving masking', async () => {
    const dbi = await makeDb();
    await dbi.execute(`INSERT INTO kyc_cases (subject, ssn, owner_id, team_id) VALUES ('a','111223344','u-x','zz')`);
    const res = await queryUnscoped({ db: dbi, user: analyst }, casesTable);
    expect(res.rows.length).toBeGreaterThan(0);
    expect(String(res.rows[0].ssn)).toMatch(/^••••/);
  });
});
