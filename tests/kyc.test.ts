// Redteam probes B.1–B.8 for apps/kyc, made reproducible as vitest tests.
// Happy paths cover claim → approve/reject → reopen once.
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq, desc } from 'drizzle-orm';
import { executeAction } from '@platform/actions/mutate';
import { getDb, type DB } from '@platform/data/client';
import { query } from '@platform/data/query';
import { auditLog, approvalRequests } from '@platform/data/schema';
import { sensitiveFieldNames } from '@platform/policy/sensitive-fields';
import { kycReviews } from '../apps/kyc/schema';
import { kycActions } from '../apps/kyc/actions';
import type { SeedUser } from '@platform/policy/roles';

// Seeded users (decideApproval re-checks requester perms, so requesters must
// be real seeded accounts).
const analyst: SeedUser = { id: 'u-analyst', name: 'Ana', role: 'analyst', teamId: 'kyc' };
const senior: SeedUser = { id: 'u-senior', name: 'Sam', role: 'senior_reviewer', teamId: 'kyc' };
const compliance: SeedUser = {
  id: 'u-compliance',
  name: 'Cora',
  role: 'compliance_readonly',
  teamId: 'compliance',
};
const engAdmin: SeedUser = { id: 'u-engadmin', name: 'Ada', role: 'eng_admin', teamId: 'eng' };
const finance: SeedUser = {
  id: 'u-finance',
  name: 'Finn',
  role: 'finance_approver',
  teamId: 'finance',
};

let db: DB;
let seq = 0;
beforeAll(async () => {
  db = await getDb('sandbox');
});

async function auditsFor(actionId: string, entityId?: string) {
  const clauses = [eq(auditLog.actionId, actionId)];
  if (entityId) clauses.push(eq(auditLog.entityId, entityId));
  return db
    .select()
    .from(auditLog)
    .where(and(...clauses))
    .orderBy(desc(auditLog.id));
}

async function latestAudit(actionId: string, entityId?: string) {
  return (await auditsFor(actionId, entityId))[0];
}

async function makeCase(
  over: {
    status?: string;
    assigneeId?: string | null;
    riskScore?: string;
    resubmissionCount?: number;
    dueAt?: Date;
    teamId?: string;
  } = {},
) {
  const id = crypto.randomUUID();
  seq += 1;
  await db.insert(kycReviews).values({
    id,
    customerRef: `PROBE-${String(seq).padStart(3, '0')}`,
    fullName: 'Probe Customer',
    dateOfBirth: '1990-01-01',
    country: 'FR',
    idDocumentType: 'passport',
    idDocumentNumber: 'DOC000001',
    riskScore: over.riskScore ?? 'low',
    status: over.status ?? 'pending',
    assigneeId: over.assigneeId ?? null,
    teamId: over.teamId ?? 'kyc',
    dueAt: over.dueAt ?? new Date(Date.now() + 48 * 3600e3),
    resubmissionCount: over.resubmissionCount ?? 0,
  });
  return id;
}

async function getCase(id: string) {
  const [row] = await db.select().from(kycReviews).where(eq(kycReviews.id, id));
  return row;
}

