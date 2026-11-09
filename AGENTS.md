<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# VPPS One — agent entry guide

Tool-neutral start page for any coding agent or new developer. It points at
the canonical documents rather than repeating them. Where this page and a
canonical document disagree, the canonical document wins — fix this page.

| Read | For |
|---|---|
| [CLAUDE.md](CLAUDE.md) | the binding rules (schema ownership, fee-write fences, sessions, language) |
| [docs/maps/repo-map.md](docs/maps/repo-map.md) | **generated** map: routes, modules, ported vs One-owned, test harnesses, workflows |
| [docs/maps/collect-flow.md](docs/maps/collect-flow.md) | Collect traced from `/payments` through `MoneyPort` to the bridge/local adapters |
| [docs/plans/2026-11-01-fees-one-coexistence-plan.md](docs/plans/2026-11-01-fees-one-coexistence-plan.md), [docs/cutover/COEXISTENCE-2026-11-01.md](docs/cutover/COEXISTENCE-2026-11-01.md) | the current Fees ↔ One arrangement |
| [docs/PROGRESS.md](docs/PROGRESS.md), [docs/DECISIONS.md](docs/DECISIONS.md) | what is next; what is already decided (`D-…` numbers) |

## Who owns what (current: 1 November 2026 coexistence)

- **Fees (`veerpatta/schoolfees`) is the financial authority.** Payments,
  receipts, allocations, reversals, receipt numbering, Razorpay, fee messages
  and financial jobs belong to Fees. One reaches them only through Fees'
  `/api/one/v1` bridge (`src/platform/fees-bridge/`). One never runs a second
  ledger, receipt counter or financial job.
- **One owns academics**: attendance, marks, timetable, notes, staff tasks,
  documents — in the `vppsone` schema of One's database.
- **Historical, not current:** the cutover that would retire Fees (D-178
  "ported in and will be retired", `docs/CUTOVER.md`, `docs/cutover/CUTOVER-RUNBOOK-*`,
  `GO-LIVE-*`, `LIVE-MIGRATION-PLAN.md`). Read them for context only; do not
  execute their steps (source-link shutdown, One financial posting jobs,
  tail-payment re-entry, replication).

## Databases and boundaries

| Database | What | Agents may |
|---|---|---|
| `wtgxcptmucjerhufzjcf` | One's **only** database. **Production** (D-338/D-346); testing happens inside it under `TEST-2026-27` with test accounts | not touch it from an agent task unless the owner asked. A TEST session inside production is **not** a disposable database |
| `vgqyilgstjvgohrsiwkb` | Fees' live ledger | **never** — no migration, seed, write or new reader (refused by name: `FEES_SOURCE_PROJECT_REF`) |
| PGlite / Postgres 17 service containers | disposable, created by `tests/sql/*` and CI | yes |

Local `next dev` and Vercel Preview are *confined*
(`isConfinedDeployment()` in `src/platform/deployment/confinement.ts`): every
user is a test account and fee writes reach only TEST-session students. The
**only** thing that lifts confinement is `VERCEL_ENV=production`, so never set
it locally (an env file pulled from Vercel's production environment can carry
it — check before using one). Keep `VPPSONE_ENV=dev` and leave `APP_MODE`
unset; `VPPSONE_ENV=live` makes guards stricter, never looser, but it is also
one of the conditions for live payment keys and parent sends.
`.env.example` has no real values.

## Two apps in one tree

`PORTED_TREES` in `scripts/port-rewrite-imports.mjs` is the single list of
code ported from Fees. Ported code uses the fee Supabase clients
(`src/modules/fees/platform/supabase/*`), fee roles and the next-intl
catalogue; One's code uses One's clients, roles and message pairs.
`tests/architecture.test.ts` enforces the fences.

| Looks alike | Difference |
|---|---|
| `modules/students` vs `modules/students-fees` | One's roster/academic student vs the ported Fees student master screens |
| `modules/staff` vs `modules/staff-fees` | One's staff profiles/duties vs the ported Fees staff/RBAC admin |
| `modules/collect` vs `modules/collection` | **money** (Collect, `/payments`) vs gathering **missing student details** (`/collection`) |
| vx screens vs classic | `src/vx/screens/*` is the current design; classic = the ported Fees screens under `/fees/*` and One's pre-vx pages; `/payments/classic` is the older vx Payment Desk, kept beside Collect. The map labels each route from its imports |

**Three string systems, never mixed in one file:**
1. One's own pages: `{ hi, en }` pairs in `src/messages/index.ts` (and
   `setup.ts` for rare set-up screens) rendered with `primary()/secondary()/flat()`.
