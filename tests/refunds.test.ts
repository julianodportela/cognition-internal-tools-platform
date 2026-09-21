// Redteam probes B.3–B.8 for apps/refunds, made reproducible as vitest tests.
// Also covers the happy paths: <$100 executes immediately, >=$100 needs sign-off.
import { describe, it, expect, beforeAll } from 'vitest';
import { eq, desc } from 'drizzle-orm';
import { executeAction } from '@platform/actions/mutate';
import { getDb, type DB } from '@platform/data/client';
import { query } from '@platform/data/query';
import { auditLog, approvalRequests } from '@platform/data/schema';
import { refunds, transactions } from '../apps/refunds/schema';
import type { SeedUser } from '@platform/policy/roles';
import { engAdmin } from './helpers';

// Seeded users (decideApproval re-checks requester perms, so requesters must
// be real seeded accounts).
const analyst: SeedUser = { id: 'u-analyst', name: 'Ana', role: 'analyst', teamId: 'kyc' };
const support: SeedUser = { id: 'u-support', name: 'Sue', role: 'support_agent', teamId: 'support' };
const senior: SeedUser = { id: 'u-senior', name: 'Sam', role: 'senior_reviewer', teamId: 'kyc' };
const finance: SeedUser = { id: 'u-finance', name: 'Finn', role: 'finance_approver', teamId: 'finance' };
const engDev: SeedUser = { id: 'u-engdev', name: 'Dev', role: 'eng_dev', teamId: 'eng' };

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

async function makeTxn(over: { id?: string; amountCents?: number } = {}) {
  const id = over.id ?? crypto.randomUUID();
  await db.insert(transactions).values({
    id,
    customerId: 'cust-test',
    customerEmail: 'probe@example.test',
    cardLast4: '4242',
    amountCents: over.amountCents ?? 5_000,
    merchant: 'Probe Merchant',
    occurredAt: new Date(),
    status: 'settled',
  });
  return id;
}

describe('refunds app — happy paths', () => {
  it('fixtures loaded: 36 transactions, refunds seeded', async () => {
    const txns = await db.select().from(transactions);
    const refs = await db.select().from(refunds);
    expect(txns.length).toBeGreaterThanOrEqual(36);
    expect(refs.length).toBeGreaterThanOrEqual(4);
  });

  it('refund under $100 executes immediately and marks the txn refunded', async () => {
    const txnId = await makeTxn({ amountCents: 9_999 });
    const res = await executeAction(engDev, 'refunds.request', {
      transactionId: txnId,
      reason: 'Under threshold',
    });
    expect(res.status).toBe('ok');
    const [txn] = await db.select().from(transactions).where(eq(transactions.id, txnId));
    expect(txn.status).toBe('refunded');
    const [row] = await db.select().from(refunds).where(eq(refunds.transactionId, txnId));
    expect(row.status).toBe('issued');
    expect(row.processorRef).toMatch(/^rf_/);
    expect(row.requesterId).toBe('u-engdev');
  });

  it('refund of $100 or more needs finance sign-off (dualControl, notSelf)', async () => {
    const txnId = await makeTxn({ amountCents: 20_000 });
    const res = await executeAction(engDev, 'refunds.request', {
      transactionId: txnId,
      reason: 'Big refund',
    });
    expect(res.status).toBe('needs_approval');
    const requestId = res.status === 'needs_approval' ? res.requestId : '';

    // Requester cannot self-approve (B.5 notSelf).
    const self = await executeAction(engDev, 'platform.approve', { requestId });
    expect(self.status).toBe('failed');

    const decided = await executeAction(finance, 'platform.approve', { requestId });
    expect(decided.status).toBe('ok');
    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    expect(req.status).toBe('executed');
    const [row] = await db.select().from(refunds).where(eq(refunds.transactionId, txnId));
    expect(row.status).toBe('issued');

    // Second approve of the same request fails (B.5 double-decide).
    const again = await executeAction(finance, 'platform.approve', { requestId });
    expect(again.status).toBe('failed');
  });
});

