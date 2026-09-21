// Violates: no-raw-db (client import, non-allowlisted drizzle import,
// dynamic import of a banned module, require() of the client).
import { getDb } from '@platform/data/client';
import { eq, sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';

export async function bad() {
  const dyn = await import('@platform/data/client');
  const req = require('@platform/data/client');
  const db = getDb('sandbox');
  const users = await db.select().from(req.users).where(eq(text as never, 'x'));
  return { dyn, users };
}
