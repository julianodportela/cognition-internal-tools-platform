import type { ZodType } from 'zod';
import type { SeedUser } from '@platform/policy/roles';
import type { DB } from '@platform/data/client';
import type { QueryOptions, QueryResult, AggregateOptions } from '@platform/data/query';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Integrations } from '@platform/integrations';

export interface ApprovalPolicy {
  // Phase 2: dualControl(pred), requiresRole(role), notSelf, etc.
  kind: 'dualControl' | 'requiresRole' | 'notSelf';
  role?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  when?: (input: any) => boolean;
}

export interface ActionCtx {
  user: SeedUser;
  db: DB; // transaction handle — the only db handle app code receives
  query(table: PgTable, opts?: QueryOptions): Promise<QueryResult>;
  aggregate(table: PgTable, opts?: AggregateOptions): Promise<Record<string, unknown>[]>;
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

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ActionDef<I = any, O = any> {
  id: string;
  perm: string;
  input: ZodType<I>;
  risk: 'high' | 'low';
  approval?: ApprovalPolicy;
  idempotency?: (input: I) => string;
  rateLimit?: { perUser: number; perMinute: number };
  tags?: ('money' | 'external')[];
  appId?: string;
  run(ctx: ActionCtx, input: I): Promise<O>;
}

export interface ActionOpts<I, O> {
  id: string;
  perm: string;
  input: ZodType<I>;
  risk?: 'high' | 'low';
  approval?: ApprovalPolicy;
  idempotency?: (input: I) => string;
  rateLimit?: { perUser: number; perMinute: number };
  tags?: ('money' | 'external')[];
  appId?: string;
  run(ctx: ActionCtx, input: I): Promise<O>;
}

export function defineAction<I, O>(opts: ActionOpts<I, O>): ActionDef<I, O> {
  return { risk: 'high', ...opts };
}

export type MutateResult =
  | { status: 'ok'; data: unknown }
  | { status: 'needs_approval'; requestId: string }
  | { status: 'validation_error'; issues: { path: string; message: string }[] }
  | { status: 'failed'; code: string; message: string };
