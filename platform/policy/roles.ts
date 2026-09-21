// Org-wide permission and role policy. Versioned in-repo so every change is a reviewed PR.

export const permissions = [
  'pii.reveal',
  'audit.view',
  'admin.manage',
] as const;

export type PlatformPermission = (typeof permissions)[number];
// App manifests contribute their own permission strings; keep the union open.
export type Permission = PlatformPermission | (string & {});

export type RoleId =
  | 'analyst'
  | 'senior_reviewer'
  | 'compliance_readonly'
  | 'support_agent'
  | 'finance_approver'
  | 'eng_dev'
  | 'eng_admin';

export type Scope = 'own' | 'team' | 'all';

export interface RoleDef {
  permissions: Permission[];
  scope: Scope;
}

export const roles: Record<RoleId, RoleDef> = {
  analyst: { permissions: [], scope: 'own' },
  senior_reviewer: { permissions: ['pii.reveal'], scope: 'team' },
  compliance_readonly: { permissions: ['audit.view'], scope: 'all' },
  support_agent: { permissions: [], scope: 'own' },
  finance_approver: { permissions: ['audit.view'], scope: 'all' },
  eng_dev: { permissions: ['audit.view', 'pii.reveal'], scope: 'all' },
  eng_admin: { permissions: ['audit.view', 'pii.reveal', 'admin.manage'], scope: 'all' },
};

export interface SeedUser {
  id: string;
  name: string;
  role: RoleId;
  teamId: string;
}

export const users: SeedUser[] = [
  { id: 'u-analyst', name: 'Ana Analyst', role: 'analyst', teamId: 'kyc' },
  { id: 'u-senior', name: 'Sam Senior', role: 'senior_reviewer', teamId: 'kyc' },
  { id: 'u-compliance', name: 'Cora Compliance', role: 'compliance_readonly', teamId: 'compliance' },
  { id: 'u-support', name: 'Sue Support', role: 'support_agent', teamId: 'support' },
  { id: 'u-finance', name: 'Finn Finance', role: 'finance_approver', teamId: 'finance' },
  { id: 'u-engdev', name: 'Dev Devin', role: 'eng_dev', teamId: 'eng' },
  { id: 'u-engadmin', name: 'Ada Admin', role: 'eng_admin', teamId: 'eng' },
];
