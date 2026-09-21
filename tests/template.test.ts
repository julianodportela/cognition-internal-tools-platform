import { describe, it, expect, beforeAll } from 'vitest';
import { eq, desc } from 'drizzle-orm';
import { executeAction } from '@platform/actions/mutate';
import { getDb, type DB } from '@platform/data/client';
import { query } from '@platform/data/query';
import { auditLog, approvalRequests } from '@platform/data/schema';
import { expenseRequests } from '../templates/app/schema';
import type { SeedUser } from '@platform/policy/roles';
import { engAdmin } from './helpers';

const analyst: SeedUser = { id: 'u-analyst', name: 'Ana', role: 'analyst', teamId: 'kyc' };
const finance: SeedUser = { id: 'u-finance', name: 'Finn', role: 'finance_approver', teamId: 'finance' };
// Approval requesters must resolve to a real user (decideApproval re-checks
// their perms at execution time), so use the seeded eng_dev account here.
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

describe('template app end-to-end', () => {
  it('fixtures loaded 40 rows into sandbox', async () => {
    const all = await db.select().from(expenseRequests);
    expect(all.length).toBe(40);
  });

  it('masks sensitive columns in query results', async () => {
    const { rows } = await query({ db, user: engAdmin }, expenseRequests, { limit: 5 });
    expect(rows.length).toBe(5);
    const email = String(rows[0].employeeEmail);
    expect(email.startsWith('••••')).toBe(true);
    expect(email.endsWith('test')).toBe(true); // last4 of user@example.test
    expect(email).not.toContain('@');
  });

  it('revealField returns the real value and writes an audit row', async () => {
    const [row] = await db.select().from(expenseRequests).limit(1);
    const res = await executeAction(engAdmin, 'platform.revealField', {
      appId: 'template',
      table: 'expense_requests',
      column: 'employeeEmail',
      rowId: String(row.id),
    });
    expect(res.status).toBe('ok');
    const data = res.status === 'ok' ? (res.data as { value: string }) : { value: '' };
    expect(data.value).toMatch(/@example\.test$/);
    const audit = await latestAudit('platform.revealField');
    expect(audit).toBeTruthy();
    expect(audit.entity).toBe('expense_requests');
  });

  it('full lifecycle: create → submit → claim → approve → pay → archive', async () => {
    const created = await executeAction(analyst, 'template.create', {
      title: 'Lifecycle test',
      amountCents: 12_345,
      employeeEmail: 'lt@example.test',
    });
    expect(created.status).toBe('ok');
    const id = (created.status === 'ok' ? (created.data as { id: string }).id : '');

    expect((await executeAction(analyst, 'template.submit', { id })).status).toBe('ok');
    expect((await executeAction(analyst, 'template.claim', { id })).status).toBe('ok');

    // Low amount: dualControl predicate false → executes immediately.
    const approved = await executeAction(engAdmin, 'template.approve', { id, amountCents: 12_345 });
    expect(approved.status).toBe('ok');

    // pay is dualControl() unconditionally → needs_approval.
    const payRes = await executeAction(finance, 'template.pay', { id, txnId: `txn-${id}` });
    expect(payRes.status).toBe('needs_approval');
    const requestId = payRes.status === 'needs_approval' ? payRes.requestId : '';
    const decided = await executeAction(engAdmin, 'platform.approve', { requestId });
    expect(decided.status).toBe('ok');

    const [paid] = await db.select().from(expenseRequests).where(eq(expenseRequests.id, id));
    expect(paid.status).toBe('paid');

    expect((await executeAction(analyst, 'template.archive', { id })).status).toBe('ok');
    const { rows } = await query({ db, user: engAdmin }, expenseRequests, {
      where: eq(expenseRequests.id, id),
    });
    expect(rows.length).toBe(0); // soft-deleted hidden by default
  });

  it('approve over $500 routes through an approval request decided by finance', async () => {
    const [submitted] = await db
      .select()
      .from(expenseRequests)
      .where(eq(expenseRequests.status, 'submitted'))
      .limit(1);
    // The requester must hold template.approve themselves (perm check precedes
    // the approval gate), so engDev files and finance decides.
    const res = await executeAction(engDev, 'template.approve', {
      id: submitted.id,
      amountCents: 80_000,
    });
    expect(res.status).toBe('needs_approval');
    const requestId = res.status === 'needs_approval' ? res.requestId : '';

    // Requester cannot self-approve (notSelf).
    const self = await executeAction(engDev, 'platform.approve', { requestId });
    expect(self.status).toBe('failed');

    const decided = await executeAction(finance, 'platform.approve', { requestId });
    expect(decided.status).toBe('ok');
    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    expect(req.status).toBe('executed');
    const [row] = await db.select().from(expenseRequests).where(eq(expenseRequests.id, submitted.id));
    expect(row.status).toBe('approved');
  });

  it('failing payout leaves the row approved and audits failed:run_error', async () => {
    // Make a fresh approved row cheaply.
    const created = await executeAction(analyst, 'template.create', {
      title: 'Failing payout',
      amountCents: 9_999,
      employeeEmail: 'fp@example.test',
    });
    const id = created.status === 'ok' ? (created.data as { id: string }).id : '';
    await executeAction(analyst, 'template.submit', { id });
    await executeAction(engAdmin, 'template.approve', { id, amountCents: 9_999 });

    const payRes = await executeAction(finance, 'template.pay', { id, txnId: 'badtxnF' });
    const requestId = payRes.status === 'needs_approval' ? payRes.requestId : '';
    const decided = await executeAction(engAdmin, 'platform.approve', { requestId });
    expect(decided.status).toBe('failed');
    expect(decided.status === 'failed' ? decided.code : '').toBe('run_error');

    // The failed inner run rolls back the deciding transaction, so the request
    // stays pending (retryable); the durable record is the failed audit row.
    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    expect(req.status).toBe('pending');
    const [row] = await db.select().from(expenseRequests).where(eq(expenseRequests.id, id));
    expect(row.status).toBe('approved');
    const audit = await latestAudit('platform.approve');
    expect(audit.status).toBe('failed:run_error');
  });
});
