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

export const platformSchema = { users, auditLog, idempotencyKeys, rateLimitBuckets };
