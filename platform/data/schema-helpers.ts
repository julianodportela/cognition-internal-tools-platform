import {
  pgTable,
  uniqueIndex,
  type PgColumnBuilderBase,
  type PgColumn,
} from 'drizzle-orm/pg-core';
import { getTableName, sql } from 'drizzle-orm';
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
export function platformTable<T extends Record<string, PgColumnBuilderBase>>(
  name: string,
  cols: T,
  extra?: (t: { [K in keyof T]: PgColumn }) => unknown[],
) {
  for (const [key, builder] of Object.entries(cols)) {
    if (markedBuilders.has(builder)) {
      // Register both the db column name and the JS property key — rows come
      // back from drizzle with camelCase keys while callers may use either.
      const dbName = builderNames.get(builder) ?? key;
      sensitiveColumns.add(`${name}.${dbName}`);
      if (dbName !== key) sensitiveColumns.add(`${name}.${key}`);
    }
  }
  return pgTable(name, cols, extra as never);
}

/**
 * Partial unique index — the sanctioned way for an app to declare
 * "at most one active row per key" (e.g. one open refund per transaction).
 * `whereSql` is a raw SQL predicate written by the app author at schema time
 * (schema files are engineering-reviewed; raw SQL stays out of runtime code).
 */
export function uniqueIndexOn(col: PgColumn, name: string, whereSql: string) {
  return uniqueIndex(name).on(col).where(sql.raw(whereSql));
}

const policyNames = new Set<string>(sensitiveFieldNames);

const toSnake = (s: string) => s.replace(/([A-Z])/g, '_$1').toLowerCase();

/** Is this column sensitive — either marked in schema or on the global policy
 *  list? Both the raw name and its snake_cased form are checked, because
 *  Drizzle rows come back camelCase while the policy list is snake_case. */
export function isSensitive(table: unknown, column: string): boolean {
  const tableName =
    typeof table === 'string' ? table : getTableName(table as never);
  if (sensitiveColumns.has(`${tableName}.${column}`)) return true;
  if (policyNames.has(column) || policyNames.has(toSnake(column))) return true;
  return false;
}

export function maskValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    // Emails mask to ••••@domain — a bare "last4" leaks the wrong intuition
    // (the last 4 chars of an email are a domain fragment, not an identifier).
    if (v.includes('@')) return `••••@${v.split('@').pop()}`;
    // Short secrets (CVV/PIN/last4) get nothing back — never echo them whole.
    if (v.length <= 4) return '••••';
    return `••••${v.slice(-4)}`;
  }
  return null;
}
