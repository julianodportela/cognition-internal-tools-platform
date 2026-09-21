---
name: new-app
description: Create a new internal app under apps/<id>/ from a plain-language request, on sandbox data, by copying templates/app.
---

# new-app

Read `AGENTS.md` first. Never skip step 1.

1. **Spec first.** Create `apps/<id>/APP_SPEC.md` from `templates/APP_SPEC_TEMPLATE.md`
   using the requester's own words. Map each sentence with the §3 vocabulary table in
   AGENTS.md. Put anything you had to guess under "Open questions". Show the spec to the
   requester and wait for an explicit "yes". If they change it, update the spec and
   re-confirm. **No code before confirmation.**
2. **Pick permissions.** Every role in the spec must map to existing `Permission` values
   (`platform/policy/roles.ts`). If none fit, stop: write the needed permission under
   "Open questions" and tell the requester engineering must add it.
3. **Copy the template.** `cp -r templates/app apps/<id>`. Rename: app id, table names,
   action id prefix (`<id>.`), permission prefix, display names. Delete template-only
   features the spec doesn't mention; do not add primitives the spec doesn't need.
4. **schema.ts** — one table per "Data" item. Wrap every sensitive field in `sensitive()`.
   Include `deleted_at` if anything is deletable, `assignee_id` if items are claimed,
   `due_at` if there is a deadline, `team_id` if visibility is per-team.
5. **actions.ts** — one `defineAction` per "Actions" line. `risk: 'low'` only for
   reversible/harmless writes; everything else keeps the default high risk and gets an
   `approval` policy matching the spec ("needs approval when …"). Predicates read the
   row via `ctx.records.get`, never client input. Money/external ⇒
   `tags`, `idempotency`, `rateLimit`. Add a `guardFixture` for every action whose input
   needs an existing row.
6. **pages/** — copy `index.tsx`/`detail.tsx`, adjust columns/tabs/buttons to the spec.
   Only `@platform/ui` components.
7. **fixtures.ts** — 20–50 deterministic synthetic rows covering every status; fake
   emails `userN@example.test`; never real-looking names or numbers.
8. **manifest.ts** — `dataMode: 'sandbox'`, `dataClass: 'sensitive'` if any field is
   sensitive, `sources` = table names. Register in `apps/index.ts`.
9. `pnpm db:generate` → `./scripts/verify` → `pnpm test:e2e`. Fix app code until green.
   Never touch `platform/`, guards, or add `eslint-disable`.
10. Run the `redteam` skill. Include its output and the APP_SPEC.md in the PR body.
11. Open a PR titled `app(<id>): <name>`. Tell the requester: "It's live in sandbox at
    `/a/<id>` with made-up data. To use real data, engineering runs the promote step."
