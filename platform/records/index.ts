import { and, eq, getTableColumns, getTableName, isNull } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SeedUser } from '@platform/policy/roles';
import { can } from '@platform/rbac/rbac';
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
  insert(table: PgTable, values: Row): Promise<Row>;
  update(table: PgTable, id: string | number, patch: Row): Promise<Row>;
  remove(table: PgTable, id: string | number): Promise<void>;
  claim(table: PgTable, id: string | number): Promise<Row>;
  assign(table: PgTable, id: string | number, userId: string): Promise<Row>;
  release(table: PgTable, id: string | number): Promise<Row>;
  addNote(entity: string, entityId: string, body: string): Promise<Row>;
}

/**
 * Auto-audited record helpers — the only way action code touches rows.
 * Every insert/update/remove fetches before, applies, fetches after, and
 * queues an audit call (written by executeAction, masked before storage).
 */
export function makeRecords(deps: RecordsDeps): RecordsApi {
  const { db, user, reveal, auditPush } = deps;
  const tn = (t: PgTable) => getTableName(t);

  async function get(table: PgTable, id: string | number): Promise<Row | null> {
    const rows = (await db
      .select()
      .from(table as never)
      .where(eq(idCol(table), id as never))
      .limit(1)) as Row[];
    const r = rows[0];
    return r ? maskRow(tn(table), r, reveal) : null;
  }

  async function getRaw(table: PgTable, id: string | number): Promise<Row | null> {
    const rows = (await db
      .select()
      .from(table as never)
      .where(eq(idCol(table), id as never))
      .limit(1)) as Row[];
    return rows[0] ?? null;
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
    const before = await getRaw(table, id);
    if (!before) throw new Error(`${tn(table)} row ${id} not found`);
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
    const before = await getRaw(table, id);
    if (!before) throw new Error(`${tn(table)} row ${id} not found`);
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
    const row = await getRaw(table, id);
    if (!row) throw new Error(`${tn(table)} row ${id} not found`);
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
    const inserted = (await db
      .insert(notes)
      .values({ appId: deps.appId ?? '_platform', entity, entityId, authorId: user.id, body })
      .returning()) as Row[];
    const row = inserted[0];
    auditPush({ entity: 'notes', id: String(row.id), before: null, after: row });
    return row;
  }

  return { get, insert, update, remove, claim, assign, release, addNote };
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
