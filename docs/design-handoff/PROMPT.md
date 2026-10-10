# Claude Code prompt — build the approved VPPS One UI, end to end

Paste everything below the line into Claude Code, opened in the **vppsone** repo
(`C:\Users\AnandKumari\Desktop\vppsone`). First unzip this pack into the repo's `docs/` folder (it creates `docs/design-handoff/`).

---

You are the lead engineer for **VPPS One** (`veerpatta/vppsone`), the school's all-in-one app. It is a Next.js App Router app deployed to Vercel (`vppsone.vercel.app`), and its backend is the Supabase project **schoolfees-dev** (ref `wtgxcptmucjerhufzjcf`), which holds test data.

The owner (Janmejay Singh, admin) has approved a complete UI design for every screen and every role, on phone and desktop. Your job is to make the real app look and behave like that design, wired to real data. Work end to end until every screen in the design exists in the app.

## 0. Hard rules (the only ones — everything else, use your judgement)
1. **Database.**
   - Only ever touch **schoolfees-dev (`wtgxcptmucjerhufzjcf`)**.
   - Before any database command, migration or MCP call, check the target project ref. If it is `vgqyilgstjvgohrsiwkb`, which is the LIVE fee app, stop that action.
   - Never write to the `veerpatta/schoolfees` repo or its database. You may READ the local fee app code at `C:\Users\AnandKumari\Projects\schoolfees` as a reference.
2. **Money stays safe.**
   - Payments, receipts, adjustments and audit logs are append-only. A correction is a new reversal or adjustment row, never an edit or a delete.
   - Fees and late fees are always separate numbers.
   - "Pending today" and "Not due yet" are never added together.
   - Payments are posted one student at a time; there is no family pay-together.
3. **Children's data.**
   - Seeds and tests use fake data only.
   - Teachers never see money.
   - Class teachers see only their own class; subject teachers see only their own class-subjects.
4. **Ship continuously.** Small commits, push to `main` when typecheck, lint, tests and build pass (Vercel deploys automatically). Migrations are additive and go in `supabase/migrations/`; apply them to schoolfees-dev as you go.
5. **Never stop to ask.** When something is unclear, pick the option closest to the design and to `docs/design-handoff/RULES.md`, write it in `docs/ui/DECISIONS.md`, and carry on.

## 1. Read first (in this order)
1. The repo's own instructions and docs: `CLAUDE.md` / `AGENTS.md` / `docs/**`, `package.json`, and the app routes, auth, roles/permissions, data layer, existing migrations and tests. VPPS One already has working fee features ported from the fee app (PRs #1–#56). **Keep all business logic, server actions, RPCs and permission checks.** You are replacing and extending the UI layer and adding missing modules.
2. `docs/design-handoff/README.md`, then:
   - `RULES.md` — domain rules and school decisions. These win over design details.
   - `DESIGN-SYSTEM.md` — tokens, type, motion, components, responsive rules, icon map.
   - `SCREENS.md` — every module, suggested route, role, state and frame, with screenshot paths.
   - `DATA-MODEL.md` — data each screen needs and the proposed additive tables.
   - `PLAN.md` — phases, with one detailed brief per phase.
3. Look at the screenshots in `docs/design-handoff/screenshots/**` for every module you build.
   - They are the visual target: desktop at 1440×900, phone at 390×844.
   - `screenshots/index.json` maps every frame to its image.
4. The design source files `docs/design-handoff/design/src/*.dc.html` are **executable specs**. In each one:
   - the template (HTML with `{{holes}}`, `<sc-for>`, `<sc-if>`) is the exact markup and copy;
   - `class Component … renderVals()` holds the state machine, the sample data shapes, the smart defaults and every handler.
   - Port them to React components and server data. **Do not embed the `.dc.html` files.**
   - `design/project/` holds the built copies.
   - To view any frame as static HTML: `node docs/design-handoff/tools/render.js docs/design-handoff/design/project/<Frame>.dc.html out.html`.
5. For the Payment Desk, read the fee app's real Payment Desk (`app/protected/payments/*`, `lib/payments/*`, and the RPCs `preview_workbook_payment_allocation` / `post_student_payment*`). VPPS One's Payment Desk must behave the same way: free amount, oldest-first allocation, payment date, mode, reference, notes, idempotency. Then apply the design's polish.

## 2. Build order
Follow `PLAN.md` phases P0–P12 in order:
- **P0** — inventory and ledger
- **P1** — design system
- **P2** — role-aware app shell
- **P3** — Payment Desk
- **P4** — the rest of Money
- **P5** — admin core (Today, Needs you, Students, Student 360, Attendance)
- **P6** — teacher app
- **P7** — notes on children
- **P8** — academic coordinator
- **P9** — exam coordinator, including the Sampark links
- **P10** — the remaining admin modules
- **P11** — system states
- **P12** — polish and final check

Each phase ends with a push to `main`.

Keep `docs/ui/PROGRESS.md` updated after every commit: phase, what shipped, routes, migrations applied, open items. A fresh session must be able to continue from it alone.

## 3. How to build each screen
- **Responsive.** One component tree per screen with **one responsive layout**: a container-query breakpoint at **900px**, exactly like the design. Desktop gets the sidebar and two-pane layouts; phone gets the top bar, bottom bar and bottom sheets. Do not build separate mobile pages.
- **Look.** Use the tokens, components and motion from `DESIGN-SYSTEM.md`. Animate only transform and opacity, and respect `prefers-reduced-motion`.
- **Every state.** Build every `start` state listed for the module in `SCREENS.md` as a real reachable state: loading skeleton, empty, error, success with a drawn tick, sheets and dialogs, and Undo toasts.
- **Smart defaults** from `RULES.md`, for example:
  - Attendance opens with everyone present.
  - Marks entry auto-advances to the next child.
  - Payment Desk helper chips only fill the amount.
  - Notes can be spoken.
- **Copy.** Use the plain English from the design, with Hindi under key labels and an EN | हि switch where the design has one. Format money as Indian rupees (₹1,23,400).
- **Data.** Read data on the server (React Server Components plus the repo's data layer). Writes go through server actions. Add database views when a screen needs joined data. Realtime is only for counters that change while you watch (today's collection, attendance board).
- **Permissions.** One permission matrix drives the nav, the page guards and Row Level Security. The Staff → Roles screen edits that matrix.

## 4. Check each phase (keep it light)
- typecheck, lint, unit tests for money, attendance and marks logic, and build.
- A Playwright walk of the routes you touched at 390×844 and 1440×900 for each role that can see them. Save the shots to `docs/ui/shots/<phase>/`. Compare them by eye with the design screenshots and fix anything clearly off.
- A quick axe accessibility pass on new pages.
- Then commit, push to `main`, and confirm the Vercel deploy is green.

## 5. Done means
- Every module and state in `SCREENS.md` exists in the app for the right roles, on phone and desktop.
- All of it is wired to schoolfees-dev data, with fake seed data so that every screen shows real-looking content.
- The nav for every role matches the design: admin, teacher, accountant, academic coordinator and exam coordinator.
- Admin can "See the app as" each role.
- `docs/ui/PROGRESS.md` and `DECISIONS.md` are complete.
- The last commit is on `main` and deployed.

Finish with a short report: what shipped, migrations applied, decisions made, and anything left.
