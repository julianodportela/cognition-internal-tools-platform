import { redirect } from 'next/navigation';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@platform/auth/provider';
import { requirePerm } from '@platform/rbac/rbac';
import { getApp } from '@platform/registry';
import { getDb } from './client';
import { query, aggregate, type QueryOptions, type QueryResult, type AggregateOptions } from './query';
import type { SeedUser } from '@platform/policy/roles';
import type { AppManifest } from '@platform/registry';

export interface ReadCtx {
  user: SeedUser;
  app: AppManifest;
  query(table: PgTable, opts?: QueryOptions): Promise<QueryResult>;
  aggregate(table: PgTable, opts?: AggregateOptions): Promise<Record<string, unknown>[]>;
}

/**
 * THE ONLY sanctioned read path for app server components.
 * Resolves the app's dataMode (no caller override), enforces app permission,
 * redirects to /login when unauthenticated.
 */
export async function getReadCtx(appId: string): Promise<ReadCtx> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const app = getApp(appId);
  if (!app) throw new Error(`Unknown app ${appId}`);
  requirePerm(user, app.permission);
  const db = await getDb(app.dataMode);
  const ctx = { db, user, reveal: new Set<string>() };
  return {
    user,
    app,
    query: (t, o) => query(ctx, t, o),
    aggregate: (t, o) => aggregate(ctx, t, o),
  };
}

/** Convenience WHERE clause for the "Mine" filter preset (assignee_id = me). */
export function mineClause(user: SeedUser, table: PgTable): SQL {
  const c = (table as unknown as Record<string, never>)['assigneeId'];
  return eq(c, user.id);
}
