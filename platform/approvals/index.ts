import type { ApprovalPolicy } from '@platform/actions/define';
import type { SeedUser, Permission } from '@platform/policy/roles';
import { can } from '@platform/rbac/rbac';

/** Request needs one approver other than the requester. */
export function dualControl(when?: (input: unknown) => boolean): ApprovalPolicy {
  return { kind: 'dualControl', when };
}

/** Request needs an approver holding a specific role. */
export function requiresRole(role: string, when?: (input: unknown) => boolean): ApprovalPolicy {
  return { kind: 'requiresRole', role, when };
}

/** Serialize a policy for storage (function predicate is not persisted). */
export function policyToJson(p: ApprovalPolicy): Record<string, unknown> {
  return p.kind === 'requiresRole' ? { kind: p.kind, role: p.role } : { kind: p.kind };
}

/**
 * May `approver` decide this request? notSelf is ALWAYS enforced.
 * - dualControl: approver ≠ requester AND (holds the action's perm OR approvals.manage)
 * - requiresRole: approver ≠ requester AND approver.role === policy.role
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
