import type { PgTable } from 'drizzle-orm/pg-core';

/** Any Drizzle table shape — used where platform code must accept arbitrary app tables. */
export type AnyTable = PgTable;
