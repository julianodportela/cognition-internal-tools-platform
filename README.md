# Internal Tools Platform

Build internal business apps — KYC queues, refund dashboards, feature-flag panels — from a paragraph of plain English, on a shared runtime that enforces login, permissions, data masking, approvals and audit. An open alternative to low-code platforms like Power Apps.

## Table of contents

- [Overview](#overview)
- [Baseplate features](#baseplate-features)
- [Apps included](#apps-included)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Building a new app](#building-a-new-app)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Status and roadmap](#status-and-roadmap)
- [Contributing](#contributing)

## Overview

The project has two layers:

- **Platform** (`platform/`, `app/`) — owned by engineers. Handles login, roles, masking of private data, second-person approvals, the audit log and the sandbox/production split. It is the only code that touches the database or external services.
- **Apps** (`apps/<name>/`) — small declarative packages: tables, buttons, who may press them, and screens. Written by an AI agent (or a business user working with one).

## Baseplate features

Shared by every app, so no app has to build them:

- **Login and roles** — who can open what and press what.
- **Data masking** — private fields are hidden by default; revealing is logged.
- **Approvals Inbox** — risky actions wait for a second person.
- **Audit log** — every action is recorded.
- **No double-doing** — two clicks still mean one refund.
- **Notes, attachments, claiming** — on any record.
- **Sandbox first** — apps start on fake data; real data needs engineering approval.
- **Agent harness** — the rulebook and recipes an AI follows to build apps safely.

Apps can only act through these; they can't reach the database or network on their own, so a badly written app can be wrong but can't leak data or skip a control.

## Apps included

Each app adds only its own tables, buttons and rules on top of the baseplate.

### Refunds Dashboard — `/a/refunds`
- Support agents refund card payments.
- Refunds of $100 or more need finance approval.
- A payment can't be refunded twice.

### KYC Review Queue — `/a/kyc`
- Analysts claim identity cases (one analyst per case) and approve or reject with a reason.
- High-risk cases need a senior reviewer's sign-off.
- Rejected customers can be re-reviewed once; cases go overdue after 48 hours.
- Compliance can see everything, change nothing.

### Feature-Flag Admin — `/a/flags`
- Engineers create flags and change staging freely.
- Production changes need a second engineer; `payments`/`kyc` flags need an admin.
- Full change history; stale flags listed after 90 days.
- Flags can be archived, never deleted.

## Tech stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS · Drizzle ORM · PGlite locally (Postgres dialect) · Zod · Vitest · Playwright · GitHub Actions · pnpm

## Getting started

Prerequisites: Node 20 (`.nvmrc`) and pnpm 10 via Corepack.

```bash
git clone https://github.com/julianodportela/cognition-internal-tools-platform.git
cd cognition-internal-tools-platform
nvm use
corepack enable && corepack prepare pnpm@10.18.0 --activate
pnpm install
pnpm exec playwright install chromium   # only needed for browser tests
pnpm dev                                 # http://localhost:3000
```

The app runs entirely on local fake data; no external services or credentials are required.

## Usage

1. Open http://localhost:3000/login and pick a user:

   | User | Role |
   |---|---|
   | `u-analyst` | KYC analyst |
   | `u-senior` | senior KYC reviewer |
   | `u-compliance` | compliance (read-only) |
   | `u-support` | support agent (refunds) |
   | `u-finance` | finance approver |
   | `u-engdev` | engineer |
   | `u-engadmin` | engineering admin |

2. The home page lists the apps your role can open. `/inbox` shows approvals waiting for you; `/audit` shows the log.
3. Try a flow, for example: as `u-support` issue a $150 refund → as `u-finance` approve it in the Inbox → check `/audit`.

Reset local data at any time with `pnpm db:reset-sandbox`.

## Building a new app

1. Write one paragraph describing the app: the things, who works them, the buttons, what needs a second pair of eyes, what is private.
2. Give it to the agent in this repo. It follows `.agents/skills/new-app/SKILL.md` and first writes a plain-English spec at `apps/<name>/APP_SPEC.md`, listing open questions where the request conflicts with policy.
3. Review the spec (not the code) and request changes in plain English.
4. The agent copies `templates/app`, fills in schema, actions, pages and fixtures, runs all checks and a red-team pass, records timings in `docs/dryrun-<name>.md`, and opens a PR.
5. Merge the PR: the app appears on the home page on sandbox data.
6. To use production data, an engineer follows `.agents/skills/promote` and adds `promotions/<name>.yaml` after human sign-off and a passing red-team.

Editing an existing app follows the same loop via `.agents/skills/edit-app`. Roles and permissions are defined in `platform/policy/roles.ts`; changing them is a normal reviewed PR.

## Project structure

```
AGENTS.md            rulebook the agent reads before touching the repo
.agents/skills/      recipes: new-app, edit-app, redteam, promote, debug
app/                 Next.js routes: login, home, inbox, audit, /a/<app>
platform/            the trusted runtime (auth, policy, data, actions, approvals, records, guard, ui)
apps/                the apps: refunds, kyc, flags
  <name>/
    APP_SPEC.md      plain-language spec
    manifest.ts      defineApp({...})
    schema.ts        tables; sensitive() on private columns
    actions.ts       one defineAction per button
    pages/           screens built from @platform/ui
    fixtures.ts      synthetic sandbox data
templates/           canonical example app + APP_SPEC template
promotions/          engineer-approved sandbox → production bindings
tests/               unit, security, guard and e2e tests
docs/                build dry-run timings and friction logs
```

## Testing

```bash
./scripts/verify      # typecheck, lint, structure/promotion guards, unit + security tests
pnpm test:e2e         # Playwright smoke tests against the dev server
pnpm guard:redteam    # adversarial guard tests (permissions, masking, approvals, idempotency)
```

CI runs `verify`, secret scanning (gitleaks) and `e2e` against a production build on every pull request.

## Status and roadmap

This is a prototype. Login is a development "pick a user" screen (an identity-provider interface exists for SSO), the database is PGlite locally (swap `DATABASE_URL` for Postgres), payment/KYC/flag services are mocks behind interfaces, and no hosting target is chosen.

Before production use: wire SSO, point at a managed Postgres, implement the real integrations behind the existing interfaces, choose hosting, and have security review `platform/` — the trusted layer.

## Contributing

- Engineers own `platform/`, `app/`, `.github/` and `promotions/` (see `CODEOWNERS`).
- App changes go through the agent skills or a normal PR under `apps/<name>/`; never add `eslint-disable` or weaken a guard — use the platform primitive instead.
- Run `./scripts/verify` before pushing.
