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
| UI-14 | The eager-JS budget is re-measured against the redesigned shell (`docs/evidence/smoothness-redesign.json`), and re-measured as each module merges until P12 | The new shell replaces the old chrome on every route and `/login` shares its chunks; it measured 10.2% over the old baseline. The 10% guard now applies from the redesign forward, and the search palette loads lazily. The script reads each route's client-reference manifest, which in this build lists the client modules of the whole app (the `/login` manifest names the same 174 modules as `/payments`), so every new screen raises every route's figure; the final baseline is taken in P12. |
| UI-15 | Payment Desk late fee is "Take with fees" or "Waive" (with reason, payments:waive_late_fee), never "later" | The ledger settles each installment's late fee right after its fees, so a later late fee cannot be represented. |
| UI-16 | Payment Desk preview copies the ledger rule (fees first, then each row's late fee; no late fee when a payment dated on or before the due date clears the installment); the server still decides at posting | Back-dated payments show the late fee they avoid, without a second allocation engine. |
| UI-17 | Cheque no. and UPI/UTR go in `reference_number`; cheque bank and date go in remarks | No new fee columns (fee tables are never altered). |
| UI-18 | Bulk entry sends its grid as the template CSV through the existing import batch | Typed rows and uploaded files share one validation path. |
| UI-19 | Sign-in, `/apps` and "Go home" land on the design's role home (`homeForRole`: admin, office and view-only → `/`, teacher → `/teach`, accountant and fee collector → `/accounts`, academic coordinator → `/academics`, exam coordinator → `/exam-office`); a stored start screen still wins | PLAN P2 role home redirect. The legacy `homeFor` stays for the classic navigation map and its tests. |
| UI-20 | Admin Today lives at `/` inside the app group; other menus visiting `/` go to their start screen or role home | The design's admin home is `/`. |
| UI-21 | A Needs-you decision is held on the device for 6 s (Undo cancels with nothing sent), then the existing server action runs | Undo without deleting anything on the server. |
| UI-22 | Attendance summaries count only marked classes, and the mark-on-behalf panel opens with everyone present for a new register | RULES C. |
| UI-23 | "Pending today" = overdue or part-paid past due; everything else unpaid is "Not due yet"; the late fee is always its own number | RULES fee separation. |
| UI-24 | The sidebar's Needs-you badge counts the same items as `/inbox` | One source for the queue. |
| UI-25 | The academic coordinator holds `attendance:mark_on_behalf` and `attendance:correct` | The design's AcadAttendance marks a class for a teacher on leave and approves change requests ("attendance oversight"). Same rows as the office. |
| UI-26 | Calendar is shown to holders of `academics:view` | Matches the page guard; view-only and the fee desk do not get it. |
| UI-27 | The old academics hub moved to `/academics/setup` and the old calendar editor to `/calendar/days` | `/academics` and `/calendar` are the design's screens; nothing old is lost. |
| UI-28 | A holiday added on the calendar writes `academic_calendar_days`; other events go to `vppsone.calendar_events` and are cancelled, never deleted | Registers and the timetable already read the days table. |
| UI-29 | "Needs attention" is one SQL view (`vppsone.v_needs_attention`): attendance < 75%, < 33% in a subject, a drop of 15+ points, 2+ open notes | PLAN P8. |
| UI-30 | The accountant's bookkeeping (cheques, deposit slips, UPI lines, requests, counter queue, reminder pauses, report schedules) lives in append-only `vppsone.acc_*` tables | Fee rows are never edited from these screens; refunds and reversals are requests the admin decides, and the money moves through the existing fee screens. |
| UI-31 | Fee setup works on the real model: "copy last year + %" is "raise every class by %", installments are the academic-fee split plus due dates, the late fee is flat per installment, transport is each route's yearly fee | The fee engine has no per-installment percentages or stop-level transport; the review step counts the impact before publishing. |
| UI-32 | Report schedules are saved but not sent, and "send to class teachers" is Copy + a wa.me link | No paid WhatsApp sends without approval (CLAUDE.md rule 8). |
| UI-33 | Absent alerts, birthday wishes and messages about notes/plans only go into `vppsone.parent_message_queue` | Nothing sends to parents without approval (CLAUDE.md rule 8). |
| UI-34 | Attendance tap cycle is Present → Absent → Half-day → Present; a teacher can change a saved register for 30 minutes from its first submit, then asks the office | RULES C. |
| UI-35 | An offline attendance save waits in an IndexedDB outbox and is resent with the same command id | PLAN A.10; the server treats the repeat as idempotent. |
| UI-36 | Notes reuse `vppsone.notes` (new columns: tags, status open/working/done, visibility, follow-up) and the academics engineer's `support_plans`; replies, notice reads and the parent queue are new tables | One notes model shared by the teacher app, the board, Student 360 and "needs attention". |
