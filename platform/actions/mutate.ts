import { and, eq, lt } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { SeedUser } from '@platform/policy/roles';
import { PermissionDenied, requirePerm } from '@platform/rbac/rbac';
import type { DB, DataMode } from '@platform/data/client';
import { getAppDb, getPlatformDb } from '@platform/data/internal';
import { auditLog, idempotencyKeys, rateLimitBuckets, approvalRequests, users as usersTable } from '@platform/data/schema';
import { maskObject, query as runQuery, aggregate as runAggregate, type QueryCtx, type QueryOptions } from '@platform/data/query';
import { resolveIntegrations } from '@platform/integrations';
import { getAction, getApp } from '@platform/registry';
import { makeRecords } from '@platform/records';
import { policyToJson } from '@platform/approvals';
import { emit } from '@platform/events';
import { ensureJobsStarted } from '@platform/events/jobs';
import { userById } from '@platform/policy/roles';
import { log } from '@platform/log';
import type { ActionCtx, ActionDef, InternalActionCtx, MutateResult } from './define';

/** Test-only escape hatch; never exported to app code. */
export interface InternalExecOpts {
  _forceDataMode?: DataMode;
}

class InProgressError extends Error {
  constructor() {
    super('another request with the same idempotency key is in progress');
    this.name = 'in_progress';
  }
}
class RateLimitedError extends Error {
  constructor(actionId: string) {
    super(`Rate limit exceeded for ${actionId}`);
    this.name = 'rate_limited';
  }
}

function validationIssues(err: { issues?: { path: PropertyKey[]; message: string }[] }) {
  return (err.issues ?? []).map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
  }));
}

type AuditCall = { entity: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

async function insertAudit(
  db: DB,
  row: {
    requestId: string;
    actorId: string;
    actionId: string;
    appId: string | null;
    entity: string;
    entityId: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    status: string;
  },
) {
  await db.insert(auditLog).values({
    requestId: row.requestId,
    actorId: row.actorId,
    actionId: row.actionId,
    appId: row.appId,
    entity: row.entity,
    entityId: row.entityId,
    beforeJson: row.before ? JSON.stringify(maskObject(row.entity, row.before)) : null,
    afterJson: row.after ? JSON.stringify(maskObject(row.entity, row.after)) : null,
    status: row.status,
  });
}

function buildCtx(
  db: DB,
  user: SeedUser,
  appId: string | null,
  requestId: string,
  dataMode: DataMode,
  auditCalls: AuditCall[],
  approvedBy?: string,
): InternalActionCtx {
  const reveal = new Set<string>();
  const qctx: QueryCtx = { db, user, reveal };
  // App-facing query/aggregate closures strip scope/includeDeleted — there is
  // no runtime opt-out of row visibility from inside an action either.
  const stripOpts = (o?: QueryOptions): QueryOptions => {
    const { scope, includeDeleted, ...rest } = o ?? {};
    if (scope !== undefined || includeDeleted !== undefined) {
      throw new Error(
        "query options 'scope'/'includeDeleted' are not available to app code. See AGENTS.md §Invariants.",
      );
    }
    return rest;
  };
  return {
    user,
    db,
    approvedBy,
    query: (t, o) => runQuery(qctx, t, stripOpts(o)),
    aggregate: (t, o) => runAggregate(qctx, t, o),
    records: makeRecords({ db, user, appId, reveal, auditPush: (c) => auditCalls.push(c) }),
    integrations: resolveIntegrations(dataMode),
    appId,
    requestId,
    now: new Date(),
    reveal,
    audit: {
      record: async (entity, id, before, after) => {
        auditCalls.push({ entity, id, before, after });
      },
    },
  };
}

/** The ctx app action code actually sees: frozen, and own-keys exclude 'db'. */
function publicCtx(inner: InternalActionCtx): ActionCtx {
  const { db: _dbUnused, ...pub } = inner;
  void _dbUnused;
  return Object.freeze(pub);
}

async function writeAudits(
  db: DB,
  ctx: { requestId: string; userId: string; actionId: string; appId: string | null },
  auditCalls: AuditCall[],
) {
  if (auditCalls.length === 0) {
    await insertAudit(db, {
      requestId: ctx.requestId, actorId: ctx.userId, actionId: ctx.actionId,
      appId: ctx.appId, entity: ctx.actionId, entityId: null,
      before: null, after: null, status: 'ok',
    });
    return;
  }
  for (const c of auditCalls) {
    await insertAudit(db, {
      requestId: ctx.requestId, actorId: ctx.userId, actionId: ctx.actionId,
      appId: ctx.appId, entity: c.entity, entityId: c.id,
      before: c.before, after: c.after, status: 'ok',
    });
  }
}

/** Durable rate limit via rate_limit_buckets — survives multi-process and
 *  restart, unlike an in-memory Map. Runs inside the action's transaction. */
async function consumeRateLimit(tx: DB, userId: string, actionId: string, limit: { max: number; windowSeconds: number }): Promise<void> {
  const windowMs = limit.windowSeconds * 1000;
  // Prune rows whose window has fully expired.
  await tx
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.windowStart, new Date(Date.now() - windowMs)));
  const [bucket] = await tx
    .select()
    .from(rateLimitBuckets)
    .where(and(eq(rateLimitBuckets.userId, userId), eq(rateLimitBuckets.actionId, actionId)))
    .limit(1);
  if (!bucket) {
    await tx.insert(rateLimitBuckets).values({ userId, actionId, count: 1, windowStart: new Date() });
    return;
  }
  if (bucket.count >= limit.max) throw new RateLimitedError(actionId);
  await tx
    .update(rateLimitBuckets)
    .set({ count: bucket.count + 1 })
    .where(eq(rateLimitBuckets.id, bucket.id));
}

