# Review plan finish: completion matrix (4 November 2026)

The deliverable for the owner's 3 Nov instruction "finish the review plan and
build a safe, low-cost MCP". It has one row for each requirement ID in the
3 Nov review PDF (T01–M03). This file updates the 3 Nov audit matrix, taken at
`d779f52e`, with every PR merged or opened since. Every fact comes from a PR
body, a merge commit, a deployment record or a live check named below. When
there is no source, the cell says **not verified**. Owner decisions are in
`docs/plans/2026-11-03-mcp-feasibility.md` §9, and the decisions made here are
D-384–D-398 in `docs/DECISIONS.md`.

**Status key.** The status column uses five values. A bracket after the status
says what kind of check exists.

| Status | Meaning |
|---|---|
| `verified` | The code exists and a test exercises the requested behaviour. If the row names a live check, that check passed too |
| `implemented-unverified` | The code exists, but the deciding check is missing: a live run, a device, a provider connection or a test |
| `partial` | Part of the outcome is not built, or a target is not met |
| `not built` | Nothing has been built yet |
| `blocked` | The work waits on the owner, an account, a device or real data |

**Owner column.** The owner column says who closes the remaining gap.

| Owner | Who it is |
|---|---|
| Dev | Engineering in this repo |
| Fees | A change in `veerpatta/schoolfees` |
| Owner | Raj: a decision, an account or a device |

**Deployments.** All of these were READY at the time of writing.

| Name in this file | Deployment | What it contains |
|---|---|---|
| **One-prod** | `dpl_8x7BSjdNoNMz9TFuQmQowcsQ1Zma` at `eb9631e8` | Every merged One PR below |
| **Fees-prod** | `dpl_2c62oJTDoC6gWuE9dJCrG6w8GzGm` at `4079ff00` | Fees #135 and #137 |

**Live checks.** Every live check was made on 3–4 Nov on one.vpps.co.in, in
desktop Chrome, signed in as an admin, and measured timings only. None created
a record or sent a message. No other limits apply to these checks:

- No Android or other real device was available.
- No other role's login was used, because the agent may not enter passwords.

**CI.** These are the check results at the time of writing.

| PRs | Checks |
|---|---|
| Merged One PRs #174–#182, #184 and #179 | All green, 25–26 checks each. #179's run includes `single-use-locks`, its two-connection SQL proof on PostgreSQL 17 |
| One #183 and #185 (open) | Green |
| One #186 (open) | `check` was still pending |
| Fees #138 (open) | `scan` fails: `scan.rounding-policy-mixed` has 5 findings against a budget of 4 |

## Matrix

