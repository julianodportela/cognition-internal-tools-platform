// 40 deterministic synthetic rows. Loaded into the SANDBOX db only
// (platform/data/fixtures.ts throws on production). All names, dates and
// document numbers are made up — never real-looking.

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(23);
const COUNTRIES = ['FR', 'DE', 'ES', 'NL', 'IE', 'IT'];
const DOC_TYPES = ['passport', 'national_id', 'driving_licence'] as const;
const RISKS = ['low', 'low', 'medium', 'high'] as const; // ~1/4 high
const day = 24 * 60 * 60 * 1000;
const now = Date.now();

// Status cycle covers all four states; in_review rows rotate across
// assignees — u-engadmin rows are kept low/medium risk so the
// audit-completeness guard (which runs as u-engadmin) can decide them.
const STATUS_CYCLE = [
  'pending', 'pending', 'in_review', 'approved', 'rejected',
  'pending', 'in_review', 'rejected', 'pending', 'approved',
] as const;
const IN_REVIEW_ASSIGNEES = ['u-analyst', 'u-senior', 'u-engadmin'] as const;

const rows = Array.from({ length: 40 }, (_, i) => {
  const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
  const createdAt = new Date(now - (1 + (i % 14)) * day);
  // dueAt is createdAt + 48h; every 4th pending row gets an extra-late
  // createdAt so several open rows are already OVERDUE.
  const overdue = status === 'pending' && i % 4 === 0;
  const openedAt = overdue ? new Date(now - (4 + (i % 6)) * day) : createdAt;
  const dueAt = new Date(openedAt.getTime() + 2 * day);
  let riskScore = RISKS[i % RISKS.length];

  let assigneeId: string | null = null;
  let decidedBy: string | null = null;
  let decidedAt: Date | null = null;
  let decisionReason: string | null = null;
  let resubmissionCount = 0;

  if (status === 'in_review') {
    assigneeId = IN_REVIEW_ASSIGNEES[i % IN_REVIEW_ASSIGNEES.length];
    if (assigneeId === 'u-engadmin' && riskScore === 'high') riskScore = 'medium';
  }
  if (status === 'approved' || status === 'rejected') {
    assigneeId = status === 'approved' ? 'u-senior' : 'u-analyst';
    decidedBy = 'u-senior';
    decidedAt = new Date(openedAt.getTime() + day);
    decisionReason =
      status === 'approved' ? `Documents verified (#${i + 1})` : `Document illegible (#${i + 1})`;
    resubmissionCount = status === 'rejected' && i % 2 === 0 ? 1 : 0;
  }

  return {
    id: `00000000-0000-4000-b000-${String(i + 1).padStart(12, '0')}`,
    customerRef: `CUST-${String(7000 + i)}`,
    fullName: `Test Customer ${i + 1}`,
    dateOfBirth: `198${i % 10}-0${(i % 9) + 1}-${String(1 + (i % 27)).padStart(2, '0')}`,
    country: COUNTRIES[i % COUNTRIES.length],
    idDocumentType: DOC_TYPES[i % DOC_TYPES.length],
    idDocumentNumber: `DOC${String(100000 + Math.floor(rand() * 899999))}`,
    riskScore,
    status,
    assigneeId,
    teamId: 'kyc',
    dueAt,
    decidedBy,
    decidedAt,
    decisionReason,
    resubmissionCount,
    createdAt,
    updatedAt: decidedAt ?? createdAt,
  };
});

export const fixtures = { kyc_reviews: rows };
