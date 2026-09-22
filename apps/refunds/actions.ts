import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { defineAction } from '@platform/actions/define';
import { dualControl } from '@platform/approvals';
import { refunds, transactions } from './schema';

const APPROVAL_THRESHOLD_CENTS = 10_000;

export const requestInput = z.object({
  transactionId: z.string().uuid().max(64),
  reason: z.string().min(1).max(500),
});

// Request a refund for a transaction's full amount. Approval is decided from
// the real transaction row — never the request body — so a caller cannot send
// a small amount to skip dual control. Missing row -> require approval.
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
    // Lock the row first: concurrent requests for the same transaction
    // serialize here, and the status check can't be raced.
    const txn = await ctx.records.lock(transactions, i.transactionId);
    if (txn.status !== 'settled') {
      throw new Error(`Transaction ${i.transactionId} is '${txn.status}' — only 'settled' transactions may be refunded`);
    }
    // Record intent BEFORE calling the processor: an 'issued'/'pending' row
    // (plus the partial unique index) blocks any concurrent double-refund.
    const row = await ctx.records.insert(refunds, {
      transactionId: i.transactionId,
      amountCents: Number(txn.amountCents),
      reason: i.reason,
      status: 'pending',
      requesterId: ctx.user.id,
      approverId: ctx.approvedBy ?? null,
    });
    let result: { status: string; refundId?: string } | null = null;
    try {
      result = await ctx.integrations.payments.refund(
        i.transactionId,
        Number(txn.amountCents),
        `refund:${i.transactionId}`,
      );
    } catch {
      result = null;
    }
    if (result?.status === 'submitted') {
      await ctx.records.update(refunds, row.id as string, { status: 'issued', processorRef: result.refundId });
      await ctx.records.update(transactions, i.transactionId, { status: 'refunded' });
    } else {
      // Declined is terminal for this transaction in this app — no retry path.
      await ctx.records.update(refunds, row.id as string, { status: 'failed' });
      await ctx.records.update(transactions, i.transactionId, { status: 'refund_declined' });
    }
    return { id: row.id, status: result?.status === 'submitted' ? 'issued' : 'failed', refundId: result?.refundId ?? null };
  },
});

export const refundsActions = [request];
