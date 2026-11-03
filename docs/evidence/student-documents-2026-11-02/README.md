# Student profile documents — 2 November 2026

User request: simplify the Documents section, fit the surrounding One UI/UX,
brainstorm the options, implement and deploy live. Base `3c9076e`; implementation
`b2334db` plus review fixes on `codex/student-documents-ux`,
[PR #158](https://github.com/veerpatta/vppsone/pull/158).

## Result

Uploaded documents appear first, with a count and persistent Add action. Files
open through the existing private route; removal is separate and confirmed by
filename. Add opens a VX sheet with type selection, keyboard-operable file
picker, optional note, progress and retry. School-issued certificates remain
below uploaded files. Storage provider selection and existing validated byte
transports are reused; no migration or financial/provider change.

The document workspace sits above the profile's fee Suspense boundary so drafts,
retry IDs and active uploads survive a late fee read. Escape belongs to the active
sheet; focus returns to Add. Both-language accounts see paired form labels.

## Executed validation

| Check | Evidence |
| --- | --- |
| Focused action/private file checks | 32 passed; denial, preview and actual-student fences, failure retention, private responses |
| Full unit suite after review fixes | 429 files, 19,232 passed, one existing skip |
| Combined production-component browser suite | 45 passed, including 16 document cases plus existing profile and fee-stream regressions |
| Responsive and accessibility | 320px, 390px and 1280px; light/dark; keyboard; six upload-dialog axe scans; existing profile reduced-motion/axe checks |
| Language | English, Hindi and bilingual labels/choices |
| Recovery | Invalid bytes; unavailable storage; failed reads; failed removal; retry UUID stability; edited metadata gets a new UUID; draft/retry/in-flight state across fee streaming |
| Static checks | Typecheck and changed-file lint pass; full lint has 15 pre-existing warnings; 430 theme tokens match; 828 ported imports pass |
| Synthetic sibling production bundle | Vite build passes after adding the new action boundary stub; fixture never imports live server auth |
| Fresh read-only review | No critical issue. Stream-state loss and missing paired labels reproduced by four failing browser cases, then all four passed after fixes. No findings set aside |

The review-fixed application at `ca4498f` passed the complete CI main check,
including production build and bundle budgets. Its first phone job passed 43/45
cases; traces showed Vite discovering upload dependencies late and reloading two
320px pages into the generic fixture. A dedicated profile Vite configuration now
scans only the runner's entries and preloads the upload dependencies. The new
assertion checks there is only one document navigation. All 45 cases pass with
the isolated configuration. This final change affects tests only.

Final CI status belongs to the exact release head and is recorded in the PR.
Live deployment identity and anonymous route checks are recorded after merge.
The earlier implementation head's sibling fixture needed the new action stub,
also fixed before release.

All browser records are synthetic; uploads use local intercepted requests and
removals use refused action stubs. Shared-browser control is disabled in Work
settings. No physical-device test or real live document upload/removal is claimed.
D: has under 1 GB free, so the Next production build runs in CI; an automatic
policy blocked deleting an old build cache and no alternate deletion was tried.

## Screenshots

- [Document list, phone](documents-390-light.png)
- [Document list, desktop drawer](documents-1280-light.png)
- [Upload, 320px dark](upload-320-dark.png)
- [Upload, desktop](upload-1280-light.png)
