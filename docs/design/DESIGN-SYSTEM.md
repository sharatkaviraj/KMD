# Ledger Calm 2 — component and behavior contract

Version 1.0 · 17 September 2026. Read with `tokens.css`, `prototype.css`, the actual HTML views, and `HANDOFF.md`. Existing application tokens in `src/app/globals.css` are the migration starting point.

## 1. Design decisions

| Question | Chosen direction | Why / constraint |
|---|---|---|
| One home for all accounts? | Role-specific composition using shared components | A teacher, accountant and administrator have different first tasks |
| Dense dashboard or whitespace? | Compact task lists inside generous page structure | Scan quickly without turning routine work into a spreadsheet |
| Mobile navigation? | Up to four common destinations plus More | Keep labels and comfortable touch targets; never drop allowed routes |
| Desktop navigation? | Full sidebar grouped by responsibility | More screen space should remove taps, not reproduce a phone menu |
| Primary emphasis? | One warm action per task region | Users should identify what to do without reading the whole page |
| Visual identity? | Evolve the installed Ledger Calm palette | Staff move between related apps; visual continuity reduces relearning |
| Chart style? | Small, labelled, decision-specific | Admin needs exceptions; accountant needs collection context; teacher needs work |
| Illustration? | Small inline SVG icons, initial avatars, empty-state symbols | No stock imagery, expensive animation, or external font dependency |
| App unification? | Consistent language across existing app boundaries | A design reference does not duplicate fee accounting or erase SamPark workflows |

## 2. Tokens and migration

`tokens.css` is the visual reference. Map its semantic names onto the installed Tailwind v4 `@theme`; do not introduce a second global theme or scatter literal colors through components.

| Reference token | Existing application equivalent / use |
|---|---|
| `--background` | `--color-background`; whole-page warm paper |
| `--surface`, `--surface-muted` | `--color-surface`, `--color-surface-2`; cards and subdued regions |
| `--ink`, `--muted` | `--color-foreground`, `--color-muted-foreground` |
| `--accent`, `--accent-soft` | `--color-accent`, `--color-accent-soft`; primary task and emphasis |
| `--nav`, `--nav-text`, `--nav-muted` | Existing navigation tokens; dark sidebar and readable text |
| `--green`, `--amber`, `--red`, `--blue` | Success, warning, failure and information; pair with explicit text |
| `--border`, `--border-strong` | Card dividers versus interactive control boundaries |
| `--radius-sm/md/lg` | 8 / 14 / 20 px for controls / cards / larger feature regions |
| `--space-*` | 4, 8, 12, 16, 20, 24, 32 px rhythm |

Use the current system/Devanagari font stack. No remote font is needed. Page title 32 px desktop / 27 px phone; section title 18 / 16; body 14–15; control labels 12–13; small context 11–12. Do not use tiny context text for essential instructions. Monetary and count columns use tabular numerals. Use Indian number formatting in rupees with an explicit period and source.

## 3. Responsive composition

| Width | Navigation | Content and behavior |
|---|---|---|
| 320–760 CSS px | Bottom bar; school identity and account initials above | One-column tasks; two-column compact metrics; forms stacked; directory cards; timetable day agenda |
| 761–1150 | Narrow sidebar; no bottom bar | Reduce page gutters; collapse a secondary panel when main controls need room; preserve table scrolling only for genuinely two-dimensional data |
| 1151+ | 224 px sidebar with complete grouped destinations | Main task plus 320–360 px supporting column; four summary metrics where useful |
| Wide desktop | Limit reading/content width, keep comfortable gutters | Add useful adjacent context; do not stretch paragraphs or fields across the entire monitor |

The atlas's automatic layout check currently starts at **360 px**, not 320; implementation acceptance also requires 320 and 200% zoom. Its screenshot geometry at 390 and 1440 is the visual reference. The exact breakpoint may adapt to real content; preserve the hierarchy and interaction contract.

Primary actions remain reachable near the top. On mobile, the teacher's attendance call to action precedes metrics. On accounts, receive-payment is in the heading before summary cards. Admin exceptions precede supporting trend/detail sections. The bottom bar must reserve page space, honor safe-area insets, and keep focused controls visible; an open software keyboard must not cover input or save controls.

For desktop tables, retain column headers, right-align amounts, and show filters above results. On mobile, turn directory/dues rows into labelled cards. Keep marks grids horizontal only when necessary, with visible student identity and deliberate keyboard order. Never solve overflow by hiding required information or shrinking the whole page.

## 4. Shared components

