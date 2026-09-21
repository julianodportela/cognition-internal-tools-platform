import { uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { platformTable, sensitive, uniqueIndexOn } from '@platform/data/schema-helpers';

// Customer card transactions (read-only for the app) and the refunds issued
// against them. Emails and card digits are sensitive(): masked everywhere and
// only revealed via the audited platform.revealField action.
export const transactions = platformTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: text('customer_id').notNull(),
  customerEmail: sensitive(text('customer_email')),
  cardLast4: sensitive(text('card_last4')),
  amountCents: integer('amount_cents').notNull(),
  merchant: text('merchant').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  status: text('status').notNull().default('settled'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const refunds = platformTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: uuid('transaction_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('pending'),
  requesterId: text('requester_id').notNull(),
  approverId: text('approver_id'),
  processorRef: text('processor_ref'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
}, (t) => [
  // At most one open refund per transaction — belt-and-braces under the
  // action-level idempotency key. Declined/failed/refunded-in-full rows are
  // terminal, so they do not block a later legitimate retry by the platform.
  uniqueIndexOn(t.transactionId, 'refunds_txn_active_uniq', "status IN ('pending','issued')"),
]);

export const schema = { transactions, refunds };
