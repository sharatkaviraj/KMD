# One UI polish

The user requested an audit, ideas, implementation and live deployment of UI improvements, especially the session pill, mobile composition and smoothness. This is a refinement of One's navy/teal, serif-heading design using existing React, Next.js and CSS; no new animation library is needed.

## Findings and approaches

The live 390px Today screen puts a detached white session pill, a roster banner and a large blue ledger card before its navy header. The mobile picker opens a mostly empty full-screen Fees-style view. The shared list staggers every row for up to 400ms; hover lifts also apply to touch; native sheets retain a 230ms dismissal delay with reduced motion. One's intent-prefetch links do not report pending navigation to the existing progress bar.

1. Restyle only the pill: small, but leaves the surrounding composition and interaction problems.
2. Replace the visual system: extensive change and unnecessary relearning.
3. Refine shared components (chosen by the implementer): retain the design and session authorization logic, fix the shell, native picker, notices and common interaction behavior together.

## Design

- Put session and roster state in a single compact, responsive workspace toolbar using One's tokens. Keep full session labels, visible TEST identity, the real permission-filtered session list, and a stable loading placeholder. On mobile, use navy to connect naturally to the Today hero. The toolbar scrolls away; existing page headers retain their sticky behavior.
- Show healthy roster state compactly with the exact checked time available through an accessible disclosure. Stale/error/pending states retain their complete message and remain visible. Health reads stay in an independent Suspense boundary.
- Give the existing switchers an opt-in One appearance. Desktop remains a keyboard accessible Radix menu; mobile uses the existing One bottom sheet, with bounded height, safe areas, visible selection, full labels and retry behavior. Cookie-first navigation, stale-parameter removal and viewer restrictions stay intact.
- Place the ledger explanation below the Today header/hero in a native, compact disclosure. Keep the financial authority explanation and both destinations available. Do not change the source of financial figures.
- Use shorter shared sheet/list entrances, avoid touch-only hover lifts and row shrinking, animate the status pulse with opacity instead of shadow, and remove the reduced-motion dismissal wait. Preserve focus restoration and history behavior.
- Connect intent-prefetched navigation to the existing pending-event mechanism; retain delayed feedback to avoid flashing on instant routes.

## Verification and boundaries

Use synthetic browser fixtures for interaction and layout. Check 320, 390, 768, 1024 and 1440px, light/dark, English/Hindi, TEST labels, loading/error, keyboard dismissal, Back, focus restoration, scroll lock and reduced motion. Run the repository type, lint, import/theme, unit, build and bundle checks, then PR CI. Inspect production's deployed commit and the real mobile UI after release.

No schema, permissions, Fees authority, payment/provider gates, messages, school records or certificate issuance changes. Production QA is read-only. Keep the existing dirty main checkout untouched in an isolated D: worktree.
