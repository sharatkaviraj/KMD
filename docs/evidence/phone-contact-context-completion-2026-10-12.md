# Phone contact recovery and sibling context — 12 October 2026

This candidate completes three reproduced P2 findings after the 29 fixes already released in PR77–79. These checks use Chromium touch phone emulation, not physical handsets. Exact candidate/main CI and production receipts are recorded in the pull request and the consolidated Library report after release.

| Finding | Reproduction | Change and acceptance |
| --- | --- | --- |
| FU-CON03: contact uncertainty lost across views | Original characterization checks showed a manually repeated contact after reload/Back/tab context could create a second entry after an uncertain save. PR79's mounted warning did not retain the original attempt across those boundaries. | Reserve a verified contact-only browser record before dispatch, scoped to authenticated staff/session/student. Save and Check reauthorize preview/class access and use the original UUID PK with exact persisted payload readback. Locks/CAS and late-context guards retain uncertain originals and prevent competing tabs from overwriting them. Reload/Back/two tabs/offline/denied storage/unsupported locking/scope changes passed. |
| FU-CON04: expired unsaved agreed date blocks recovery | A stale page accepted an agreed date; the server refused it against current school time. Check returned not-found, but the date stayed disabled and Retry was refused again. Actual action RED performed zero inserts; actual phone RED was preserved separately from a cold-start timeout. | Explicit date-only correction retains the original UUID and immutable other fields, appends a bounded date history before dispatch, and recognizes whichever original/corrected candidate actually persisted. No upsert, historical edit or fresh-ID recovery. Lost correction response and late original winner return the actual stored date. |
| FU-SIB01: sibling Back loses directory filters | At 390px, directory search/class/fee segment/page 2 → primary profile → Family → sibling → localized app Back returned to `/students`. Browser Back/Forward controls passed; zero actions were attempted. | One sibling href now uses the existing sanitized `studentProfileHref(m.id, p.returnTo)`. Actual components with synthetic routing restored the exact original directory at 360/390/412px. |

## Focused verification and independent review

- Contact: 35/35 focused action/storage/calendar tests; 30/30 post-correction phone cases at 360/390/412px and 844×390 landscape. Final phone run began 00:34:09.681 UTC and took 154.404158 seconds, with zero unexpected/skipped/flaky cases. The recovered pre-correction 24-case baseline and original interrupted/no-final-JSON run remain separately recorded.
- Sibling: baseline RED began 00:23:43.938 UTC, 6.667969 seconds; GREEN three widths began 00:25:03.770 UTC, 9.320731 seconds. Native touch/44px app Back, exact URL and browser history controls were checked; zero server actions/external requests.
- Scoped lint, 21 owned-file TypeScript diagnostics and whitespace checks passed. Separate read-only source review found no remaining important findings. Root separately reviewed the sibling href and its result JSON.
- Financial/payment files, schema/grants and recipient-producing workflows were not changed. Physical keyboards, devices and printers remain separate coverage.

## Genuine DEV persisted verification

Exact healthy DEV `wtgxcptmucjerhufzjcf` and an existing active QA admin were verified. The deliberately shared accountant synthetic student was independently tagged; no enrolment or identity was created. A fresh ledger and zero-row preflight preceded the first Save. Screenshots, trace and video were disabled for genuine data.

The first authentication attempt stopped before Save: its ledger contains zero commands and independent SQL confirmed zero contact rows. An auth-only diagnostic proved a local `127.0.0.1`/`localhost` redirect/cookie mismatch; aligning the origin settled sign-in with browser POST disabled. This was test setup, not a product authentication finding.

The guarded resume forwarded the first Save exactly once, verified its row after a server 200, intentionally aborted the response and observed native `ERR_FAILED`. It then stopped on a premature five-second Check closure assertion while the UI was still Saving. That failure is retained as a failed run, not relabeled green.

A new ledger linked to that exact one-row checkpoint restored only its audited recovery record. It checked the original without replaying Save, verified row/creation time unchanged, then performed the one remaining deliberately separate identical contact under a fresh UUID. The 390px continuation passed: start 01:00:29.434 UTC, total 40.782689 seconds, one expected/zero unexpected/skipped/flaky cases. Final independent SQL confirmed:

- Original `2d1d3a24-f0a3-4d64-9d30-4eec554471c4`: persisted once; original Save replay count zero.
- Separate `f9e14bef-861e-415c-8bdc-bf6a72b7be69`: exactly one additional row with the intended identical payload.
- Exactly two contacts for the owned student, correct creator/session/outcome/note; no date/note link changes.
- Global existing staff notices remained 24→24: zero new notices, not a claim that the database had no notices.
- Seven retained fee receipts still totaled ₹36,000 with seven distinct request IDs. No financial write or real transfer occurred in this phase.

The coordinator-owned local server was stopped after verifying PID, command and creation times. Raw temporary authentication logs were removed. Owned `.env.local` remains only until the final deployed read-only checks, then is removed. Business fixtures and audit ledgers are retained; separate destructive fixture-cleanup and PR69 DDL approvals are not bypassed.

## Release and coverage limits

Full exact-head CI/build/budgets, original phone lanes, follow-up phone lanes including the new sibling fixture, provider concurrency, ready/merge/deploy and exact production read-only acceptance remain release gates when this candidate record is written. The pull-request receipt and current consolidated report supersede this historical gate checkpoint.

Browser storage deletion, another device and physical-device lifecycle behavior remain outside the original-record recovery guarantee. Actual production Family→Sibling clicking is blocked by the owned fixture's lack of a family relationship; the three-width component reproduction covers that href, and the deployed check separately verifies real Next profile return context without creating fixtures. Recipient-producing cover writes and the three unapproved PR69 atomic operations remain separate, explicitly blocked coverage.
