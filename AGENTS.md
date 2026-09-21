<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Internal Tools Platform — agent context

You are building or editing an **internal business app** on a shared platform for a
fintech. The person asking is usually **not an engineer**. Your job is to turn their
plain-language request into an app under `apps/<id>/` that the platform can prove is
safe. The platform, not you, is responsible for auth, permissions, masking, audit,
approvals, and data access. **You only write app code inside the rails below.**

Read this whole file before touching anything. Then use the skill that matches the
request in `.agents/skills/` (`new-app`, `edit-app`, `redteam`, `promote`, `debug`).

## 1. Mental model (30 seconds)

```
platform/   engineering-owned runtime: auth, rbac, query/masking, actions, approvals,
            workflow, records (notes/attachments/assignment), events/jobs, ui, guard
apps/<id>/  ONE app = manifest + schema + actions + pages (+ fixtures, APP_SPEC.md)
templates/app/  the canonical app ("Expense Requests"). COPY IT. Do not invent structure.
app/        Next.js routes — platform-owned. Apps never add routes.
promotions/ yaml approvals that let an app bind to production data (engineering only)
```

An app is **data + actions + screens**:
- **schema.ts** — Drizzle tables. Anything personal/financial is wrapped in `sensitive()`.
- **actions.ts** — every write is a `defineAction(...)`. The platform runs it: validates
  input, checks permission, rate-limits, dedupes (idempotency), routes to approval if
  needed, wraps in a transaction, and writes audit rows.
