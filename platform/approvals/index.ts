import type { ApprovalPolicy, ApprovalCtx } from '@platform/actions/define';
import type { SeedUser, Permission } from '@platform/policy/roles';
import { can } from '@platform/rbac/rbac';

/**
 * Request needs one approver other than the requester.
 * `when(input, ctx)` may be async — ctx.records.get loads real rows so
 * predicates never trust request input.
 */
export function dualControl(
  when?: (input: unknown, ctx: ApprovalCtx) => boolean | Promise<boolean>,
): ApprovalPolicy {
  return { kind: 'dualControl', when };
}

/** Request needs an approver holding a specific role. */
export function requiresRole(
  role: string,
  when?: (input: unknown, ctx: ApprovalCtx) => boolean | Promise<boolean>,
): ApprovalPolicy {
  return { kind: 'requiresRole', role, when };
}

/** Serialize a policy for storage (function predicate is not persisted). */
export function policyToJson(p: ApprovalPolicy): Record<string, unknown> {
  return p.kind === 'requiresRole' ? { kind: p.kind, role: p.role } : { kind: p.kind };
}

/**
 * Two-layer approval model:
 * 1. `approvals.decide` (the perm on platform.approve/platform.reject) gates who may
 *    ATTEMPT to decide anything in the Inbox — granted broadly to working roles.
 * 2. `canDecide` below is the real per-request gate; notSelf is ALWAYS enforced:
 * - dualControl: approver ≠ requester AND (holds the action's perm OR approvals.manage)
 * - requiresRole: approver ≠ requester AND approver.role === policy.role
 * `approvals.manage` therefore means OVERRIDE: it lets finance/eng_admin decide any
 * dualControl request even for an action whose perm they don't hold.
 */
export function canDecide(
  approver: SeedUser,
  requesterId: string,
  policy: { kind: string; role?: string },
  actionPerm: Permission,
): boolean {
  if (approver.id === requesterId) return false;
  if (policy.kind === 'requiresRole') {
    return approver.role === policy.role;
  }
  return can(approver, actionPerm) || can(approver, 'approvals.manage');
}
