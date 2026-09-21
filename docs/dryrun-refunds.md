# Dry run: refunds app (harness rehearsal)

Branch: `devin/1790026621-refunds-app` (not pushed). Requester: client's support lead, plain-language request for a refunds dashboard.

## Timings (wall clock, 2026-09-21 UTC)

| Phase | Start | End | Duration |
|---|---|---|---|
| (a) APP_SPEC written | 21:37:01 | 21:38:20 | ~1.3 min |
| (b) code → first `./scripts/verify` green | 21:38:20 | 21:39:19 | ~1 min (green on first try) |
| (c) `pnpm test:e2e` green | 21:39:19 | 21:39:56 | <1 min |
| (d) redteam (A + B probes, tests, screenshots) | 21:39:56 | 21:42:30 | ~2.5 min |
| **Total** | | | **~5.5 min** |

## Friction log (docs/platform gaps hit during the run)

1. **`support_agent` lacks `refunds.issue` — the primary user can't press the button.** The requester asked for "support agents request a refund", but `platform/policy/roles.ts` only grants `refunds.issue` to `finance_approver` and `eng_*`. Per AGENTS.md §10 I cannot invent permissions, so `refunds.request` keeps `perm: 'refunds.issue'` and support gets `permission_denied` (probe B.3 proves the guard works). Recorded under APP_SPEC "Open questions". **Proposed fix:** engineering adds `refunds.issue` to `support_agent` — a reviewed platform change. This is the correct fail-safe but will confuse a requester: "my app is done but the main user can't use it."
2. **No `approvedBy` on `ActionCtx`.** `refunds.approver_id` exists in the schema but there is no way to stamp the deciding approver from inside `run()` — approval lives only in `approval_requests.approver_id`. **Proposed fix:** expose `ctx.approvedBy` (or `ctx.approval`) when an action executes via a decided approval request. Currently column stays null; note shown in audit trail only.
3. **`pkill -f` kills the caller's own shell.** `pkill -f "next dev"` (and `"pnpm dev"`) matched the exec's own command line containing the same string → exit -1, server left dead. Workaround used: `fuser -k 3000/tcp`. Worth a line in env-setup-notes/docs.
4. **`own`-scope fallback is subtle.** `scopePredicate` for an `own`-scoped role falls back owner_id → team_id → *no restriction*. `transactions`/`refunds` have neither column, so support sees all rows (intended — customer records). Docs don't spell out that "no owner column = no restriction", which could surprise either direction. Probe B.4 is effectively N/A for this schema; docs could state the fallback rule.
5. **No lookup/search primitive.** "Look up a customer's recent transactions" is served by a filterable DataTable (status tabs + sort + paging) — there's no text-search option (e.g. `?customer=`). A `where` on `customerId` would work but there's no search input component; acceptable for the dry run, likely requested soon.
6. **Email masking shows `••••test`** (last4 of `user@example.test`). Correct but looks odd to a business user — the "last 4" of an email is a domain fragment. No fix needed for safety; cosmetic note.
7. **Free-text `reason` inputs can contain anything** — an agent could type PII into `reason`, which lands in `approval_requests.input_json` unmasked (input field names can't be PII-named but values aren't scanned). Probe B.8 notes this as a residual risk, not a guard gap I could close from apps/.
8. **Skill doesn't ask for app-specific e2e.** `pnpm test:e2e` is green but only exercises the template. A refunds e2e would live in `tests/e2e/` which is fine to add, but the skill doesn't say so — `tests/refunds.test.ts` covers it via vitest probes instead.
9. **Two `pg-core` column-name wrinkle:** `refunds.transactionId` uses `uuid()` so input must be a uuid — harmless, but the template's `id: z.string().min(1)` pattern doesn't reveal that `z.string().uuid()` was needed until you read drizzle column types. Minor.

## What was built (as confirmed in APP_SPEC)

