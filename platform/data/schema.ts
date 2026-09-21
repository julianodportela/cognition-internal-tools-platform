import {
  pgTable,
  text,
  timestamp,
  integer,
  serial,
  index,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  teamId: text('team_id').notNull(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    requestId: text('request_id').notNull(),
    actorId: text('actor_id').notNull(),
    actionId: text('action_id').notNull(),
    appId: text('app_id'),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    ip: text('ip'),
    status: text('status').notNull().default('ok'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('audit_entity_idx').on(t.entity, t.entityId),
    index('audit_actor_idx').on(t.actorId),
    index('audit_created_idx').on(t.createdAt),
  ],
);

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  actionId: text('action_id').notNull(),
  resultJson: text('result_json'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  actionId: text('action_id').notNull(),
  count: integer('count').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true, mode: 'date' }).notNull(),
});

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: text('id').primaryKey(),
    actionId: text('action_id').notNull(),
    appId: text('app_id'),
    requesterId: text('requester_id').notNull(),
    inputJson: text('input_json').notNull(),
    policyJson: text('policy_json').notNull(),
    idemKey: text('idem_key'),
    status: text('status').notNull().default('pending'), // pending|approved|rejected|executed|failed
    approverId: text('approver_id'),
    reason: text('reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    resultJson: text('result_json'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('approval_status_idx').on(t.status),
    index('approval_requester_idx').on(t.requesterId),
  ],
);

export const notes = pgTable(
  'notes',
  {
    id: serial('id').primaryKey(),
    appId: text('app_id').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('notes_entity_idx').on(t.appId, t.entity, t.entityId)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: serial('id').primaryKey(),
    appId: text('app_id').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
    uploadedBy: text('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('attachments_entity_idx').on(t.appId, t.entity, t.entityId)],
);

export const platformSchema = {
  users,
  auditLog,
  idempotencyKeys,
  rateLimitBuckets,
  approvalRequests,
  notes,
  attachments,
};
