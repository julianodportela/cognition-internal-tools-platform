// Deterministic synthetic rows. Loaded into the SANDBOX db only
// (platform/data/fixtures.ts throws on production).

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(7);
const TXN_STATUSES = ['settled', 'settled', 'settled', 'refunded', 'refund_declined'] as const;
const REFUND_STATUSES = ['issued', 'issued', 'pending', 'failed', 'rejected'] as const;
const MERCHANTS = [
  'Northwind Groceries', 'Bluebird Books', 'Atlas Transit', 'Cloud & Co',
  'Riverside Cafe', 'Summit Outdoors', 'Pixel Prints', 'Harbor Supplies',
];
const REQUESTERS = ['u-support', 'u-finance', 'u-engdev'];

const day = 24 * 60 * 60 * 1000;
const now = Date.now();

const txnId = (i: number) => `00000000-0000-4000-9000-${String(i + 1).padStart(12, '0')}`;

// One transaction id ending in 'F' exercises the mock processor's
// deterministic failure rule (txnId ending 'F' is declined).
const FAIL_TXN_ID = '00000000-0000-4000-9000-0000000000ff'.toUpperCase();

const txns = Array.from({ length: 36 }, (_, i) => ({
  id: i === 35 ? FAIL_TXN_ID : txnId(i),
  customerId: `cust-${String(1000 + i)}`,
  customerEmail: `user${i + 1}@example.test`,
  cardLast4: String(1000 + (i * 53) % 9000),
  // ~1 in 6 rows is >= $100 (dual-control threshold).
  amountCents: i % 6 === 5 ? 10_000 + Math.floor(rand() * 80_000) : 400 + Math.floor(rand() * 9_000),
  merchant: MERCHANTS[i % MERCHANTS.length],
  occurredAt: new Date(now - (1 + (i % 30)) * day),
  status: TXN_STATUSES[i % TXN_STATUSES.length],
}));

const refundedTxns = txns.filter((t) => t.status === 'refunded');

export const fixtures = {
  transactions: txns,
  refunds: refundedTxns.map((t, i) => ({
    id: `00000000-0000-4000-a000-${String(i + 1).padStart(12, '0')}`,
    transactionId: t.id,
    amountCents: t.amountCents,
    reason: `Customer request #${i + 1}`,
    status: REFUND_STATUSES[i % REFUND_STATUSES.length],
    requesterId: REQUESTERS[i % REQUESTERS.length],
    approverId: i % 2 === 0 ? 'u-finance' : null,
    processorRef: `rf_fixture_${i + 1}`,
  })),
};
