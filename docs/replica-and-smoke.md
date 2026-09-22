# The replica, the deep smoke, and what they found

22 September 2026. `schoolfees-dev` was given a de-identified copy of the live
fee database, every QA account was made to work, and every screen was opened as
every account. This is what that produced.

## 1 · The replica (F6, D-186)

`npm run replica:plan` · `npm run replica:load` — `scripts/replicate-live.mjs`.

11,295 rows across 34 tables, read-only from `vgqyilgstjvgohrsiwkb` and written
to `wtgxcptmucjerhufzjcf`. The live client is sealed inside a closure whose only
exported function calls `.select()`, so there is no code path in the file that
can write to live.

**Exact, because it is what makes a test real:** every amount, due date,
payment date, receipt number, instalment plan, discount, carry-forward and
waiver. Dev and live both total **₹1,56,19,700 billed** and **₹57,30,757
receipted**, with 640 distinct receipt numbers.

**Replaced, because it is a person:** names, phone numbers, e-mail addresses,
street addresses and free-text notes. Aadhaar, Jan-Aadhaar, APAAR and
photographs are dropped rather than masked.

**How you can tell it is not live**, at a glance and in code:

- twelve surnames across 614 children — each name ordinary, the roster
  unmistakably generated the moment anybody sorts by name;
- every phone number in the `99999xxxxx` block;
- every e-mail address ending `.invalid`, which by RFC 2606 can never resolve;
- `aadhaar_no`, `jan_aadhaar_no`, `apaar_id`, `photo_path` all null;
- a row in `vppsone.data_replica` recording the run, so "is this live data?" is
  a question with an answer in the database.

Not copied: audit logs, telemetry, import staging, config-change snapshots and
every WhatsApp table — logs, or payloads whose JSON embeds the names this
exercise exists to remove. `docs/replica-report.json` lists all of it.

**Six rows live holds that live's own rules would reject today.** Six active
`third_child` discounts have no `family_group_id` and no manual-override flag,
so nothing records why that family got the discount; the trigger that requires
it only ever judged rows written after it existed. They are carried over with
the discount intact and marked, and are findable with:

```sql
select * from public.student_conventional_discount_assignments
where manual_override_reason like '[replica]%';
```

## 2 · The accounts

All eleven QA accounts exist and are passwordless. Two had never been created:
**`qa.fees` (accountant) had no staff profile and `qa.recovery` (fee_collector)
had no account at all** — the two roles the entire fee port exists for had never
been signed in as.

Passwordless is exact: each account has a bcrypt hash of a random value GoTrue
generated and nobody holds, so the magic link that `npm run dev:login` mints is
the only way in.

## 3 · The deep smoke

`npm run smoke:deep` — 11 accounts × 92 routes = **921 cases**, with timings.
`npm run smoke:roles` — 8 roles × 91 screens = **728 combinations**, checked
against both the permission map and PLAN §3.

Zero screens crash. `qa.inactive` is refused entry, correctly.

**The role matrix had never covered the 48 ported fee screens.** It read
`requirePermission` out of each `page.tsx`, and a ported fee screen has none —
its permission is in `(app)/fees/layout.tsx` and its finer-grained one is a
`requireStaffPermission()` in the fee app's own vocabulary. So the matrix
concluded "any member of staff may open this" and reported all 264 correct
refusals as failures. The direction that matters is the other one: it would
equally have passed a fee screen with **no guard at all**. It now reads both
vocabularies, follows layouts and re-exports, and 728 of 728 are as expected.

Fee screens each role can open, of 48:

| | opens | denied |
|---|---|---|
| admin | 41 | 0 |
| accountant | 32 | 9 |
| fee_collector | 32 | 9 |
| office | 12 | 29 |
| teacher, academic, exam, view_only | 0 | 47 |

The accountant's nine refusals are the fee app's own admin-only screens
("no edits outside the Payment Desk"), so that column is the fee app
reproduced faithfully. **Office is the one worth a second look:** `office`
reaches the fee screens as the fee app's Viewer, which is defined as
"Dashboard, Students, Defaulters and Receipts" and nothing else. If "office
reads fees" was meant to mean the whole desk minus the money, the fee app's own
`teacher` role is exactly that — "reads every workspace tab, no financial
writes" — and it is a one-line change in `feeRoleFor()`.

## 4 · The blocker (D-188)

**An accountant cannot post a payment**, and no client choice changes it.

Tried, not inferred. Signed in as `qa.fees` with a real session token and asked
`post_student_payment_with_adjustments` for ₹100 against a child with ₹58,500
outstanding, once through the user JWT the Payment Desk uses and once through
the service role:

```
user JWT (the Payment Desk's client):
  REFUSED — You do not have permission to post payments.
service role:
  REFUSED — You do not have permission to post payments.

receipts written by this probe: 0
```

`post_student_payment_with_adjustments` begins
`if not public.has_permission('payments:write')`, and `has_permission` is
`auth.uid() is not null and case private.current_staff_role() …`, which reads
only `public.users`. A VPPS One account fails it both ways: through the cookie
client because it has no `public.users` row (D-6 puts the role in
`vppsone.staff_profiles` so it is not kept in two places), and through the
service-role client because `auth.uid()` is null there.

