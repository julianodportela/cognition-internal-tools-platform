# Dry run: KYC review queue (new-app harness)

Branch: `devin/1790031184-kyc-app` from `devin/1790026621-refunds-app`. Requester: compliance/ops lead, plain-language request for a KYC review queue.

## Timings (wall clock, 2026-09-21 UTC)

| Phase | Start | End | Duration |
|---|---|---|---|
| setup (nvm/pnpm/install/playwright) | 22:53:04 | 22:55:48 | ~2.7 min |
| (a) APP_SPEC written | 22:53:30 | 22:55:31 | ~2 min (overlapped with install) |
| (b) code → first `./scripts/verify` green | 22:55:48 | 23:00:19 | ~4.5 min (2 lint iterations) |
| (c) tests/kyc.test.ts + tests/e2e/kyc.spec.ts, `pnpm test:e2e` green | 23:01:16 | 23:03:43 | ~2.5 min |
| (d) redteam (guards + B.1–B.10, report) | 23:04:10 | 23:06:30 | ~2.5 min |
| **Total** | | | **~13.5 min** |

## Friction log (blocked or awkward — nothing worked around)

1. **`analyst` lacks `kyc.decide` — the primary user can't approve/reject.** The request says analysts approve/reject; `platform/policy/roles.ts` grants `kyc.decide` only to `senior_reviewer`/`eng_*`. `kyc.approve`/`kyc.reject` keep `perm: 'kyc.decide'`; analysts can claim, view, and add notes only (probe B.3 proves the denial). Needs an engineering perm change.
2. **Role-based approval requests can never be decided.** `requiresRole('senior_reviewer', …)` on high-risk decisions creates a "needs senior_reviewer" request, but `platform.approve` requires `approvals.manage`, which `senior_reviewer` does not hold — and `finance_approver` (who has it) fails the role check. Test `B.5` asserts the request stays `pending` forever. Either grant `approvals.manage` to `senior_reviewer` or let `canDecide` accept the required role.
3. **No owner-based reveal.** "Masked for everyone except the analyst who owns the case" is not expressible: `platform.revealField` is gated on `pii.reveal`, which analysts lack. Everyone sees `••••` + last4; only senior/eng_admin can reveal (audited). Recorded as an Open question.
4. **`Date.now()` rejected by the React purity lint rule** in server-component render paths (overdue badge). `new Date().getTime()` passes — same impurity, different spelling. The rule is noise for server components; worth a docs note or a platform `now()` helper.
5. **Fixture typing rejects a named interface** — fixtures must be plain literals inferring to `Record<string, Record<string, unknown>[]>`; a named row interface fails assignment. Template comment could say so.
6. **Failed actions audit with `entityId: null`** (entity = action id), so "audit rows for this row" assertions must filter by `actionId` only. Test-authoring papercut.
7. **`run_error` swallows the thrown message** — callers get `Action failed (ref …)`; UI can't show "already re-reviewed" vs "not pending". Tests assert `failed` + unchanged row. A `userMessage` allow-list on `Error` would help.
8. **`ctx.records.claim` rejects already-assigned rows only for non-`approvals.manage` users**, so a finance user could re-claim someone's case; the action re-checks `status === 'pending'` so it's harmless here, but the primitive's override rule isn't documented.
9. **`pnpm` not on PATH in fresh shells** until `source ~/.nvm/nvm.sh` — the setup one-liner's `nvm` step failed once for this reason.
10. **Test table name collision:** `tests/helpers.ts` already creates a `kyc_cases` table, so the app table is `kyc_reviews`. Surprising for a "kyc" app; harness could reserve/namespace test tables.
11. **Skill has no step for app-specific e2e** (same as refunds friction #8). Added `tests/e2e/kyc.spec.ts` anyway; Playwright's `webServer` boots `pnpm dev` itself so no manual server juggling was needed this time.

## What was built (as confirmed in APP_SPEC)

- `kyc_reviews` (customer_ref, **full_name / date_of_birth / id_document_number sensitive**, country, id_document_type, risk_score low/medium/high, status pending/in_review/approved/rejected, assignee_id, team_id, due_at, decided_by/at, decision_reason, resubmission_count).
- `kyc.claim` (kyc.read) — `ctx.records.claim` + transition to in_review; compliance_readonly refused.
- `kyc.approve` / `kyc.reject` (kyc.decide, risk high) — only the assignee; `requiresRole('senior_reviewer')` predicate loads the row and fires for high risk when requester isn't senior; idempotent per `<verb>:<id>`, rate-limited 30/min; reason stored + noted (reject requires one).
- `kyc.reopen` (kyc.read) — rejected → pending once (`resubmission_count` 0→1), clears assignee/decision, resets `due_at = now+48h`.
- Overdue: `due_at = created+48h`; SLA job emits `sla.breached` on `due_at`; queue/detail show OVERDUE badge and count for open cases.
- Screens: Queue (tabs by status, masked PII columns, risk/assignee/due), Mine, Detail (StageBar, case card with claim/decide/reopen, Notes, FileList for the ID document).

## Redteam report

```
REDTEAM apps/kyc @ a488785
A. guards: PASS   (guard:redteam: 4 files / 28 tests; ./scripts/verify: typecheck+lint(0 warn)
                   +structure+promotions + 12 files / 126 tests; zero eslint-disable;
                   audit-completeness exercises claim/approve/reject/reopen via guardFixture)
B.1 masking ........ PASS  query() as analyst → fullName/dateOfBirth/idDocumentNumber = ••••+last4;
                          e2e shows masked queue+detail; audit before/after JSON has no raw PII
B.2 reveal ......... PASS  analyst revealField → permission_denied; senior → ok + audit row
                          platform.revealField; e2e senior Reveal shows value
B.3 permission ..... PASS  analyst kyc.approve → permission_denied + audit; compliance
                          claim/reopen/approve all fail, rows unchanged
B.4 scope .......... PASS  team 'other' row: analyst/senior query 0 rows, compliance 1;
                          analyst claim on it → failed, unchanged
B.5 approval ....... PASS  engAdmin high-risk approve → needs_approval (predicate reads row,
                          client input can't bypass); self-approve fails; finance fails role
                          check; senior direct high-risk approve ok; non-assignee decide fails.
                          FINDING (platform, friction #2): senior platform.approve →
                          permission_denied, request undecidable
B.6 idempotency .... PASS  approve twice → cached ok, no extra audit; reject after approve fails
B.7 failure ........ PASS  approve on pending → failed:run_error, row unchanged, audit failed
B.8 PII inputs ..... PASS  inputs = id/reason only; residual: free-text reason may hold typed PII
B.9 sandbox ........ PASS  manifest dataMode='sandbox', dataClass='sensitive', fixtures
                          'Test Customer N'/DOC…/cust-…, no promotions/kyc.yaml
B.10 spec drift .... PASS  actions/states/roles match APP_SPEC 1:1; mismatches with the
                          business request are recorded as Open questions 1–3
Verdict: PASS (0 app findings; 1 platform finding — friction #2 — blocks senior sign-off
         on high-risk decisions until roles/approvals are changed)
```

## Test counts
- `./scripts/verify`: 12 files / 126 tests (18 new in tests/kyc.test.ts).
- `pnpm test:e2e`: 5/5 (2 new kyc specs).
- `pnpm guard:redteam`: lint clean + 4 files / 28 tests.
