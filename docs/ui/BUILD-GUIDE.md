# How a redesigned screen is built

Read with `docs/design-handoff/{RULES,DESIGN-SYSTEM,SCREENS,DATA-MODEL}.md`,
`docs/ui/DECISIONS.md` and the repo's `CLAUDE.md`.

## Where things go

| What | Where |
|---|---|
| Route | `src/app/(app)/<route>/page.tsx` (server component). Replace the interim redirect if there is one. |
| Screen UI | `src/vx/screens/<module>/*.tsx` — client parts marked `"use client"` |
| Server data for a non-fee module | `src/vx/screens/<module>/data.ts` (`import "server-only"`), using this app's clients (`@/platform/supabase/*`, `vppsone` schema) or existing repos in `src/modules/<x>/data` |
| Server data / actions that touch **fee** data | inside a ported tree, e.g. `src/modules/payments/vx/*`, `src/modules/receipts/vx/*`. Only ported trees may import `@/modules/fees/platform/supabase/*` (`tests/architecture.test.ts`). Prefer calling the existing module functions and RPC wrappers rather than new queries. |
| Server actions | `actions.ts` next to the route (`"use server"`). First line of every write: `requirePermission`/`assertPermission`, then `assertNotPreviewing()` from `@/vx/view-as`. |
| Migrations | Additive SQL in `vppsone` schema only, applied with the Supabase connector to **`wtgxcptmucjerhufzjcf` only** (never `vgqyilgstjvgohrsiwkb`), then saved as `supabase/migrations/<version>_<name>.sql` with the version the database recorded. |
| Fake seed data | Applied to dev with SQL, saved under `supabase/seed/vx/<module>.sql`. Fake names only, never a real child. |

## The kit (`src/vx/`)

- `ui/page.tsx`: `VxPage` (the `.vx` container, 900px container query), `TopBar` (desktop glass bar + phone bar with back), `Section`, `Split` (list + sticky detail), `Grid`, `DataList` (table on desktop, cards on phone from one column list), `Banner`.
- `ui/primitives.tsx`: Card, CardHead, SecHead, Pill, Btn, Money, Avatar, IconTile, Progress, Ring, Sparkline, StackedBar, BarChart, Donut, HeatGrid, Kpi, EmptyState, Skel, PageSkeleton, SuccessTick, WhatsAppPreview, ListRow, Stat.
- `ui/controls.tsx` (client): Chip, ChipRow, Seg, Switch, SwitchRow, RadioCard, Field, Input, Textarea, Select, Stepper, NumberPad, WizardSteps, DateChips, SearchBox, CountUp.
- `ui/overlays.tsx` (client): Sheet (bottom sheet on phone, dialog on desktop), `useToast().show({ text, tone, undo })`, HelpButton, Confirm.
- `ui/voice.tsx`: VoiceNote (Web Speech API, hi-IN / en-IN).
- `icons.tsx`: `<Ic n="name" />` with the design's icon names.
- `format.ts`: rupees, rupeesShort, amountInWords, dateLabel, ago, greeting, etc. (Asia/Kolkata).
- `text.ts`: pairs `{ en, hi }`; server code uses `lead(pair, staff.language)` / `under(...)`; client code uses `useVx().tx(pair)` or `<Tx en hi />` / `<Bi />` from `i18n.tsx`.
- `vx.css`: the design's classes (`card`, `btn pri|sec|soft|ghost`, `chip`, `pill`, `inp`, `row`, `sech`, `tap`, `num`, `serif`, `only-d`, `only-m`, `g2/g3/g4`, `stack`, `pad`, …) and keyframes. Use the classes and inline styles the `.dc.html` template uses, so the screen matches its screenshot.

## Rules that bite

- Never import `next-intl` or `@/messages` in vx files; never render a ported fee component that needs the fee next-intl catalogue on a vx route.
- Every user-facing string is an English/Hindi pair where the design shows Hindi; English-first.
- Teachers never see money. Class teachers only their own class; subject teachers only their own class-subjects (use the existing scoped reads).
- Payments, receipts, adjustments and audit rows are append-only; corrections are reversal rows. Fees and late fees are always separate. "Pending today" and "Not due yet" are never added. One student per payment. Keep passing `client_request_id`.
- Session: never sort labels; use `pickSessionLabel()` / the resolved view session. Chunk `.in()` lists with `fetchInChunks`.
- Every route needs a row in `tests/fixtures/role-expectations.ts` and must be reachable from `src/vx/nav.ts` (or listed in `NON_NAV_SCREENS`).
- React Compiler lint applies to `src/vx` and `src/app`: no setState directly in effects, no ref reads/writes during render.
- Each state named in SCREENS.md for the module must be reachable (URL params such as `?view=` / `?sheet=` are fine).

## Checks before a commit

Node 24 is required (`npx -y node@24 …` if the machine has 22):
`npm run typecheck`, `npm run lint`, `npm run check:port`, `npm run test`, and `npm run build` with the CI placeholder env from `.github/workflows/ci.yml`.