describe('refunds redteam probes', () => {
  it('B.3 permission: support lacks refunds.issue → permission_denied + audit', async () => {
    const txnId = await makeTxn({ amountCents: 1_000 });
    const res = await executeAction(support, 'refunds.request', {
      transactionId: txnId,
      reason: 'Support attempt',
    });
    expect(res.status).toBe('failed');
    expect(res.status === 'failed' ? res.code : '').toBe('permission_denied');
    const audit = await latestAudit('refunds.request');
    expect(audit.status).toBe('failed:permission_denied');
  });

  it('B.3 permission: analyst lacks refunds.approve → reject denied', async () => {
    const res = await executeAction(analyst, 'refunds.reject', {
      id: 'anything',
      reason: 'nope',
    });
    expect(res.status).toBe('failed');
    expect(res.status === 'failed' ? res.code : '').toBe('permission_denied');
  });

  it('B.5 approval bypass: misleading input cannot skip dual control on a >=$100 txn', async () => {
    const txnId = await makeTxn({ amountCents: 99_000 });
    const res = await executeAction(engDev, 'refunds.request', {
      transactionId: txnId,
      reason: 'bypass attempt',
      amountCents: 1,
    });
    expect(res.status).toBe('needs_approval');
  });

  it('B.6 idempotency: same transaction requested twice → one refund row, cached second result', async () => {
    const txnId = await makeTxn({ amountCents: 3_000 });
    const input = { transactionId: txnId, reason: 'duplicate click' };
    const first = await executeAction(engDev, 'refunds.request', input);
    expect(first.status).toBe('ok');
    const second = await executeAction(engDev, 'refunds.request', input);
    expect(second.status).toBe('ok');
    const rows = await db.select().from(refunds).where(eq(refunds.transactionId, txnId));
    expect(rows.length).toBe(1);
  });

  it('B.6/B.5 backstop: a different requester cannot refund the same transaction again', async () => {
    const txnId = await makeTxn({ amountCents: 3_000 });
    const first = await executeAction(engDev, 'refunds.request', {
      transactionId: txnId,
      reason: 'first',
    });
    expect(first.status).toBe('ok');
    // Idempotency keys are global (not per-user): the second request gets the
    // cached first result and never re-runs — still exactly one refund row.
    const second = await executeAction(finance, 'refunds.request', {
      transactionId: txnId,
      reason: 'second attempt',
    });
    expect(second.status).toBe('ok');
    const rows = await db.select().from(refunds).where(eq(refunds.transactionId, txnId));
    expect(rows.length).toBe(1);
  });

  it('B.7 failure path: processor decline leaves state unchanged + failed audit', async () => {
    // Mock payments declines any txnId ending in 'F'.
    const txnId = await makeTxn({ id: crypto.randomUUID().replace(/.$/, 'F'), amountCents: 4_000 });
    const res = await executeAction(engDev, 'refunds.request', {
      transactionId: txnId,
      reason: 'should fail',
    });
    expect(res.status).toBe('failed');
    expect(res.status === 'failed' ? res.code : '').toBe('run_error');
    const [txn] = await db.select().from(transactions).where(eq(transactions.id, txnId));
    expect(txn.status).toBe('settled');
    const rows = await db.select().from(refunds).where(eq(refunds.transactionId, txnId));
    expect(rows.length).toBe(0);
    const audit = await latestAudit('refunds.request');
    expect(audit.status).toBe('failed:run_error');
  });

  it('B.1 masking: customer email + card masked via query(), real values only in db', async () => {
    const { rows } = await query({ db, user: finance }, transactions, { limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(String(r.customerEmail)).not.toContain('@example.test');
      expect(String(r.customerEmail).startsWith('••••')).toBe(true);
      expect(String(r.cardLast4)).not.toMatch(/^\d{4}$/);
      expect(String(r.cardLast4).startsWith('••••')).toBe(true);
    }
  });

  it('B.2 reveal gated: analyst denied, senior reveals + audit row', async () => {
    const [txn] = await db.select().from(transactions).limit(1);
    const denied = await executeAction(analyst, 'platform.revealField', {
      appId: 'refunds',
      table: 'transactions',
      column: 'customerEmail',
      rowId: String(txn.id),
    });
    expect(denied.status).toBe('failed');
    const allowed = await executeAction(senior, 'platform.revealField', {
      appId: 'refunds',
      table: 'transactions',
      column: 'customerEmail',
      rowId: String(txn.id),
    });
    expect(allowed.status).toBe('ok');
    const audit = await latestAudit('platform.revealField');
    expect(audit.entity).toBe('transactions');
  });
});
