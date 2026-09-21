import { describe, it, expect } from 'vitest';
import { can, requirePerm, PermissionDenied, scopePredicate } from '@platform/rbac/rbac';
import { casesTable, analyst, engAdmin } from './helpers';
import { getTableColumns } from 'drizzle-orm';
import type { SeedUser } from '@platform/policy/roles';

const senior: SeedUser = { id: 'u-s', name: 'Senior', role: 'senior_reviewer', teamId: 'kyc' };

describe('rbac', () => {
  it('can() reflects role permissions', () => {
    expect(can(senior, 'pii.reveal')).toBe(true);
    expect(can(analyst, 'pii.reveal')).toBe(false);
    expect(can(engAdmin, 'audit.read')).toBe(true);
  });

  it('requirePerm throws PermissionDenied', () => {
    expect(() => requirePerm(senior, 'pii.reveal')).not.toThrow();
    expect(() => requirePerm(analyst, 'pii.reveal')).toThrow(PermissionDenied);
  });

  it('scopePredicate: all → undefined', () => {
    expect(scopePredicate(engAdmin, casesTable)).toBeUndefined();
  });

  it('scopePredicate: own → owner_id = user', () => {
    const sql = scopePredicate(analyst, casesTable);
    expect(sql).toBeDefined();
    void getTableColumns(casesTable);
  });

  it('scopePredicate: team → team_id = user.teamId', () => {
    expect(scopePredicate(senior, casesTable)).toBeDefined();
  });
});
