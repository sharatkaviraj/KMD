# UI build decisions

Decisions taken while building the approved design (`docs/design-handoff/`).
Each one is the option closest to the design and to `RULES.md`. Numbered UI-n
so they do not collide with `docs/DECISIONS.md` (D-n).

| # | Decision | Why |
|---|---|---|
| UI-1 | The design system lives in `src/vx/`, not `src/ui/` or `components/vx/` | `src/ui` is in `PORTED_TREES` (School Fees' kit, next-intl strings). The new kit says its strings through its own pairs, so it lives outside the ported trees and the two catalogues cannot mix. |
| UI-2 | Tokens keep the design's names (`--bg`, `--card`, `--pri` …) and are scoped to `.vx` / `.vxt`, never `:root` | Four names (`--card`, `--nav`, `--info`, `--scrim`) already exist on `:root` as HSL triplets for the ported Tailwind theme. Scoping keeps both themes working side by side while old screens are still in use. Component classes (`.card`, `.btn`, …) are scoped the same way. |
| UI-3 | Dark mode follows the existing `next-themes` `.dark` class on `<html>` | One switch for the whole app. `.dark .vx` replaces the design's `.vx.dark`. |
| UI-4 | The layout flips at 900 px of the **page's own width** (container query), and the sidebar shows from a 900 px window | PLAN A.4: "flips at 900px of the content container, not the window". On a 900–1150 px screen the sidebar collapses to icons so the page still gets desktop width. |
| UI-5 | Old screens stay reachable after their module is rebuilt | Rule: keep all business logic, server actions and RPCs. They are linked from Settings → Classic screens until retired on purpose. |
| UI-6 | Language: EN shows English, "both" shows English with Hindi under key labels, हि shows Hindi first | The design is English-first with Hindi under key labels and an EN · हि switch. The switch writes the existing `preferred_language` (en ↔ hi); "both" keeps its meaning. |
| UI-7 | Eight app roles map onto the design's five menus | admin, office and view_only use the admin menu filtered by permission; accountant and fee_collector use the accountant menu. Permissions still decide every item. |
| UI-8 | Pages are wrapped by one `VxShell` for every signed-in route | One sidebar, one bottom bar, one search palette for old and new screens alike. Old screens render in the shell's content area without the `.vx` scope, so their own theme is untouched. |
| UI-9 | Branding: "VPPS One" in the app, "Shri Veer Patta Senior Secondary School" on receipts | RULES I: keep what the repo and receipts use today (`NEXT_PUBLIC_SCHOOL_NAME`). |
| UI-10 | Two new permissions: `messages:send` (admin, office, both coordinators) and `settings:manage` (admin) | The design gives Messages and Settings their own menu items. Added to the TS map and to `vppsone.role_permissions` in one additive migration; `tests/scoped-reads.test.ts` reads both. |
| UI-11 | A nav route whose redesigned screen is not built yet redirects to the classic screen that does the job | Every nav item works from the first deploy, so nothing 404s while the phases land. Each redirect is replaced by its screen. |
| UI-12 | "See the app as" borrows the permissions of the matching real role (teacher, accountant, academic_coordinator, exam_coordinator) and is a cookie on the admin's own browser | The menu matches what that role sees; writes go through `assertNotPreviewing()` and refuse. |
| UI-13 | The legacy command palette is replaced by the vx search palette | One Ctrl K, searching this person's pages, students and receipts. |
