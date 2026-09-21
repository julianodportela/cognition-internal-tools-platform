import {
  pgTable,
  type PgColumnBuilderBase,
  type TableConfig,
} from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import { sensitiveFieldNames } from '@platform/policy/sensitive-fields';

declare const maskedBrand: unique symbol;
/** A value that may only be rendered masked; unmasking happens inside revealField. */
export type Masked<T> = T & { readonly [maskedBrand]: 'masked' };

// Registry of "table.column" pairs marked sensitive via sensitive().
const sensitiveColumns = new Set<string>();
const markedBuilders = new WeakSet<object>();
const builderNames = new WeakMap<object, string>();

/**
 * Wrap a drizzle column builder to mark the column sensitive, e.g.
 *   ssn: sensitive(text('ssn'))
 * Must be used inside platformTable()/pgTableFor() so the table name is known.
 */
export function sensitive<T extends PgColumnBuilderBase>(col: T): T {
  markedBuilders.add(col);
  const name = (col as unknown as { config?: { name?: string } }).config?.name;
  if (name) builderNames.set(col, name);
  return col;
}

/** pgTable wrapper that registers columns wrapped in sensitive(). */
export function platformTable<T extends TableConfig>(
  name: string,
  cols: T extends TableConfig ? Record<string, PgColumnBuilderBase> : never,
  extra?: never,
) {
  for (const [key, builder] of Object.entries(
    cols as Record<string, PgColumnBuilderBase>,
  )) {
    if (markedBuilders.has(builder)) {
      sensitiveColumns.add(`${name}.${builderNames.get(builder) ?? key}`);
    }
  }
  return pgTable(name, cols as never, extra as never);
}

const policyNames = new Set<string>(sensitiveFieldNames);

/** Is this column sensitive — either marked in schema or on the global policy list? */
export function isSensitive(table: unknown, column: string): boolean {
  const tableName =
    typeof table === 'string' ? table : getTableName(table as never);
  if (sensitiveColumns.has(`${tableName}.${column}`)) return true;
  if (policyNames.has(column)) return true;
  return false;
}

export function maskValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    const last4 = v.slice(-4);
    return `••••${last4}`;
  }
  return null;
}