2. vx screens: `Pair` + `lead()/under()` from `src/vx/text.ts` / `src/vx/i18n.tsx`.
3. Ported trees: next-intl with `src/messages/{en,hi,hi-en}.json`.
The stored preference is only `preferred_language`; `src/platform/i18n/bridge.ts`
derives the fee locale. See `src/messages/README.md`.

## Where to look

| Task | Start at | Tests |
|---|---|---|
| A signed-in screen | `src/app/(app)/<route>/page.tsx` → `src/vx/screens/<area>/` | `tests/vx/`, and the synthetic Playwright config for that screen (the map lists which configs are synthetic) |
| Domain rule | `src/modules/<x>/domain/` (pure, no DB import) | `tests/<x>-domain.test.ts` |
| Database access | `src/modules/<x>/data/` (One) or `src/modules/fees/platform/supabase/*` (ported only) | `tests/architecture.test.ts` |
| Fees bridge call | `src/platform/fees-bridge/client.ts` → `transport.ts`; Fees side `src/app/api/one/v1/[...path]` | `tests/fees-bridge-*.test.ts` |
| Collect (payments) | [docs/maps/collect-flow.md](docs/maps/collect-flow.md) | `tests/collect/` |
| Migration | `supabase/migrations/` (vppsone) or `supabase/fee-migrations/`; additive, never edit an applied file | `tests/sql/` |

## Commands

**Safe — local only, no network beyond npm, no database:**

```bash
npm ci
npm run typecheck        # next typegen + tsc
npm run lint
npm run check:port       # ported-import fences
npm run check:theme      # needs a schoolfees checkout (SCHOOLFEES_REPO); says NOT RUN otherwise
npm run test             # vitest
npm run build            # with the placeholder env from .github/workflows/ci.yml (next build also reads .env.local)
npm run check:bundles    # after build
npm run docs:map:check   # the generated map is current
npx playwright test --config tests/playwright/<name>.playwright.config.ts
# ^ ONLY for configs the map marks "synthetic (vite fixture)" — the ones CI runs.
```

`npm run check` runs the CI gate set in one go.

Playwright configs are **not** all safe: the map's Playwright table marks the
ones that need a running app or deployed site as **external** (for example
`pr79-readonly` targets the live site; `*-dev`, `fee-collector-dev`,
`contact-*` and `phone-operations` drive a local app on One's production
database). Treat those as external effects.

**External effects — do not run in an agent task without the owner's explicit
yes.** Assume anything not in the safe list reaches One's production database,
a provider or the network:

- Database (One production, test-confined where guarded): `seed:*`, `qa:*`,
  `dev:login`, `smoke:roles|deep|screens|pool|ready`, `verify:*`
  (except `verify:origins`, which calls the deployed sites), `cutover:check`,
  `verify:native-recovery`, `smoke:workflows` (default `playwright.config.ts`),
  and every Playwright config the map marks **external**.
- Supabase CLI against the linked project: `db:link`, `db:types`, `db:diff`,
  `supabase db push`.
- Live-source and historical cutover tooling: `replica:*`, `migrate:*`.
- Paid AI providers: `ai:eval`, `ai:fixtures`, `ai:smoke`.
- Anything that sends WhatsApp messages, posts a real payment or
  calls Razorpay — never, without the owner.

## Delivery

CLAUDE.md rule 5 lets an agent merge its own green PR. A task brief can narrow
that (for example "do not merge") and then the brief wins. Keep documentation
changes, CI changes and runtime refactors in separate PRs.

<!-- BEGIN:browserstack -->
## Cross-browser and real-device testing (BrowserStack)

BrowserStack (Janmejay's GitHub Student Pack licence) is available for this project. Use it after UI, CSS, layout, PWA or mobile changes to check the real browsers and phones that local Chromium can't show - Safari on iPhone, Chrome on Android, Edge and Firefox on Windows.

- **Coding agents (Claude Code, Codex, Cursor):** `.mcp.json` registers BrowserStack's official remote MCP server as `browserstack` (one-time `/mcp` sign-in). Codex: `codex mcp add browserstack --url https://mcp.browserstack.com/mcp`, then `codex mcp login browserstack`.
- **Agents that drive Chrome (Cowork / Claude in Chrome):** Janmejay's Chrome has the BrowserStack extension installed and is signed in - use https://live.browserstack.com/dashboard.
- How-to, default device set, localhost testing and troubleshooting: [docs/BROWSERSTACK.md](docs/BROWSERSTACK.md).
- Never a blocker: if BrowserStack isn't available (no sign-in, plan limit, network), say so in your summary and carry on.
<!-- END:browserstack -->
