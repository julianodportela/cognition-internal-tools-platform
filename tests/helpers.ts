import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { text, serial, timestamp } from 'drizzle-orm/pg-core';
import { platformSchema } from '@platform/data/schema';
import { platformTable, sensitive } from '@platform/data/schema-helpers';
import type { DB } from '@platform/data/client';
import type { SeedUser } from '@platform/policy/roles';

export const casesTable = platformTable('kyc_cases', {
  id: serial('id').primaryKey(),
  subject: text('subject').notNull(),
  ssn: sensitive(text('ssn')),
  ownerId: text('owner_id'),
  teamId: text('team_id'),
  status: text('status').notNull().default('open'),
  assigneeId: text('assignee_id'),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
});

export async function makeDb(): Promise<DB> {
  const client = new PGlite('memory://');
  const db = drizzle(client, { schema: { ...platformSchema, casesTable } }) as unknown as DB;
  await db.execute(`CREATE TABLE users (id text PRIMARY KEY, name text NOT NULL, role text NOT NULL, team_id text NOT NULL)`);
  await db.execute(`CREATE TABLE audit_log (
    id serial PRIMARY KEY, request_id text NOT NULL, actor_id text NOT NULL,
    action_id text NOT NULL, app_id text, entity text NOT NULL, entity_id text,
    before_json text, after_json text, ip text, status text NOT NULL DEFAULT 'ok',
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.execute(`CREATE TABLE idempotency_keys (
    key text PRIMARY KEY, action_id text NOT NULL, result_json text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.execute(`CREATE TABLE rate_limit_buckets (
    id serial PRIMARY KEY, user_id text NOT NULL, action_id text NOT NULL,
    count integer NOT NULL, window_start timestamptz NOT NULL
  )`);
  await db.execute(`CREATE TABLE approval_requests (
    id text PRIMARY KEY, action_id text NOT NULL, app_id text,
    requester_id text NOT NULL, input_json text NOT NULL, policy_json text NOT NULL,
    idem_key text, status text NOT NULL DEFAULT 'pending', approver_id text,
    reason text, decided_at timestamptz, result_json text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.execute(`CREATE TABLE notes (
    id serial PRIMARY KEY, app_id text NOT NULL, entity text NOT NULL,
    entity_id text NOT NULL, author_id text NOT NULL, body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.execute(`CREATE TABLE attachments (
    id serial PRIMARY KEY, app_id text NOT NULL, entity text NOT NULL,
    entity_id text NOT NULL, filename text NOT NULL, content_type text NOT NULL,
    size integer NOT NULL, storage_key text NOT NULL, uploaded_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.execute(`CREATE TABLE kyc_cases (
    id serial PRIMARY KEY, subject text NOT NULL, ssn text, owner_id text,
    team_id text, status text NOT NULL DEFAULT 'open', assignee_id text,
    deleted_at timestamptz, due_at timestamptz
  )`);
  return db;
}

export const analyst: SeedUser = { id: 'u-a', name: 'Analyst A', role: 'analyst', teamId: 'kyc' };
export const engAdmin: SeedUser = { id: 'u-e', name: 'Eng Admin', role: 'eng_admin', teamId: 'eng' };