Sixteen of the eighteen fee RPCs are gated this way. Six carry a
`coalesce(auth.role(),'') = 'service_role'` arm and work when called with the
service-role client — `preview_workbook_payment_allocation` is fixed that way
here, which is what made the Payment Desk load a child's dues at all. Ten do
not, and they include posting, undoing, refunding and every repayment-plan
action.

Three ways out, none of them an agent's call:

1. **One shared fee service identity** — a single row in `public.users` whose id
   is a dedicated auth user, used to sign the fee RPC calls. Role truth stays in
   `vppsone.staff_profiles`, which decides *whether* to call; `received_by` still
   records the real person on the receipt. One row, not twenty-eight.
2. **A fallback in `private.current_staff_role()`** to `vppsone.staff_profiles`.
   The cleanest end state — both halves of the merged app would agree — but it
   changes the fee database's own SQL, which at cutover means changing live.
3. **Per-staff `public.users` rows** — already rejected, and still the worst: a
   person's role in two places that can disagree.

## 5 · Two bugs that would have hit live on the first morning

**The academic session was chosen by sorting the labels** (D-187). Six places
did it — `resolveSessionLabel()` and its 92 callers, the nightly job runner,
three seeding scripts and the e2e harness. `TEST-2026-27` sorts above both
`2027-28` and `2026-27`, because `T` sorts above `2`, and the live fee database
has carried that rehearsal session for months. Every register, mark, cover plan
and dashboard would have worked in the rehearsal year — reading empty, writing
there, raising nothing. It was invisible until dev had more than one session,
which is what the replica produced. The teacher's day showed "आपकी कक्षा —" and
"no timetable in effect" on a school day; it now shows Class 1, 39 children and
8 periods.

**A `.in()` list of more than about 300 ids fails silently after eight seconds**
(F11). Measured on this deployment: 300 ids (~11 KB of URL) succeeds, 400
(~15 KB) does not. The school has 583 active children. `fetch` does not refuse
an over-long URL quickly — it hangs for eight seconds and then rejects, and call
sites written `const { data } = await …` turn that into an empty array. The
defaulters queue made two such calls, so it took **16 seconds** and rendered with
no promise counts and no repayment plans, and nothing said a query had failed.
Chunked at 200, it is **880ms** and the columns are populated.

The knowledge already existed in this repository — `ai-context-bundle.ts` has
the constant, and three other files have the reasoning as a prose comment. It
is now `platform/helpers/in-filter.ts`, so the next person writing
`.in("student_id", ids)` has one place to find it.

## 6 · Dev was not the twin it was believed to be

All three financial materialized views had **no grants at all** in dev, where
live grants them to `authenticated` and `service_role`. The Payment Desk
answered `503 permission denied for materialized view` for every account, with
or without data. Applied to dev and deliberately **not** written as a migration:
a migration can be replayed against live, live already has them, and rule 8
makes a write to live a stop-and-ask.

The earlier claim that dev is a schema twin was checked on columns and not on
privileges. The two are twins on 68 tables' columns; they were not on grants.
Live also has ten tables in `public` that dev does not — `staff_profiles`,
`subjects`, `timetable_slots` and seven others — and no ported code touches any
of them, so nothing depends on it today.

## 7 · The seeders could not rebuild the database

Three separate faults, each of which made `npm run seed:scenarios` stop
half-way and leave a partially-made database that looked finished:

- the collection request insert omitted `audience_kind` and `audience_label`,
  which the rounds work later made NOT NULL;
- the exam fixture took its subjects from the busiest class's timetable, and
  the busiest class need not be timetabled;
- `qa:seed` printed "run npm run qa:seed" as the remedy for a precondition it
  never created (D-190).

All three are fixed, and `npm run smoke:workflows` is **42 of 42** — including
the teacher attendance journey, which had only ever been skipped because the
last run happened on a Sunday.

## 8 · What would make this faster and easier, from what this session saw

Not a wish list — every item below is something that went wrong, or was
measured, in the course of this work.

### The two habits that caused most of it

**`const { data } = await …` throws the error away.** It is the shape behind
the 16-second defaulters page, behind four columns of missing data on it, and
behind the Payment Desk telling an accountant that a child's dues were "not
prepared" when the truth was a failed permission check. Each rendered a
plausible, wrong screen and said nothing. This repository already knows the
lesson — `fetchAllPages` exists because a dashboard read ₹56.8L instead of
₹1.14 Cr — but the knowledge lives in comments rather than in anything that
enforces it. **A lint rule banning a discarded `error` from a Supabase call
would have caught all three.** There are 156 `.in(` call sites; the same rule
shape could require them to be chunked.

**A screen that cannot get its data guesses at why.** "Dues are not prepared
for this student — Payment Desk can repair this only when Fee Setup is
complete" sent the reader to Fee Setup, which was correct and had nothing to do
with it. "Unable to load dues. Tap Retry or ask admin to check Fee Setup" did
the same on a 503. For a non-technical reader this is worse than a bare
failure, because it costs them a trip to a screen that will look fine.
**Separate "there is nothing here" from "we could not find out", and never
name a remedy the code has not checked.**

