# VPPS One — module build spec (read fully before writing anything)

You are building one or more **responsive design modules** for VPPS One, the admin app of
Shri Veer Patta Sr. Sec. School, Amet (Rajasthan). Each module is ONE `.dc.html` file that
renders the **desktop** layout (sidebar + top bar) when wide and the **phone** layout
(top bar + bottom bar, sheets from the bottom) when narrower than 900px. Same file, same
logic; CSS container queries switch the layout.

All paths below are relative to the scratchpad root:
`/tmp/claude-0/-home-claude/169079ca-89ec-5c96-a646-4a555733067e/scratchpad`

## 0. Golden reference — copy its patterns
`src/Fees.dc.html` (Receipts & day close) is the finished reference. Read it end to end
first. Copy its skeleton, header pattern, state pattern (`data()` / `st()` / `toast()` /
`openSheet()` / `closeSheet()`), list/table pattern, split detail panel, sheet, toast,
segmented control, chips, switch, radio cards, steppers and success animation.
`shared/vx.css` is the design system (tokens + component classes + keyframes) — read it.
`shared/icons.js` is the icon set (`IC.name` → SVG path `d`).

## 1. What you write
* `src/<Name>.dc.html` — the module source. Keep `/*VX_CSS*/` inside the helmet `<style>`
  and `/*VX_ICONS*/` as the first line inside `data()` exactly as Fees does. The build
  inlines them.
* `src/<Name>.boards.json` — the canvas frames to show (format in §9).
* Do NOT edit anything in `shared/`, `check/`, `src/Fees*`, `src/XSide*`, `src/XNav*`, or
  any other agent's files. Do not write into `vppsone-design/project/` by hand — only via
  the build/wrapper scripts with YOUR module names.

## 2. Build + check loop (must end clean)
```
cd /tmp/claude-0/-home-claude/169079ca-89ec-5c96-a646-4a555733067e/scratchpad
python3 shared/build.py <Name>
node check/check3.js vppsone-design/project/<Name>.dc.html --quiet
python3 shared/wrappers.py <Name>
```
`check3.js` renders every `start` option, resolves every `{{hole}}`, and fuzz-clicks every
function you return from `renderVals()` (calling it with a fake event whose
`e.target.value === '12'`, `e.target.checked === true`, `e.target.files === []`), then
re-renders. Fix everything it reports. The ONLY acceptable remaining message is
`link target missing: X.dc.html` where X is one of the planned module files in §8 that
another agent is still building. It runs in Node: **never touch `window`, `document`,
`localStorage`, `navigator.*` (except what Fees uses) or DOM APIs** in renderVals or handlers.

## 3. Template rules (the runtime is strict)
* File skeleton = Fees: `<!doctype html>…<script src="./support.js"></script>…<x-dc><helmet>`
  fonts link + `<style>/*VX_CSS*/</style></helmet>` root element `</x-dc>` then
  `<script type="text/x-dc" data-dc-script data-props='…'>class Component extends DCLogic {…}</script>`.
* Holes `{{a.b.c}}` are **dotted lookups only**. No expressions, no `!`, no ternaries, no
  `===`, no calls, no string concat inside holes. Compute everything in `renderVals()`.
  Literals are allowed only as `{{ true }}` / `{{ false }}` / numbers in hint attributes.
* Loops: `<sc-for list="{{rows}}" as="r" hint-placeholder-count="6">…</sc-for>`.
  Inside, `r.x` and all outer values resolve. Nested loops fine.
* Branches: `<sc-if value="{{is.list}}" hint-placeholder-val="{{ true }}">…</sc-if>`. There
  is no else — use a second sc-if with the negated boolean computed in JS.
  Every sc-if value must be a real boolean (never undefined).
* Events: `onClick="{{fn}}"`, inputs use `value="{{x}}" onChange="{{onX}}"` (also for
  textarea/select). Handlers must be functions returned from renderVals (per-row closures
  in arrays are fine, like `r.open`).
* `style="…"` is a normal CSS string; holes inside are fine
  (`style="width: {{p.w}}; background: {{p.c}}"`). Never produce an empty value, `undefined`
  or `NaN` — use `'none'`, `'0'`, `'transparent'`.
* Child components: `<dc-import name="XSide" active="dues" dark="{{dark}}" hint-size="248px,100vh"></dc-import>`
  and `<dc-import name="XNav" active="menu" dark="{{dark}}" hint-size="100%,76px"></dc-import>`.
* Links between artboards: `<a href="Other.dc.html" class="tap">`. Only link to files that
  exist (§8) or planned module files (§8).
