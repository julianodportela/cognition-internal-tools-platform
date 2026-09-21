import { uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { platformTable, sensitive } from '@platform/data/schema-helpers';

// Canonical app table: demonstrates sensitive(), deleted_at (soft delete),
// assignee_id (claiming), due_at (SLA job) and team_id (row scoping).
export const expenseRequests = platformTable('expense_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  amountCents: integer('amount_cents').notNull(),
  status: text('status').notNull().default('draft'),
  requesterId: text('requester_id').notNull(),
  assigneeId: text('assignee_id'),
  dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
  receiptNote: text('receipt_note'),
  employeeEmail: sensitive(text('employee_email')),
  employeeBankLast4: sensitive(text('employee_bank_last4')),
  teamId: text('team_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
});

export const schema = { expense_requests: expenseRequests };