interface CoreParams {
  action: ActionDef;
  requester: SeedUser;
  input: unknown;
  appId: string | null;
  dataMode: DataMode;
  requestId: string;
  approvedBy?: string;
}

type CoreOutcome =
  | { kind: 'replayed'; data: unknown }
  | { kind: 'executed'; data: unknown };

/**
 * THE transactional core every money-action goes through — one db.transaction:
 *  (1) claim the idempotency key as in_progress (ON CONFLICT → replay/in_progress)
 *  (2) consume a rate-limit bucket (durable table)
 *  (3) run the action
 *  (4) write audit rows
 *  (5) mark the key completed with the stored result
 * A run() error rolls all of it back; the failed audit row is written
 * afterwards in a separate small transaction by the caller.
 *
 * decideApproval runs the identical steps via executeCoreTx inside its own
 * outer transaction so the decision and the execution commit atomically.
 */
export async function executeCore(db: DB, p: CoreParams): Promise<CoreOutcome> {
  return db.transaction((tx) => executeCoreTx(tx as DB, p));
}

export async function executeAction(
  user: SeedUser,
  actionId: string,
  rawInput: unknown,
  opts: InternalExecOpts = {},
): Promise<MutateResult> {
  ensureJobsStarted();
  const action = getAction(actionId) as ActionDef | undefined;
  if (!action) {
    return { status: 'failed', code: 'unknown_action', message: `No action ${actionId}` };
  }

  // dataMode comes from the owning app's manifest — never a silent default.
  const appId = action.appId ?? (rawInput as { appId?: string } | null)?.appId ?? null;
  const app = appId ? getApp(appId) : undefined;
  const dataMode: DataMode = opts._forceDataMode ?? app?.dataMode ?? 'sandbox';
  const db = app ? await getAppDb(app) : await getPlatformDb('sandbox');
  const requestId = randomUUID();
  if (appId && !app) {
    await insertAudit(db, {
      requestId, actorId: user.id, actionId, appId,
      entity: actionId, entityId: null, before: null, after: null,
      status: 'failed:unknown_app',
    });
    return { status: 'failed', code: 'unknown_app', message: `No app ${appId}` };
  }

  const fail = async (code: string, message: string): Promise<MutateResult> => {
    await insertAudit(db, {
      requestId, actorId: user.id, actionId, appId,
      entity: actionId, entityId: null, before: null, after: null,
      status: `failed:${code}`,
    });
    return { status: 'failed', code, message };
  };

  try {
    requirePerm(user, action.perm);
  } catch (e) {
    if (e instanceof PermissionDenied) return fail('permission_denied', e.message);
    throw e;
  }

  const parsed = action.input.safeParse(rawInput);
  if (!parsed.success) {
    return { status: 'validation_error', issues: validationIssues(parsed.error) };
  }
  const input = parsed.data;

  const idemKey = action.idempotency?.(input as never);

  // Idempotency lookup BEFORE the approval branch: a replayed call returns the
  // stored result without minting a second approval request.
  if (idemKey) {
    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, `${actionId}:${idemKey}`))
      .limit(1);
    if (existing?.status === 'completed' && existing.resultJson != null) {
      return { status: 'ok', data: JSON.parse(existing.resultJson) };
    }
    if (existing?.status === 'in_progress') {
      return { status: 'failed', code: 'in_progress', message: `Action failed (ref ${requestId})` };
    }
  }

  // Early rate-limit check so a throttled caller fails fast; the authoritative
  // increment happens inside the transaction in executeCore.
  if (action.rateLimit) {
    const [bucket] = await db
      .select()
      .from(rateLimitBuckets)
      .where(and(eq(rateLimitBuckets.userId, user.id), eq(rateLimitBuckets.actionId, actionId)))
      .limit(1);
    if (bucket && bucket.windowStart.getTime() > Date.now() - action.rateLimit.windowSeconds * 1000 && bucket.count >= action.rateLimit.max) {
      return fail('rate_limited', `Rate limit exceeded for ${actionId}`);
    }
  }

  // --- Approvals ---
  if (action.approval) {
    // Read-only ctx so predicates load real rows — never trust request input
    // for amounts/status that decide whether an approval is required.
    const ro = makeRecords({ db, user, appId, reveal: new Set(), auditPush: () => {} });
    const approvalCtx = Object.freeze({ user, records: { get: ro.get } });
    const triggered = !action.approval.when || await action.approval.when(input, approvalCtx);
    if (triggered) {
      // A pending request with the same idempotency key returns the same requestId.
      if (idemKey) {
        const existing = await db
          .select()
          .from(approvalRequests)
          .where(and(eq(approvalRequests.idemKey, `${actionId}:${idemKey}`), eq(approvalRequests.status, 'pending')))
          .limit(1);
        if (existing[0]) {
          return { status: 'needs_approval', requestId: existing[0].id };
        }
      }
      // input_json is masked before storage — free-text fields never persist raw PII.
      const maskedInput = maskObject('approval_requests', input as Record<string, unknown>);
      await db.insert(approvalRequests).values({
        id: requestId,
        actionId,
        appId,
        requesterId: user.id,
        inputJson: JSON.stringify(maskedInput),
        policyJson: JSON.stringify(policyToJson(action.approval)),
        idemKey: idemKey ? `${actionId}:${idemKey}` : null,
        status: 'pending',
      });
      await insertAudit(db, {
        requestId, actorId: user.id, actionId, appId,
        entity: 'approval_requests', entityId: requestId,
        before: null, after: { status: 'pending', input: maskedInput }, status: 'needs_approval',
      });
      await emit({ type: 'approval.requested', actorId: user.id, appId, actionId, entityId: requestId });
      return { status: 'needs_approval', requestId };
    }
  }

  try {
    const outcome = await executeCore(db, { action, requester: user, input, appId, dataMode, requestId });
    if (outcome.kind === 'replayed') return { status: 'ok', data: outcome.data };
    await emit({ type: 'action.completed', actorId: user.id, appId, actionId });
    return { status: 'ok', data: outcome.data };
  } catch (e) {
    if (e instanceof InProgressError) {
      return fail('in_progress', `Action failed (ref ${requestId})`);
    }
    if (e instanceof RateLimitedError) {
      return fail('rate_limited', `Rate limit exceeded for ${actionId}`);
    }
    // run_error → generic client message; full error logged keyed by requestId.
    log.error(`action ${actionId} failed`, { requestId, error: e instanceof Error ? e.stack : String(e) });
    return fail('run_error', `Action failed (ref ${requestId})`);
  }
}

