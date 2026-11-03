# Android findings: implementation and release evidence

Branch: `codex/android-findings-20261102`.
Base and production inspected on 2 November: `1a88631328c153fc8d13bc5b44eb95d317c3c17f`, deployment `dpl_971X9dA2caCTUcJvy51zaLiJvPRm`.
Fees base: `5ccb966f1395adc9bd17b4e74f13a9cdc7c8a145`.
PR159 session controls, disclosures and sheet motion are retained.

## Findings and changes

| Finding | Reproduction and cause | Change and evidence |
| --- | --- | --- |
| Payment picker identity, P2 | Production report: Galaxy S24 / Android 14 / Chrome, 360x647, TEST search `Te`. Manufactured rows reproduced clipping. At 360px the late-fee money column occupied 186px of a 326px row, with `flex-shrink:0`; identity fell to 48px. The name/metadata were ellipsized. | `desk.tsx` and `paydesk.css` give identity a full grid track and put wrapping money text beneath it. Identity is now 246px in all four 360px cases. No selection or calculation changes. English/Hindi paid, pending, pending+late and late-only rows, long names and large amounts pass text-range bounds and exact student-ID selection at 320/360/390/412/1440px. |
| Password eye, P3 | Synthetic touch reproduced INPUT -> BUTTON focus loss. Independent public baseline inspection also observed One scrollY 3 -> 107 at 360x647; this was Chromium emulation, not native IME evidence. | `login-form.tsx` prevents pointer focus transfer only while editing, snapshots/restores selection after changing type, and retains the same input node. Tab/Enter/Space keep button focus. Labels, validation, next target and failed-login behavior remain. |
| Unnamed academic historical results | The original remote URL was not captured. Real loaders and view, against manufactured rows, reproduced historical marks, absent names and detail denial. This is a fixture reproduction of the reported mechanism, not a new production login/session reproduction. | `data.ts` names the union of the selected class's exam cohort and current roll; `canOpen` uses the unchanged `studentDetail` current-enrolment/class-scope guard. `progress-view.tsx` shows historical results without forbidden detail links. Current attendance/attention stay current-roll only. Class-specific marks cannot be attributed to another class. Per-pupil averaging and absent-as-zero are preserved, including an unequal-paper fixture. |
| Receipt footer, P3 device report | Ordinary list/detail/back fixtures passed before changes. A separate manufactured 40px visual/layout viewport gap reproduced navigation at bottom 647 while the visible edge was 607. This does not establish that the same gap caused the original physical Android screenshot. | `vx.css` positions primary navigation using the existing `--keyboard-offset` published by the one shared viewport provider, independently of safe-area padding. No new listener. Seven fixtures cover normal portrait/landscape sizes, Hindi/English, repeated list/detail/back and restoring the viewport gap to zero. Sheet controls are unchanged. |

Historical marks are retained. The manufactured 394 scored pupil/subject entries remain 394; only the misleading `papers` label becomes `scored entries`. Current roll counts and exam eligibility/enrolment dates are unchanged. No authorization rule or historical-detail access is broadened.

Chrome's [layout and visual viewport documentation](https://developer.chrome.com/blog/viewport-resize-behavior) informed the viewport investigation. The viewport-gap fixture is a controlled model; it is not a claim of a native-device pass.

## Local validation

| Check | Result |
| --- | --- |
| Unit suite | 430 files, 19,256 passed, one existing skipped test |
| Payment UI Chromium | 25 passed, including 10 geometry/selection cases and existing recovery/idempotency cases |
| Login UI Chromium | 10 passed; touch portrait/landscape, middle selection, repeated toggles, typing, keyboard navigation and failed login in English/Hindi |
| Receipt navigation Chromium | 7 passed; ordinary geometry and manufactured viewport gap |
| Typecheck | Passed |
| Lint | Passed with 15 existing warnings |
| Ported import check | 828 files, passed |
| Theme parity | 430 tokens match the Fees checkout |
| Local production build | FAILED: ENOSPC during webpack output. Its PowerShell wrapper reported exit 0 despite the error; this is not build success. |
| Local route bundle check | NOT RUN: no completed local production build |

The initial dependency junction pointed at an older One install. Final unit/type checks use the existing version-matched installation: Next 16.4.3, React 19.2.8, Vite 8.3.5, Vitest 4.1.12, Playwright 1.63.0. No dependency or lockfile was changed. Clean exact-head CI remains required for production build/bundle evidence and WebKit coverage. The new login/receipt suites are in the existing phone follow-up CI matrix.

The first broad payment rerun exposed an added test-introspection property breaking existing exact snapshot assertions; introspection was moved to a separate fixture function and all 25 cases then passed. The plain-Hindi gate rejected an overly formal label; the wording was corrected and the full unit suite reran green. No gate or security verifier was weakened.

The final version-matched login rerun also caught 1–3px of delayed native focus/selection autoscroll in landscape. Event tracing showed that scroll occurred before pointer-down. The test now waits for a stable pre-click baseline, retaining exact post-toggle scroll equality, no blur and unchanged selection; all ten cases passed afterward.

## Coverage and safety limits

- Real Android keyboard persistence and the original browser/navigation-area footer symptom: NOT RUN in this implementation session. The prior BrowserStack session ended and both Smoke Lab runs are revoked. Exact original Chrome versions remain unknown.
- One's original academic remote drilldown URL: unavailable. Only the manufactured loader/view reproduction is claimed.
- Fees authenticated workflows: NOT RUN; secure handoff remains unavailable. Public login/runtime checks are separate from acceptance of internal workflows.
- No new records, migrations, assignments, payments, reversals, messages, provider calls, paid AI or credentials. The existing private TEST note and receipt `TST20261102-0001` were not touched.
- No optional motion/search redesign was added. Bundle/loading impact will use the existing clean CI budgets and public script measurements; these do not measure device latency.

Release commit, exact-head CI, production alias, public runtime and rollback evidence are recorded in the final PR/release report after those stages finish. No stage above implies whole-app acceptance.