* `data-props` JSON (single-quoted attribute, so no `'` inside):
  `{"start":{"editor":"enum","options":["list","…"],"default":"list"},"dark":{"editor":"boolean","default":false},"$preview":{"width":1440,"height":900}}`
* `setState(obj)` merges synchronously. Initial `this.state` is `{}` — hence the `st()`
  pattern: defaults ← start-state map ← `this.state`.
* Cache static data in `data()` (`if (this._d) return this._d;`).
* Accessibility: every `<button>` has `type="button"`; icon-only buttons get `aria-label`;
  toggles use `role="switch" aria-checked`, choices `role="radio" aria-checked`, chips
  `aria-pressed`; inputs sit in `<label class="field"><span>Label</span>…</label>`.
* Size: aim for a source file of 35–65 KB. Never above 80 KB.

## 4. Layout skeleton (copy from Fees)
```
<div class="vx {{theme}}" style="position: relative; width: 100%; height: 100vh; min-height: 560px; overflow: hidden; display: flex; background: var(--bg); color: var(--fg); font-family: Inter, 'Noto Sans Devanagari', system-ui, sans-serif; font-size: 14px; line-height: 1.45">
  <div class="only-d" style="flex: none; height: 100%"><dc-import name="XSide" active="<key>" dark="{{dark}}" hint-size="248px,100vh"></dc-import></div>
  <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; position: relative">
    <header class="only-d glass" …64px: crumb + serif title left, actions right…>
    <header class="only-m glass" …58px: back (link to F13-Menu.dc.html on the module's first screen, back button on deeper screens) + title/sub + one action…>
    <main class="scroll" style="flex: 1; min-height: 0; position: relative"> screens… </main>
    <div class="only-m" style="flex: none"><dc-import name="XNav" active="menu" dark="{{dark}}" hint-size="100%,76px"></dc-import></div>
  </div>
  sheets (scrim + section.sheet) and toast live here, at the root, after the column
</div>
```
Sidebar keys (XSide `active`): dues, reminders, feesetup, reports, exams, timetable,
calendar, admissions, studenttools, staff, teacher, messages, settings, auth.
A module MAY replace the chrome where it makes sense (e.g. the sign-in screen has no
sidebar/bottom bar; the teacher view has a teacher sidebar + teacher bottom bar built
inline in that module) — still keep `.only-d` / `.only-m` switching.

Responsive helpers from vx.css (phone = container < 900px):
`.only-d` desktop only · `.only-m` phone only · `.hide-m` hide on phone · `.hide-d` hide on desktop ·
`.g4` 4 cols → 2 · `.g3`/`.g2` → 1 col · `.stack` any grid → 1 col · `.pad` 16px side padding on phone ·
`.unstick` sticky side panel becomes normal flow on phone · `.mfull` full width on phone ·
`.hs` horizontal chip scroller. On desktop `.sheet` automatically becomes a centered dialog
(580px, add class `wide` for 760px); on phone it is a bottom sheet with `.grab`.
Desktop tables: CSS grid rows (`display: grid; grid-template-columns: …`) with `class="tap row"`.
Phone: the same data as card lists (one `.card` with rows), 44px+ touch targets, sticky
bottom action bars for forms (`position: sticky; bottom: 0` inside main, `.glass`).

## 5. Look + motion (the user's priority: smooth, clean, simple)
* Use the tokens only (`var(--card)`, `var(--mut)`, `var(--acc)`, `var(--oks)`/`var(--ok)`,
  `var(--warns)`/`var(--warnfg)`, `var(--bads)`/`var(--bad)`, `var(--infos)`/`var(--info)`,
  chart colours `var(--c1..c4)`), so dark mode just works. Brand: primary #0B4F79,
  accent #0E717C, nav #082F49. Display headings use `class="serif"` (Source Serif 4).
  Numbers use `class="num"`. Section labels use `class="sech"`.
* Components: `.card`, `.btn` + `.pri|.sec|.soft|.ghost|.danger`, `.chip(.on)`, `.pill`,
  `.seg` + `.thumb` (sliding segmented control), `.sw(.on)` switch, `.inp(.err)`, `.field`,
  `.row(.sel)`, `.skel` shimmer, `.k` keycap, `.glass`.
