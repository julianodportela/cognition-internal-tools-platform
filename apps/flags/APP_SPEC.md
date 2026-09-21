# Feature Flags

> Written in plain language for the person who asked for the app. They confirm this
> document, not the code.

## Purpose
Engineers need one place to create feature flags, turn them on or off per environment
(staging and production), optionally roll them out to a percentage of users, and see
the full history of who changed what and when. Production changes need a second pair
of eyes; flags for payments or KYC need an engineering admin.

## Who uses it
- **eng_dev** (`flags.read`, `flags.toggle`) — can: view flags, create flags, toggle /
  change rollout in **staging** immediately, *request* a toggle / rollout change in
  **production** (someone else must approve), archive flags, approve another
  engineer's production request (for flags not tagged payments/kyc).
- **eng_admin** (`flags.read`, `flags.toggle`, `flags.prod.toggle`, `approvals.manage`) —
  everything above, plus approving production changes on flags tagged `payments` or
  `kyc`.
- **analyst / support_agent** (`flags.read`) — view only.
- **compliance_readonly / finance_approver / senior_reviewer** — no access to this app.
- Who can see other people's items? **Everyone with access sees every flag** (flags
  are shared engineering configuration, not personal data).

## Data
Nothing in this app is personal or financial. No field is sensitive.
- **flag**: key (unique), description, owner team, tags (comma-separated, e.g.
  `payments`, `kyc`), staging on/off, staging rollout %, production on/off,
  production rollout %, last changed at, last changed by, archived at, version.
- **flag change** (history, one row per change): flag, environment, what changed
  (created / toggled / rollout / archived, before → after), who did it, who approved
  it (when approval was needed), when.

## Screens
- **Flags** (`/a/flags`): every flag with key, owner team, tags, staging and production
  state (on/off + rollout %), last changed by/at. Tabs: `all`, `active`, `stale`,
  `archived`. "New flag" form.
- **Stale** (`/a/flags/stale`): active flags nobody has changed in **90 days**, oldest
  first — the clean-up list.
- **History** (`/a/flags/history`): every change across all flags, newest first.
- **Detail** (`/a/flags/detail?id=`): the flag, its current staging/production state,
  controls to change staging (immediate) and production (request approval), archive
  button, the flag's own change history, and notes.

## Actions
One line per button. Who may press it and when it needs someone else's sign-off.
- **Create flag** — creates a flag, off in both environments. Who: eng_dev, eng_admin
  (`flags.toggle`). Needs approval: **never**.
- **Set staging** — turn a flag on/off in staging and/or set its staging rollout
  (0–100). Sent to the flag service (mock). Who: eng_dev, eng_admin (`flags.toggle`).
  Needs approval: **never** (staging is safe to change; every change is recorded).
- **Set production** — turn a flag on/off in production and/or set its production
  rollout (0–100). Sent to the flag service (mock). Who: eng_dev, eng_admin
  (`flags.toggle`). Needs approval: **always — a second engineer** (anyone else holding
  `flags.toggle`; the requester can never approve their own request). This button is
  **refused** for flags tagged `payments` or `kyc` (see next line).
- **Set production (restricted)** — the same change, only for flags tagged `payments`
  or `kyc`. Who: eng_dev, eng_admin (`flags.toggle`). Needs approval: **always — an
  engineering admin** (`eng_admin` role). Approving happens in the platform Inbox.
- **Archive flag** — hides the flag from the active list; it is **never deleted** and
  its history stays. Only allowed once the flag is **off in both environments** (so
  archiving can't silently change behaviour). Who: eng_dev, eng_admin (`flags.toggle`).
  Needs approval: **never**.
- There is **no delete** and **no un-archive** button.

Every action writes a platform audit row and a **flag change** history row. Every
change carries the flag's version the screen was showing; if someone else changed the
flag in the meantime the change is refused and you reload ("no silent overwrites").
A stale flag is one whose last change is more than 90 days ago (archived flags are
not listed as stale).

## Stages
Flags do not move through stages. Per environment they are simply on or off with a
rollout percentage.

## Data mode
**Sandbox.** All flags are made up. The flag service is a mock: it accepts every
change except keys ending in `F`, which it rejects (used to test the failure path —
the flag then stays exactly as it was).
Switching to real data / the real flag service is a separate engineering approval step.

## Out of scope
Evaluating flags for end users (the SDK), per-user targeting rules, environments other
than staging and production, un-archiving, editing a flag's key/tags after creation,
Slack/email notifications.

## Open questions
1. **`flags.prod.toggle` is not used.** That permission is held only by `eng_admin`. If
   production *requests* required it, ordinary engineers could not request a production
   change at all, which contradicts "needs a second engineer to approve". So production
   requests use `flags.toggle` + a mandatory second approver, and the "admin only for
   payments/kyc" rule is enforced through the approver's role instead. If you would
   rather only admins can even *request* production changes, say so and we switch the
   production actions to `flags.prod.toggle`.
2. **Two production buttons.** The platform allows one approval rule per action, so the
   "second engineer" rule and the "admin" rule are two actions. The screen shows only
   the right one for each flag, and the server refuses the wrong one.
3. **"Any engineer"** is read as the `eng_dev` and `eng_admin` roles (the ones holding
   `flags.toggle`). Analysts and support can look but not change.
4. Rollout is stored per environment as a whole number 0–100; "on with rollout 0" is
   allowed (a kill-switch style flag) — confirm this is what you want.
5. The "New flag" form and the change controls are shown to read-only users too (the
   platform refuses the click with "permission denied"); the platform has no app-side
   "can this user do X" helper yet to hide them.
