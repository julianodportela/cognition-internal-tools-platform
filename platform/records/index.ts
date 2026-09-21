import { and, eq, getTableColumns, getTableName, isNull } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SeedUser } from '@platform/policy/roles';
import { can, scopePredicate } from '@platform/rbac/rbac';
import type { DB } from '@platform/data/client';
import { maskRow } from '@platform/data/query';
import { notes } from '@platform/data/schema';

export interface AuditCall {
  entity: string;
  id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface RecordsDeps {
  db: DB;
  user: SeedUser;
  appId: string | null;
  reveal: ReadonlySet<string>;
  auditPush(c: AuditCall): void;
}

type Row = Record<string, unknown>;

const cols = (t: PgTable) => getTableColumns(t) as Record<string, never>;

function idCol(t: PgTable): never {
  const c = cols(t);
  return (c['id'] ?? Object.values(c)[0]) as never;
}

export interface RecordsApi {
  get(table: PgTable, id: string | number): Promise<Row | null>;
  /** SELECT … FOR UPDATE — row must be visible under the caller's scope. */
  lock(table: PgTable, id: string | number): Promise<Row>;
  insert(table: PgTable, values: Row): Promise<Row>;
  update(table: PgTable, id: string | number, patch: Row): Promise<Row>;
  remove(table: PgTable, id: string | number): Promise<void>;
  claim(table: PgTable, id: string | number): Promise<Row>;
  assign(table: PgTable, id: string | number, userId: string): Promise<Row>;
  release(table: PgTable, id: string | number): Promise<Row>;
  addNote(entity: string, entityId: string, body: string): Promise<Row>;
  /** Throws not_found unless the parent row is visible + not soft-deleted. */
  requireParentRow(entity: string, entityId: string): Promise<void>;
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string | number) {
    super(`${entity} row ${id} not found`);
    this.name = 'not_found';
  }
}

/**
 * Auto-audited record helpers — the only way action code touches rows.
 * Every id-addressed operation first verifies the row is visible under the
 * caller's row-scope AND not soft-deleted; otherwise it fails with not_found
 * (same shape as a genuinely missing row — no existence oracle).
 * Every insert/update/remove queues a masked audit call.
 */
export function makeRecords(deps: RecordsDeps): RecordsApi {
  const { db, user, reveal, auditPush } = deps;
  const tn = (t: PgTable) => getTableName(t);

  /** Row must exist, be in scope, and not soft-deleted. */
  async function getRawScoped(table: PgTable, id: string | number): Promise<Row | null> {
    const clauses = [eq(idCol(table), id as never)];
    const c = cols(table);
    if (c['deletedAt']) clauses.push(isNull(c['deletedAt'] as never));
    const scoped = scopePredicate(user, table);
    if (scoped) clauses.push(scoped);
    const rows = (await db
      .select()
      .from(table as never)
      .where(and(...clauses))
      .limit(1)) as Row[];
    return rows[0] ?? null;
  }

  async function requireRow(table: PgTable, id: string | number): Promise<Row> {
    const row = await getRawScoped(table, id);
    if (!row) throw new NotFoundError(tn(table), id);
    return row;
  }

  async function get(table: PgTable, id: string | number): Promise<Row | null> {
    const r = await getRawScoped(table, id);
    return r ? maskRow(tn(table), r, reveal) : null;
  }

  async function lock(table: PgTable, id: string | number): Promise<Row> {
    const clauses = [eq(idCol(table), id as never)];
    const c = cols(table);
    if (c['deletedAt']) clauses.push(isNull(c['deletedAt'] as never));
    const scoped = scopePredicate(user, table);
    if (scoped) clauses.push(scoped);
    const rows = (await db
      .select()
      .from(table as never)
      .where(and(...clauses))
      .for('update')
      .limit(1)) as Row[];
    if (!rows[0]) throw new NotFoundError(tn(table), id);
    return rows[0];
  }

  async function insert(table: PgTable, values: Row): Promise<Row> {
    const inserted = (await db
      .insert(table as never)
      .values(values as never)
      .returning()) as Row[];
    const row = inserted[0];
    auditPush({ entity: tn(table), id: String(row['id']), before: null, after: row });
    return maskRow(tn(table), row, reveal);
  }

  async function update(table: PgTable, id: string | number, patch: Row): Promise<Row> {
    const before = await requireRow(table, id);
    const updated = (await db
      .update(table as never)
      .set(patch as never)
      .where(eq(idCol(table), id as never))
      .returning()) as Row[];
    const after = updated[0];
    auditPush({ entity: tn(table), id: String(id), before, after });
    return maskRow(tn(table), after, reveal);
  }

  async function remove(table: PgTable, id: string | number): Promise<void> {
    const before = await requireRow(table, id);
    const c = cols(table);
    if (c['deletedAt']) {
      await db
        .update(table as never)
        .set({ deletedAt: new Date() } as never)
        .where(eq(idCol(table), id as never));
      auditPush({ entity: tn(table), id: String(id), before, after: { ...before, deletedAt: 'soft-deleted' } });
    } else {
      await db.delete(table as never).where(eq(idCol(table), id as never));
      auditPush({ entity: tn(table), id: String(id), before, after: null });
    }
  }

  async function claim(table: PgTable, id: string | number): Promise<Row> {
    const row = await requireRow(table, id);
    const current = row['assigneeId'] ?? row['assignee_id'];
    if (current && current !== user.id && !can(user, 'approvals.manage')) {
      throw new Error(`Row ${id} is already assigned to ${current}`);
    }
    return update(table, id, { assigneeId: user.id });
  }

  async function assign(table: PgTable, id: string | number, userId: string): Promise<Row> {
    return update(table, id, { assigneeId: userId });
  }

  async function release(table: PgTable, id: string | number): Promise<Row> {
    return update(table, id, { assigneeId: null });
  }

  async function addNote(entity: string, entityId: string, body: string): Promise<Row> {
    // Notes attach to a real row the caller can see — otherwise not_found.
    await requireParentRow(entity, entityId);
    const inserted = (await db
      .insert(notes)
      .values({ appId: deps.appId ?? '_platform', entity, entityId, authorId: user.id, body })
      .returning()) as Row[];
    const row = inserted[0];
    auditPush({ entity: 'notes', id: String(row.id), before: null, after: row });
    return row;
  }

  /**
   * The parent row must be visible under the caller's scope and not
   * soft-deleted. Throws not_found otherwise — indistinguishable from a
   * missing row. `requireRow` resolves the table from the registry.
   */
  async function requireParentRow(entity: string, entityId: string): Promise<void> {
    const { getSchemaTable } = await import('@platform/registry');
    const table = getSchemaTable(entity);
    if (!table) throw new NotFoundError(entity, entityId);
    await requireRow(table, entityId);
  }

  return { get, lock, insert, update, remove, claim, assign, release, addNote, requireParentRow };
}

/** Deleted-row filter shared by query(): true if table has a deletedAt column. */
export function hasDeletedAt(table: PgTable): boolean {
  return 'deletedAt' in cols(table);
}

export function notDeleted(table: PgTable) {
  const c = cols(table);
  return c['deletedAt'] ? isNull(c['deletedAt'] as never) : undefined;
}

export { and };
