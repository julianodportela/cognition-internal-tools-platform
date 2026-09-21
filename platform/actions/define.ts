import { z, type ZodType } from 'zod';
import type { SeedUser, Permission } from '@platform/policy/roles';
import type { DB } from '@platform/data/client';
import type { QueryOpts, QueryResult, AggregateOptions } from '@platform/data/query';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Integrations } from '@platform/integrations';
import type { SQL } from 'drizzle-orm';
import type { RecordsApi } from '@platform/records';
import type { AppManifest } from '@platform/registry';

/**
 * Read-only context given to approval predicates. Bound to the app's own
 * dataMode — predicates load real rows instead of trusting request input.
 */
export interface ApprovalCtx {
  user: SeedUser;
  records: {
    get(table: PgTable, id: string | number): Promise<Record<string, unknown> | null>;
  };
}

export type ApprovalPolicy =
  | { kind: 'dualControl'; when?: (input: unknown, ctx: ApprovalCtx) => boolean | Promise<boolean> }
  | { kind: 'requiresRole'; role: string; when?: (input: unknown, ctx: ApprovalCtx) => boolean | Promise<boolean> };

/**
 * The frozen context handed to app action code. It carries NO db property —
 * rows flow through records/query/audit closures bound to the action's app
 * (platform-internal actions go through InternalActionCtx instead). Callers
 * must not be able to add fields: the runtime hands a frozen object whose
 * own-keys never include 'db'.
 */
export interface ActionCtx {
  user: SeedUser;
  /**
   * Id of the approver who decided the request, when this action is executing
   * inside decideApproval. Undefined for direct (non-approved) execution —
   * stamp approval-dependent columns with `ctx.approvedBy ?? null`.
   */
  approvedBy?: string;
  query(table: PgTable, opts?: QueryOpts): Promise<QueryResult>;
  aggregate(table: PgTable, opts?: AggregateOptions): Promise<Record<string, unknown>[]>;
  records: RecordsApi;
  integrations: Integrations;
  appId: string | null;
  requestId: string;
  now: Date;
  reveal: ReadonlySet<string>;
  audit: {
    record(
      entity: string,
      entityId: string,
      before: Record<string, unknown> | null,
      after: Record<string, unknown> | null,
    ): Promise<void>;
  };
}

/** Platform-internal ctx: still exposes the raw tx handle. Never given to app code. */
export interface InternalActionCtx extends ActionCtx {
  db: DB;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ActionDef<I = any, O = any> {
  id: string;
  perm: Permission;
  input: ZodType<I>;
  risk: 'high' | 'low';
  approval?: ApprovalPolicy;
  idempotency?: (input: I) => string;
  rateLimit?: { max: number; windowSeconds: number };
  tags?: ('money' | 'external')[];
  appId?: string;
  /** Skip in the audit-completeness guard test; value is the justification. */
  guardSkip?: string;
  /** Guard-test helper: produce a valid input (e.g. referencing a seeded row). */
  guardFixture?: (ctx: GuardFixtureCtx) => I | Promise<I>;
  /** Platform-internal: run receives an InternalActionCtx with the raw tx. */
  internal?: boolean;
  /** Escape hatch for binary payloads (e.g. dataBase64) — fields exempt from
   *  the 1000-char input cap. Platform-internal use only. */
  largeInputFields?: string[];
  run(ctx: ActionCtx, input: I): Promise<O>;
}

export interface ActionOpts<I, O> {
  id: string;
  perm: Permission;
  /**
   * Input schemas must carry entity IDs and amounts — never raw PII.
   * Approval requests persist input_json in approval_requests; the guard
   * layer fails the build if any field name appears in the global
   * sensitive-field list (platform/policy/sensitive-fields.ts).
   */
  input: ZodType<I>;
  risk?: 'high' | 'low';
  approval?: ApprovalPolicy;
  idempotency?: (input: I) => string;
  rateLimit?: { max: number; windowSeconds: number };
  tags?: ('money' | 'external')[];
  appId?: string;
  guardSkip?: string;
  guardFixture?: (ctx: GuardFixtureCtx) => I | Promise<I>;
  run(ctx: ActionCtx, input: I): Promise<O>;
}

/**
 * Every Zod string input field must declare a `.max()` of at most 1000 —
 * free-text inputs land in approval_requests.input_json and audit rows, and
 * unbounded strings are a storage/PII-sink risk.
 */
export function assertStringFieldsBounded(id: string, input: ZodType, exempt: string[] = []): void {
  if (!(input instanceof z.ZodObject)) return;
  for (const [name, field] of Object.entries(input.shape)) {
    if (exempt.includes(name)) continue;
    const unwrapped = field instanceof z.ZodOptional || field instanceof z.ZodNullable
      ? (field as z.ZodOptional<ZodType>).unwrap()
      : field;
    if (unwrapped instanceof z.ZodString) {
      const max = unwrapped.maxLength;
      if (max === null || max > 1000) {
        throw new Error(
          `Action ${id}: string input '${name}' must declare .max() <= 1000 (got ${max}). See AGENTS.md §Invariants.`,
        );
      }
    }
  }
}

export function defineAction<I, O>(opts: ActionOpts<I, O>): ActionDef<I, O> {
  // Defense in depth: the spread below must never let an app smuggle the
  // internal flags that would hand run() a raw tx on ctx.db.
  if ('internal' in opts || 'largeInputFields' in opts) {
    throw new Error(
      `Action ${opts.id}: 'internal'/'largeInputFields' are platform-internal and may not be set by app code. See AGENTS.md §Invariants.`,
    );
  }
  assertStringFieldsBounded(opts.id, opts.input);
  return { risk: 'high', ...opts };
}

/** Ergonomic fixture context handed to guardFixture — sandbox db only. */
export interface GuardFixtureCtx {
  firstRow(table: PgTable, where?: SQL): Promise<Record<string, unknown> | undefined>;
  user: SeedUser;
}

/** App-code entry point for declaring a manifest (identity fn with type). */
export function defineApp(m: AppManifest): AppManifest {
  return m;
}

export type MutateResult =
  | { status: 'ok'; data: unknown }
  | { status: 'needs_approval'; requestId: string }
  | { status: 'validation_error'; issues: { path: string; message: string }[] }
  | { status: 'failed'; code: string; message: string };
