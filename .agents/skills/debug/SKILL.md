---
name: debug
description: Diagnose a failing verify/guard/e2e run or a runtime error in an app without weakening any guard.
---

# debug

Rule zero: the fix is always in `apps/<id>/`. If it seems to require touching
`platform/`, a guard, or an `eslint-disable`, stop and hand off to engineering with the
error text.

| Symptom | Meaning | Fix |
|---|---|---|
| `internal-tools/no-raw-db` / `only-platform-imports` | app reached outside the rails | use `getReadCtx` / `ctx.records` / `@platform/ui`; see AGENTS.md §2 |
| `sensitive-must-be-declared` | column name is in the global sensitive list | wrap in `sensitive()` |
| `check-structure`: unexpected file | file outside the allowed set | move into `pages/` or `components/`, or delete |
| audit-completeness: "no audit row for X" | action ran without touching records | use `ctx.records.*` for the write; if truly no write, the platform still writes a fallback row — check `guardFixture` returned valid input |
| audit-completeness: "high-risk action without approval" | missing `approval` | add `dualControl()`/`requiresRole()`, or justify `risk: 'low'` in APP_SPEC |
| audit-completeness: "input field matches sensitive list" | PII in action input | pass an entity id instead |
| `check-promotions` failure | manifest is production without valid yaml | set `dataMode: 'sandbox'` (business users) or see `promote` skill (engineers) |
| `needs_approval` when you expected `ok` | policy predicate true (or row missing ⇒ fail closed) | correct per spec; approve from `/inbox` as another user |
| `failed:permission_denied` | user lacks `perm` | switch dev user at `/login`; if the role should have it, that's a platform policy change |
| `failed:run_error` with txn `...F` | deterministic mock failure | expected; test the failure path |
| Page 500 "functions cannot be passed to client" | passing a function/render prop across RSC boundary | use `format:` on columns and `fieldsFromSchema` |
| Table shows `null`/blank for a sensitive number | masked non-string | expected; use Reveal |
| Migration mismatch | edited `schema.ts` without regenerating | `pnpm db:generate`, then `pnpm db:reset-sandbox` and restart dev |

Useful: `pnpm dev` logs, `/audit` (recent events panel + rows per requestId),
`pnpm vitest run tests/guard -t "<action id>"`.