* Motion uses ONLY transform/opacity keyframes from vx.css:
  `xIn` (list rows, with stagger `animation-delay` 0–400ms), `xRise`/`.rise` (KPI cards),
  `xPush` (go deeper / open detail), `xPop` (go back), `xUp`/`xDown` (sheets, automatic),
  `xModal` (dialogs, automatic on desktop), `xPopIn` (badges, success ticks, stamps),
  `xDraw` (SVG stroke draw: set `--len` and `stroke-dasharray` = len — rings, sparklines,
  success checks), `xGrowY`/`xGrowX` (bars in charts; set `transform-origin`),
  `xToast`, `xShake` (`.inp.err`), `xPulse` (live dot), `xLoop` (spinner), `xFade`.
  Transitions: `width .5s var(--ease)` for progress bars, `transform .32s var(--spring)`
  for thumbs/knobs. Screen switch = change `screen` + set `anim: 'push'|'pop'`, and put
  `animation: {{anim.x}}` on the screen container (see Fees).
* Every action gives feedback: a toast (with **Undo** for anything destructive or bulk),
  an animated state change, or a success screen with a drawn tick.
* Modern widgets to use where they fit: KPI cards with delta pills, SVG donut/ring
  (`stroke-dasharray`), sparkline (polyline + xDraw), stacked bar, heat grid, progress
  bars, timeline/history log, stepper wizard with progress, segmented controls, chip
  filters, command-style search, bottom sheets, side panels, inline validation, skeleton
  loaders, empty states with one clear action, WhatsApp message preview bubble
  (`var(--wabg)` background, `var(--wab)` bubble, `var(--wafg)` text), drag-free
  reordering (up/down buttons), toggles, steppers.
* Simple to understand: one primary action per screen, plain words (no jargon), short
  helper text under anything that could confuse, numbers in Indian format (`₹1,23,400`,
  lakh as `₹4.6 L`), dates like `Thu 8 Oct`.

## 6. The school world (all fictional — never use real people)
* Today is **Thu 8 Oct 2026**, session **2026–27**. User: **Janmejay Singh**, Admin.
  Office staff on receipts: "Office desk". Accountant: Ms. Neelam Sharma.
* Classes (class teacher · students): Nursery (Ms. Kanwar 18), LKG (Ms. Rathore 20),
  UKG (Ms. Mehta 22), Class 1 (Ms. Jain 23), Class 2 (Ms. Vyas 25), Class 3 (Ms. Sharma 24),
  Class 4 (Mr. Verma 29), Class 5 (Ms. Paliwal 26), Class 6 (Ms. Bhati 31), Class 7
  (Mr. Choudhary 27), Class 8 (Mr. Solanki 28), Class 9 (Mr. Meena 28), Class 10 (Ms. Dave 30),
  11 Science (Mr. Trivedi 22), 11 Commerce (Mr. Purohit 18), 11 Arts (Ms. Chouhan 14),
  12 Science (Mr. Bhatt 20), 12 Commerce (Ms. Kothari 17), 12 Arts (Mr. Rawal 12). Total 434.
* Students already used elsewhere (reuse them for consistency): Aarav Sharma (Class 7, SR 1234,
  Route 3, sibling Diya Sharma Class 3, father Rakesh Sharma), Aarti Kumawat (Class 10),
  Aarush Jain (UKG, new), Ishita Rathore (12 Science), Kunal Verma (Class 4, Route 1),
  Mohit Agarwal (Class 9, Route 2), Neha Joshi (Class 8, sibling Rohit Joshi Class 5,
  father Prakash Joshi), Pooja Mehta (11 Commerce), Riya Singh (Class 6, Route 1),
  Tanvi Paliwal (LKG, new). Invent more with common local surnames (Sharma, Jain, Mehta,
  Paliwal, Kumawat, Rathore, Choudhary, Vyas, Purohit, Solanki, Bhati, Dave, Trivedi,
  Chouhan, Kothari, Rawal, Meena, Agarwal, Joshi, Singh, Kanwar, Sen, Regar, Gurjar).
  Phone numbers: `98290 4xxxx` style, partly masked (`98290 ••512`).
* Fees: four installments — 15 Jul, 15 Sep, 15 Nov, 15 Jan. Today Installment 1 and 2
  are due, 3 and 4 are "not due yet". Academic fee per year (fictional): Nursery–UKG
  ₹17,400 · 1–5 ₹20,400 · 6–8 ₹25,800 · 9–10 ₹31,200 · 11–12 ₹34,800 (+₹3,600 lab for
  Science). New students also pay a one-time admission fee ₹1,200. Transport by route
  (monthly × 9, Jul–Mar): Route 1 Amet town ₹600 · Route 2 Kelwa ₹700 · Route 3 Railmagra ₹800 ·
  Route 4 Kunwariya ₹900. Sibling discount 10% on the younger child's academic fee;
  staff-child concession 50%. Late fee ₹10 per day after a due date, capped at ₹300 per
  installment.
  Session money: expected ₹31.2 L, collected ₹18.9 L, pending today ₹6.4 L across
  138 students, not due yet ₹5.9 L.