- `transactions` (customer_id, **customer_email sensitive**, **card_last4 sensitive**, amount_cents, merchant, occurred_at, status) — read-only to the app.
- `refunds` (transaction_id, amount_cents, reason, status pending/approved/issued/failed/rejected, requester_id, approver_id, processor_ref, created_at).
- `refunds.request` — perm `refunds.issue`, risk high, `dualControl` predicate loads the transaction row and requires sign-off at ≥ 10_000 cents (fail-closed on missing row); `idempotency: refund:<transactionId>`; `rateLimit 20/min`; `tags: money, external`; calls `ctx.integrations.payments.refund`, inserts the `refunds` row and marks the txn `refunded`. Double-refund is blocked by the global idempotency key AND an in-run check for active refunds.
- `refunds.reject` — perm `refunds.approve`, `dualControl()` always.
- Screens: Queue (transactions, masked email/card, status tabs), Refunds (audit view: every refund + requester/approver), Detail (transaction + refund history + request form + notes).

## Redteam report

```
REDTEAM apps/refunds @ d4b138a
A. guards: PASS   (guard:redteam: eslint apps/templates 0 problems; tests/guard 9/9;
                   ./scripts/verify: typecheck+lint+structure+promotions+55 tests green;
                   zero eslint-disable in apps/refunds; refunds.request/reject exercised
                   by audit-completeness via guardFixture)
B.1 masking ........ PASS  query() masks customerEmail+cardLast4 to ••••test/••••xxxx;
                          UI screenshots show masked cells for u-support; audit rows masked
                          (tests/refunds.test.ts 'B.1 masking')
B.2 reveal ......... PASS  u-analyst revealField → failed; u-senior → ok +
                          audit row platform.revealField (test 'B.2 reveal gated')
B.3 permission ..... PASS  u-support refunds.request → permission_denied + audit;
                          u-analyst refunds.reject → permission_denied (2 tests)
B.4 scope .......... PASS  N/A by design: customer tables have no owner_id/team_id →
                          all roles see all rows (intended); documented in friction #4
B.5 approval ....... PASS  ≥$100 request → needs_approval; input {amountCents:1} cannot
                          bypass; requester self-approve fails; double-approve fails (3 tests)
B.6 idempotency .... PASS  same request twice → 1 refund row (cached result);
                          different requester → also deduped by global key (2 tests)
B.7 failure ........ PASS  txnId ending 'F' → failed:run_error, txn stays settled,
                          no refund row, audit row written (1 test)
B.8 PII inputs ..... PASS  input fields = transactionId/reason/id — no sensitive-named
                          fields (audit-completeness asserts globally); residual: free-text
                          reason could hold typed PII (friction #7)
B.9 sandbox ........ PASS  manifest.dataMode='sandbox', dataClass='sensitive',
                          fixtures synthetic (userN@example.test), no promotions/refunds.yaml,
                          integrations resolve to mocks, SANDBOX banner visible in UI
B.10 spec drift .... PASS  actions.ts matches APP_SPEC actions/roles 1:1; the one
                          deliberate mismatch (support lacks refunds.issue) is recorded
                          as an Open question in the spec itself
Verdict: PASS (0 blocking findings; friction #1 needs an engineering perm change
         before the app is usable by its primary role)
```

## Test counts
- `./scripts/verify`: 55 tests (44 prior + 11 new in tests/refunds.test.ts), 9 files.
- `pnpm test:e2e`: 3/3.
- `pnpm guard:redteam`: lint clean + tests/guard 9/9.

## Evidence
- Screenshots: `/home/ubuntu/dryrun-queue.png` (u-support, masked queue), `/home/ubuntu/dryrun-detail.png` (masked detail + request form), `/home/ubuntu/dryrun-inbox.png` (u-finance, pending ≥$100 request awaiting decision).
- Dev server: `pnpm dev` on port 3000, log `/tmp/dev6.log`.

## Git log (branch devin/1790026621-refunds-app, unpushed)
```
d4b138a tests(refunds): redteam probes B.3-B.8 + happy paths
705b4dc app(refunds): Refunds Dashboard — transactions/refunds schema, request (dualControl >=$100, idempotent, payments) + reject, queue/refunds/detail pages, fixtures, APP_SPEC
```