/**
 * Approve or reject a pending request (called by platform.approve/reject actions
 * inside their own run()). Approval executes the original action AS THE
 * REQUESTER, bypassing the approval gate but re-running perm + idempotency.
 * The whole decision + execution lives in the platform.approve transaction —
 * approval_requests ends at 'executed' only if the run committed.
 */
export async function decideApproval(
  ctx: InternalActionCtx,
  requestId: string,
  approved: boolean,
  reason?: string,
): Promise<unknown> {
  const db = ctx.db;
  const [req] = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId))
    .limit(1);
  if (!req) throw new Error(`No such request ${requestId}`);
  if (req.status !== 'pending') throw new Error(`Request ${requestId} is ${req.status}`);

  const policy = JSON.parse(req.policyJson) as { kind: string; role?: string };
  const action = getAction(req.actionId) as ActionDef | undefined;
  if (!action) throw new Error(`Action ${req.actionId} no longer exists`);

  const { canDecide } = await import('@platform/approvals');
  if (!canDecide(ctx.user, req.requesterId, policy, action.perm)) {
    throw new Error('You may not decide this request');
  }

  // Atomic claim: only the first decider flips status out of 'pending'.
  const claimed = await db
    .update(approvalRequests)
    .set({
      status: approved ? 'approved' : 'rejected',
      approverId: ctx.user.id,
      reason: reason ?? null,
      decidedAt: new Date(),
    })
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, 'pending')))
    .returning();
  if (claimed.length === 0) throw new Error(`Request ${requestId} already decided`);

  await ctx.audit.record('approval_requests', requestId, { status: 'pending' }, { status: approved ? 'approved' : 'rejected', approverId: ctx.user.id, reason });
  await emit({ type: 'approval.decided', actorId: ctx.user.id, appId: req.appId, actionId: req.actionId, entityId: requestId, payload: { approved } });

  if (!approved) return { decided: 'rejected' };

  // Execute original action as the requester, approval gate bypassed.
  const requester =
    userById(req.requesterId) ??
    (await db.select().from(usersTable).where(eq(usersTable.id, req.requesterId)).limit(1))
      .map((r) => ({ id: r.id, name: r.name, role: r.role as SeedUser['role'], teamId: r.teamId }))[0];
  if (!requester) throw new Error(`Requester ${req.requesterId} no longer exists`);
  // Roles may have changed since the request was filed — re-check at execution.
  requirePerm(requester, action.perm);
  const input = JSON.parse(req.inputJson);
  const actionNoApproval = { ...action, approval: undefined };
  const reqApp = req.appId ? getApp(req.appId) : undefined;

  // Run the same transactional core inside this decision's outer transaction —
  // one commit carries the status flip, the run, the audits, and the idem key.
  const outcome = await executeCoreTx(db as DB, {
    action: actionNoApproval,
    requester,
    input,
    appId: req.appId,
    dataMode: reqApp?.dataMode ?? 'sandbox',
    requestId,
    approvedBy: ctx.user.id,
  });

  if (outcome.kind === 'executed') {
    await db
      .update(approvalRequests)
      .set({ status: 'executed', resultJson: JSON.stringify(outcome.data ?? null) })
      .where(eq(approvalRequests.id, requestId));
  }

  await emit({ type: 'action.completed', actorId: requester.id, appId: req.appId, actionId: req.actionId, payload: { approvedBy: ctx.user.id } });
  return { decided: 'approved', result: outcome.data };
}

