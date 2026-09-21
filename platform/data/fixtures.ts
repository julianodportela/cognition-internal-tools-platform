import type { DB, DataMode } from './client';
import type { AppManifest } from '@platform/registry';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * Load an app's synthetic fixtures into the sandbox database.
 * Idempotent (rows carry fixed ids; conflicts are ignored) so it can run at
 * every sandbox init. Throws if the app is production — fixtures are
 * synthetic data and may never touch a real database.
 */
export async function loadFixtures(
  app: AppManifest,
  db: DB,
  mode: DataMode,
): Promise<void> {
  if (!app.fixtures || Object.keys(app.fixtures).length === 0) return;
  if (mode !== 'sandbox') {
    // A production app with fixtures is a bug — fail closed.
    if (app.dataMode === 'production') {
      throw new Error(`Refusing to load fixtures for production app ${app.id}`);
    }
    return; // sandbox-app fixtures never enter the production connection
  }
  for (const [key, rows] of Object.entries(app.fixtures)) {
    const table = app.schema[key] as PgTable | undefined;
    if (!table) throw new Error(`fixtures.${key}: no such table in ${app.id} schema`);
    if (rows.length === 0) continue;
    await db
      .insert(table as never)
      .values(rows as never)
      .onConflictDoNothing();
  }
}
