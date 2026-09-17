# Design artifact validation

17 September 2026. Machine-readable results and source hashes are in [validation.json](validation.json). Rerun `node docs/design/render.mjs` after changing the HTML/CSS/JS; it overwrites the corresponding PNGs and evidence.

## Executed checks

- Rendered **32 screen compositions** at **360, 390, 768, 1024 and 1440 CSS px**: 160 layout checks.
- Exported each at 390 px phone and 1440 px desktop: **64 full-page PNGs**.
- Exported first-viewport images for accountant, teacher and admin at 390×844 and 1440×1000: **6 PNGs**.
- Exported the design gallery and a three-role overview: **2 PNGs**. Total: **72 PNGs**.
- Checked page width and right-edge overflow outside deliberate table containers; final run reported no overflow. No uncaught page errors or failed requests were recorded.
- Executed 17 prototype checks: attendance status/count/save; all-present reset; SR search; no matches; invalid negative payment; changed payment preview; Escape dialog close; marks maximum; absent disables score; zero/blank/absent distinction; rejection reason; repeat decision prevention; audience count; token confirmation without account shell; Hindi language attribute; viewer content; atlas screen count.

The first pass found the Apps page overflowing at 360 and 390 because two cards remained side by side. Fixed by stacking app cards. State/component panel grids also stack on phones. Mobile More now points to a role-specific hub. The language shortcut keeps nonteacher roles in their own preferences instead of switching their workspace to the teacher demo.

## Image interpretation

`*-mobile.png` and `*-desktop.png` show full content. For these exports only, fixed navigation is placed at the document edge so it does not cover a row halfway down a long image. The actual HTML uses the fixed desktop sidebar/mobile bottom bar. `*-first.png` shows the actual fixed navigation at the original viewport, and the overview uses these first-viewport images.

These are deterministic Chromium renders of authored HTML, not AI-generated approximations. All graphics use inline SVG/CSS. The current rendering environment provides the system font and Hindi fallback; small font differences are expected on other operating systems. The HTML/CSS and semantic design rules take precedence over operating-system antialiasing differences in PNGs.

## Scope and remaining validation

This run tests the **static design prototype** only. It does not test the deployed VPPS One, School Fees or SamPark applications, authenticated authorization, persistence, accounting, migrations, messages, live providers or device cameras. Simulated save/preview dialogs are labelled as examples. Four-child workflow samples are not reconciled to the fictional full-school home summaries.

The automatic run is not a complete accessibility audit. Physical iPhone/Android checks, mobile keyboards, screen readers, actual 200% browser zoom, 320 px reflow, performance field metrics, and staff usability remain implementation acceptance work. Some modules are covered by shared pattern mappings rather than individually functional mockups; `SCREENS.md` identifies those variants.

Do not substitute these results for the active plan's role/workflow smoke suite. Once the implementation uses these designs, capture the actual app at the same viewports and include its real data/role/state evidence.
