import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { SeedUser } from '@platform/policy/roles';
import { PermissionDenied, requirePerm } from '@platform/rbac/rbac';
import { getDb, type DB, type DataMode } from '@platform/data/client';
import { auditLog, idempotencyKeys, approvalRequests, users as usersTable } from '@platform/data/schema';
import { maskObject, query as runQuery, aggregate as runAggregate, type QueryCtx } from '@platform/data/query';
import { resolveIntegrations } from '@platform/integrations';
import { getAction, getApp } from '@platform/registry';
import { makeRecords } from '@platform/records';
import { policyToJson } from '@platform/approvals';
import { emit } from '@platform/events';
import { ensureJobsStarted } from '@platform/events/jobs';
import { userById } from '@platform/policy/roles';
import type { ActionDef, InternalActionCtx, MutateResult } from './define';

// --- In-memory rate limiting (per process; swap for shared store later) ---
const buckets = new Map<string, number[]>();
function checkRateLimit(userId: string, actionId: string, limit: { max: number; windowSeconds: number }): boolean {
  const key = `${userId}:${actionId}`;
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < limit.windowSeconds * 1000);
  if (hits.length >= limit.max) return false;
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

/** Test-only escape hatch; never exported to app code. */
export interface InternalExecOpts {
  _forceDataMode?: DataMode;
}

function validationIssues(err: { issues?: { path: PropertyKey[]; message: string }[] }) {
  return (err.issues ?? []).map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
  }));
}

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
  action: ActionDef,
  appId: string | null,
  requestId: string,
  dataMode: DataMode,
  auditCalls: { entity: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[],
): InternalActionCtx {
  const reveal = new Set<string>();
  const qctx: QueryCtx = { db, user, reveal };
  const ctx: InternalActionCtx = {
    user,
    db,
    query: (t, o) => runQuery(qctx, t, o),
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
  void action;
  return ctx;
}

async function writeAudits(
  db: DB,
  ctx: { requestId: string; userId: string; actionId: string; appId: string | null },
  auditCalls: { entity: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[],
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
  const db = await getDb(dataMode);
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

  if (action.rateLimit && !checkRateLimit(user.id, actionId, action.rateLimit)) {
    return fail('rate_limited', `Rate limit exceeded for ${actionId}`);
  }

  const idemKey = action.idempotency?.(input);

  // --- Approvals ---
  if (action.approval) {
    const triggered = !action.approval.when || action.approval.when(input);
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
      await db.insert(approvalRequests).values({
        id: requestId,
        actionId,
        appId,
        requesterId: user.id,
        inputJson: JSON.stringify(input),
        policyJson: JSON.stringify(policyToJson(action.approval)),
        idemKey: idemKey ? `${actionId}:${idemKey}` : null,
        status: 'pending',
      });
      await insertAudit(db, {
        requestId, actorId: user.id, actionId, appId,
        entity: 'approval_requests', entityId: requestId,
        before: null, after: { status: 'pending', input }, status: 'needs_approval',
      });
      await emit({ type: 'approval.requested', actorId: user.id, appId, actionId, entityId: requestId });
      return { status: 'needs_approval', requestId };
    }
  }

  if (idemKey) {
    const existing = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, `${actionId}:${idemKey}`));
    if (existing[0]?.resultJson != null) {
      return { status: 'ok', data: JSON.parse(existing[0].resultJson) };
    }
  }

  const auditCalls: { entity: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[] = [];

  let data: unknown;
  try {
    data = await db.transaction(async (tx) => {
      const txCtx = buildCtx(tx as DB, user, action, appId, requestId, dataMode, auditCalls);
      return action.run(txCtx, input as never);
    });
  } catch (e) {
    return fail('run_error', e instanceof Error ? e.message : String(e));
  }

  await writeAudits(db, { requestId, userId: user.id, actionId, appId }, auditCalls);

  if (idemKey) {
    await db
      .insert(idempotencyKeys)
      .values({ key: `${actionId}:${idemKey}`, actionId, resultJson: JSON.stringify(data ?? null) })
      .onConflictDoNothing();
  }

  await emit({ type: 'action.completed', actorId: user.id, appId, actionId });
  return { status: 'ok', data };
}

/**
 * Approve or reject a pending request (called by platform.approve/reject actions
 * inside their own run()). Approval executes the original action AS THE
 * REQUESTER, bypassing the approval gate but re-running perm + idempotency.
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
  const auditCalls: { entity: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[] = [];
  const reqApp = req.appId ? getApp(req.appId) : undefined;
  const inner = buildCtx(db, requester, actionNoApproval, req.appId, requestId, reqApp?.dataMode ?? 'sandbox', auditCalls);
  let data: unknown;
  try {
    data = await actionNoApproval.run(inner, input);
  } catch (e) {
    await db
      .update(approvalRequests)
      .set({ status: 'failed' })
      .where(eq(approvalRequests.id, requestId));
    throw e;
  }
  await writeAudits(db, { requestId, userId: requester.id, actionId: req.actionId, appId: req.appId }, auditCalls);

  const idem = action.idempotency?.(input);
  if (idem) {
    await db
      .insert(idempotencyKeys)
      .values({ key: `${req.actionId}:${idem}`, actionId: req.actionId, resultJson: JSON.stringify(data ?? null) })
      .onConflictDoNothing();
  }

  await db
    .update(approvalRequests)
    .set({ status: 'executed', resultJson: JSON.stringify(data ?? null) })
    .where(eq(approvalRequests.id, requestId));

  await emit({ type: 'action.completed', actorId: requester.id, appId: req.appId, actionId: req.actionId, payload: { approvedBy: ctx.user.id } });
  return { decided: 'approved', result: data };
}
