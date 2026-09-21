import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { defineAction } from '@platform/actions/define';
import { dualControl } from '@platform/approvals';
import { defineStates } from '@platform/workflow';
import { expenseRequests } from './schema';

export const expenseFlow = defineStates({
  initial: 'draft',
  states: ['draft', 'submitted', 'approved', 'rejected', 'paid'],
  transitions: [
    { from: 'draft', to: 'submitted' },
    { from: 'submitted', to: 'approved', perm: 'template.approve' },
    { from: 'submitted', to: 'rejected', perm: 'template.approve' },
    { from: 'approved', to: 'paid', perm: 'template.approve' },
  ],
});

export const createInput = z.object({
  title: z.string().min(1).max(200),
  amountCents: z.number().int().positive(),
  employeeEmail: z.string().min(3),
  employeeBankLast4: z.string().max(4).optional(),
  receiptNote: z.string().max(1000).optional(),
});

const idInput = z.object({ id: z.string().min(1) });

// Guard fixtures pick a real seeded row so guard tests exercise a real run.
const rowInStatus = async (db: never, status: string) => {
  const rows = await (db as {
    select: () => {
      from: (t: typeof expenseRequests) => {
        where: (w: unknown) => { limit: (n: number) => Promise<{ id: string; amountCents: number }[]> };
      };
    };
  })
    .select()
    .from(expenseRequests)
    .where(eq(expenseRequests.status, status))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`No fixture row in status '${status}'`);
  return row;
};

export const create = defineAction({
  id: 'template.create',
  perm: 'template.write',
  risk: 'low',
  input: createInput,
  guardFixture: () =>
    ({
      title: 'Guard fixture request',
      amountCents: 1_000,
      employeeEmail: 'guard@example.test',
    }) as z.infer<typeof createInput>,
  run: async (ctx, i) => {
    const row = await ctx.records.insert(expenseRequests, {
      title: i.title,
      amountCents: i.amountCents,
      status: 'draft',
      requesterId: ctx.user.id,
      teamId: ctx.user.teamId,
      employeeEmail: i.employeeEmail,
      employeeBankLast4: i.employeeBankLast4 ?? null,
      receiptNote: i.receiptNote ?? null,
    });
    return { id: row.id };
  },
});

export const submit = defineAction({
  id: 'template.submit',
  perm: 'template.write',
  risk: 'low',
  input: idInput,
  guardFixture: async ({ db }) => ({ id: (await rowInStatus(db as never, 'draft')).id }),
  run: async (ctx, i) => {
    const row = await expenseFlow.transition(ctx, expenseRequests, i.id, 'submitted');
    return { id: row.id, status: row.status };
  },
});

export const claim = defineAction({
  id: 'template.claim',
  perm: 'template.write',
  risk: 'low',
  input: idInput,
  guardFixture: async ({ db }) => ({ id: (await rowInStatus(db as never, 'submitted')).id }),
  run: async (ctx, i) => {
    const row = await ctx.records.claim(expenseRequests, i.id);
    return { id: row.id, assigneeId: row.assigneeId };
  },
});

export const approve = defineAction({
  id: 'template.approve',
  perm: 'template.approve',
  risk: 'high',
  approval: dualControl((i) => (i as { amountCents?: number }).amountCents! > 50_000),
  idempotency: (i) => `approve:${i.id}`,
  rateLimit: { max: 20, windowSeconds: 60 },
  input: z.object({ id: z.string().min(1), amountCents: z.number().int().positive() }),
  guardFixture: async ({ db }) => {
    const row = await rowInStatus(db as never, 'submitted');
    return { id: row.id, amountCents: row.amountCents };
  },
  run: async (ctx, i) => {
    const row = await expenseFlow.transition(ctx, expenseRequests, i.id, 'approved');
    return { id: row.id, status: row.status };
  },
});

export const reject = defineAction({
  id: 'template.reject',
  perm: 'template.approve',
  risk: 'high',
  approval: dualControl(),
  input: z.object({ id: z.string().min(1), reason: z.string().max(1000).optional() }),
  guardFixture: async ({ db }) => ({
    id: (await rowInStatus(db as never, 'submitted')).id,
    reason: 'Fixture rejection',
  }),
  run: async (ctx, i) => {
    const row = await expenseFlow.transition(ctx, expenseRequests, i.id, 'rejected');
    if (i.reason) {
      await ctx.records.addNote('expense_requests', i.id, `Rejected: ${i.reason}`);
    }
    return { id: row.id, status: row.status };
  },
});

export const pay = defineAction({
  id: 'template.pay',
  perm: 'template.approve',
  risk: 'high',
  tags: ['money', 'external'],
  approval: dualControl(),
  idempotency: (i) => `pay:${i.id}`,
  input: z.object({ id: z.string().min(1), txnId: z.string().min(1) }),
  guardFixture: async ({ db }) => {
    const row = await rowInStatus(db as never, 'approved');
    return { id: row.id, txnId: `txn-${row.id}` };
  },
  run: async (ctx, i) => {
    const row = await ctx.records.get(expenseRequests, i.id);
    if (!row || row.status !== 'approved') {
      throw new Error(`Request ${i.id} is not in 'approved' status`);
    }
    const result = await ctx.integrations.payments.refund(
      i.txnId,
      Number(row.amountCents),
      `pay:${i.id}`,
    );
    const paid = await expenseFlow.transition(ctx, expenseRequests, i.id, 'paid');
    return { id: paid.id, status: paid.status, refund: result };
  },
});

export const archive = defineAction({
  id: 'template.archive',
  perm: 'template.write',
  risk: 'low',
  input: idInput,
  guardFixture: async ({ db }) => ({ id: (await rowInStatus(db as never, 'rejected')).id }),
  run: async (ctx, i) => {
    await ctx.records.remove(expenseRequests, i.id);
    return { id: i.id, archived: true };
  },
});

export const templateActions = [create, submit, claim, approve, reject, pay, archive];
