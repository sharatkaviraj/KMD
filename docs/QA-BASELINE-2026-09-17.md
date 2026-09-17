# VPPS One — baseline audit, 2026-09-17

Purpose: ground PLAN revision 2 in current code and exercised behavior.
Application source `0712de6`; deployed target `https://vppsone.vercel.app` using
existing QA accounts on schoolfees-dev. The alias was tested, but its immutable
deployment commit was not independently queried during this baseline. Sibling
source commits: SamPark `830548c`, School Fees `48beb9a6`.

## Executed checks

| Check | Actual result | What it proves / does not prove |
|---|---|---|
| `npm run check` | Exit 0; typegen/typecheck, lint, 28 Vitest files / **1,904 tests passed**, production build succeeded | Baseline compiles and existing tests pass; no new revision-2 implementation tested |
| `$env:APP_ORIGIN='https://vppsone.vercel.app'; npm run smoke:roles` | Exit 0; **36 pages × 6 roles = 216 checked**, all matched map; no missing-fixture lines | Authenticated GET/page-guard consistency against deployed test app; no form mutations or independent product expectations |
| Admin browser session, default desktop viewport then 390×844 | Dashboard, More and Collection opened | Profile/link dashboard, SamPark under More, no fee/app entry visible in inspected navigation |
| Empty collection request submitted in browser | Browser blocked submission; title-en, title-hi and class invalid | Required controls are enforced before submit; no request created |
| Mobile collection overflow probe | `innerWidth=390`, document scroll width 375 | No page-width overflow in this inspected state; does not establish all mobile layouts |
| Teacher browser session, 390×844 | QA Teacher authenticated at `/dashboard`; Teach loaded with no assigned class/periods and one cover assignment | Landing remains generic profile/navigation rather than immediate Today; teacher menu has no Requests entry. This account's current fixture does not exercise a normal class-attendance day |
| Source route/domain comparison | Both sibling source trees and VPPS One navigation, collection, queue, plan/progress inspected | Concrete implementation differences mapped in PARITY; not a full live audit of sibling apps |

The smoke process emitted a Node module-type warning while loading TypeScript;
it did not fail. Record runner module configuration as a low-priority tooling
cleanup; do not change package module type casually without testing scripts.

## Findings to carry into the implementation queue

Priority here is revision-2 product impact, not a claim of production damage.

| ID | Priority / evidence | Finding and reproduction | Expected / task |
|---|---|---|---|
| B-01 | P1 parity gap; browser + source | Admin home/More has no School Fees destination; navigation.ts has no fee/app registry | Explicit original app access on eligible home, R1.1 |
| B-02 | P1 parity gap; source | Native requests accept a single class; no filtered/explicit-list rounds, bulk/master/office equivalent found | Complete S-03–S-06 instead of treating original Phase 5 done as parity, R3 |
| B-03 | P2 UX; browser + source | Admin/teacher `/dashboard` displays email, short name and destinations; both lack operational priorities | Role homes, teacher direct Today, R1.2/R2 |
| B-04 | P2 UX; browser + source | Admin reaches Collect through More; same shared order prioritizes Teach/Cover/Timetable for office-style work | Role-specific order, familiar SamPark name, R1 |
| B-05 | P2 UX; browser | New request requires English and Hindi title fields; empty-submit probe flags both even for a single-language workflow | Author in selected language, optional translated value and explicit fallback, R1.3/R3.2 |
| B-06 | P2 UX; browser + source | Collection class selector orders Class 1, Class 10…Class 12, Class 2; `localeCompare` uses labels | Natural academic class order with nursery stages and streams, R3.2 |
| B-07 | P1 correctness risk; source-confirmed difference, no mutation reproduction | `collection/data/requests-repo.ts` rereads current enrolled class roster and values; SamPark `requests.ts` explicitly freezes issue-time roster/value snapshots | Prove moving a child/editing a value after issue; freeze new rounds and adapt legacy requests, R3.1 |
| B-08 | P1 parity gap; source | SOURCES explicitly says photo capture not ported and workbooks omitted; academic CSV is not original SamPark workbook/photo workflow | Capture/bulk photos and required export parity, R4 |
| B-09 | P1 coverage gap; source | `smoke-roles.mjs` derives expected permission from page's guard; wrong guard may agree with itself | Independent product role matrix plus mutation/class-scope cases, R0.3 |
| B-10 | P1 coverage gap; source | Smoke `fillIds` can return null; loop continues without adding a failure; a partially checked suite can exit 0 | Fail missing fixtures/count mismatch, per-case timeout and machine-readable report, R0.3. No skip occurred in this executed run |
| B-11 | P2 UX; browser + source | Teacher navigation has no request workspace despite public teacher collection links existing | Assigned-request inbox and direct token workflow mapping, R2.1/R3.3 |
| B-12 | P1 recovery hypothesis; source | Attendance queue catches persistent-storage failure and keeps only memory; parseQueue accepts any object as Queue | Test storage-full/reload/malformed shape/account switch; display persistence capability and validate/version draft, R5.1 |
| B-13 | P1 transaction hypothesis; prior progress notes + source architecture | Original progress describes timetable publish and correction approval as sequential writes with known interruption windows | Failure injection/concurrent decisions; atomic RPCs where required, R5.1/R5.2 |
| B-14 | P2 language inconsistency; source | Request reason UI submits `reasonEn` and hidden empty `reasonHi`; fallback can display English to Hindi readers | Language-aware authored reasons and fallback, R3.2; not reproduced with a saved request in this baseline |

## Scope of the evidence

This was a **baseline audit with existing automated checks and selected browser
probes**, not completion of the planned deep workflow suite. No full mutation,
concurrent-save, offline replay, photo, Excel round-trip, fee sandbox, provider,
physical Android/webview or printer matrix was executed here. No benchmark
proves the proposed speed targets yet. No new fixtures or school records were
created by the browser probes. QA sign-in/session activity occurred normally.

Source-only risks above require reproduction before being reported as actual
runtime failures. Existing green tests do not disprove missing product workflows.
New implementation tasks remain todo. Preserve this baseline and write a new
dated report with actual counts as R0/R8 tooling and workflows land.