/**
 * The core steps factored for callers that already hold a transaction handle —
 * decideApproval runs them inside the platform.approve transaction so claim,
 * run, audits, and status='executed' are a single atomic commit.
 */
async function executeCoreTx(tx: DB, p: CoreParams): Promise<CoreOutcome> {
  const idemKey = p.action.idempotency?.(p.input as never);
  let claimedKey: string | null = null;
  if (idemKey) {
    claimedKey = `${p.action.id}:${idemKey}`;
    const inserted = await tx
      .insert(idempotencyKeys)
      .values({ key: claimedKey, actionId: p.action.id, status: 'in_progress' })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) {
      const [existing] = await tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, claimedKey)).limit(1);
      if (existing?.status === 'completed' && existing.resultJson != null) {
        return { kind: 'replayed', data: JSON.parse(existing.resultJson) };
      }
      throw new InProgressError();
    }
  }

  if (p.action.rateLimit) {
    await consumeRateLimit(tx, p.requester.id, p.action.id, p.action.rateLimit);
  }

  const auditCalls: AuditCall[] = [];
  const inner = buildCtx(tx, p.requester, p.appId, p.requestId, p.dataMode, auditCalls, p.approvedBy);
  const runCtx = p.action.internal ? inner : publicCtx(inner);
  const data = await p.action.run(runCtx, p.input as never);

  await writeAudits(tx, { requestId: p.requestId, userId: p.requester.id, actionId: p.action.id, appId: p.appId }, auditCalls);

  if (claimedKey) {
    await tx
      .update(idempotencyKeys)
      .set({ status: 'completed', resultJson: JSON.stringify(data ?? null) })
      .where(eq(idempotencyKeys.key, claimedKey));
  }
  return { kind: 'executed', data };
}