describe('kyc app — happy paths', () => {
  it('fixtures loaded: >=40 rows covering all four statuses, some overdue', async () => {
    const rows = await db.select().from(kycReviews);
    expect(rows.length).toBeGreaterThanOrEqual(40);
    const statuses = new Set(rows.map((r) => r.status));
    for (const s of ['pending', 'in_review', 'approved', 'rejected']) {
      expect(statuses.has(s)).toBe(true);
    }
    const overdue = rows.filter(
      (r) => r.status === 'pending' && r.dueAt.getTime() < Date.now(),
    );
    expect(overdue.length).toBeGreaterThanOrEqual(1);
  });

  it('analyst claims a pending case → in_review + assignee, audit row', async () => {
    const id = await makeCase({ status: 'pending' });
    const res = await executeAction(analyst, 'kyc.claim', { id });
    expect(res.status).toBe('ok');
    const row = await getCase(id);
    expect(row.status).toBe('in_review');
    expect(row.assigneeId).toBe('u-analyst');
    const audit = await latestAudit('kyc.claim', id);
    expect(audit.status).toBe('ok');
  });

  it('analyst claims then approves a low-risk case → approved + decidedBy u-analyst', async () => {
    const id = await makeCase({ status: 'pending', riskScore: 'low' });
    expect((await executeAction(analyst, 'kyc.claim', { id })).status).toBe('ok');
    const res = await executeAction(analyst, 'kyc.approve', { id, reason: 'Docs verified' });
    expect(res.status).toBe('ok');
    const row = await getCase(id);
    expect(row.status).toBe('approved');
    expect(row.decidedBy).toBe('u-analyst');
  });

  it('senior claims then approves a low-risk case → approved + decidedBy + note', async () => {
    const id = await makeCase({ status: 'pending', riskScore: 'low' });
    expect((await executeAction(senior, 'kyc.claim', { id })).status).toBe('ok');
    const res = await executeAction(senior, 'kyc.approve', { id, reason: 'Docs verified' });
    expect(res.status).toBe('ok');
    const row = await getCase(id);
    expect(row.status).toBe('approved');
    expect(row.decidedBy).toBe('u-senior');
    expect(row.decisionReason).toBe('Docs verified');
    expect(row.decidedAt).not.toBeNull();
  });

  it('senior rejects with a reason → rejected + note', async () => {
    const id = await makeCase({ status: 'pending' });
    expect((await executeAction(senior, 'kyc.claim', { id })).status).toBe('ok');
    const res = await executeAction(senior, 'kyc.reject', { id, reason: 'Blurry scan' });
    expect(res.status).toBe('ok');
    const row = await getCase(id);
    expect(row.status).toBe('rejected');
    expect(row.decisionReason).toBe('Blurry scan');
  });

  it('reject without a reason → validation_error', async () => {
    const id = await makeCase({ status: 'in_review', assigneeId: 'u-senior' });
    const res = await executeAction(senior, 'kyc.reject', { id });
    expect(res.status).toBe('validation_error');
  });

  it('reopen a rejected case once → pending, unassigned, count 1, due +48h; second reopen fails', async () => {
    const id = await makeCase({ status: 'rejected', resubmissionCount: 0, assigneeId: 'u-analyst' });
    const res = await executeAction(analyst, 'kyc.reopen', { id });
    expect(res.status).toBe('ok');
    const row = await getCase(id);
    expect(row.status).toBe('pending');
    expect(row.assigneeId).toBeNull();
    expect(row.resubmissionCount).toBe(1);
    expect(row.decidedBy).toBeNull();
    expect(row.dueAt.getTime()).toBeGreaterThan(Date.now() + 47 * 3600e3);

    const again = await executeAction(analyst, 'kyc.reopen', { id });
    expect(again.status).toBe('failed');
    const row2 = await getCase(id);
    expect(row2.status).toBe('pending'); // unchanged by the failed attempt
    expect(row2.resubmissionCount).toBe(1);
  });

  it('reopen a case already re-reviewed (resubmissionCount >= 1) → failed', async () => {
    const id = await makeCase({ status: 'rejected', resubmissionCount: 1 });
    const res = await executeAction(analyst, 'kyc.reopen', { id });
    expect(res.status).toBe('failed');
    const row = await getCase(id);
    expect(row.status).toBe('rejected');
  });
});