* Payment modes: Cash, UPI, Cheque, Bank (NEFT). Receipts R-0001… (today's are R-0404–R-0417).
* Exams 2026–27: Unit Test 1 (Jul, done), Half-yearly (23 Sep–3 Oct, marks entry in
  progress now), Unit Test 2 (Dec), Annual (Mar). Subject teachers enter marks through
  **Sampark** links (a per-teacher link on WhatsApp, no login needed).
* Messaging: WhatsApp through **AiSensy** (templates must be approved; each message costs
  about ₹0.88; delivery → read ticks). SMS is not used.
* Backups: nightly to Google Drive + Cloudflare R2.
* Roles: Admin, Accountant, Class teacher, Subject teacher, Exam coordinator, Fee collector,
  Viewer (read only).

## 7. Domain rules the design must respect (these are non-negotiable)
* "**Pending today**" = installments whose due date has passed, unpaid. "**Not due yet**" =
  future installments. Never add them together as "dues".
* **Late fee is always shown separately** and is never added into the fee due. A family
  whose only debt is a late fee is not a defaulter.
* Receipts are never edited. A correction is a reversal entry + new receipt. 10-minute Undo.
* Attendance "not marked" is never counted as present.
* Students who **left owing money** still appear in dues/recovery (marked "Left"), not in
  headcount.
* Anything sent to parents is **Hindi-first** with English below, and shows a WhatsApp
  preview before sending. Every send / bulk action shows the count and cost first.
* Destructive actions need a confirm sheet stating the impact in plain words; bulk actions
  get Undo.
* Show who did what and when (small history log) on records that matter (money, marks,
  roles, settings).

## 8. Files that exist (safe link targets)
Phone: `App.dc.html` (prototype), `F01-Today`, `F02-NeedsYou`, `F03-QuickActions`,
`F04-Search`, `F05-Students`, `F06-Student360`, `F07-Student360-Fees`, `F08-Student360-Family`,
`F09-Collect`, `F10-CollectDone`, `F11-Attendance`, `F12-MarkAttendance`, `F13-Menu`,
`F14-TodayDark` (all `.dc.html`).
Desktop: `Desktop.dc.html`, `D01-Students`, `D02-Student360`, `D03-NeedsYou`,
`D04-Attendance`, `D05-Collect`, `D06-Receipt`, `D07-Search`, `D08-TodayDark` (all `.dc.html`),
`Fees.dc.html`.
Planned module files (being built in parallel — OK to link; the checker will flag them
until they exist): `Dues`, `Reminders`, `FeeSetup`, `Reports`, `Admissions`, `StudentTools`,
`Exams`, `Timetable`, `Calendar`, `Staff`, `Teacher`, `Messages`, `Settings`, `Auth`
(all `.dc.html`).
When one responsive element must go to different places per device (e.g. "Open student"),
render two anchors: one `class="only-d"` → `D02-Student360.dc.html`, one `class="only-m"`
→ `F06-Student360.dc.html`. "Collect fee" → `D05-Collect` / `F09-Collect`.

## 9. Canvas frames — `src/<Name>.boards.json`
List the frames that best show the module, 3–4 desktop + 4–5 phone, most important first:
```
[
  {"file": "Dues.dc.html", "device": "desktop", "title": "Dues · call list"},
  {"file": "DX-Dues-Plan.dc.html", "device": "desktop", "start": "plan", "title": "Set up an EMI plan"},
  {"file": "M-Dues.dc.html", "device": "phone", "start": "list", "title": "Dues · call list"},
  {"file": "M-Dues-Call.dc.html", "device": "phone", "start": "call", "title": "Log a call"}
]
```
The first entry is the module file itself (its default `start`). Desktop extras are
`DX-<Name>-<State>.dc.html`; phone frames are `M-<Name>.dc.html` and `M-<Name>-<State>.dc.html`.
Optionally one frame with `"dark": true`. Titles are short and plain.
`start` values must be options of your module's `start` enum. Every start state must
be a meaningful screen/state that renders fully on BOTH widths.

## 10. Definition of done (per module)
1. Every screen in your brief exists, works on both widths, and is reachable by clicking
   (Play mode) from the module's first screen, not only via `start`.
2. `check3.js` clean (except planned-module links). Run it once more with `--deep` at the end.
3. `boards.json` written and `wrappers.py <Name>` run.
4. Reply with: module name, start states, one line per screen, any icon you added inline,
   and anything you could not do. Keep the reply under 250 words.
If you need an icon that is not in `shared/icons.js`, add it inside `data()` right after
`/*VX_ICONS*/` with `IC.newName = 'M…';` (single-path Lucide style, 24×24 viewBox).
