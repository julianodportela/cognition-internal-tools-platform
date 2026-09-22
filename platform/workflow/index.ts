import type { PgTable } from 'drizzle-orm/pg-core';
import type { SeedUser, Permission } from '@platform/policy/roles';
import { can } from '@platform/rbac/rbac';
import type { ActionCtx } from '@platform/actions/define';

type Row = Record<string, unknown>;

export interface Transition {
  from: string | string[];
  to: string;
  perm?: Permission;
  guard?: (row: Row) => boolean;
}

export interface WorkflowDef {
  initial: string;
  states: string[];
  transitions: Transition[];
}

export interface Workflow {
  def: WorkflowDef;
  /** Is `to` a legal next state for this row (and does the user have the perm)? */
  can(row: Row, to: string, user: SeedUser): boolean;
  /** All legal next states for this row+user. */
  nextStates(row: Row, user: SeedUser): string[];
  /**
   * Apply a transition inside an action: validates, then updates the row's
   * status column via ctx.records.update (auto-audited).
   */
  transition(ctx: ActionCtx, table: PgTable, id: string | number, to: string): Promise<Row>;
}

export function defineStates(def: WorkflowDef): Workflow {
  const { initial, states, transitions } = def;
  if (!states.includes(initial)) throw new Error(`initial state ${initial} not in states`);

  const match = (row: Row, to: string, user: SeedUser): Transition | undefined =>
    transitions.find((t) => {
      const froms = Array.isArray(t.from) ? t.from : [t.from];
      if (!froms.includes(String(row['status'] ?? initial))) return false;
      if (t.to !== to) return false;
      if (t.perm && !can(user, t.perm)) return false;
      if (t.guard && !t.guard(row)) return false;
      return true;
    });

  return {
    def,
    can: (row, to, user) => match(row, to, user) !== undefined,
    nextStates: (row, user) =>
      transitions
        .filter((t) => {
          const froms = Array.isArray(t.from) ? t.from : [t.from];
          return froms.includes(String(row['status'] ?? initial));
        })
        .map((t) => t.to)
        .filter((to) => match(row, to, user) !== undefined),
    transition: async (ctx, table, id, to) => {
      const row = await ctx.records.get(table, id);
      if (!row) throw new Error(`row ${id} not found`);
      if (!match(row, to, ctx.user)) {
        throw new Error(
          `Invalid transition ${row['status'] ?? initial} -> ${to} for user ${ctx.user.id}`,
        );
      }
      return ctx.records.update(table, id, { status: to });
    },
  };
}
