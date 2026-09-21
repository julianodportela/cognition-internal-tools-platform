import fs from 'fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'path';
import { platformSchema } from './schema';
import { users as seedUsers } from '@platform/policy/roles';
import { users as usersTable } from './schema';

export type DataMode = 'sandbox' | 'production';
export type DB = PgliteDatabase<typeof platformSchema>;

/**
 * ONLY this module may read SANDBOX_DATABASE_URL / DATABASE_URL.
 * Sandbox and production are separate connections; app code receives whichever
 * ctx.db the platform hands it and can never name the other one.
 */
function urlFor(mode: DataMode): string {
  if (mode === 'sandbox') {
    return process.env.SANDBOX_DATABASE_URL ?? './.data/sandbox';
  }
  return process.env.DATABASE_URL ?? './.data/production';
}

const cache = new Map<DataMode, Promise<DB>>();

async function create(mode: DataMode): Promise<DB> {
  const url = urlFor(mode);
  if (!url.startsWith('memory://') && !url.includes('://')) {
    // file-backed PGlite needs its data dir to exist
    fs.mkdirSync(url, { recursive: true });
  }
  const client = new PGlite(url);
  const db = drizzle(client, { schema: platformSchema });
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), 'drizzle'),
  });
  await seed(db);
  // App fixtures are synthetic — sandbox connections only, idempotent.
  const { getApps } = await import('@platform/registry');
  const { loadFixtures } = await import('./fixtures');
  for (const app of getApps()) {
    await loadFixtures(app, db, mode);
  }
  return db;
}

async function seed(db: DB) {
  const existing = await db.select().from(usersTable).limit(1);
  if (existing.length > 0) return;
  for (const u of seedUsers) {
    await db
      .insert(usersTable)
      .values({ id: u.id, name: u.name, role: u.role, teamId: u.teamId });
  }
}

// Capability required to open the production connection. Held only by
// platform/data/internal.ts — app code can never reach it, and the guard
// layer additionally greps for literal getDb('production') call sites.
const PROD_CAP: unique symbol = Symbol('itp.prodCapability');

/** Internal use by platform/data/internal.ts only. */
export function productionCapability(): symbol {
  return PROD_CAP;
}

export function getDb(mode: DataMode = 'sandbox', capability?: symbol): Promise<DB> {
  if (mode === 'production' && capability !== PROD_CAP) {
    throw new Error(
      "getDb('production') requires the platform-internal capability; go through platform/data/internal.ts (promotion-checked).",
    );
  }
  let p = cache.get(mode);
  if (!p) {
    p = create(mode);
    p.catch(() => cache.delete(mode));
    cache.set(mode, p);
  }
  return p;
}
