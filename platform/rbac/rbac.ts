import { and, eq, getTableColumns, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { roles, type Permission, type SeedUser } from '@platform/policy/roles';

export class PermissionDenied extends Error {
  constructor(
    public readonly userId: string,
    public readonly permission: string,
  ) {
    super(`User ${userId} lacks permission "${permission}"`);
    this.name = 'PermissionDenied';
  }
}

export function can(user: SeedUser, perm: Permission): boolean {
  return roles[user.role].permissions.includes(perm);
}

export function requirePerm(user: SeedUser, perm: Permission): void {
  if (!can(user, perm)) throw new PermissionDenied(user.id, perm);
}

/**
 * Row-scope predicate based on the user's role scope:
 *  - 'all'  → no restriction
 *  - 'team' → team_id = user.teamId (falls back to owner_id if no team_id column)
 *  - 'own'  → owner_id = user.id (falls back to team_id, else NO RESTRICTION —
 *             a table with neither column is visible to every role)
 */
export function scopePredicate(user: SeedUser, table: PgTable): SQL | undefined {
  const scope = roles[user.role].scope;
  if (scope === 'all') return undefined;
  const cols = getTableColumns(table) as Record<string, { name: string } | undefined>;
  const has = (n: string) => Object.values(cols).some((c) => c?.name === n);
  const col = (n: string) =>
    (Object.values(cols).find((c) => c?.name === n) ?? undefined) as never;
  const clauses: SQL[] = [];
  if (scope === 'team') {
    if (has('team_id')) clauses.push(eq(col('team_id'), user.teamId));
    else if (has('owner_id')) clauses.push(eq(col('owner_id'), user.id));
  } else {
    if (has('owner_id')) clauses.push(eq(col('owner_id'), user.id));
    else if (has('team_id')) clauses.push(eq(col('team_id'), user.teamId));
  }
  if (clauses.length === 0) return undefined;
  return and(...clauses);
}
