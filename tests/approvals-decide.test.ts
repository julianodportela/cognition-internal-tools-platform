// Two-layer approval model: platform.approve/platform.reject gate on the broad
// 'approvals.decide' perm; canDecide is the real per-request gate
// (dualControl → holds the action's perm OR approvals.manage override;
// requiresRole → matching role). Regression tests for the permissions split.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { executeAction } from '@platform/actions/mutate';
import { getDb, type DB } from '@platform/data/client';
import { approvalRequests } from '@platform/data/schema';
import { transactions } from '../apps/refunds/schema';
import type { SeedUser } from '@platform/policy/roles';

// Requesters must be real seeded accounts (decideApproval re-checks requester
// perms via userById); approvers can be fabricated SeedUsers since can() and
// canDecide read only role.
const support: SeedUser = { id: 'u-support', name: 'Sue', role: 'support_agent', teamId: 'support' };
const senior: SeedUser = { id: 'u-senior', name: 'Sam', role: 'senior_reviewer', teamId: 'kyc' };
const engDev: SeedUser = { id: 'u-engdev', name: 'Dev', role: 'eng_dev', teamId: 'eng' };
const engDev2: SeedUser = { id: 'u-engdev2', name: 'Dev2', role: 'eng_dev', teamId: 'eng' };
const compliance: SeedUser = { id: 'u-compliance', name: 'Cora', role: 'compliance_readonly', teamId: 'compliance' };

let db: DB;
beforeAll(async () => {
  db = await getDb('sandbox');
});

async function makeTxn(amountCents: number) {
  const id = crypto.randomUUID();
  await db.insert(transactions).values({
    id,
    customerId: 'cust-test',
    customerEmail: 'probe@example.test',
    cardLast4: '4242',
    amountCents,
    merchant: 'Probe Merchant',
    occurredAt: new Date(),
    status: 'settled',
  });
  return id;
}

async function requestStatus(requestId: string) {
  const [req] = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId));
  return req.status;
}

describe('approvals.decide layer — broad attempt gate', () => {
  it('compliance_readonly cannot call platform.approve at all (no approvals.decide)', async () => {
    const txnId = await makeTxn(20_000);
    const res = await executeAction(support, 'refunds.request', { transactionId: txnId, reason: 'Big' });
    const requestId = res.status === 'needs_approval' ? res.requestId : '';
    expect(requestId).toBeTruthy();
    const denied = await executeAction(compliance, 'platform.approve', { requestId });
    expect(denied.status).toBe('failed');
    expect(denied.status === 'failed' ? denied.code : '').toBe('permission_denied');
    expect(await requestStatus(requestId)).toBe('pending');
  });
});

describe('canDecide layer — per-request eligibility', () => {
  it('senior_reviewer CANNOT approve a dualControl request for an action whose perm they lack (approvals.manage removed)', async () => {
    // refunds.request needs refunds.issue; senior_reviewer holds neither it
    // nor the approvals.manage override anymore.
    const txnId = await makeTxn(20_000);
    const res = await executeAction(support, 'refunds.request', { transactionId: txnId, reason: 'Big' });
    expect(res.status).toBe('needs_approval');
    const requestId = res.status === 'needs_approval' ? res.requestId : '';
    const denied = await executeAction(senior, 'platform.approve', { requestId });
    expect(denied.status).toBe('failed');
    expect(await requestStatus(requestId)).toBe('pending');
    // And someone holding the action's perm (eng_dev has refunds.issue) can still decide.
    const allowed = await executeAction(engDev2, 'platform.approve', { requestId });
    expect(allowed.status).toBe('ok');
    expect(await requestStatus(requestId)).toBe('executed');
  });

  it('eng_dev CAN approve another eng_dev dualControl request (holds the action perm)', async () => {
    const txnId = await makeTxn(20_000);
    const res = await executeAction(engDev, 'refunds.request', { transactionId: txnId, reason: 'Peer review' });
    expect(res.status).toBe('needs_approval');
    const requestId = res.status === 'needs_approval' ? res.requestId : '';
    const decided = await executeAction(engDev2, 'platform.approve', { requestId });
    expect(decided.status).toBe('ok');
    expect(await requestStatus(requestId)).toBe('executed');
  });
});
