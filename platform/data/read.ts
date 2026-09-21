import { redirect } from 'next/navigation';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { and, eq, asc } from 'drizzle-orm';
import { notes, attachments } from './schema';
import { getCurrentUser } from '@platform/auth/provider';
import { requirePerm } from '@platform/rbac/rbac';
import { getApp } from '@platform/registry';
import { getAppDb } from './internal';
import { query, aggregate, type QueryOpts, type QueryResult, type AggregateOptions, type QueryOptions } from './query';
import type { SeedUser } from '@platform/policy/roles';
import type { AppManifest } from '@platform/registry';
import type { DB } from './client';

export interface ReadCtx {
  user: SeedUser;
  app: AppManifest;
  query(table: PgTable, opts?: QueryOpts): Promise<QueryResult>;
  aggregate(table: PgTable, opts?: AggregateOptions): Promise<Record<string, unknown>[]>;
  /** Notes attached to an entity (platform table — apps can't import its schema). */
  listNotes(entity: string, entityId: string): Promise<Record<string, unknown>[]>;
  /** Attachments attached to an entity. */
  listAttachments(entity: string, entityId: string): Promise<Record<string, unknown>[]>;
}

/** App-facing query options may not carry scope/includeDeleted — throw if
 *  they do, so there is no silent opt-out of row visibility. */
function appOpts(o: QueryOpts | undefined): QueryOptions {
  const { scope, includeDeleted, ...rest } = (o ?? {}) as QueryOptions;
  if (scope !== undefined || includeDeleted !== undefined) {
    throw new Error(
      "query options 'scope'/'includeDeleted' are not available to app code. See AGENTS.md §Invariants.",
    );
  }
  return rest;
}

/** Parent row must exist, be in scope, and not soft-deleted — same rule the
 *  records API applies to writes. */
async function parentVisible(db: DB, user: SeedUser, entity: string, entityId: string): Promise<boolean> {
  const { getSchemaTable } = await import('@platform/registry');
  const { makeRecords } = await import('@platform/records');
  const table = getSchemaTable(entity);
  if (!table) return false;
  const rec = makeRecords({ db, user, appId: null, reveal: new Set(), auditPush: () => {} });
  return (await rec.get(table, entityId)) !== null;
}

/**
 * THE ONLY sanctioned read path for app server components.
 * Resolves the app's dataMode (no caller override), enforces app permission,
 * and — for production-bound apps — asserts a valid signed promotion.
 * Redirects to /login when unauthenticated.
 */
export async function getReadCtx(appId: string): Promise<ReadCtx> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const app = getApp(appId);
  if (!app) throw new Error(`Unknown app ${appId}`);
  requirePerm(user, app.permission);
  const db = await getAppDb(app); // throws promotion_required for unpromoted prod apps
  const ctx = { db, user, reveal: new Set<string>() };
  return Object.freeze({
    user,
    app,
    query: (t: PgTable, o?: QueryOpts) => query(ctx, t, appOpts(o)),
    aggregate: (t: PgTable, o?: AggregateOptions) => aggregate(ctx, t, o),
    listNotes: async (entity: string, entityId: string) => {
      if (!(await parentVisible(db, user, entity, entityId))) return [];
      return db
        .select()
        .from(notes)
        .where(and(eq(notes.appId, appId), eq(notes.entity, entity), eq(notes.entityId, entityId)))
        .orderBy(asc(notes.createdAt));
    },
    listAttachments: async (entity: string, entityId: string) => {
      if (!(await parentVisible(db, user, entity, entityId))) return [];
      return db
        .select()
        .from(attachments)
        .where(and(eq(attachments.appId, appId), eq(attachments.entity, entity), eq(attachments.entityId, entityId)))
        .orderBy(asc(attachments.createdAt));
    },
  });
}

/** Convenience WHERE clause for the "Mine" filter preset (assignee_id = me). */
export function mineClause(user: SeedUser, table: PgTable): SQL {
  const c = (table as unknown as Record<string, never>)['assigneeId'];
  return eq(c, user.id);
}
