// Org-wide permission and role policy. Versioned in-repo so every change is a reviewed PR.

export const permissions = [
  // platform
  'pii.reveal',
  'audit.read',
  'approvals.manage',
  'admin.manage',
  // kyc
  'kyc.read',
  'kyc.decide',
  'kyc.decide_high_risk',
  // refunds
  'refunds.read',
  'refunds.issue',
  'refunds.approve',
  // flags
  'flags.read',
  'flags.toggle',
  'flags.prod.toggle',
  // template/example app
  'template.read',
  'template.write',
  'template.approve',
] as const;

export type Permission = (typeof permissions)[number];

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
  analyst: {
    permissions: ['kyc.read', 'refunds.read', 'flags.read', 'template.read', 'template.write'],
    scope: 'own',
  },
  senior_reviewer: {
    permissions: ['kyc.read', 'kyc.decide', 'kyc.decide_high_risk', 'pii.reveal', 'template.read', 'template.write'],
    scope: 'team',
  },
  compliance_readonly: {
    permissions: ['audit.read', 'kyc.read', 'refunds.read'],
    scope: 'all',
  },
  support_agent: {
    permissions: ['refunds.read', 'flags.read', 'template.read'],
    scope: 'own',
  },
  finance_approver: {
    permissions: ['refunds.read', 'refunds.issue', 'refunds.approve', 'audit.read', 'approvals.manage', 'template.read', 'template.approve'],
    scope: 'all',
  },
  eng_dev: {
    permissions: [
      'audit.read', 'pii.reveal',
      'kyc.read', 'refunds.read', 'refunds.issue',
      'flags.read', 'flags.toggle',
      'template.read', 'template.write', 'template.approve',
    ],
    scope: 'all',
  },
  eng_admin: {
    permissions: [
      'audit.read', 'pii.reveal', 'approvals.manage', 'admin.manage',
      'kyc.read', 'kyc.decide', 'kyc.decide_high_risk',
      'refunds.read', 'refunds.issue', 'refunds.approve',
      'flags.read', 'flags.toggle', 'flags.prod.toggle',
      'template.read', 'template.write', 'template.approve',
    ],
    scope: 'all',
  },
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

export function userById(id: string): SeedUser | undefined {
  return users.find((u) => u.id === id);
}