### Speed, measured

| | before | after |
|---|---|---|
| `/fees/defaulters` | 16,000ms | 880ms |
| `/fees/payments` | 503 | 76ms warm |

Everything else is already quick: the fee screens sit at 70–140ms warm, and the
heaviest remaining are `/fees/students` (~340ms) and `/fees/dashboard`
(~230ms). Two things are worth doing anyway:

- **First render costs 5–10× warm.** `/fees/payments` is 855ms cold and 80ms
  warm; `/fees/defaulters` 1,484ms then 880ms. The first person to open a
  screen each morning pays it. `tests/e2e/warm-server.ts` already warms five
  routes for the test suite — the same list, fired after a deploy, would move
  that cost off the accountant.
- **The student list loads 614 names alphabetically.** A fee desk does not
  think alphabetically; it thinks "who is in front of me" and "who owes". The
  search is good and instant, but the default ordering could be recent
  receipts, or defaulters first.

### Easier for somebody who is not technical

- **The dev database now looks exactly like real money, and the header says
  "Live".** ₹1.56 crore of correct-looking figures, real receipt numbers, real
  dates — and the session pill reads **`Live · 2026-27`**. It is not wrong:
  `session-pill.tsx` gives the "Live" treatment to the session the school is
  currently in, as opposed to an archived year or a `TEST-`prefixed one, and
  `2026-27` is exactly that. But **the app marks test *sessions* by label and
  has no way to mark a test *database*** — and the replica deliberately keeps
  live's labels, because changing them would have broken every parser that
  reads a year out of one.

  So the one screen element somebody would look at to answer "is this real?"
  answers yes. That is now a genuine hazard: the deployed app at
  `vppsone.vercel.app` reads this database, so it is showing ₹1.56 crore of
  fabricated money under a badge saying Live, and someone will eventually
  screenshot a figure from it into a WhatsApp group. A dev deployment should
  say so in a way that survives a screenshot — a tinted header bar, or the
  school name rendered as "Shri Veer Patta SSS (TEST DATA)". `VPPSONE_ENV` is
  already set and already known to the app; it is only a question of making it
  loud.
- **The keyboard shortcuts on the Payment Desk are the best thing on it** —
  `F1 Cash · F2 UPI · F3 Bank · F4 Cheque · ↵ Review`, already discoverable in
  the header. Nothing else in the app has an equivalent, and the two screens
  used at a counter all day (the register, the call queue) would benefit most.
- **The call queue is a list of 477 families, ordered.** What a collector needs
  is the next five calls, not the complete list — the ordering is already
  computed, so a "today's calls" band above the queue would turn a scroll into
  a task.
- **The empty states are genuinely good** — "The fee desk has no academic
  session", "no class of your own", "आज विद्यालय बंद है" — and they are the
  reason the missing fee data read as unconfigured rather than broken. That
  standard is worth holding to; the two error messages above are the exception,
  not the rule.
- **Offline attendance is advertised on the teacher's home** ("इंटरनेट चला जाए
  तो भी हाज़िरी लगती रहेगी") and is exactly the right promise for a school on a
  patchy connection. It is also the strongest argument for finishing the PWA
  decision (F8) rather than leaving the manifest inert.

## 9 · Signing in as any of them

All ten signable accounts are passwordless — each carries a bcrypt hash of a
random value GoTrue generated and nobody holds, so a magic link is the only way
in. `qa.inactive` exists precisely so that being refused can be tested.

```bash
npm run dev:login                  # list every account
npm run dev:login -- accountant    # a link for the fee desk
npm run dev:login -- teacher /teach
```

Run it from **PowerShell**, not Git Bash: Git Bash rewrites a leading-slash
argument into a Windows path, so `/teach` arrives as
`C:/Users/…/Programs/Git/teach`. Set `APP_ORIGIN` when the server is not on
port 3000.

For a bot, `scripts/deep-smoke.mjs` is the worked example: it mints a link per
account with the admin API, follows the redirect chain to collect the session
cookie, and reuses that cookie across every route. `scripts/smoke-roles.mjs`
does the same for one account per role. Neither involves a password anywhere,
and both refuse to run against anything but the dev project.

| key | account | role |
|---|---|---|
| `admin` | qa.admin | admin |
| `office` | qa.accountant | office |
| `accountant` | qa.fees | accountant |
| `feeCollector` | qa.recovery | fee_collector |
| `academic` | qa.academic | academic_coordinator |
| `exam` | qa.exam | exam_coordinator |
| `teacher` | qa.teacher | teacher, with a class and a full day |
| `teacher2` | qa.teacher2 | teacher, sharing no class with the first |
| `teacherWithoutClasses` | qa.teacher.none | teacher holding nothing |
| `viewOnly` | qa.viewonly | view_only |
| — | qa.inactive | deactivated; must be refused |
