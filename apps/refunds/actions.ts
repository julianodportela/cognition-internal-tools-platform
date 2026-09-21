import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { defineAction } from '@platform/actions/define';
import { dualControl } from '@platform/approvals';
import { refunds, transactions } from './schema';

const APPROVAL_THRESHOLD_CENTS = 10_000;

export const requestInput = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

const refundIdInput = z.object({
  id: z.string().min(1),
  reason: z.string().min(1).max(500),
});

const ACTIVE_STATUSES = ['pending', 'approved', 'issued'];

// Request a refund for a transaction's full amount. Approval is decided from
// the real transaction row — never the request body — so a caller cannot send
// a small amount to skip dual control. Missing row → require approval.
export const request = defineAction({
  id: 'refunds.request',
  perm: 'refunds.issue',
  risk: 'high',
  tags: ['money', 'external'],
  approval: dualControl(async (i, ctx) => {
    const row = await ctx.records.get(transactions, (i as { transactionId: string }).transactionId);
    return !row || Number(row.amountCents) >= APPROVAL_THRESHOLD_CENTS;
  }),
  idempotency: (i) => `refund:${i.transactionId}`,
  rateLimit: { max: 20, windowSeconds: 60 },
  input: requestInput,
  guardFixture: async ({ firstRow }) => {
    const row = await firstRow(transactions, eq(transactions.status, 'settled'));
    if (!row) throw new Error("No fixture transaction in status 'settled'");
    return { transactionId: String(row.id), reason: 'Guard fixture refund' };
  },
  run: async (ctx, i) => {
    const txn = await ctx.records.get(transactions, i.transactionId);
    if (!txn) throw new Error(`Transaction ${i.transactionId} not found`);
    if (txn.status === 'refunded') {
      throw new Error(`Transaction ${i.transactionId} is already refunded`);
    }
    const existing = await ctx.query(refunds, {
      where: and(
        eq(refunds.transactionId, i.transactionId),
        inArray(refunds.status, ACTIVE_STATUSES),
      ),
      scope: false,
      limit: 1,
    });
    if (existing.rows.length > 0) {
      throw new Error(`Transaction ${i.transactionId} already has an active refund`);
    }
    const result = await ctx.integrations.payments.refund(
      i.transactionId,
      Number(txn.amountCents),
      `refund:${i.transactionId}`,
    );
    const row = await ctx.records.insert(refunds, {
      transactionId: i.transactionId,
      amountCents: Number(txn.amountCents),
      reason: i.reason,
      status: result.status === 'submitted' ? 'issued' : 'failed',
      requesterId: ctx.user.id,
      processorRef: result.refundId,
    });
    await ctx.records.update(transactions, i.transactionId, { status: 'refunded' });
    return { id: row.id, status: row.status, refundId: result.refundId };
  },
});

// Finance rejects a refund. Dual control always applies.
export const reject = defineAction({
  id: 'refunds.reject',
  perm: 'refunds.approve',
  risk: 'high',
  approval: dualControl(),
  input: refundIdInput,
  guardFixture: async ({ firstRow }) => {
    const row = await firstRow(refunds, eq(refunds.status, 'issued'));
    if (!row) throw new Error("No fixture refund in status 'issued'");
    return { id: String(row.id), reason: 'Fixture rejection' };
  },
  run: async (ctx, i) => {
    const row = await ctx.records.get(refunds, i.id);
    if (!row) throw new Error(`Refund ${i.id} not found`);
    if (row.status === 'rejected') throw new Error(`Refund ${i.id} is already rejected`);
    const updated = await ctx.records.update(refunds, i.id, { status: 'rejected' });
    await ctx.records.addNote('refunds', i.id, `Rejected: ${i.reason}`);
    return { id: updated.id, status: updated.status };
  },
});

export const refundsActions = [request, reject];
