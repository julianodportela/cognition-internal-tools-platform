# Refunds Dashboard

> Written in plain language for the person who asked for the app. They confirm this
> document, not the code. Keep every line something a non-engineer can verify.

## Purpose
Support agents look up a customer's recent card transactions and request a refund
with a reason. Small refunds go through immediately; larger ones need a finance
sign-off. Finance and compliance can audit every refund ever issued.

## Who uses it
- **support_agent** — can: view all card transactions (emails/card numbers masked),
  request a refund.
- **finance_approver** — can: view everything, request refunds, and approve or
  reject refund requests of $100 or more from the Inbox.
- **compliance_readonly** — can: view all transactions and all refunds (read only).
- Who can see other people's items? Everyone sees all transactions and refunds —
  these are customer records, not personal work items. Who *did* each refund is
  always visible on the refund row.

## Data
One line per thing we store. Mark anything personal or financial as **sensitive** —
it is hidden by default and can only be revealed by people with that permission,
and every reveal is recorded.
- **transaction**: customer_id, **customer_email (sensitive)**, **card_last4
  (sensitive)**, amount_cents, merchant, occurred_at, status.
- **refund**: transaction_id, amount_cents, reason, status
  (pending/issued/failed), requester_id, approver_id, processor_ref, created_at.

## Screens
- **Queue** (`/a/refunds`): all card transactions, newest first, with masked
  customer email and card. Tabs filter by transaction status.
- **Refunds** (`/a/refunds/refunds`): every refund ever issued — amount, reason,
  status, who requested it, when. This is the audit view finance/compliance use.
- **Detail** (`/a/refunds/detail?id=`): one transaction, its refund history, the
  request-refund form, and notes.

## Actions
One line per button. Say who may press it and when it needs someone else's sign-off.
- **Request refund** — refunds the transaction for its full amount with a reason.
  Who: refunds.issue holders (finance/engineering today). Needs approval when:
  the transaction is $100 or more (a different person with approval rights must
  sign off; the requester can never approve their own). Always: idempotent per
  transaction — the same transaction can never be refunded twice; rate-limited;
  calls the payments processor.
- Rejecting a $100+ refund request is done by finance in the Inbox — an issued
  refund can never be un-issued, so there is no separate "reject" action.

## Stages
- transaction: settled → refunded, or settled → refund_declined (terminal).
- refund: requested → (approval when ≥ $100) → issued | failed.

## Data mode
**Sandbox.** All data is made up. Nothing here touches real customers.
Switching to real data is a separate engineering approval step.

## Out of scope
Partial refunds (refund is always for the transaction's full amount), editing or
deleting transactions, issuing refunds by customer rather than by transaction,
retrying a declined refund (refund_declined is terminal for the transaction),
and exports/reports.

## Open questions
- ~~The requester said "support agents request refunds", but the `refunds.issue`
  permission is not granted to the `support_agent` role~~ — **resolved:** engineering
  granted `refunds.issue` to `support_agent` in `platform/policy/roles.ts`.
</content>
