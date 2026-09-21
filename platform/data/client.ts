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
  const client = new PGlite(urlFor(mode));
  const db = drizzle(client, { schema: platformSchema });
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), 'drizzle'),
  });
  await seed(db);
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

export function getDb(mode: DataMode = 'sandbox'): Promise<DB> {
  let p = cache.get(mode);
  if (!p) {
    p = create(mode);
    cache.set(mode, p);
  }
  return p;
}
