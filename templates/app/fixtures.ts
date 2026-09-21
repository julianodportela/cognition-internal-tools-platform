// 40 deterministic synthetic rows. Loaded into the SANDBOX db only
// (platform/data/fixtures.ts throws on production).

// Small deterministic PRNG so fixture data is stable across resets.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'paid'] as const;
const TEAMS = ['ops', 'eng', 'kyc', 'finance'];
const REQUESTERS = ['u-analyst', 'u-senior', 'u-support'];
const ASSIGNEES = ['u-senior', 'u-analyst', null, null];
const TITLES = [
  'Conference travel', 'Team dinner', 'Laptop stand', 'Software license',
  'Taxi to airport', 'Offsite catering', 'Hardware repair', 'Visa fee',
];

const day = 24 * 60 * 60 * 1000;
const now = Date.now();

export const fixtures = {
  expense_requests: Array.from({ length: 40 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    title: `${TITLES[i % TITLES.length]} #${i + 1}`,
    // ~1 in 8 rows exceeds the $500 dual-control threshold.
    amountCents: i % 8 === 7 ? 60_000 + Math.floor(rand() * 90_000) : 500 + Math.floor(rand() * 30_000),
    status: STATUSES[i % STATUSES.length],
    requesterId: REQUESTERS[i % REQUESTERS.length],
    assigneeId: ASSIGNEES[i % ASSIGNEES.length],
    // Every 5th row is overdue so the sla.check job has something to find.
    dueAt: i % 5 === 4 ? new Date(now - (2 + i % 7) * day) : new Date(now + (3 + i % 10) * day),
    receiptNote: i % 3 === 0 ? `Receipt emailed separately (${i + 1})` : null,
    employeeEmail: `user${i + 1}@example.test`,
    employeeBankLast4: String(1000 + (i * 37) % 9000),
    teamId: TEAMS[i % TEAMS.length],
  })),
};
