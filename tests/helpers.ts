import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { text, serial } from 'drizzle-orm/pg-core';
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
  await db.execute(`CREATE TABLE kyc_cases (
    id serial PRIMARY KEY, subject text NOT NULL, ssn text, owner_id text,
    team_id text, status text NOT NULL DEFAULT 'open'
  )`);
  return db;
}

export const analyst: SeedUser = { id: 'u-a', name: 'Analyst A', role: 'analyst', teamId: 'kyc' };
export const engAdmin: SeedUser = { id: 'u-e', name: 'Eng Admin', role: 'eng_admin', teamId: 'eng' };
