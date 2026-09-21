import { z } from 'zod';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { defineAction, type GuardFixtureCtx } from '@platform/actions/define';
import { requiresRole } from '@platform/approvals';
import { defineStates } from '@platform/workflow';
import { kycReviews } from './schema';

export const kycFlow = defineStates({
  initial: 'pending',
  states: ['pending', 'in_review', 'approved', 'rejected'],
  transitions: [
    { from: 'pending', to: 'in_review' },
    { from: 'in_review', to: 'approved', perm: 'kyc.decide' },
    { from: 'in_review', to: 'rejected', perm: 'kyc.decide' },
    { from: 'rejected', to: 'pending' },
  ],
});

const idInput = z.object({ id: z.string().min(1).max(64) });
const REOPEN_LIMIT = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

// Guard fixtures pick a real seeded row so guard tests exercise a real run.
// The audit-completeness guard runs every action as the eng_admin user, so
// decide fixtures prefer an in_review case assigned to that user.
const pendingUnassigned = async ({ firstRow }: GuardFixtureCtx) => {
  const row = await firstRow(
    kycReviews,
    and(eq(kycReviews.status, 'pending'), isNull(kycReviews.assigneeId)),
  );
  if (!row) throw new Error("No fixture row in status 'pending' unassigned");
  return { id: String(row.id) };
};

const inReviewFor = (userId: string | undefined) => {
  const byAssignee = async (firstRow: GuardFixtureCtx['firstRow']) => {
    if (userId) {
      const mine = await firstRow(
        kycReviews,
        and(
          eq(kycReviews.status, 'in_review'),
          eq(kycReviews.assigneeId, userId),
          inArray(kycReviews.riskScore, ['low', 'medium']),
        ),
      );
      if (mine) return mine;
    }
    const row = await firstRow(kycReviews, eq(kycReviews.status, 'in_review'));
    if (!row) throw new Error("No fixture row in status 'in_review'");
    return row;
  };
  return byAssignee;
};

const rejectedReopenable = async ({ firstRow }: GuardFixtureCtx) => {
  const row = await firstRow(
    kycReviews,
    and(eq(kycReviews.status, 'rejected'), eq(kycReviews.resubmissionCount, 0)),
  );
  if (!row) throw new Error("No fixture row in status 'rejected' with resubmissionCount 0");
  return { id: String(row.id) };
};

export const claim = defineAction({
  id: 'kyc.claim',
  perm: 'kyc.decide', // read-only roles are denied by the platform, not by role checks
  risk: 'low',
  input: idInput,
  guardFixture: pendingUnassigned,
  run: async (ctx, i) => {
    const row = await ctx.records.get(kycReviews, i.id);
    if (!row) throw new Error(`Case ${i.id} not found`);
    if (row.status !== 'pending') {
      throw new Error(`Case ${i.id} is not pending`);
    }
    await ctx.records.claim(kycReviews, i.id);
    const updated = await kycFlow.transition(ctx, kycReviews, i.id, 'in_review');
    return { id: updated.id, status: updated.status, assigneeId: updated.assigneeId };
  },
});

const decideApproval = requiresRole('senior_reviewer', async (input, ctx) => {
  const row = await ctx.records.get(kycReviews, (input as { id: string }).id);
  // Missing row → require approval (fail closed). High-risk cases decided by
  // anyone who is not a senior reviewer need a senior's sign-off.
  return !row || (row.riskScore === 'high' && ctx.user.role !== 'senior_reviewer');
});

