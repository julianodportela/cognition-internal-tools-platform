import { redirect } from 'next/navigation';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { and, eq, asc } from 'drizzle-orm';
import { notes, attachments } from './schema';
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
  /** Notes attached to an entity (platform table — apps can't import its schema). */
  listNotes(entity: string, entityId: string): Promise<Record<string, unknown>[]>;
  /** Attachments attached to an entity. */
  listAttachments(entity: string, entityId: string): Promise<Record<string, unknown>[]>;
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
    listNotes: (entity, entityId) =>
      db
        .select()
        .from(notes)
        .where(and(eq(notes.appId, appId), eq(notes.entity, entity), eq(notes.entityId, entityId)))
        .orderBy(asc(notes.createdAt)),
    listAttachments: (entity, entityId) =>
      db
        .select()
        .from(attachments)
        .where(and(eq(attachments.appId, appId), eq(attachments.entity, entity), eq(attachments.entityId, entityId)))
        .orderBy(asc(attachments.createdAt)),
  };
}

/** Convenience WHERE clause for the "Mine" filter preset (assignee_id = me). */
export function mineClause(user: SeedUser, table: PgTable): SQL {
  const c = (table as unknown as Record<string, never>)['assigneeId'];
  return eq(c, user.id);
}