describe('kyc redteam probes', () => {
  it('B.1 masking: PII masked via query(); audit row contains no raw PII', async () => {
    const id = await makeCase({ status: 'in_review', assigneeId: 'u-senior' });
    const { rows } = await query({ db, user: analyst }, kycReviews, {
      where: eq(kycReviews.id, id),
    });
    expect(rows.length).toBe(1);
    const r = rows[0];
    for (const key of ['fullName', 'dateOfBirth', 'idDocumentNumber']) {
      expect(String(r[key]).startsWith('••••')).toBe(true);
      expect(String(r[key])).not.toBe('Probe Customer');
      expect(String(r[key])).not.toBe('1990-01-01');
      expect(String(r[key])).not.toBe('DOC000001');
    }
    // Non-sensitive columns stay readable.
    expect(r.customerRef).toMatch(/^PROBE-/);

    const res = await executeAction(senior, 'kyc.approve', { id, reason: 'mask probe' });
    expect(res.status).toBe('ok');
    for (const a of await auditsFor('kyc.approve', id)) {
      expect(JSON.stringify({ before: a.beforeJson, after: a.afterJson })).not.toContain(
        'Probe Customer',
      );
      expect(JSON.stringify({ before: a.beforeJson, after: a.afterJson })).not.toContain(
        'DOC000001',
      );
    }
  });

  it('B.2 reveal: analyst denied; senior reveals real value + audit row', async () => {
    const id = await makeCase({ status: 'pending' });
    const denied = await executeAction(analyst, 'platform.revealField', {
      appId: 'kyc',
      table: 'kyc_reviews',
      column: 'fullName',
      rowId: id,
    });
    expect(denied.status).toBe('failed');
    expect(denied.status === 'failed' ? denied.code : '').toBe('permission_denied');

    const allowed = await executeAction(senior, 'platform.revealField', {
      appId: 'kyc',
      table: 'kyc_reviews',
      column: 'fullName',
      rowId: id,
    });
    expect(allowed.status).toBe('ok');
    expect(allowed.status === 'ok' ? (allowed.data as { value: unknown }).value : null).toBe(
      'Probe Customer',
    );
    const audit = await latestAudit('platform.revealField', id);
    expect(audit.entity).toBe('kyc_reviews');
    expect(audit.status).toBe('ok');
  });

  it('B.3 permission: compliance_readonly lacks kyc.decide → permission_denied + audit', async () => {
    const id = await makeCase({ status: 'in_review', assigneeId: 'u-compliance' });
    const res = await executeAction(compliance, 'kyc.approve', { id });
    expect(res.status).toBe('failed');
    expect(res.status === 'failed' ? res.code : '').toBe('permission_denied');
    // Failed attempts are audited with entityId null, so filter by action only.
    const audit = await latestAudit('kyc.approve');
    expect(audit.status).toBe('failed:permission_denied');
  });

  it('B.3 read-only role: compliance cannot claim, reopen, or decide', async () => {
    const claimId = await makeCase({ status: 'pending' });
    const claim = await executeAction(compliance, 'kyc.claim', { id: claimId });
    expect(claim.status).toBe('failed');
    expect((await getCase(claimId)).status).toBe('pending');
    expect((await getCase(claimId)).assigneeId).toBeNull();

    const reopenId = await makeCase({ status: 'rejected', resubmissionCount: 0 });
    const reopen = await executeAction(compliance, 'kyc.reopen', { id: reopenId });
    expect(reopen.status).toBe('failed');
    expect((await getCase(reopenId)).status).toBe('rejected');

    const decideId = await makeCase({ status: 'in_review', assigneeId: 'u-compliance' });
    const decide = await executeAction(compliance, 'kyc.approve', { id: decideId });
    expect(decide.status).toBe('failed');
    expect(decide.status === 'failed' ? decide.code : '').toBe('permission_denied');
  });

  it('B.3 claim is exclusive: claiming a case already held by someone else fails', async () => {
    // ctx.records.claim rejects an already-assigned row unless the caller
    // holds admin.manage — analysts get a hard failure, nothing changes hands.
    const id = await makeCase({ status: 'pending', assigneeId: 'u-senior' });
    const res = await executeAction(analyst, 'kyc.claim', { id });
    expect(res.status).toBe('failed');
    const row = await getCase(id);
    expect(row.assigneeId).toBe('u-senior');
    expect(row.status).toBe('pending');
  });

  it('B.4 scope: team-scoped roles cannot see or act on another team’s cases', async () => {
    const id = await makeCase({ status: 'pending', teamId: 'other' });
    const analystView = await query({ db, user: analyst }, kycReviews, {
      where: eq(kycReviews.id, id),
    });
    expect(analystView.rows.length).toBe(0);
    const seniorView = await query({ db, user: senior }, kycReviews, {
      where: eq(kycReviews.id, id),
    });
    expect(seniorView.rows.length).toBe(0);
    const complianceView = await query({ db, user: compliance }, kycReviews, {
      where: eq(kycReviews.id, id),
    });
    expect(complianceView.rows.length).toBe(1);

    const claim = await executeAction(analyst, 'kyc.claim', { id });
    expect(claim.status).toBe('failed');
    expect((await getCase(id)).status).toBe('pending');
    expect((await getCase(id)).assigneeId).toBeNull();
  });

  it('B.5 approval: high-risk decide by analyst needs senior sign-off in the Inbox', async () => {
    const id = await makeCase({ status: 'pending', riskScore: 'high' });
    expect((await executeAction(analyst, 'kyc.claim', { id })).status).toBe('ok');
    const res = await executeAction(analyst, 'kyc.approve', { id, reason: 'looks fine' });
    expect(res.status).toBe('needs_approval');
    const requestId = res.status === 'needs_approval' ? res.requestId : '';
    expect(requestId).toBeTruthy();
    const [req] = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, requestId));
    expect(req.status).toBe('pending');
    expect(req.actionId).toBe('kyc.approve');
    expect(req.requesterId).toBe('u-analyst');

    // Requester cannot self-approve (notSelf).
    const self = await executeAction(analyst, 'platform.approve', { requestId });
    expect(self.status).toBe('failed');

    // Finance holds approvals.manage but is not a senior_reviewer → role mismatch.
    const financeApprove = await executeAction(finance, 'platform.approve', { requestId });
    expect(financeApprove.status).toBe('failed');

    // A senior_reviewer decides the request — the original action re-runs as
    // the analyst and stamps decidedBy from ctx.approvedBy.
    const decided = await executeAction(senior, 'platform.approve', { requestId });
    expect(decided.status).toBe('ok');
    const [reqAfter] = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, requestId));
    expect(reqAfter.status).toBe('executed');
    const row = await getCase(id);
    expect(row.status).toBe('approved');
    expect(row.decidedBy).toBe('u-senior');
    expect(row.assigneeId).toBe('u-analyst');
    const audit = await latestAudit('kyc.approve', id);
    expect(audit.status).toBe('ok');

    // A second non-senior approver cannot re-decide (also fails the role check).
    const again = await executeAction(engAdmin, 'platform.approve', { requestId });
    expect(again.status).toBe('failed');
  });

  it('B.5 senior decides a high-risk case directly — no approval needed', async () => {
    const id = await makeCase({ status: 'pending', riskScore: 'high' });
    expect((await executeAction(senior, 'kyc.claim', { id })).status).toBe('ok');
    const res = await executeAction(senior, 'kyc.approve', { id, reason: 'verified in person' });
    expect(res.status).toBe('ok');
    const row = await getCase(id);
    expect(row.status).toBe('approved');
    expect(row.decidedBy).toBe('u-senior');
  });

  it('B.5 only the claimer can decide: senior cannot decide a case assigned to someone else', async () => {
    const id = await makeCase({ status: 'in_review', assigneeId: 'u-analyst', riskScore: 'low' });
    const res = await executeAction(senior, 'kyc.approve', { id });
    expect(res.status).toBe('failed');
    expect((await getCase(id)).status).toBe('in_review');
  });

  it('B.6 idempotency: deciding twice → cached ok, no extra audit rows; reject after approve fails', async () => {
    const id = await makeCase({ status: 'in_review', assigneeId: 'u-senior', riskScore: 'low' });
    const first = await executeAction(senior, 'kyc.approve', { id, reason: 'first' });
    expect(first.status).toBe('ok');
    const auditsAfterFirst = (await auditsFor('kyc.approve', id)).filter(
      (a) => a.status === 'ok',
    ).length;
    expect(auditsAfterFirst).toBeGreaterThan(0);

    const second = await executeAction(senior, 'kyc.approve', { id, reason: 'first' });
    expect(second.status).toBe('ok'); // idempotency replay — no re-run
    const auditsAfterSecond = (await auditsFor('kyc.approve', id)).filter(
      (a) => a.status === 'ok',
    ).length;
    expect(auditsAfterSecond).toBe(auditsAfterFirst);

    // Terminal state: reject after approve is an invalid transition.
    const reject = await executeAction(senior, 'kyc.reject', { id, reason: 'too late' });
    expect(reject.status).toBe('failed');
    expect((await getCase(id)).status).toBe('approved');
  });

  it('B.7 failure path: deciding a pending case fails run_error, row unchanged, audit failed', async () => {
    const id = await makeCase({ status: 'pending', assigneeId: 'u-senior', riskScore: 'low' });
    const res = await executeAction(senior, 'kyc.approve', { id });
    expect(res.status).toBe('failed');
    expect(res.status === 'failed' ? res.code : '').toBe('run_error');
    const row = await getCase(id);
    expect(row.status).toBe('pending');
    expect(row.decidedBy).toBeNull();
    // Failed attempts are audited with entityId null, so filter by action only.
    const audit = await latestAudit('kyc.approve');
    expect(audit.status).toBe('failed:run_error');
  });

  it('B.8 PII in inputs: no kyc action input key is a sensitive field name', async () => {
    for (const a of kycActions) {
      const shape = (a.input as { shape?: Record<string, unknown> }).shape ?? {};
      for (const key of Object.keys(shape)) {
        expect(sensitiveFieldNames as readonly string[]).not.toContain(key);
      }
    }
  });
});
