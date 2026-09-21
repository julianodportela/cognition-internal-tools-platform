# Internal Tools Platform

A shared runtime for building internal business apps (KYC queues, refund dashboards,
feature-flag panels, …) where an AI agent — or an engineer — writes only the app-specific
parts, and the platform enforces auth, permissions, PII masking, audit, approvals, and
sandbox/production separation. This is the "buy the runtime, generate the apps"
alternative to a low-code platform.

- **Agents:** start at [`AGENTS.md`](AGENTS.md) and `.agents/skills/`.
- **Business users:** you describe the app in plain language; you review
  `apps/<id>/APP_SPEC.md`, not code. New apps run on made-up data until engineering
  promotes them.
- **Engineers:** you own `platform/`, `app/`, `.github/`, `promotions/` (CODEOWNERS).

## Quick start

```bash
nvm use            # Node 20 (.nvmrc)
corepack enable && corepack prepare pnpm@10.18.0 --activate && pnpm install
pnpm exec playwright install chromium   # once, for pnpm test:e2e
pnpm dev           # http://localhost:3000 → /login, pick a dev user
./scripts/verify   # typecheck + lint + structure/promotion guards + unit & guard tests
pnpm test:e2e      # Playwright smoke against the dev server
```

Dev users (`/login`): `u-analyst`, `u-senior`, `u-compliance`, `u-support`,
`u-finance`, `u-engdev`, `u-engadmin`. The example app is at `/a/template`.

## What the platform provides

| Concern | Primitive | Where |
|---|---|---|
| Identity | `IdentityProvider` (dev login-as; OIDC later), signed cookie | `platform/auth` |
| Permissions & row scope | `Permission` union, roles, `own/team/all` scope | `platform/policy`, `platform/rbac` |
| Reads | `getReadCtx(appId).query/aggregate` — scoped, masked, keyset-paginated | `platform/data/read.ts`, `query.ts` |
| PII | `sensitive()` columns, `••••1234` masking, audited `platform.revealField` | `platform/data/schema-helpers.ts` |
| Writes | `defineAction` → `runAction`: validate, perm, rate-limit, idempotency, approval, transaction, audit | `platform/actions` |
| Approvals | `dualControl`, `requiresRole`, `/inbox` | `platform/approvals` |
| Workflow | `defineStates`, `StageBar` | `platform/workflow` |
| Records | notes, attachments (signed URLs), claim/assign, soft delete | `platform/records` |
| Events & jobs | notifier ring buffer, `registerJob`, SLA check | `platform/events` |
| Integrations | payments / kyc / flags / storage interfaces + deterministic mocks | `platform/integrations` |
| UI | `AppShell`, `DataTable`, `ActionForm`, `Drawer`, `ConfirmDialog`, `Notes`, `FileList`, … | `platform/ui` |
| Guards | ESLint plugin (8 rules), structure check, promotion gate, audit-completeness & binding tests | `platform/guard`, `tests/guard` |
| Sandbox → production | separate connections/credentials, `promotions/<id>.yaml` signed by engineering | `platform/data/client.ts`, `platform/guard/check-promotions.ts` |

## Anatomy of an app

```
apps/<id>/
  APP_SPEC.md   plain-language spec the requester confirms
  manifest.ts   defineApp({ id, permission, dataMode:'sandbox', dataClass, schema, actions, pages })
  schema.ts     Drizzle tables; sensitive() on PII
  actions.ts    defineAction(...) per button
  fixtures.ts   synthetic rows for sandbox
  pages/*.tsx   server components using @platform/ui
```

`templates/app/` (Expense Requests) is the canonical copy source.

## Safety model in one paragraph

App code can only import an allowlist of platform modules. It cannot open a database,
run SQL, call HTTP, read env vars, add routes, or define server actions — the lint
plugin and structure check fail CI otherwise. All reads return masked rows; all writes
go through one action runner that audits every request and defaults to requiring
approval. Sensitive column names are enforced globally. New apps bind to a sandbox
database and mock integrations; binding to production requires a yaml approval file
that only engineering can add (CODEOWNERS), checked by CI. `tests/guard` executes every
registered action and proves it audits, and a negative fixture proves every lint rule
fires.

## Status / not yet

Dev login-as only (OIDC interface exists), PGlite locally (Postgres dialect; swap
`DATABASE_URL`), in-memory rate limits and notifier, mock integrations, local file
storage. Deployment target (container/Vercel) is the client's choice.