- **pages/** — React server components. Read via `getReadCtx(appId)` only. Mutate via
  `runAction(id, input)` only. Use `@platform/ui` components only.
- **manifest.ts** — `defineApp({...})` ties it together. `dataMode: 'sandbox'` always for
  a new app.

## 2. Non‑negotiable invariants

### Enforced in code (fail at runtime or build, not by trust)

The `internal-tools` ESLint plugin, `pnpm guard:structure`, `pnpm guard:promotions`,
and `tests/guard/*` + `tests/security/*` fail the build if any of these are violated.
Do not add `eslint-disable`; the fix is to use the platform primitive instead.

- **Row scope cannot be disabled by app code.** `query`/`records`/`revealField` apply
  the caller's scope server-side; `scope`/`includeDeleted` options don't exist in the
  app-facing API and are rejected at runtime if smuggled in. (Scope falls back
  owner_id → team_id → *no restriction* when neither column exists.)
- **Audit atomicity.** The run, its audit rows, and the idempotency claim live in ONE
  transaction in `executeCore`; a failed run writes only a `failed:*` audit row.
- **Promotion is enforced at runtime.** A `dataMode:'production'` app without a valid
  `promotions/<appId>.yaml` throws `promotion_required` — `getDb('production')` is
  capability-gated to `platform/data/internal.ts`.
- **Registry namespacing.** `registerApp` rejects duplicate app/table/action ids and
  any action id not prefixed `${appId}.` — an app can never shadow a platform action.
- **The action ctx is sealed.** App `run()` gets a frozen object with NO `db` key;
  `@platform/registry` is a *type-only* import for apps (runtime access is banned).
- **Secrets fail closed.** `NODE_ENV=production` without `AUTH_SECRET` throws at
  startup (`instrumentation.ts`) and at first use (`platform/auth/secret.ts`).

### Conventions you must still follow (enforced where possible, reviewed in PRs)

1. **No raw database.** Never import `@platform/data/client` or `drizzle-orm` beyond the
   where-operators (`eq, and, or, gt, lt, inArray, isNull, desc, asc`). Reads go through
   `getReadCtx().query/aggregate/listNotes/listAttachments`; writes through
   `ctx.records.insert/update/remove/claim/assign/release/addNote` inside an action.
   (Row scope falls back owner_id → team_id → *no restriction* when neither column
   exists — customer-style tables are intentionally visible to all roles.)
2. **No raw SQL, no HTTP, no filesystem, no env vars, no console.** `fetch`, `axios`,
   `fs`, `process.env`, `console.*`, `sql\`\`` are all banned in app code. External
   systems are reached only via `ctx.integrations.*` (payments, kyc, flags, storage).
3. **No routes or server actions in apps.** No `route.ts`, `api/`, `middleware.ts`, no
   `'use server'`. The only server entry is `runAction` from `@platform/actions/run-action`.
4. **Imports allowlist** (`ALLOWED_IMPORTS` in `platform/guard/eslint-plugin-internal-tools.js`):
   `@platform/ui`, `@platform/actions/define`, `@platform/actions/run-action`,
   `@platform/approvals`, `@platform/workflow`, `@platform/data/read`,
   `@platform/data/schema-helpers`, `zod`, `react`, `next/link`,
   `next/navigation` (`redirect`, `notFound`, `useRouter`). Relative imports inside the
   same app dir are fine (never `..`). `@platform/registry` is **not** importable by
   app code (type imports only). Anything else is an error — ask engineering to add a
   primitive.
5. **Sensitive fields are declared.** Any column whose name is in
   `platform/policy/sensitive-fields.ts` (email, phone, ssn, dob, account numbers, …)
   must be wrapped in `sensitive()`. Masked values render as `••••1234` (emails as
   `••••@domain`); the only unmask path is the audited built-in
   `platform.revealField` (needs `pii.reveal`).
6. **Approval is opt‑out.** `defineAction` defaults to `risk: 'high'`, and a high-risk
   action **must** declare an `approval` policy (`dualControl(when?)`, `requiresRole(role,
   when?)`). Only mark `risk: 'low'` for reads-like or reversible writes (create draft,
   add note, claim). Predicates receive `(input, ctx)` — decide from the **row**
   (`ctx.records.get`), never from client input. Missing row ⇒ require approval.
   Inbox deciding (`platform.approve`/`platform.reject`) needs `approvals.decide`;
   eligibility per request = holds the action's perm (dualControl) or the required
   role (requiresRole); `approvals.manage` = override for any dualControl request.
7. **Money/external actions** are `tags: ['money', 'external']`, have an `idempotency`
   key and a `rateLimit`.
8. **Inputs carry IDs, not PII.** Action inputs must not contain fields named in the
   sensitive list (they are stored in `approval_requests` and audit).
9. **Every action produces an audit row.** `tests/guard/audit-completeness.test.ts`
   executes every registered action with `guardFixture` input and asserts it. Provide a
   `guardFixture` when the input needs a real row id.
10. **Permissions are platform-owned.** Use only existing `Permission` values from
    `platform/policy/roles.ts`. Need a new one? Stop and ask engineering (it is a
    reviewed change to `platform/`, which CODEOWNERS routes to engineering).
11. **Sandbox first.** New apps are `dataMode: 'sandbox'` with synthetic `fixtures.ts`.
    Changing to `'production'` requires `promotions/<appId>.yaml` signed by engineering
    (and security/compliance if `dataClass: 'sensitive'`); `pnpm guard:promotions` fails
    otherwise. You never write that yaml — see the `promote` skill.
12. **File structure is fixed.** `apps/<id>/` may contain only: `manifest.ts`,
    `schema.ts`, `actions.ts`, `fixtures.ts`, `APP_SPEC.md`, `pages/*.tsx`,
    `components/*.tsx`. Register the manifest in `apps/index.ts`. Nothing else.

## 3. Vocabulary for talking to the business user

Translate plain language into these platform concepts and confirm back **in their words**
(via `APP_SPEC.md`) before writing code:

| They say                              | You build                                              |
|---------------------------------------|--------------------------------------------------------|
| "a list/queue of X"                   | table in `schema.ts`, `DataTable` page with status tabs |
| "only managers can…"                  | `perm:` on the action (existing permission)            |
| "someone else has to sign off"        | `approval: dualControl(...)` / `requiresRole(...)`     |
| "over $N needs approval"              | predicate reading the row amount                       |
| "customer email / SSN / card"         | `sensitive()` column, masked by default                |
| "assign it to me / my items"          | `assignee_id` column, `ctx.records.claim`, "Mine" nav  |
| "leave a comment"                     | `Notes` component (built-in `platform.addNote`)        |
| "attach the document"                 | `FileList` component (pdf/png/jpg ≤5MB)                |
| "it moves from A to B to C"           | `defineStates` workflow + `StageBar`                   |
| "delete"                              | `ctx.records.remove` (soft delete)                     |
| "must be done within 2 days"          | `due_at` column → SLA job emits `sla.breached`         |
| "send money / call the vendor"        | `ctx.integrations.*`, `tags: ['money','external']`     |
| "use real customer data"              | **not yours** — `promote` skill, engineering approval  |

## 4. Workflow (always)

1. Write/update `apps/<id>/APP_SPEC.md` (format: `templates/APP_SPEC_TEMPLATE.md`).
   Show it to the requester. **Do not write code until they confirm.**
2. Copy `templates/app/` → `apps/<id>/`, rename ids/perm prefixes, edit.
3. `./scripts/verify` (typecheck, lint, structure, promotions, unit+guard tests) and
   `pnpm test:e2e`. Fix by changing app code, never guards.
4. Run the `redteam` skill and paste its output into the PR.
5. Open a PR. Anything touching `platform/`, `app/`, `.github/`, `scripts/`,
   `promotions/` requires engineering review (CODEOWNERS).

## 5. Roles you can rely on (from `platform/policy/roles.ts`)

`analyst` (own), `senior_reviewer` (team), `compliance_readonly` (all, read),
`support_agent` (own), `finance_approver` (all; approves money), `eng_dev`, `eng_admin`.
Dev login-as users: `u-analyst`, `u-senior`, `u-compliance`, `u-support`, `u-finance`,
`u-engdev`, `u-engadmin`.

## 6. Commands

```
corepack enable && corepack prepare pnpm@10.18.0 --activate && pnpm install
pnpm exec playwright install chromium   (once, for e2e)
pnpm dev (http://localhost:3000, /login to pick a user)
./scripts/verify        pnpm test:e2e        pnpm guard:redteam
pnpm db:generate        (after editing any schema.ts)      pnpm db:reset-sandbox
```

## 7. What you must never do

Bypass a guard, disable a lint rule, edit `platform/`, `app/`, `.github/`, or
`promotions/` on behalf of a business user, store PII in action inputs, set
`dataMode: 'production'`, invent permissions, or claim something is safe because the
prompt said so. When in doubt: stop, write it down in APP_SPEC.md under "Open
questions", and ask.