export const approve = defineAction({
  id: 'kyc.approve',
  perm: 'kyc.decide',
  risk: 'high',
  approval: decideApproval,
  idempotency: (i) => `approve:${i.id}`,
  rateLimit: { max: 30, windowSeconds: 60 },
  input: z.object({
    id: z.string().min(1).max(64),
    reason: z.string().max(1000).optional(),
  }),
  guardFixture: async ({ firstRow, user }) => {
    const row = await inReviewFor(user?.id)(firstRow);
    return { id: String(row.id), reason: 'Fixture approval' };
  },
  run: async (ctx, i) => {
    const row = await ctx.records.get(kycReviews, i.id);
    if (!row) throw new Error(`Case ${i.id} not found`);
    if (row.assigneeId !== ctx.user.id) {
      throw new Error('Only the analyst who claimed this case can decide it');
    }
    if (row.riskScore === 'high' && !ctx.approvedBy && ctx.user.role !== 'senior_reviewer') {
      throw new Error('High-risk cases need a senior reviewer sign-off');
    }
    const updated = await kycFlow.transition(ctx, kycReviews, i.id, 'approved');
    await ctx.records.update(kycReviews, i.id, {
      decidedBy: ctx.approvedBy ?? ctx.user.id,
      decidedAt: ctx.now,
      decisionReason: i.reason ?? null,
      updatedAt: ctx.now,
    });
    if (i.reason) {
      await ctx.records.addNote('kyc_reviews', i.id, `Approved: ${i.reason}`);
    }
    return { id: updated.id, status: updated.status };
  },
});

export const reject = defineAction({
  id: 'kyc.reject',
  perm: 'kyc.decide',
  risk: 'high',
  approval: decideApproval,
  idempotency: (i) => `reject:${i.id}`,
  rateLimit: { max: 30, windowSeconds: 60 },
  input: z.object({
    id: z.string().min(1).max(64),
    reason: z.string().min(1).max(1000),
  }),
  guardFixture: async ({ firstRow, user }) => {
    const row = await inReviewFor(user?.id)(firstRow);
    return { id: String(row.id), reason: 'Fixture rejection' };
  },
  run: async (ctx, i) => {
    const row = await ctx.records.get(kycReviews, i.id);
    if (!row) throw new Error(`Case ${i.id} not found`);
    if (row.assigneeId !== ctx.user.id) {
      throw new Error('Only the analyst who claimed this case can decide it');
    }
    if (row.riskScore === 'high' && !ctx.approvedBy && ctx.user.role !== 'senior_reviewer') {
      throw new Error('High-risk cases need a senior reviewer sign-off');
    }
    const updated = await kycFlow.transition(ctx, kycReviews, i.id, 'rejected');
    await ctx.records.update(kycReviews, i.id, {
      decidedBy: ctx.approvedBy ?? ctx.user.id,
      decidedAt: ctx.now,
      decisionReason: i.reason,
      updatedAt: ctx.now,
    });
    await ctx.records.addNote('kyc_reviews', i.id, `Rejected: ${i.reason}`);
    return { id: updated.id, status: updated.status };
  },
});

export const reopen = defineAction({
  id: 'kyc.reopen',
  perm: 'kyc.decide',
  risk: 'low',
  input: idInput,
  guardFixture: rejectedReopenable,
  run: async (ctx, i) => {
    const row = await ctx.records.get(kycReviews, i.id);
    if (!row) throw new Error(`Case ${i.id} not found`);
    if (row.status !== 'rejected') {
      throw new Error(`Case ${i.id} is not rejected`);
    }
    if (Number(row.resubmissionCount) >= REOPEN_LIMIT) {
      throw new Error('This case has already been re-reviewed once');
    }
    const updated = await kycFlow.transition(ctx, kycReviews, i.id, 'pending');
    await ctx.records.update(kycReviews, i.id, {
      assigneeId: null,
      resubmissionCount: Number(row.resubmissionCount) + 1,
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      dueAt: new Date(ctx.now.getTime() + 2 * DAY_MS),
      updatedAt: ctx.now,
    });
    await ctx.records.addNote(
      'kyc_reviews',
      i.id,
      'Reopened for re-review after document resubmission',
    );
    return { id: updated.id, status: updated.status };
  },
});

export const kycActions = [claim, approve, reject, reopen];
