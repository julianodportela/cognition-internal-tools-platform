import { and, asc, desc, eq, getTableColumns, getTableName, gt, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SeedUser } from '@platform/policy/roles';
import { isSensitive, maskValue } from './schema-helpers';
import { scopePredicate } from '@platform/rbac/rbac';
import type { DB } from './client';

type AnyDB = Pick<DB, 'select'>;

export interface QueryCtx {
  db: AnyDB;
  user: SeedUser;
  /** Set of "table.column" fields revealed for this request (platform-set only). */
  reveal?: ReadonlySet<string>;
}

interface CursorPayload {
  v: unknown;
  id: unknown;
}

function encodeCursor(v: unknown, id: unknown): string {
  return Buffer.from(JSON.stringify({ v, id })).toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString()) as CursorPayload;
}

export interface QueryOptions {
  where?: SQL;
  orderBy?: { column: string; dir?: 'asc' | 'desc' };
  cursor?: string;
  limit?: number;
  /** Set false to bypass row-scope (platform-internal use only). */
  scope?: boolean;
  /** Include soft-deleted rows (deleted_at not null). Default: excluded. */
  includeDeleted?: boolean;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  nextCursor: string | null;
}

/** Non-enumerable marker proving rows passed through the masking query layer. */
export const MASKED_ROWS = Symbol.for('itp.maskedRows');

export function assertMaskedRows(rows: unknown): void {
  if (!Array.isArray(rows) || (rows as never)[MASKED_ROWS as never] !== true) {
    throw new Error(
      'Rows passed to DataTable did not come through platform query() — masking is not guaranteed. See AGENTS.md §Invariants.',
    );
  }
}

const asCol = (c: unknown) => c as never;

/** Mask sensitive columns of a row. reveal keys are "table.column". */
export function maskRow(
  tableName: string,
  row: Record<string, unknown>,
  reveal?: ReadonlySet<string>,
): Record<string, unknown> {
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (isSensitive(tableName, key) && !reveal?.has(`${tableName}.${key}`)) {
      out[key] = maskValue(out[key]);
    }
  }
  return out;
}

/** Mask an arbitrary before/after object for audit storage. */
export function maskObject(
  tableName: string,
  obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (obj == null) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = isSensitive(tableName, k) ? maskValue(v) : v;
  }
  return out;
}

/**
 * Server-side paged query with keyset pagination. Stable sort = orderBy column
 * + id tiebreak; rows never skip/dup while data changes underneath.
 */
export async function query(
  ctx: QueryCtx,
  table: PgTable,
  opts: QueryOptions = {},
): Promise<QueryResult> {
  const tableName = getTableName(table);
  const cols = getTableColumns(table) as Record<string, never>;
  const idCol = (cols['id'] ?? Object.values(cols)[0]) as never;
  const sortKey = opts.orderBy?.column ?? 'id';
  const sortCol = (cols[sortKey] ?? idCol) as never;
  const dir = opts.orderBy?.dir ?? 'asc';
  const limit = Math.min(opts.limit ?? 50, 500);

  const clauses: SQL[] = [];
  if (opts.where) clauses.push(opts.where);
  if (!opts.includeDeleted && cols['deletedAt']) {
    clauses.push(isNull(cols['deletedAt']));
  }
  if (opts.scope !== false) {
    const scoped = scopePredicate(ctx.user, table);
    if (scoped) clauses.push(scoped);
  }
  if (opts.cursor) {
    const { v, id } = decodeCursor(opts.cursor);
    const cmp = dir === 'asc' ? gt : lt;
    clauses.push(
      or(
        cmp(asCol(sortCol), v as never),
        and(eq(asCol(sortCol), v as never), gt(asCol(idCol), id as never)),
      )!,
    );
  }

  let q = ctx.db
    .select()
    .from(table as never)
    .orderBy(
      dir === 'asc' ? asc(asCol(sortCol)) : desc(asCol(sortCol)),
      asc(asCol(idCol)),
    )
    .limit(limit + 1);
  if (clauses.length) q = q.where(and(...clauses)) as typeof q;

  const raw = (await q) as Record<string, unknown>[];
  const hasMore = raw.length > limit;
  const page = raw.slice(0, limit);
  const rows = page.map((r) => maskRow(tableName, r, ctx.reveal));
  Object.defineProperty(rows, MASKED_ROWS, { value: true, enumerable: false });
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor(last[sortKey] ?? last['id'], last['id']) : null;
  return { rows, nextCursor };
}

export interface AggregateOptions {
  groupBy?: string;
  count?: boolean;
  sum?: string;
  where?: SQL;
  scope?: boolean;
  includeDeleted?: boolean;
}

export async function aggregate(
  ctx: QueryCtx,
  table: PgTable,
  opts: AggregateOptions = {},
): Promise<Record<string, unknown>[]> {
  const cols = getTableColumns(table) as Record<string, never>;
  const selection: Record<string, unknown> = {};
  if (opts.groupBy) {
    const g = cols[opts.groupBy];
    if (!g) throw new Error(`aggregate: no column ${opts.groupBy}`);
    selection[opts.groupBy] = sql`${asCol(g)}`.as(opts.groupBy);
  }
  if (opts.count !== false) selection['count'] = sql<number>`count(*)`.as('count');
  if (opts.sum) {
    const s = cols[opts.sum];
    if (!s) throw new Error(`aggregate: no column ${opts.sum}`);
    selection['sum'] = sql`coalesce(sum(${asCol(s)}),0)`.as('sum');
  }

  const clauses: SQL[] = [];
  if (opts.where) clauses.push(opts.where);
  if (!opts.includeDeleted && cols['deletedAt']) {
    clauses.push(isNull(cols['deletedAt']));
  }
  if (opts.scope !== false) {
    const scoped = scopePredicate(ctx.user, table);
    if (scoped) clauses.push(scoped);
  }

  let q = ctx.db.select(selection as never).from(table as never);
  if (clauses.length) q = q.where(and(...clauses)) as typeof q;
  if (opts.groupBy) q = q.groupBy(asCol(cols[opts.groupBy])) as typeof q;
  return (await q) as Record<string, unknown>[];
}
