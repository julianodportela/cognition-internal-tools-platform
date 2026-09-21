// ~30 deterministic synthetic flags + ~40 history rows. Loaded into the
// SANDBOX db only (platform/data/fixtures.ts throws on production).
//
// The fixture set deliberately covers every guardFixture the actions need:
//  - unarchived flag with tags exactly 'payments' and 'kyc' (restricted prod)
//  - unarchived flag with tags '' (staging / production fixtures)
//  - unarchived flag with both envs off (archive fixture)
// plus ~8 stale flags (no change in 90+ days), 4 archived flags, and one
// untagged flag whose key ends in 'F' — the mock flag service rejects it,
// which is the failure-path probe.

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

const rand = mulberry32(2026);
const day = 24 * 60 * 60 * 1000;
const now = Date.now();

const flagId = (i: number) =>
  `00000000-0000-4000-b000-${String(i).padStart(12, '0')}`;

const KEYS = [
  'checkout-new-cart', 'kyc-doc-upload-v2', 'payments-3ds-stepup',
  'growth-referral-banner', 'support-macro-panel', 'kyc-liveness-check',
  'payments-instant-settle', 'checkout-one-tap', 'platform-dark-mode',
  'growth-onboarding-quiz', 'support-chat-v2', 'payments-fx-margin',
  'kyc-auto-approve-low', 'checkout-guest-mode', 'platform-rate-limit-v2',
  'growth-email-digest', 'support-triage-bot', 'payments-batch-refund',
  'kyc-proof-of-address', 'legacy-export-F', 'checkout-split-payment',
  'payments-card-on-file', 'growth-ab-homepage', 'support-sla-timer',
  'platform-event-bus', 'kyc-manual-review-queue', 'payments-settlement-v1',
  'kyc-old-vendor', 'checkout-legacy-flow', 'platform-sunset-api',
];

// i is 1-based flag index. Indices 27–30 are archived.
const TAGS = [
  'payments', 'kyc', 'payments', 'growth', 'support',
  'kyc', 'payments,checkout', 'checkout', 'platform', '',
  '', '', '', '', '',
  '', '', '', '', '',
  'checkout', 'payments,checkout', 'growth', '', 'platform',
  'kyc', 'payments', 'kyc', '', 'checkout',
];

const ROLLOUTS = [0, 10, 25, 50, 100];

const flagRow = (i: number) => {
  const archived = i >= 27 && i <= 30;
  const stale = i <= 8;
  const stagingEnabled = !archived && i % 3 === 0;
  const productionEnabled = !archived && i % 4 === 1;
  const stagingRollout = stagingEnabled ? ROLLOUTS[1 + Math.floor(rand() * 4)] : 0;
  const productionRollout = productionEnabled ? ROLLOUTS[1 + Math.floor(rand() * 4)] : 0;
  const ageDays = stale ? 95 + i * 23 : 1 + ((i * 7) % 55);
  return {
    id: flagId(i),
    key: KEYS[i - 1],
    description: `Fixture flag ${KEYS[i - 1]} (#${i})`,
    ownerTeam: ['payments', 'kyc', 'growth', 'platform', 'support'][i % 5],
    tags: TAGS[i - 1],
    stagingEnabled,
    stagingRollout,
    productionEnabled,
    productionRollout,
    version: 0,
    lastChangedAt: new Date(now - ageDays * day),
    lastChangedBy: i % 2 === 0 ? 'u-engdev' : 'u-engadmin',
    archivedAt: archived ? new Date(now - (10 + i) * day) : null,
    createdAt: new Date(now - (ageDays + 30 + i) * day),
  };
};

const CHANGES = ['created', 'toggled', 'rollout', 'archived'] as const;

// One history row generator: row j refers to flag (j % 30) + 1.
const changeRow = (j: number) => {
  const fi = (j % 30) + 1;
  const change = j % 7 === 0 ? 'created' : j % 9 === 0 ? 'archived' : CHANGES[1 + Math.floor(rand() * 3)];
  const environment =
    change === 'created' || change === 'archived'
      ? 'all'
      : j % 5 === 0
        ? 'production'
        : 'staging';
  const toggled = change === 'toggled';
  const on = j % 2 === 0;
  return {
    id: `00000000-0000-4000-b000-${String(100 + j).padStart(12, '0')}`,
    flagId: flagId(fi),
    flagKey: KEYS[fi - 1],
    environment,
    change,
    before:
      change === 'created' ? '—'
      : change === 'archived' ? 'active'
      : toggled ? (on ? 'off' : 'on')
      : `${10 + (j % 9) * 10}%`,
    after:
      change === 'created' ? 'off in staging and production'
      : change === 'archived' ? 'archived'
      : toggled ? (on ? 'on' : 'off')
      : `${(j % 9) * 10}%`,
    actorId: j % 2 === 0 ? 'u-engdev' : 'u-engadmin',
    approverId: environment === 'production' ? 'u-engadmin' : null,
    createdAt: new Date(now - (1 + ((j * 11) % 120)) * day),
  };
};

export const fixtures = {
  flags: Array.from({ length: 30 }, (_, i) => flagRow(i + 1)),
  flag_changes: Array.from({ length: 44 }, (_, j) => changeRow(j)),
};
