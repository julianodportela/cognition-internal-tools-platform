import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { SeedUser } from '@platform/policy/roles';
import { PermissionDenied, requirePerm } from '@platform/rbac/rbac';
import { getDb, type DB, type DataMode } from '@platform/data/client';
import { auditLog, idempotencyKeys } from '@platform/data/schema';
import { maskObject, query as runQuery, aggregate as runAggregate, type QueryCtx } from '@platform/data/query';
import { resolveIntegrations } from '@platform/integrations';
import { getAction } from '@platform/registry';
import type { ActionCtx, ActionDef, MutateResult } from './define';

// --- In-memory rate limiting (per process; swap for shared store later) ---
const buckets = new Map<string, number[]>();
function checkRateLimit(userId: string, actionId: string, limit: { perUser: number; perMinute: number }): boolean {
  const key = `${userId}:${actionId}`;
  const now = Date.now();
  const windowMs = 60_000;
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit.perUser * limit.perMinute) return false;
  hits.push(now);
  buckets.set(key, hits);
  return true;
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

export async function executeAction(
  user: SeedUser,
  actionId: string,
  rawInput: unknown,
  opts: { dataMode?: DataMode } = {},
): Promise<MutateResult> {
  const action = getAction(actionId) as ActionDef | undefined;
  if (!action) {
    return { status: 'failed', code: 'unknown_action', message: `No action ${actionId}` };
  }
  const dataMode = opts.dataMode ?? 'sandbox';
  const db = await getDb(dataMode);
  const requestId = randomUUID();
  const appId = action.appId ?? null;

  const fail = async (code: string, message: string): Promise<MutateResult> => {
    await insertAudit(db, {
      requestId,
      actorId: user.id,
      actionId,
      appId,
      entity: actionId,
      entityId: null,
      before: null,
      after: null,
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
  if (idemKey) {
    const existing = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, `${actionId}:${idemKey}`));
    if (existing[0]?.resultJson != null) {
      return { status: 'ok', data: JSON.parse(existing[0].resultJson) };
    }
  }

  // --- PHASE 2 SEAM: approvals ---
  // When action.approval is set and its `when` predicate matches, phase 2 will
  // enqueue a pending approval and return needs_approval instead of executing.
  if (action.approval) {
    // TODO(phase-2): persist approval request; notify approvers.
    return { status: 'needs_approval', requestId };
  }

  const integrations = resolveIntegrations(dataMode);
  const reveal = new Set<string>();
  const auditCalls: { entity: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[] = [];

  const qctx: QueryCtx = { db, user, reveal };
  const ctx: ActionCtx = {
    user,
    db,
    query: (t, o) => runQuery(qctx, t, o),
    aggregate: (t, o) => runAggregate(qctx, t, o),
    integrations,
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

  let data: unknown;
  try {
    data = await db.transaction(async (tx) => {
      (ctx as { db: DB }).db = tx as DB;
      (qctx as { db: unknown }).db = tx;
      return action.run(ctx, input as never);
    });
  } catch (e) {
    return fail('run_error', e instanceof Error ? e.message : String(e));
  }

  if (auditCalls.length === 0) {
    await insertAudit(db, {
      requestId, actorId: user.id, actionId, appId,
      entity: actionId, entityId: null, before: null, after: null, status: 'ok',
    });
  } else {
    for (const c of auditCalls) {
      await insertAudit(db, {
        requestId, actorId: user.id, actionId, appId,
        entity: c.entity, entityId: c.id, before: c.before, after: c.after, status: 'ok',
      });
    }
  }

  if (idemKey) {
    await db
      .insert(idempotencyKeys)
      .values({ key: `${actionId}:${idemKey}`, actionId, resultJson: JSON.stringify(data ?? null) })
      .onConflictDoNothing();
  }

  return { status: 'ok', data };
}
