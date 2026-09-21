# KYC Review Queue

> Written in plain language for the person who asked for the app. They confirm this
> document, not the code. Keep every line something a non-engineer can verify.

## Purpose
Customers who sign up get a KYC case. Analysts pick cases from a queue, look at the
customer's details and uploaded ID document, add notes, and approve or reject the
customer with a reason. High-risk customers need a senior reviewer. Compliance can
watch everything but change nothing.

## Who uses it
- **analyst** — can: view the team's queue, claim a case (one analyst per case),
  approve/reject low- and medium-risk cases they have claimed, add notes, upload
  a resubmitted document, reopen a rejected case once for re-review. High-risk
  cases they decide are sent to a senior reviewer in the Inbox for sign-off.
- **senior_reviewer** — can: everything an analyst can, plus decide any case
  directly including high-risk ones, sign off analysts' high-risk requests in
  the Inbox, and reveal masked personal fields.
- **compliance_readonly** — can: view every case, note and document. Cannot claim,
  note, reveal, decide or reopen anything.
- Who can see other people's items? Everyone on the KYC team sees the whole team
  queue (so they can pick from it). Compliance sees everything.

## Data
One line per thing we store. Mark anything personal or financial as **sensitive** —
it is hidden by default and can only be revealed by people with that permission,
and every reveal is recorded.
- **KYC case**: customer reference, **full name (sensitive)**, **date of birth
  (sensitive)**, country, ID document type (passport / national id / driving
  licence), **ID document number (sensitive)**, the uploaded document file
  (attachment), risk score from the vendor (low / medium / high), status, who has
  claimed it, due date (48 hours after the case was opened), who decided it and
  when, the decision reason, how many times the customer has resubmitted, and the
  team that owns it.
- **Notes** on a case (built-in): author, text, time.
- **Documents** on a case (built-in attachments): pdf/png/jpg up to 5 MB.

## Screens
- **Queue** (`/a/kyc`): every case for the team, newest first, with masked name /
  date of birth / document number. Tabs: all / pending / in review / approved /
  rejected. Cases past their 48-hour due date show an **OVERDUE** flag.
- **Mine** (`/a/kyc/mine`): only the cases I have claimed.
- **Case** (`/a/kyc/detail?id=`): the case's details (masked), risk badge, overdue
  flag, stage bar, the uploaded document(s), notes, and the buttons below.

## Actions
One line per button. Say who may press it and when it needs someone else's sign-off.
- **Claim** — takes a pending case into "in review" and assigns it to me. Fails if
  someone else already holds it. Who: analyst, senior_reviewer (any KYC-team member
  who is not read-only). Needs approval when: never.
- **Approve** — marks the case approved with an optional reason; only the person
  who claimed the case can press it. Who: analyst, senior_reviewer. Needs
  approval when: the case is **high risk** and the presser is not a senior
  reviewer — a senior reviewer signs off in the Inbox. Low/medium-risk cases
  are decided immediately.
- **Reject** — marks the case rejected with a required reason; only the person who
  claimed the case can press it. Who and sign-off: same rule as Approve.
- **Reopen for re-review** — a rejected customer who has resubmitted a document goes
  back to "pending" (unclaimed) so it can be picked up again. Allowed **once** per
  case. Who: analyst, senior_reviewer. Needs approval when: never.
- **Add note / Upload document** — built-in; anyone who can use the app and is not
  read-only.
- **Reveal name / date of birth / document number** — built-in, audited reveal.
  Who: `pii.reveal` holders (senior_reviewer, engineering). See Open question #3.

## Stages
pending → in_review (Claim) → approved | rejected (Approve/Reject by the claimer;
senior sign-off if high risk) ; rejected → pending (Reopen, once).

## Overdue rule
Every case gets a due date 48 hours after it is opened. Cases still open past that
date are flagged OVERDUE on screen, and the platform's SLA job raises an
`sla.breached` event for each one.

## Masking
Full name, date of birth and document number are masked (`••••1234`) on every
screen and in every audit row. The only way to see the real value is the Reveal
button, and every reveal is recorded in the audit log with who / what / when.

## Data mode
**Sandbox.** All data is made up. Nothing here touches real customers.
Switching to real data is a separate engineering approval step.

## Out of scope
Creating cases from the app (they arrive from sign-up), calling the KYC vendor for
the risk score (it is stored on the case), deleting cases, re-assigning a case to
someone else, more than one re-review, emailing customers.

## Open questions
1. **[resolved]** Analysts can now approve/reject — `kyc.decide` was granted to
   `analyst` on the base branch (commit 1101cf7).
2. **[resolved]** Senior sign-off now works — `senior_reviewer` was granted
   `approvals.manage` on the base branch (commit 1101cf7), so Inbox requests
   reach the required role.
3. **[resolved by fallback]** "Masked for everyone except the analyst who owns
   the case" is not supported by the platform: there is no ownership-scoped
   unmask. The app falls back to the existing explicit, logged reveal path —
   `platform.revealField` gated on `pii.reveal`, every reveal audited. Everyone
   sees masks; `pii.reveal` holders (senior_reviewer, engineering) can reveal.
4. **Who records a resubmission?** I assumed the analyst uploads the new document
   and presses "Reopen for re-review" on the customer's behalf.
5. **Approve/reject after the 48 h flag** is still allowed — the flag is a warning,
   not a block. Confirm.
