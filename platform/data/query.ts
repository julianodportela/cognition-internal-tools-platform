import { and, asc, eq, getTableColumns, getTableName, gt, isNull, lt, or, sql, Column, SQL, type SQL as SQLType } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { createHmac } from 'crypto';
import type { SeedUser } from '@platform/policy/roles';
import { isSensitive, maskValue } from './schema-helpers';
import { scopePredicate } from '@platform/rbac/rbac';
import { authSecret } from '@platform/auth/secret';
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

/** Options app code may pass — no scope/deleted escapes. */
export interface QueryOpts {
  where?: SQLType;
  orderBy?: { column: string; dir?: 'asc' | 'desc' };
  cursor?: string;
  limit?: number;
}

/** Internal superset: scope/includeDeleted exist for platform code only. */
export interface QueryOptions extends QueryOpts {
  /** Set false to bypass row-scope (platform-internal use only). */
  scope?: boolean;
  /** Include soft-deleted rows (deleted_at not null). Default: excluded. */
  includeDeleted?: boolean;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  nextCursor: string | null;
  error?: { code: 'invalid_cursor' };
}

export interface AggregateOptions {
  groupBy?: string;
  count?: boolean;
  sum?: string;
  where?: SQLType;
  scope?: boolean;
  includeDeleted?: boolean;
}

/** Module-private symbol (NOT Symbol.for) — app code cannot forge it. */
export const MASKED_ROWS = Symbol('itp.maskedRows');

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

/** Mask an arbitrary before/after object for audit/input storage. */
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
 * A `where` clause may not reference a sensitive column unless that field is
 * revealed for this request — otherwise masked reads become an equality oracle.
 * Walks the SQL tree recursively and throws on any sensitive Column.
 */
function assertNoSensitiveFilter(node: unknown, reveal?: ReadonlySet<string>): void {
  if (node == null || typeof node !== 'object') return;
  if (node instanceof Column) {
    const tableName = getTableName(node.table);
    if (isSensitive(tableName, node.name) && !reveal?.has(`${tableName}.${node.name}`)) {
      throw new Error(
        `sensitive_column_in_filter: where may not reference masked column ${tableName}.${node.name}`,
      );
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) assertNoSensitiveFilter(n, reveal);
    return;
  }
  if (node instanceof SQL || node instanceof SQL.Aliased) {
    for (const c of (node as SQL).queryChunks as unknown[]) assertNoSensitiveFilter(c, reveal);
  }
}

function signCursor(body: string, bind: string): string {
  return createHmac('sha256', authSecret()).update(`${bind}.${body}`).digest('base64url');
}

function encodeCursor(v: unknown, id: unknown, bind: string): string {
  const body = Buffer.from(JSON.stringify({ v, id })).toString('base64url');
  return `${body}.${signCursor(body, bind)}`;
}

function decodeCursor(cursor: string, bind: string): CursorPayload | null {
  try {
    const [body, sig] = cursor.split('.');
    if (!body || !sig) return null;
    if (sig !== signCursor(body, bind)) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!parsed || typeof parsed !== 'object' || !('id' in parsed)) return null;
    return parsed as CursorPayload;
  } catch {
    return null;
  }
}

/**
 * Server-side paged query with keyset pagination. Stable sort = orderBy column
 * + id tiebreak; rows never skip/dup while data changes underneath.
 *
 * Hard rules (enforced, not conventional):
 *  - orderBy on a sensitive column -> throw
 *  - where referencing a sensitive (unrevealed) column -> throw
 *  - groupBy/sum on a sensitive column -> throw
 *  - cursors are HMAC-signed and bound to table+user+sort — forged/expired/
 *    garbage cursors return {error:'invalid_cursor'}, never raw values.
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

  if (isSensitive(tableName, sortKey)) {
    throw new Error(`sensitive_column_in_orderby: cannot sort ${tableName} by masked column ${sortKey}`);
  }
  if (opts.where) assertNoSensitiveFilter(opts.where, ctx.reveal);

  const clauses: SQLType[] = [];
  if (opts.where) clauses.push(opts.where);
  if (!opts.includeDeleted && cols['deletedAt']) {
    clauses.push(isNull(cols['deletedAt']));
  }
  if (opts.scope !== false) {
    const scoped = scopePredicate(ctx.user, table);
    if (scoped) clauses.push(scoped);
  }
  if (opts.cursor) {
    // The cursor is bound to this table+user+sort: a cursor minted for another
    // table, user, or ordering (or forged outright) is an invalid_cursor.
    const bind = `${tableName}|${ctx.user.id}|${sortKey}|${dir}`;
    const c = decodeCursor(opts.cursor, bind);
    if (!c) return { rows: [], nextCursor: null, error: { code: 'invalid_cursor' } };
    const cmp = dir === 'asc' ? gt : lt;
    if (c.v === null) {
      // NULLS LAST ordering: after the last null-valued row only null rows
      // with a greater id remain.
      clauses.push(and(isNull(asCol(sortCol)), gt(asCol(idCol), c.id as never))!);
    } else {
      // Successors of (v,id) under NULLS LAST: greater/lesser v, same v
      // greater id, plus all null-valued rows.
      clauses.push(
        or(
          cmp(asCol(sortCol), c.v as never),
          and(eq(asCol(sortCol), c.v as never), gt(asCol(idCol), c.id as never)),
          isNull(asCol(sortCol)),
        )!,
      );
    }
  }

  let q = ctx.db
    .select()
    .from(table as never)
    .orderBy(
      sql`${asCol(sortCol)} ${sql.raw(dir === 'asc' ? 'ASC' : 'DESC')} NULLS LAST`,
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
  const bind = `${tableName}|${ctx.user.id}|${sortKey}|${dir}`;
  const nextCursor =
    hasMore && last ? encodeCursor(last[sortKey] ?? null, last['id'], bind) : null;
  return { rows, nextCursor };
}

/** Platform-internal escape: identical to query() but without row-scope.
 *  Only platform/ code may call this — app code has no way to pass scope:false. */
export function queryUnscoped(
  ctx: QueryCtx,
  table: PgTable,
  opts: QueryOpts = {},
): Promise<QueryResult> {
  return query(ctx, table, { ...opts, scope: false });
}

export async function aggregate(
  ctx: QueryCtx,
  table: PgTable,
  opts: AggregateOptions = {},
): Promise<Record<string, unknown>[]> {
  const tableName = getTableName(table);
  const cols = getTableColumns(table) as Record<string, never>;
  const selection: Record<string, unknown> = {};
  if (opts.groupBy) {
    if (isSensitive(tableName, opts.groupBy)) {
      throw new Error(`sensitive_column_in_aggregate: cannot group by masked column ${tableName}.${opts.groupBy}`);
    }
    const g = cols[opts.groupBy];
    if (!g) throw new Error(`aggregate: no column ${opts.groupBy}`);
    selection[opts.groupBy] = sql`${asCol(g)}`.as(opts.groupBy);
  }
  if (opts.count !== false) selection['count'] = sql<number>`count(*)`.as('count');
  if (opts.sum) {
    if (isSensitive(tableName, opts.sum)) {
      throw new Error(`sensitive_column_in_aggregate: cannot sum masked column ${tableName}.${opts.sum}`);
    }
    const s = cols[opts.sum];
    if (!s) throw new Error(`aggregate: no column ${opts.sum}`);
    selection['sum'] = sql`coalesce(sum(${asCol(s)}),0)`.as('sum');
  }

  const clauses: SQLType[] = [];
  if (opts.where) {
    assertNoSensitiveFilter(opts.where, ctx.reveal);
    clauses.push(opts.where);
  }
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
