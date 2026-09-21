import { uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { platformTable } from '@platform/data/schema-helpers';

// Feature flags are shared engineering configuration: nothing personal or
// financial, so no sensitive() columns and no owner/team scope (every role
// with flags.read sees every flag). Archiving sets archived_at — rows are
// never deleted, so history always resolves to a flag.
export const flags = platformTable('flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  description: text('description').notNull(),
  ownerTeam: text('owner_team').notNull(),
  // Comma-separated lower-case tags, e.g. 'payments,checkout'.
  tags: text('tags').notNull().default(''),
  stagingEnabled: boolean('staging_enabled').notNull().default(false),
  stagingRollout: integer('staging_rollout').notNull().default(0),
  productionEnabled: boolean('production_enabled').notNull().default(false),
  productionRollout: integer('production_rollout').notNull().default(0),
  // Optimistic-concurrency counter; also the idempotency key for env changes.
  version: integer('version').notNull().default(0),
  lastChangedAt: timestamp('last_changed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  lastChangedBy: text('last_changed_by').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

// Append-only history: one row per change to a flag.
export const flagChanges = platformTable('flag_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  flagId: uuid('flag_id').notNull(),
  flagKey: text('flag_key').notNull(),
  environment: text('environment').notNull(), // 'staging' | 'production' | 'all'
  change: text('change').notNull(), // 'created' | 'toggled' | 'rollout' | 'archived' | 'service_rejected'
  before: text('before').notNull(),
  after: text('after').notNull(),
  actorId: text('actor_id').notNull(),
  approverId: text('approver_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const schema = { flags, flag_changes: flagChanges };