| Component | Inputs / variants | Required behavior |
|---|---|---|
| `RoleShell` | role, allowed destinations, active route, profile, environment | Desktop groups; mobile priority list + More; no fabricated menu items; deep links retained after sign-in |
| `PageHeading` | eyebrow, title, subtitle, primary action | Exactly one H1; relevant context in subtitle; action can wrap below on phone |
| `TaskHero` | priority, task, reason, action | Actionable first task; replace with completed/no-work state once finished |
| `MetricCard` | label, value, period, freshness, destination | Count links to matching filtered work; show unavailable distinctly from zero; only clickable if meaningful |
| `TaskList` | title, reason, due date, owner, destination, status | Keep completed work reachable; stable order; explain why an item is included |
| `StudentSearch` | query, class, session, result count | Name/SR/ID search; leading zeros preserved; URL-backed filters; reset filters; loading and no matches |
| `StudentRow/Card` | identity, class, status, permitted next action | One clear row action; identical record/filters on phone and desktop; don't show finance to teacher by convenience |
| `Field` | label, value, help, validation, pending | Persistent labels; `aria-describedby`; invalid text beside affected field; appropriate input mode |
| `StatusPill` | saved/draft/incomplete/failed/reviewed | Text plus color; no color-only meaning; no icon-only shorthand without a name |
| `SaveStatus` | dirty/pending/saved/failed/conflict | Saved only after acknowledgement; keep values on error; prevent duplicate request; explicit retry |
| `ReviewDiff` | issued snapshot, suggestion, current approved value, actor/time | Distinguish all three values; if stale, compare again before approval |
| `AudienceSummary` | resolver output, inclusion reason, member count, groups | Same resolved audience drives preview, issuance and progress; freeze after issue |
| `AttendanceControl` | student, selected status, allowed statuses | Large labelled controls; exclusive status; counts reconcile; saved register reloads correctly |
| `MarkInput` | maximum, score/null, absent, persisted state | Blank, zero, absent are distinct; per-cell error; keyboard entry; stable focus after save |
| `AppHandoff` | registry entry, destination role, environment, link kind | Destination name and external indication; original URL builders; cross-environment search fallback |
| `PhotoCapture` | student, candidate file, progress, result | Take/choose, preview, retake, upload, retry; batch match review before placement |
| `FeedbackDialog` | title, description, proposed action | Focus trap, Escape, focus return; real confirmation for irreversible effects; label affected item |
| `Empty/ErrorState` | scope, reason, next step | Differentiate no matches, no data, no assignment, denied access, expired link and failed fetch |

Reuse or extend `src/ui/primitives` and `src/ui/shell`, not a parallel set of handcrafted production components. These names describe component responsibilities; adapt them to current repository conventions.

## 5. Content, language and accessibility

- Use “Take attendance”, “Receive payment”, “Review correction”, and “Create teacher links”, not internal module/action identifiers. Do not put schema, deployment or resolver instructions in the staff interface.
- Keep English, Hindi and bilingual account preferences. The atlas's `teacher-hi` is the fully composed Hindi home reference; it is **not** proof that all screens are translated. Continue the app's message catalogue and authored-text rules, including names and request messages that must remain as authored.
- Hindi headings may need more vertical space. Never force single-line truncation on names, alerts or actions. Use an explicit language attribute where appropriate.
- The preview uses labelled SVG icons and native controls; production must verify keyboard order, visible focus, modal focus return, screen-reader names, 200% zoom, Hindi wrapping and mobile keyboard behavior.
- Design target: interactive controls at least 44×44 CSS px; principal phone actions 46–48 px. This is a comfortable design choice, stronger than WCAG 2.2's 24 px minimum with its exceptions. Native checkboxes need a sufficiently large associated label/hit area even when the visible box is smaller.
- Text should meet 4.5:1 contrast for ordinary text, 3:1 for large text; meaningful control boundaries/focus indicators need appropriate non-text contrast. Check final token combinations rather than assuming a warm palette is accessible.
- Skeletons keep final geometry. Respect reduced motion. No animation is essential to understanding status. Use polite live regions for save state and an alert for a blocking input error.

Sources used for the interaction direction: [Material adaptive layout](https://m3.material.io/foundations/layout/canonical-examples/overview), [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum), and [WCAG 2.2](https://www.w3.org/TR/WCAG22/). These inform the design; the atlas is not a WCAG conformance certification.

## 6. Performance and developer techniques

1. Keep server-rendered role shell, headings, initial scoped lists and summaries. Hydrate only interactive forms, search, status toggles and dialogs. Follow the installed Next.js 16.3 documentation rather than migrating frameworks for a visual refresh.
2. Reuse typed server repositories and permission checks. Parallelize independent reads; avoid one query per row. Select required columns, index actual filter/sort access paths after measurement, and paginate large directories at the server.
3. Use URL-backed filters and stable keys; debounce remote search, cancel stale responses, retain prior rows while updating, and return focus predictably. Do not cache a person's role or student data globally across accounts.
4. Lazy-load optional photo tools, export libraries and heavy charts when opened. Prefer simple CSS/SVG visual summaries. Avoid a new chart package for four bars.
5. Make saves explicit and idempotent. Optimistic local selection is fine for attendance toggles; persisted “Saved”, financial receipts and published reports require server acknowledgement. Keep pending/failed drafts distinguishable.
6. Route-level error/loading boundaries should match the final layout. Image dimensions are known ahead of load; thumbnails are right-sized and lazy-loaded outside the first viewport. No remote webfont payload is required.
7. Use shared component contracts and visual snapshots to prevent inconsistent buttons, corner radii and density. Build representative pages before spreading the pattern everywhere.
8. Measure with a production build: route/role-specific transfer size, request waterfalls and main-thread cost. Aim for the existing plan's p75 LCP ≤2.5s, INP ≤200ms and CLS ≤0.1. Those are targets, not measurements of this static atlas or live app. Record a before/after lab setup and field samples when available.

## 7. Pattern-state matrix

Every implemented task needs its happy path plus the applicable states below. `states` shows the visual language, but full behavior must be bound and tested in the app.

| Flow | Required states |
|---|---|
| Sign-in / landing | Pending, invalid credentials, expired issued link, inactive account, no assignment, valid preserved deep link |
| Search / directory | Loading, populated, no records, no matches, unavailable, long names, removed/deactivated record |
| Attendance / marks | Untouched, dirty, pending, saved, failed, expired session, stale second tab, retry, complete/read-only |
| SamPark | Draft, frozen issued audience, partially answered, completed, superseded, closed/unknown token, stale review |
| Fees | Pending payment, acknowledged payment, receipt, reversal/correction, no outstanding balance, unavailable fee source |
| Cover | Available, selected, pending assignment, assigned, newly conflicting, withdrawn/reassigned |
| Photo/import | Empty, selected, preview, invalid, unmatched, uploading, partial failure, retry, complete |
| Publication/export | Preparing, incomplete, ready, confirmed, published/downloaded, failed, stale source |
