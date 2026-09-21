import { uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { platformTable, sensitive } from '@platform/data/schema-helpers';

// One KYC case per customer sign-up. Named kyc_reviews (not kyc_cases — that
// name is taken by a test-local table in tests/helpers.ts).
// Personal fields are sensitive(): masked everywhere and only revealed via
// the audited platform.revealField action. No owner_id: the 'own' scope
// falls back to team_id so analysts see the whole KYC team queue.
export const kycReviews = platformTable('kyc_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerRef: text('customer_ref').notNull(),
  fullName: sensitive(text('full_name')),
  dateOfBirth: sensitive(text('date_of_birth')), // ISO 'YYYY-MM-DD'
  country: text('country').notNull(),
  idDocumentType: text('id_document_type').notNull(), // passport | national_id | driving_licence
  idDocumentNumber: sensitive(text('id_document_number')),
  riskScore: text('risk_score').notNull(), // low | medium | high
  status: text('status').notNull().default('pending'), // pending | in_review | approved | rejected
  assigneeId: text('assignee_id'),
  teamId: text('team_id').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }).notNull(),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
  decisionReason: text('decision_reason'),
  resubmissionCount: integer('resubmission_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const schema = { kyc_reviews: kycReviews };
