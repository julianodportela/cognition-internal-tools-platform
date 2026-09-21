---
name: promote
description: Engineering-only. Move an app from sandbox (synthetic data, mock integrations) to production data by adding promotions/<id>.yaml; requires human approvals and a passing redteam.
---

# promote

**Who may run this: an engineer, on request.** If a business user asks you to "use real
data", tell them this needs engineering approval and stop. Never run this skill on
their behalf.

Preconditions (all must be true — `pnpm guard:promotions` checks the yaml):
1. Latest `redteam` report on the current commit is PASS.
2. `APP_SPEC.md` is current and confirmed by the business owner.
3. `manifest.sources` lists exactly the tables the app reads/writes.
4. Production credentials (`DATABASE_URL`, real integrations) are configured out of band
   by engineering; app code never sees them.

Steps:
1. Create `promotions/<appId>.yaml`:
   ```yaml
   app: <appId>
   commit: <full sha of the redteamed commit>
   sources: [<same list as manifest.sources>]
   redteam_passed: true
   approved_at: <ISO timestamp>
   approved_by:
     - { user: <github handle>, role: engineering }
     - { user: <github handle>, role: security }     # required if dataClass: 'sensitive'
   notes: <what data, why, retention/masking notes>
   ```
2. Change **only** `dataMode: 'sandbox'` → `'production'` in `apps/<id>/manifest.ts`.
   Remove `fixtures` from the manifest (fixtures may not load into production).
3. `./scripts/verify` — `guard:promotions` must pass.
4. Open a PR titled `promote(<id>): production data` containing only those two files.
   CODEOWNERS routes it to engineering; a second approver (security/compliance for
   sensitive apps) must approve in GitHub before merge.
5. After merge, verify in production: sandbox banner gone, masking still applied,
   reveal audited, first real action appears in `/audit`.

Rollback: revert the promotion PR. The app returns to sandbox; production rows are
untouched.
