import { z } from 'zod';
import { getTableColumns, eq } from 'drizzle-orm';
import { defineAction, type ActionDef } from './define';
import { isSensitive } from '@platform/data/schema-helpers';
import { getSchemaTable } from '@platform/registry';

/**
 * Built-in: reveal a single sensitive field value for one row.
 * This is the ONLY unmask path; it requires 'pii.reveal' and is audited.
 */
export const revealField = defineAction({
  id: 'platform.revealField',
  perm: 'pii.reveal',
  risk: 'low',
  input: z.object({
    table: z.string(),
    column: z.string(),
    rowId: z.string(),
  }),
  run: async (ctx, i) => {
    const table = getSchemaTable(i.table);
    if (!table) throw new Error(`Unknown table ${i.table}`);
    if (!isSensitive(i.table, i.column)) {
      throw new Error(`${i.table}.${i.column} is not a sensitive field`);
    }
    const cols = getTableColumns(table) as Record<string, never>;
    const col = cols[i.column];
    const idCol = cols['id'];
    if (!col || !idCol) throw new Error(`No such column ${i.column}`);
    const rows = await ctx.db
      .select({ v: col as never })
      .from(table as never)
      .where(eq(idCol as never, i.rowId as never))
      .limit(1);
    const value = (rows[0] as { v?: unknown } | undefined)?.v ?? null;
    await ctx.audit.record(i.table, i.rowId, null, { [i.column]: '<revealed>' });
    return { value };
  },
});

export const platformActions: ActionDef[] = [revealField as ActionDef];
