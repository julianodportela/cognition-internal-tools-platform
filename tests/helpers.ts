import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'path';
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

/**
 * Fresh in-memory db for tests — built by the REAL platform migrations
 * (drizzle/*.sql) plus seeds, never a hand-rolled schema that can drift.
 * kyc_cases is a test-local table only (not part of any app), so it is
 * created directly after the migrations run.
 */
export async function makeDb(): Promise<DB> {
  const client = new PGlite('memory://');
  const db = drizzle(client, { schema: { ...platformSchema, casesTable } }) as unknown as DB;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  await db.execute(`CREATE TABLE kyc_cases (
    id serial PRIMARY KEY, subject text NOT NULL, ssn text, owner_id text,
    team_id text, status text NOT NULL DEFAULT 'open', assignee_id text,
    deleted_at timestamptz, due_at timestamptz
  )`);
  return db;
}

export const analyst: SeedUser = { id: 'u-a', name: 'Analyst A', role: 'analyst', teamId: 'kyc' };
export const engAdmin: SeedUser = { id: 'u-e', name: 'Eng Admin', role: 'eng_admin', teamId: 'eng' };
