# Expense Requests

## Purpose
Employees file expense requests; a reviewer approves them; finance pays them out.
This is the canonical template every generated app is copied from — it exercises
every platform primitive (masked PII, workflow, approvals, notes, attachments,
assignment, soft delete, SLA due dates, idempotency, rate limits).

## Who uses it
- **analyst / support_agent** (`template.read`, `template.write`): create drafts,
  submit, claim, archive.
- **senior_reviewer** (`template.write`): same, plus claiming within team scope.
- **finance_approver / eng_admin** (`template.approve`): approve, reject, pay out.

## Data
`expense_requests`: title, amount_cents, status, requester_id, assignee_id,
due_at, receipt_note, team_id, created_at, updated_at, deleted_at.
Sensitive (masked, reveal via audited `platform.revealField`):
`employee_email`, `employee_bank_last4`.
Soft-deleted rows (`deleted_at`) never appear in queries by default.

## Screens
- **Queue** (`/a/template`): status filter tabs, keyset pagination, masked email
  column with Reveal button, "New expense request" form.
- **Mine** (`/a/template/mine`): same queue filtered to assignee = me.
- **Detail** (`/a/template/detail?id=`): stage bar, request card with action
  buttons, notes, receipt attachments.

## Actions
- `template.create` — file a draft (any writer).
- `template.submit` — draft -> submitted.
- `template.claim` — take the request (fails if already assigned).
- `template.approve` — submitted -> approved; **needs dual-control approval when
  amount > $500**; idempotent on `approve:<id>`; rate-limited 20/min.
- `template.reject` — submitted -> rejected; **always needs dual control**.
- `template.pay` — approved -> paid via payments processor; **always needs dual
  control**; idempotent on `pay:<id>`; tagged money+external.
- `template.archive` — soft delete.
Notes/attachments use built-in `platform.addNote` / `platform.uploadAttachment`.

## Data mode
Sandbox — all data is synthetic fixtures (`fixtures.ts`).

## Out of scope
Real payment rails, employee directory lookup, per-row ACLs beyond team scope,
email notifications (events are emitted; a notifier can subscribe later).
