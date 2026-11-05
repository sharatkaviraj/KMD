# Collect: from the route to the ledger

Hand-written trace, checked against `main` on 5 November 2026. Collect is under
active development (`feat/collect-flow` and related PRs), so the file
names here are the stable entry points, not a full inventory. If a name here no
longer exists, trust the code and fix this file in the same PR.

**Naming trap.** *Collect* (`src/modules/collect`, `/payments`) is **money**:
taking a fee payment. *Collection* (`src/modules/collection`, `/collection`) is
**gathering missing student details** from teachers and families. They share
nothing.

## Who owns the money

Fees (`veerpatta/schoolfees`, database `vgqyilgstjvgohrsiwkb`) is the financial
authority (coexistence direction of 1 November 2026,
[plan](../plans/2026-11-01-fees-one-coexistence-plan.md)). One never numbers a
real receipt, never allocates a real payment, never runs a real financial job.
A real collection is a **command sent to Fees**; One displays what Fees returns.

## The path

```
/payments                                  src/app/(app)/payments/page.tsx
  requirePermission("fees:collect")         ← One permission, first
  ?classic=1 or ?receipt=…  ───────────────→ /payments/classic  (classic desks)
  usesCanonicalFees(staff, session)?        src/platform/fees-bridge/policy.ts
   ├─ yes → <CollectBridge>                src/vx/screens/collect/collect-bridge.tsx
   │         bridgeAdapter(info)           src/modules/collect/data/bridge-adapter.ts
   │           server actions              src/app/(app)/payments/collect-actions.ts
   │             assertPermission + assertSessionWritable
   │             bridge client             src/platform/fees-bridge/client.ts
   │               quoteBridgePayment / postBridgePayment / getBridgeCommand …
   │             transport                 src/platform/fees-bridge/transport.ts
   │               HTTPS → Fees  /api/one/v1/{quote,payments,commands/:id,…}
   │                 Fees: src/app/api/one/v1/[...path]  +  src/modules/one-bridge/
   │                 Fees re-checks the actor grant, then calls its own money
   │                 functions (receipt lock, idempotent client_request_id)
   │
   └─ no (test account, or a confined Preview/local deployment)
           → <CollectLocal>                src/vx/screens/collect/collect-local.tsx
             localAdapter(info)            src/modules/collect/data/local-adapter.ts
               vx Payment Desk actions     src/app/(app)/payments/actions.ts
                 ported fee action → fee clients in src/modules/fees/platform/supabase/*
                 TEST session only; One's database (wtgxcptmucjerhufzjcf, production)
```

Both adapters implement one interface,
[`MoneyPort`](../../src/modules/collect/data/money-port.ts): `search`, `likely`,
`dues`, `prepare` (quote), `post`, `status`. The cards in
`src/vx/screens/collect/collect.tsx` talk only to that interface, so the same UI
runs on both ledgers. Pure rules — flow steps, tenders, dates, family grouping,
the attempt record — live in `src/modules/collect/domain/` with no database
import.

## Switches that decide whether money can move

| Switch | Where | Effect |
|---|---|---|
| `fees:collect` permission | `requirePermission` in the page; `assertPermission` in each action | no permission, no screen and no action |
| `usesCanonicalFees` | `src/platform/fees-bridge/policy.ts` | real staff on a real session go to the bridge; everyone else is local/TEST |
| `FEES_BRIDGE_ENABLED`, `FEES_BRIDGE_WRITES_ENABLED` | env, read in `policy.ts` | bridge posting needs both; `isConfinedDeployment()` forces writes off on Preview/local |
| previewing ("view as") | `getViewer()` | `canPost` is false while previewing another staff member |
| Fees actor grant + DB gates | Fees `private.one_bridge_grants`, `one_bridge_config.commands_enabled` | Fees refuses even if One allows (see Fees `docs/modules/one-bridge.md`) |
| `app_settings.fee_writes_enabled` | One DB, local adapter path | fee writes in One's own database |

## Lost answers and retries

Nothing in `collect-actions.ts` retries. Every post carries a `commandId`
(sent as `client_request_id`). A timeout or unreadable answer comes back as
`uncertain`; the screen then asks `status` with **the same id**, and Fees'
`GET /commands/:id` answers with the committed outcome or `not_found`. The attempt
is stored client-side (`src/modules/collect/domain/attempt.ts`) so a reload
does not lose it. Never generate a fresh id to "try again": that is how one
payment becomes two receipts.

## Tests to run when you touch this

| Area | Tests |
|---|---|
| Collect domain + bridge contract | `tests/collect/collect-domain.test.ts`, `tests/collect/collect-bridge-contract.test.ts` |
| Bridge client/policy/transport | `tests/fees-bridge-client.test.ts`, `tests/fees-bridge-policy.test.ts`, `tests/fees-bridge-transport.test.ts`, `tests/fees-bridge-acceptance.test.ts` |
| Ownership fences | `tests/architecture.test.ts` |
| Payment UI (synthetic browser) | `tests/playwright/payment-ui.playwright.config.ts` (CI: `payment-parity-ui.yml`), `operations-fee-collector` in `phone-operations-ui.yml` |

`npx vitest run tests/collect tests/fees-bridge-` runs the unit layer in seconds.
None of these needs a database or a Fees deployment.
