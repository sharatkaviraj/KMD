# Student profile redesign evidence

Base: `62a513ae5e2fe937f2b2d09e70b8cb618a8c6839` (main, #82). Isolated branch: `codex/student-profile-redesign`.

Implementation commit: `73493b314257b33094a6f426c5bbe3f80bf3d81c`. [PR #83](https://github.com/veerpatta/vppsone/pull/83) records the final merge SHA, CI checks and deployment checkpoint; its description is updated after verification.

## Behavior

- 96px private portrait, readable student identity and initials fallback for missing/failed/unauthorized photos.
- Overview, Learning, Fees and More retain every permitted legacy `?tab=` link, `returnTo`, directory filters/scroll, browser Back/Forward and the existing Payment Desk URL.
- Overview uses recorded attendance, provisional-aware learning results, recorded strengths and explicit support follow-ups. No inferred weakness or invented development metrics.
- Due-now fees, upcoming dues and late fees remain distinct; monetary receipts and concessions remain distinct. Fee calculations and source adapters are unchanged. Secondary statement, sibling, note, document and history destinations remain reachable.
- Teachers retain class scope and finance exclusion. Accountants/collectors retain their existing fee workspace. Private-photo permissions are unchanged and photo stores are not combined.
- Keyboard focus, 44px/48px navigation targets, reduced motion and unavailable/empty states are covered by synthetic tests.

## Verification on CPC

Passed before release: full unit suite (164 files, 12,766 tests); targeted additional record-read/scope/contact/stream tests (27); typecheck with a 4GB heap; lint (zero errors, nine existing warnings); port import check (729 files); theme parity (430 tokens); profile/navigation browser suite (29); Payment Desk draft browser suite (4).

The final mobile/touch profile suite passed 27 cases, including light/dark accessibility; sibling navigation passed all three phone sizes. Production build and its TypeScript pass completed with CI-only configuration and no database credentials. All eight route bundle budgets passed. Final calendar/read regression tests passed 23 cases and finalized source/test lint had no errors or warnings. GitHub CI and deployment identity are recorded in the release checkpoint after they complete. No authenticated production profile or physical-device acceptance is claimed by synthetic tests.

Initial failures fixed: fee-error metadata overwrote school-read metadata; scoped profile could fall back to an old class; contact/assessment-placement/history-metadata errors could appear empty; calendar failures could infer day cells; primary Payment Desk text inherited an insufficient-contrast anchor color. Independent read-only review reports no remaining blocking findings.

Windows validation constraints resolved: Next native canonicalization required running outside the filesystem sandbox; default Node heap exhausted, then typecheck passed with 4GB; npm 12 required allowing the existing locked remote SheetJS tarball with lifecycle scripts disabled. Neither dependencies nor lockfile were changed.

Library prepared screenshot transfer was attempted with the current skill helper and reported unavailable in this execution context; no upload succeeded. Safe screenshot files are retained below and in the repository. No student data was accessed to create them.

## Synthetic screenshots

- [Overview, 390px](overview-390.png)
- [Overview, 320px](overview-320.png)
- [Fees, 320px](fees-320.png)
- [Notes restored after browser Back](notes-restored-phone.png)

All names, observations, phone values, photos and amounts in these screenshots are synthetic. The portrait is an abstract SVG fixture.

## Boundaries

No school database writes, migrations, protected LIVE schoolfees changes or third-party messages. Release was initially withheld, then explicitly authorized by the user. The established process is a draft PR, required green checks, merge to main and automatic Vercel deployment.
