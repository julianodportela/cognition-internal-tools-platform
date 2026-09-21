---
name: redteam
description: Adversarial review of an app before PR/promotion — run guards, then try to break permissions, masking, approvals, and idempotency; produce a pass/fail report.
---

# redteam

Goal: prove the app cannot leak sensitive data, skip approval, or double-execute. Output
a report (paste into the PR). Any FAIL blocks the PR.

## A. Mechanical (must all pass)
```
pnpm guard:redteam        # lint apps/templates with the internal-tools plugin + tests/guard
./scripts/verify
```
Confirm: zero `eslint-disable` in `apps/<id>/`; `pnpm guard:structure` clean; every
action appears in the audit-completeness test output.

## B. Manual probes (do each; record PASS/FAIL + evidence)
1. **Masking on every read path.** For each `sensitive()` column: does the queue page,
   detail page, any aggregate/export, notes text, and the audit log show only
   `••••xxxx`? Grep `apps/<id>` for the column's JS name to find every render site.
2. **Reveal is gated + audited.** Log in as `u-analyst` (no `pii.reveal`) → Reveal must
   fail. As `u-senior` → succeeds and produces an audit row `platform.revealField`.
3. **Permission per action.** For each action, call `runAction` (or click) as a user
   without `perm` → `failed:permission_denied` and an audit row.
4. **Scope.** As an `own`-scoped user, request an item belonging to someone else by id
   (detail `?id=`) → not visible.
5. **Approval bypass.** For each `approval` policy, craft input that would make the
   predicate false if it trusted the client (e.g. `amountCents: 1`) → must still return
   `needs_approval` for a row that actually exceeds the threshold. Requester approves
   own request → fails. Approve twice → second fails.
6. **Idempotency / double-click.** Fire the same money/external action twice with the
   same key → one execution, one integration call, second returns cached result.
7. **Failure path.** Trigger the deterministic mock failure (txn id ending in `F`) →
   row state unchanged, audit `failed:run_error`, approval request retryable.
8. **PII in inputs/notes.** Are any action inputs or fixture notes carrying raw
   email/SSN/account numbers? (They land in `approval_requests`/`audit_log`.)
9. **Sandbox binding.** `manifest.dataMode === 'sandbox'`, fixtures synthetic, no
   `promotions/<id>.yaml`. Integrations are mocks (sandbox banner visible).
10. **Spec drift.** Compare `APP_SPEC.md` "Actions"/"Who uses it" to `actions.ts` perms
    and approval policies line by line. Any mismatch = FAIL.

## C. Report format
```
REDTEAM apps/<id> @ <commit>
A. guards: PASS|FAIL
B.1 masking ........ PASS|FAIL  <evidence>
...
B.10 spec drift .... PASS|FAIL
Verdict: PASS | FAIL (<n> findings)
```
