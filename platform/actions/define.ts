import type { ZodType } from 'zod';
import type { SeedUser, Permission } from '@platform/policy/roles';
import type { DB } from '@platform/data/client';
import type { QueryOptions, QueryResult, AggregateOptions } from '@platform/data/query';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Integrations } from '@platform/integrations';
import type { RecordsApi } from '@platform/records';
import type { AppManifest } from '@platform/registry';

export type ApprovalPolicy =
  | { kind: 'dualControl'; when?: (input: unknown) => boolean }
  | { kind: 'requiresRole'; role: string; when?: (input: unknown) => boolean };

export interface ActionCtx {
  user: SeedUser;
  query(table: PgTable, opts?: QueryOptions): Promise<QueryResult>;
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
  guardFixture?: (helpers: { db: DB }) => I | Promise<I>;
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
  guardFixture?: (helpers: { db: DB }) => I | Promise<I>;
  run(ctx: ActionCtx, input: I): Promise<O>;
}

export function defineAction<I, O>(opts: ActionOpts<I, O>): ActionDef<I, O> {
  return { risk: 'high', ...opts };
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