| ID | Requested outcome | Implementation evidence | Verification evidence | Remaining gap | Owner | Status | Deployment |
|---|---|---|---|---|---|---|---|
| T01 | School crest instead of "VP"; works cached and uncached; accessible name; fallback | `Crest` (#167 `ca58c86f`). #180 `157dd7a0` makes `system/crest.tsx` a client component: if the logo fails to load (`onError`), the tile shows the serif "VP" monogram. It is named only where it is the only school identity (Today phone hero, exam office header) and is decorative elsewhere. The exam header and results card now draw the crest | `tests/vx-crest.test.tsx`. Live, desktop: the crest loads at 32 px. The hidden phone-header copy is lazy and is not fetched while hidden | Cold-cache loading and Android rendering are not verified | Dev; Owner (device) | verified (unit + desktop live) | One-prod |
| T02 | Today's fee figures from the canonical source, with an as-of time and a retry for each card; never 0 on failure | Fees `/summary/today` behind `FEES_BRIDGE_OFFICE_READS` (#169, #170; D-379–D-381). The env inventory records the switch as set on One production (`0ed96815`) | Live, as of 11:38 pm on 3 Nov: Today showed ₹38,125, 5 receipts, bank ₹23,125 (3) and cash ₹15,000 (2). This matched Fees' own read exactly. Tests: `tests/fees-office-reads.test.ts`, `tests/fees-bridge-transport.test.ts` | No test renders the card in its ok, failed and forbidden states. The comparison covered one day and one role | Dev | verified (live, admin) | One-prod |
| T03 | Loading, empty, failed and populated look different; a failed read never says "All clear"; a retry on each card | `settleParts` and `PartialReadError`; `CouldNotRead` with Try again (#167, D-365) | `tests/mobile-ui/today-honest-states.spec.ts` (harness at 390 and 1280 px) | Permission combinations, timeouts and denied responses are not forced. No failure was forced live | Dev | verified (harness) | One-prod |
| S01 | One authorised search by name, parents, phone, SR or receipt, with a match reason; race-safe; target warm p95 ≤ 500 ms | #175 `ee2fe796`: the answer no longer reads the child's whole workspace. The typed-receipt lookup runs in parallel. On a phone, receipt cards load after the names and are dropped if the words changed. #177 `02cc89eb` with Fees #135 `75b4132a`: search uses `/directory/lookup` (page 1, at most 10 rows, no counts or totals) | Tests: `tests/vx-search-actions.test.ts`, `tests/vx-palette-child-receipts.test.tsx`, `tests/fees-bridge-transport.test.ts`. Live server action, before: 3.8 s and 3.6 s for first queries, 1.4 s for a repeat. After #175 and #177: 5.4 s for the first query after a deploy (cold), 1.36–2.2 s for first-time terms, 0.58–0.68 s for repeats | **The 500 ms target is not met.** The remaining cost is in Fees' call chain: actor verification against One's Auth, read-context RPCs and enrichment (Fees #138 analysis). Cold starts add to it. The examples named in the PDF were not checked | Dev + Fees | partial | One-prod; Fees-prod |
| S02 | Honest directory transition; stale rows cannot be tapped; consistent count; back and query kept; a real speed-up | UI: "Updating results…" and dimmed stale rows (#168, D-372). Timing: one log line per bridge call, route shape only (#182 `45436075`). Speed: One #185 with Fees #138. The missing-field walk drops from 11 full `/directory` calls to 1 full call plus 5 rows-only `/directory/rows` calls. Fees adds timing for each phase | Live: a plain `/students` makes one `/directory` call of 0.47–2.7 s. With a missing-field filter, one request made 11 calls: 0.69 s, then batches of about 1.8–1.9 s, 0.85–1.0 s and 0.43–0.5 s. `v_student_directory` takes 7 ms warm and 290 ms cold (read-only `EXPLAIN ANALYZE`), so the cost is in the call chain. #185's tests (`missing-directory-walk`, `fees-bridge-student-directory`, `fees-bridge-directory-rows`) are on its branch | Merge and deploy Fees #138, then One #185. #138's `scan` check fails. There is no measurement after the change, and Fees' phase timing is not deployed. Cancellation and the updating label have no test | Dev + Fees | partial | Not deployed (#185 and Fees #138 open) |
| S03 | A labelled Filters button with a count; a grouped sheet; apply and clear; summary chips | #168 (D-372) | `tests/operations-admin/admin-mobile.spec.ts` (phone sheet, combined filters, removing chips); phone CI green | The desktop popover, Clear/reset and the keyboard path are untested | Dev | verified (phone harness) | One-prod |
| P01 | The profile opens without a double refresh, flicker or a flash of the wrong student | One card stays mounted (`useSettled`) and keeps its thumbnail (#168, D-370). Since #184, the fee part comes from parallel section reads; the UI is unchanged | `tests/student360-stream-recovery.test.tsx` (the same DOM node across the fee arrival). The Student 360 phone suites are green on #184 | Not reproduced on Android (no device). Duplicate requests are not instrumented | Owner (device); Dev | implemented-unverified | One-prod |
| P02 | Split the oversized, uncached workspace read; bounded payloads; safe invalidation; a before/after benchmark | Fees #137 `4079ff00` adds six single-purpose reads: `/students/:id/{fees,receipts,ledger,finance-history,household,history}`. They use the same grant and pins, money stays uncached, and the workspace route is kept for one release. One #184 `fc59f2d5`: Student 360 reads only the sections the role allows, in parallel. Palette receipts read 2 rows. `composeStudentView` refuses sections that disagree | Fees' read-budget test, palette receipts: 49 queries / 136 KB before, 5 queries / 1.1 KB after. Admin profile: ~59 queries / ~137 KB in 6 parallel reads, against 49 / 136 KB in one. One tests: `fees-bridge-student-callers`, `fees-bridge-student-reads`, transport. Live before: workspace 0.44–1.4 s typical, with two outliers of 12 s. After Fees #137 and before One #184: the old workspace path, now built from sections, answered 200 in 1.0 s with 87 kB. After #184, first sample: the six section reads took 1.44–1.78 s each, and the whole page took 4.3 s on a just-started server | **The latency effect is not established.** There is one sample, on a cold server. Next: take warm samples on several profiles and sessions, and revert #184 if it is slower (D-389). Remove the unused workspace path after one release | Dev | implemented-unverified | One-prod; Fees-prod |
| P03 | Never "Bus · No transport" | `shownTransportLabel` (#167, D-369) | None: no test references it | A unit test is missing. The real transport states were not checked | Dev | implemented-unverified | One-prod |
| P04 | Full-screen photo viewer with pinch and pan, authorised Save, Back/Escape and focus | `photo-viewer.tsx` (#168, D-371) | `tests/student360-compact.test.ts` (zoom maths, filename). The stream-recovery test opens the viewer and closes it with Escape | Android gestures, the hardware Back button, the download and the failure state are not checked | Owner (device); Dev | implemented-unverified | One-prod |
| P05 | Concessions lead with what applies; detail is folded; nothing is lost | `appliedConcessions` and "How this fee is worked out" (#168, D-373) | `tests/student360-compact.test.ts` (the summary only) | Populated real records and the empty and permission-restricted renders were not compared | Dev | implemented-unverified | One-prod |
| P06 | Compact household contacts; histories folded with counts; restrictions always visible | Contact cards, a number for each parent and the masking fix (#168, D-373/D-374) | Harness screenshots only | No test checks that do-not-call, pause and no-contact stay unfolded. Long and multiple families are not checked | Dev | implemented-unverified | One-prod |
| P07 | Keep Documents and History working; do not call empty Marks or Notes broken | Neither screen changed. Since #184, History reads `/students/:id/history` with the same shape | `tests/mobile-ui/student-documents.spec.ts`; Student 360 phone specs green on #184 | The optional "missing essentials" grouping suggestion is not done | Dev | verified (preservation, harness) | One-prod |
| F01 | Everything done in Fees is available in One over the canonical ledger, with the same permissions and audit | Earlier PRs (#169–#171): reads, the payment desk, the day book, receipt view, print and PDF, reversal and refunds. #178 `04bf7a90` changed four things. The desk's saved receipt opens in One. Finance hub Receipts stays in One. The day book no longer offers "Close a day … in Fees". The receipt's Fees button appears only for what Fees allows. Held: sending a receipt on WhatsApp from One through Fees' outbox (One #183 with Fees #136) | #178: `fees-receipt-source`, `fees-day-book-parity`, `fees-bridge-live-desk`. #183 and #136 have unit and migration tests. Two independent reviews were made, and their fixes applied | See [F01: what still leaves One](#f01-what-still-leaves-one). Receipt send waits for the Fees migration. Manual day close exists in neither app (D-383, D-397). No live reversal or refund has been made by a signed-in admin | Dev + Fees; Owner (day close, grants) | partial | One-prod; #183 and Fees #136 open |
| F02 | Receipt links resolve canonically; unavailable states are explained; historical and multi-session navigation | #178: a link first tries the year it names. It then tries the person's year, the active year and the other real years: at most 4, never TEST. It redirects to the year that answered. A Fees outage or a mismatch stops the search, and a number-only link uses the active year | `tests/fees-bridge-native-receipt.test.tsx` (multi-year cases), `tests/fees-receipt-source.test.ts` | Previous-year navigation was not tried live. The public `/rv/` redirect to Fees `/r/` has not been revisited since the 3 Nov audit | Dev | verified (unit) | One-prod |
| F03 | Fees receipt template, logo and signature; print and PDF match Fees | Ported template, strict adapter and the PDF in One (#169, D-375). #178: the paper inherits Fees' 16px/1.5. The templates, PDF renderer, logo, signature, icon and fonts are identical (sha256) | `tests/bridge-receipt-print.test.ts`, `tests/fees-receipt-source.test.ts` | No side-by-side comparison with Fees' live print and PDF. The colours differ by the 2026-10-05 branding decision (Owner). For a child with receipts in two years, "paid before / balance after" can differ from Fees; the fix belongs in Fees | Dev + Fees; Owner (colours) | implemented-unverified | One-prod |
| N01 | Explicit selection; compatible groups only; review; a result for each item; retry failed items only | `inbox-batch*` (#169, D-376). Since #180, batch rows draw `SaveMark` | `tests/inbox-batch.test.tsx` | Concurrent decisions, a permission change mid-batch and a double tap are untested. No live run, because it would decide real requests | Dev | verified (component) | One-prod |
| N02 | The tick and removal come only after the server confirms; failures stay with a retry | #180: a single Needs you decision stays in the list ("Will send in a moment · Undo", then "Sending…"). The tick comes only on `acknowledge`. A failure shows a line with Try again, which resends the same command id | `tests/inbox-delivery.test.tsx`, `tests/vx-save-status.test.tsx`; phone CI green | No live run, because it would decide real requests | Dev | verified (component) | One-prod |
| N03 | Assign Work: create → assign → recipient view → complete → coordinator review | Children missing from the roster are left out and counted (#167, D-366) | Production log evidence only | The full lifecycle and cross-role permissions were not exercised: it would create real tasks, and there are no other role logins. No regression test | Owner (logins); Dev | implemented-unverified | One-prod |
| U01 | One saving / saved / could not save / retry vocabulary across roles; never success before confirmation; fix the picker focus first | #174 `bcfc5881`: the `?loading` fixture stays loading, the assertion is unchanged and a late-arrival test is added. #180 adds `SaveStatus`, `SaveMark` and `useSlowSave` (`role=status`/`alert`, reduced-motion safe, TEST mark). They are used in Needs you, batch decisions, attendance register save and the note composer. #181's guided cover follows the same rule | `tests/vx-save-status.test.tsx`, `attendance-save-line`, `notes-save-line`, `inbox-delivery`. The `one-polish` phone job is green on every later PR | Not yet adopted: the payment desk, office commands, the ported fee screens (`useActionFeedback` and sonner) and fleeting toasts elsewhere. No per-role audit of accountant and coordinators (no logins) | Dev | partial | One-prod |
| A01 | Explain eligible, already reminded, no class teacher and away; say queued, not sent; totals reconcile | `reminderBreakdown` (#169, D-377) | `tests/vx-attendance-why.test.ts` | Delivery status after queueing is not shown. No live reconciliation, because a live reminder sends real staff WhatsApp messages | Dev | verified (logic) | One-prod |
| C01 | Guided flow: date and absent teacher or periods → lessons → eligible substitutes → clash and workload → review → explicit Confirm; partial days; concurrency | #181 `b0f49acb` adds `/substitutions/arrange` in four steps. `planCoverDay` writes nothing; `arrangeDay` commits through `commit_cover_command`. Confirm sends the day revision and a fingerprint of the plan (`stale` / `plan_changed`). A lost answer is checked by the same command id. "Mark away" and the inline "Assign" no longer save directly. The review lists WhatsApp notices and their cost and reports them as queued | `tests/guided-cover.test.ts`, `guided-cover-actions`, `guided-cover-screen` (jsdom), `tests/mobile-ui/guided-cover.spec.ts` (320/360/390/1280 px, Hindi); CI green | Operators remain admin and academic coordinator (`substitutions:manage` is not widened). No live run, because it would create cover records and staff WhatsApp. Release, Back at school and Arrange again are still one tap. The `?draft=` entry is a stub | Dev; Owner (who else may arrange cover) | verified (harness) | One-prod |
| M01 | Teacher or admin AI connection under their own One identity, with scope and audit enforced on the server | #179 `eb9631e8`: One's own OAuth 2.1 authorization server and a stateless, read-only MCP at `/api/mcp`. The portable core is `src/modules/mcp/domain`. Five read tools; every call re-runs the checks; metadata-only `ai_tool_calls` kept 180 days. Prerequisites: #176 `678add9a`. Migration `20261104022925_ai_connection_mcp` applied | Tests: `tests/mcp/*` (oauth, transport, pipeline, registry, card, migration, verified-actor); `tests/sql/ai-connection.mjs` (PGlite); `ai-connection-locks.py` (PostgreSQL 17). An independent review found no critical or high findings, 2 medium and 7 low; all were fixed before merge. Live: the database shows RLS on, no browser grants, functions for service_role only and the switch off. The discovery documents are correct. An unauthenticated call gets 401 with `WWW-Authenticate` | The switch is OFF and no provider has connected (M0 tests, §c). Teachers are not eligible (D7) until class-scoped reads exist and the D4 notice check is done. No drafts | Owner (M0 accounts); Dev | implemented-unverified | One-prod |
| M02 | Substitution drafts from a photo, text or voice via AI: validated, previewed and committed by the operator | Not built. Only groundwork exists: the `planCoverDay` compute half and the `/substitutions/arrange?draft=<id>` entry (`loadCoverDraft` returns null) (#181). Every MCP tool is read-only | None | A draft store, a draft tool and the review-and-Save path (feasibility phase M3, after the admin pilot) | Dev | not built | None |
| M03 | Connect Claude or ChatGPT from One, with honest status, reconnect and a kill switch | #179: Settings → AI assistant connection has the switch, every connection and Disconnect for any of them. The Preferences card has truthful states, the address and Disconnect for one's own. Disabling a login revokes its connections. #186 (open, auto-merge) adds a status line on Today and Copy address, for eligible staff only | `tests/mcp/card.test.ts`; `tests/mcp/connection-strip.test.tsx` (#186) | No provider has been tested. Reconnect after expiry or re-consent is untested live. ChatGPT needs a supporting paid workspace, which is not confirmed to exist | Owner (accounts) | blocked (built; waits for the provider test) | One-prod; #186 open |

### F01: what still leaves One

This table uses the 3 Nov inventory, with the changes from #178 and #183
applied.

| Capability | State in One |
|---|---|
| Student dues, money read, receipts list and day book, receipt view/print/PDF, collection, late-fee waiver, reversal, refund decide and post, Today figures | In One (earlier PRs). #178 keeps the desk's saved receipt and Finance hub Receipts in One |
| Send a receipt or a reversal notice on WhatsApp | Built but held: #183 with Fees #136. Until then, the receipt keeps a Fees exit for people Fees lets send |
| Dues and defaulters, statements, reminders and campaigns, reports and exports, finance controls and books, write-offs, corrections queue, reconciliation | Fees only (redirected) |
| Concession and fee-plan edits; student create, edit, photo and bulk update; configuration | Fees only (redirected) |
| Online (Razorpay) payments | Fees only |
| Bulk or old-paper payment entry | Not verified under the connection |
| Manual day close | In neither app. The nightly Fees job closes each day (D-383, D-397) |
| Public receipt verification `/rv/` | Redirects real receipts to Fees `/r/`. Not revisited |

## (a) Architecture note (D5) and free-tier hosting assessment

Decision D-384 places the MCP inside One, built over a portable core.

| Option | What it would be | Verdict and reason |
|---|---|---|
| **A. Inside One (chosen)** | Next.js route handlers on One's Vercel project, over `src/modules/mcp/domain` (Web `Request` → `Response`, Web Crypto, zod, an injected store, staff, session and readers; no Next.js, Supabase, Node built-ins or `process.env`). Token authority is One's Postgres (`vppsone.ai_*`, service role only, row and advisory locks) | Every tool must run One's own permission and scope code against One's database. This option needs no new secret, env var, domain or plan. Single-use codes, refresh rotation and immediate revocation are atomic in SQL |
| B. Cloudflare Workers Free gateway | A Worker in front that proxies to One's adapters | Evaluated, not deployed. It would add a hop, a new gateway↔One shared secret (a new persistent credential) and a second deploy, and it would not remove the dependency on Vercel. KV is eventually consistent, so it cannot be the token authority. D1 or a Durable Object would duplicate One's authority |
| C. Supabase Auth OAuth server | Supabase's tokens held by the provider | Not used. Its tokens are the ordinary session (`aud: authenticated`), with no custom scopes and no binding to the MCP address (feasibility §2.3) |

**Hosting caveat.** The owner's Vercel Pro is for this month only. When One's
hosting moves, the MCP moves with it. The core is portable, so moving it to
Workers is possible later. That move first needs a measurement of the handler's
CPU time against the Workers Free limits recorded in feasibility §8.2 (read
3 Nov):

- 100,000 requests a day
- 10 ms of CPU per request
- 128 MB of memory
- 50 subrequests per request

Vercel Hobby is for personal, non-commercial use, so it is not a fallback.

**Measurements.** These were taken on 4 Nov from India against `bom1`, without
authentication.

| Measure | Value |
|---|---|
| `POST /api/mcp` without a token → 401 | Median 95 ms (77–141 ms, n = 12) |
| Discovery metadata (`/.well-known/oauth-*`) | About 100 ms |
| An authenticated tool call | Not measured: no provider has connected |
| Handler CPU time for each call | Not measured. It is needed before any move to Workers |

**Capacity.** The design caps each staff member at 60 calls an hour and 400 a
day. Registration is capped at 5 new clients per source per hour and 100 per
hour per environment. Today only admins are eligible; their count is not
verified here. Under Workers Free's 100,000 requests a day, 250 staff could
each use the full daily cap. That is arithmetic only: CPU time is the
unmeasured limit.

**Cost.** This adds no recurring cost: no new service, secret, domain or
plan. MCP calls use One's existing Vercel functions and Supabase database. The
per-staff limits bound how much of that capacity they can take.

**What happens when a limit or a dependency fails.**

| Event | MCP behaviour | Native One |
|---|---|---|
| A staff member reaches the hourly or daily limit | The tool is refused as `rate_limited`, with at most one log row an hour and no data. The limit is approximate under concurrent calls | Unaffected |
| The registration ceiling is reached | New clients are refused. Existing connections keep working | Unaffected |
| The kill switch is off, absent or unreadable | Every tool and every refresh is refused. Nothing is consumed or revoked | Unaffected |
| A database, store or permission-matrix read fails | 503: the call fails closed and nothing is guessed | Same database, so One degrades too |
| One's Vercel deployment is down | The MCP is down too, because it lives inside One | The same outage |
| If moved to Workers Free and over 100,000 a day or 10 ms of CPU | Expected: requests fail until the reset. This was not tested | Unaffected if One is hosted elsewhere |

## (b) Provider compatibility and onboarding

| Capability | Claude | ChatGPT |
|---|---|---|
| Server side: discovery documents and the 401 challenge | Verified against One-prod | Same server; verified |
| Callback URI accepted | `https://claude.ai/api/mcp/auth_callback` is from Anthropic's docs and was not observed in a live connection. `claude.com` is deliberately not accepted until it is observed | `https://chatgpt.com/connector_platform_oauth_redirect` is from OpenAI's docs and was not observed in a live connection |
| Plan support (provider docs, feasibility §2) | Free: one custom connector. Pro, Max, Team and Enterprise: yes. On Team, only an Owner adds it | Full MCP on Business, Enterprise and Edu. Pro: read/fetch only. Free and Plus are not established |
| Account available to test | The owner's own account. **Not yet connected**: the owner will connect it himself | **No supporting paid workspace confirmed** |
| End to end: connect, use the read tools, refresh, revoke | Not run | Not run |
| Adding the connector from a mobile app | Undocumented (C3); not tested | Unknown (G4) |
| Write or draft tools | None exposed (M1 is read-only) | None exposed |

**Onboarding (honest steps).**

- **Before anyone can use it:**
  1. An admin who is not a test account turns the switch on in One, under
     Settings → AI assistant connection.
  2. The person must be eligible. Today that means admins only (D7).
- **Claude:**
  1. In Claude, open Settings → Connectors.
  2. Choose Add custom connector.
  3. Paste `https://one.vpps.co.in/api/mcp`.
  4. Claude opens One. Sign in with your own One account and approve.

  The feasibility doc (C3) recorded the web path as *Customize › Connectors* on
  3 Nov. Menu names move, so confirm the path in M0. A Free account holds one
  custom connector.
- **ChatGPT:** this needs a workspace whose plan supports custom MCP servers.
  OpenAI's current help names Business, Enterprise and Edu (Plugins → Add
  custom MCP server). No such workspace is confirmed. Until one is, ChatGPT is
  not offered as working.
- **No one-tap URL.** A prefilled Claude dialog link is documented (C14), but
  the user still confirms it and signs in. It is untested and is not offered in
  One until M0 verifies it. No ChatGPT equivalent has been verified.

## (c) Staged admin → teacher rollout checklist

These steps come from feasibility §8.3 and the "Mandatory M0 provider tests"
in `docs/plans/2026-11-03-mcp-m1-security-contract.md`. For every stage,
record the commit, the deployment, the provider and account tier, the date and
the observed capability. Never put real pupil data in fixtures, screenshots or
logs.

**Stage 0: M0 provider tests (admin accounts only, TEST or synthetic data).**
Tools are refused while the switch is off (contract #20). Steps 4–6 therefore
need the switch on: keep that window short and record when it was on.

- [ ] 1. Forwarded consent link, using two accounts. Start "Add connector" in
  Claude account A and stop at One's consent page. Open that URL in a browser
  where Claude account B, or no Claude account, is signed in. Sign in to One as
  an admin and press Allow. **Pass:** A gets no working connection, and One's
  admin list shows no live connection (at most a pending grant that is never
  redeemed). If it fails, do not enable the switch: record the result and raise
  it. Repeat for ChatGPT once a workspace exists.
- [ ] 2. Record the exact callback each provider sends. Add `claude.com` or
  ChatGPT's per-server URI only if it is observed, as an exact constant.
- [ ] 3. Registration volume: does real onboarding reach 5 new clients per
  source per hour from Anthropic's range (`160.79.104.0/21`)? Raise the limit
  only with that measurement.
- [ ] 4. Run end to end on the actual accounts: connect, the five read tools,
  refresh, revoke, a disabled staff member denied, the switch off and on, and
  Disconnect (own and admin).
- [ ] 5. Every non-admin is refused at consent and on each call. TEST is
  refused to every non-admin, including while previewing a role.
- [ ] 6. Measure the latency of an authenticated tool call. Confirm native One
  is not slowed when the MCP is off.

**Stage 1: M1 admin pilot.**

- [ ] The switch is on for named admins only. Watch the metadata in
  `ai_tool_calls` and check that `ai-connection-purge` (22:15 UTC) runs.
- [ ] Check the 90-day re-consent and refresh-replay behaviour, and that the
  Reconnect state is clear.
- [ ] Run the pilot for at least 2 weeks before Stage 2.

**Stage 2: M2 teacher reads (gates).**

- [ ] The D4 check: the admission notice covers the named providers, the
  purpose, the data categories, and the training and retention settings of
  personal accounts. This is the owner's assertion, and it is not yet verified.
- [ ] An explicit field policy for each tool. Class-scoped twins replace the
  current `readsEveryClass` requirement.
- [ ] Tests across roles, classes, sessions and fields, demotion and
  reassignment, and tampered IDs.
- [ ] Each provider is proven on an actual teacher account.
- [ ] Then the one-line `AI_CONNECTION_ROLES` change, with guided setup,
  truthful status, Disconnect and limits.

**Stage 3: M3 drafts and human Save.**

- [ ] D6 and D13 apply: native validation, side effects disclosed before Save,
  concurrency, idempotency, duplicate drafts and a stale human Save. No direct
  model commits: M4 stays deferred.

## (d) Open risks and explicit blockers

| # | Item | Kind | Who | Next action |
|---|---|---|---|---|
| 1 | Claude and ChatGPT provider tests (M0), including the forwarded-link test | Blocker for M01/M03 | Owner | The owner connects his own Claude account. The switch stays off until test 1 passes |
| 2 | ChatGPT needs a supporting paid workspace, and none is confirmed | Blocker (ChatGPT) | Owner | Confirm the workspace or keep ChatGPT unoffered. No purchase without the owner's decision |
| 3 | Receipt send: Fees migration `20261103213000` is not applied. It briefly locks the outbox, grants and office commands | Blocker for the F01 send | Dev; Owner | Off-hours: a rolled-back dry-run, then apply, merge Fees #136, check one drain cycle, merge One #183. Then the owner names who gets `can_send_receipt_notice` |
| 4 | S02: Fees #138 must be deployed before One #185. #138's `scan` fails (rounding-policy budget) | Blocker for S02 | Dev + Fees | Fix or justify the finding, merge #138, merge #185, then measure |
| 5 | Search misses its 500 ms target (repeats 0.58–0.68 s, first-time terms 1.36–2.2 s, cold 5.4 s) | Risk | Dev + Fees | Use #138's phase timing to find the dominant step (auth, context RPCs or enrichment) |
| 6 | P02 may be slower for a full-permission open: about 59 queries in 6 reads against 49 in one, and one cold sample of 4.3 s | Risk | Dev | Take warm samples on several profiles and sessions, and revert #184 if slower (D-389) |
| 7 | No Android or real device | Not verifiable here | Owner | Run T01, P01 and P04 on a phone |
| 8 | No logins for other roles. The agent may not enter passwords | Not verifiable here | Owner | Role passes for U01, N03 and T03 |
| 9 | Live N01, N03, A01 and C01 lifecycles would create real records or send staff messages | Not verifiable here | Owner | Run them in TEST with an admin account, or have staff do it |
| 10 | Manual day close is not built (D-383) | Owner decision | Owner | It needs a shared Fees close function before One can offer it |
| 11 | The MCP shares One's hosting and database. Vercel Pro is for this month only | Risk | Owner; Dev | Re-assess hosting with One. Measure CPU before any move to Workers |
| 12 | Strict refresh reuse: a lost refresh response revokes the connection | Accepted risk (contract) | Dev | The user reconnects. Watch how often this happens in the pilot |
| 13 | MCP protocol 2026-07-28 and CIMD are not implemented. JSON only, no SSE | Known limitation | Dev | Revisit if a provider requires them |
| 14 | Two apps can write one fee database (CLAUDE.md overlap) | Standing risk | Dev | Unchanged by this work |
