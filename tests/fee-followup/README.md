# Targeted fee follow-up

This is a separate synthetic suite for IMP06/04 gaps. It renders the current
PaymentDesk in Chromium mobile emulation with touch at 360/390/412 × 844.
It creates no database/auth fixture and imports no executable server action.
Phone emulation is not physical-device evidence.

| Journey | Cases | Expected effect and UI |
| --- | ---: | --- |
| Cash / UPI / bank transfer / cheque | 12 | Reference normalization, cheque clearing remarks, review before receipt, collector correction controls absent |
| Custom advance + concession + late waiver | 3 | Required reason blocks review; 3500 cash + 200 concession + 1000 waiver leaves 300; late money remains separate |
| EMI | 3 | Monthly/catch-up/full-plan shortcuts, editable custom amount, concession and waiver restricted |
| Backdate | 3 | Before-session/future dates block review; authoritative earlier-date preview omits late fee; 3500 leaves 500 |
| Admin reversal | 3 | Reason required; one retained receipt plus one distinct reversal record; removal control disappears |
| Offline / reconnect / uncertain reload | 3 | Offline transport creates zero effects; reconnect checks not-saved; same request commits once, survives reload and recovers once |

Every journey starts with zero financial effect items, verifies review is still
zero, and requires exactly one effect after confirmation. The oracle stores one
atomic localStorage item per request UUID. Attempt/check/preview diagnostics and
reversal records use separate namespaces and cannot satisfy the receipt count.
Fixed-fixture balance arithmetic does not reuse the product settlement walker.

The transport stub refuses `navigator.onLine === false` before creating an
effect and otherwise uses a locally routed endpoint. A post-commit fault and a
held lookup model uncertainty. This validates the client contract, not actual
database, provider, network or bank processing. Synthetic phone fields are NULL;
external requests are blocked and any message action fails the zero-dispatch
oracle. No physical printer or message delivery is tested.

Run only after the coordinator grants the serialized browser slot:

```powershell
node node_modules/playwright/cli.js test --config tests/playwright/fee-followup.playwright.config.ts
```

Default evidence: `.test-artifacts/fee-followup/results.json`, failure traces,
screenshots and per-test synthetic ledger attachments. Override with
`FEE_FOLLOWUP_EVIDENCE_DIR`; optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an
already installed matching Chromium. Do not reuse genuine receipt request IDs.

The config builds a static fixture before serving it, so Vite HMR cannot reload
the client on reconnect. `index.html` includes the real shell's `#vx-layer`
portal contract for receipt correction dialogs and toasts.

Observed local acceptance on main `3d5b767`: a complete run passed 24 cases and
failed three reversal cases because the first fixture lacked that portal host
(161.672 seconds). After restoring the host, the three reversal-only cases
passed (20.239 seconds). All 27 journeys therefore have passing evidence across
these two runs; this is not a claim of one final 27/27 run. Earlier bank/receipt
locator failures are retained in private coordinator evidence. No payment
product file changed, and no product defect was reproduced by this follow-up.

Not covered here: genuine DEV posting/reconciliation, backend forged-role
denials, bank/cheque clearing, multi-installment EMI lifecycle administration,
unlimited over-ledger credit, real provider delivery or physical phones.
