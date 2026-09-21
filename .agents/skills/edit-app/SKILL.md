---
name: edit-app
description: Change an existing app in apps/<id>/ from a plain-language request; spec diff first, then code, then verify + redteam.
---

# edit-app

Read `AGENTS.md` first.

1. Open `apps/<id>/APP_SPEC.md`. Restate the requested change as an edit to the spec
   (show the before/after lines). Confirm with the requester before coding.
2. Classify the change:
   - **Screen-only** (columns, labels, filters, ordering): edit `pages/`.
   - **New field**: `schema.ts` (+ `sensitive()` if applicable) → `pnpm db:generate` →
     fixtures → pages.
   - **New/changed action or rule** ("also allow…", "over $N…", "needs sign-off"):
     `actions.ts`. Re-check risk/approval — loosening an approval or marking something
     `risk: 'low'` is a red flag; keep it high unless the spec explicitly says so and
     say so in the PR.
   - **New role/permission, real data, new external system**: not an app edit. Stop and
     route to engineering (`promote` skill for real data).
3. Never change `dataMode`, `promotions/`, `platform/`, `app/`, or `.github/`.
4. Update `fixtures.ts` so every new status/field is represented.
5. `./scripts/verify` → `pnpm test:e2e` → `redteam` skill.
6. PR titled `app(<id>): <change>`, body = spec diff + redteam output.
