# VPPS One go-live with the real 2026-27 data — the plan

Written 30 Oct 2026. **Nothing in this file has been run.** It was made by
reading both repos and the fees app's read-only MCP. No file in the fees
app, and no row in either database, was changed to write it.

Both repos were synced first. The fees app's `main` is at `8a0cd47c`
(#105, linked siblings get one reminder). One's `main` is at `0c8ac02`
(#139).

What the owner asked for, and where each part is covered:

| Ask | Where |
|---|---|
| One goes live with accurate 2026-27 data copied from the fees app | Phases 1, 2, 10 |
| Port the fees app's recent changes into One | Phase 5 |
| Razorpay exactly like the fees app | Phase 7 |
| AiSensy exactly like the fees app | Phase 6 |
| New: WhatsApp API messages to staff | Phase 8 |
| A session pill like the fees app's | Phase 3 |
| All of One's test data in a test session that only admin and test accounts can see | Phases 3, 4 |
| Never change the fees app's code or data | §1, enforced in every phase |

---

## 0. Where One's data lives

The existing cutover plan (`LIVE-MIGRATION-PLAN.md`, D-3, D-310) puts One
**on the live fee database** `vgqyilgstjvgohrsiwkb`. That plan has to:

- create the `vppsone` schema, buckets and `pgrst.db_schemas` on live, and
- replace two live fee functions, `private.current_staff_role()` and
  `public.has_permission(text)` (M2).

That is a change to the fees app's database, which the owner has ruled out.
**This plan replaces it with a copy model.**

### 0.1 Revised 30 Oct: One's main database is `wtgxcptmucjerhufzjcf`

The owner chose the existing project `wtgxcptmucjerhufzjcf`
(`schoolfees-dev`, https://wtgxcptmucjerhufzjcf.supabase.co) as One's main
database (D-338). **There is no new `vppsone-live` project.** Wherever this
plan says `vppsone-live`, read `wtgxcptmucjerhufzjcf`.

What that project holds on 30 Oct (read-only counts):

| Area | Contents |
|---|---|
| `vppsone` schema | Already in place: 86 migrations including the D-skip QA and smoke-lab set, and PostgREST already exposes it |
| `public` | The masked replica of the fee data, 11 fee migrations behind live, and QA receipts up to 27 Oct |
| Classes | 20 in 2026-27, 19 in TEST-2026-27, 19 in 2027-28 |
| Auth users | 51: 50 QA accounts on `@qa.vpps.local` and the owner. Nobody else signs in, so all `vppsone` activity is test activity |
| pg_cron | 5 jobs: the matview refresh, sibling-group refresh, EMI late fee, workbook enqueue, and `smoke-enforce` |
| Plan | The org is on the **free plan**: no point-in-time recovery and no Supabase-managed backups. The nightly Drive backup (D-334) is the only backup |

What changes in the phases:

- **Phase 1 becomes "turn dev into production" in place.** No schema
  bootstrap:
  - Catch up the 11 fee migrations, with their `cron.schedule` blocks
    stripped, and diff the schema against live read-only until they match.
  - A database marker `vppsone.deployment` (`environment = 'production'`)
    replaces "is this the dev ref?" in every guard. From then on these all
    refuse this project:
    - QA, smoke-lab and day-run sign-in
    - `qa-fixture`, `seed-*` and `replicate-live.mjs`
    - every `scripts/smoke/*`
  - The `smoke-enforce` cron is unscheduled.
  - The 50 QA auth users are banned.
  - The test accounts are new users the owner controls, for example
    plus-addresses on the school domain.
- **Phase 4 quarantines in place.** One's `vppsone` rows are relabelled to
  `TEST-2026-27` and re-pointed at TEST classes and new `TEST-D-` shell
  students **before** any real fee data is loaded. Dev student ids equal
  live ids, so a row left pointing at its old student would attach to a
  real child as soon as the real data arrives. Append-only tables are
  rewritten by inserting a copy and deleting the original, with their
  named triggers switched off for that statement only.
- **Phase 2 loads real data into this project's `public`.** It replaces the
  masked replica, and the `vppsone.data_replica` marker is updated.
  - one.vpps.co.in already serves this database. So the order is fixed:
    1. lockdown (Phase 1);
    2. TEST visibility (Phase 3);
    3. quarantine (Phase 4);
    4. `fee_writes_enabled=false`;
    5. only then the first real load.
  - Until T0, staff can view real fee figures in One but cannot write them.
- **Previews and local development lose their database.** Vercel Preview
  and Development, the local `.env.local`, CI smoke tooling, and the fees
  app's local development all point at this project today. **The fees
  app's local `.env.local` and its dry-run scripts
  (`verify-online-*-dryrun.mjs`, `SUPABASE_DEV_PROJECT_REF`) target this
  project too.** After the switch, running the fees app locally would act
  on One's production data. That needs an owner decision (Q19); this plan
  never edits the fees repo.
- **Backups.** The free plan has none.
  - The Drive nightly backup, plus a read-only `pg_dump` before every real
    load and at T0, is the minimum.
  - Pro (point-in-time recovery, daily backups, and room for a separate dev
    project) is recommended (Q1).

The rest of this plan (sessions, quarantine rules, the fee port, Razorpay,
AiSensy, staff WhatsApp, cutover, rollback) holds as written.

---

## 1. Rules that hold for the whole migration

**I-1. The fees app's code, Vercel project and env never change.**
- `fees.vpps.co.in`, `schoolfees-two.vercel.app` and `vpps-one.vercel.app`
  keep serving it (D-337).

**I-2. Migration tooling never writes to the live fee database.**
- No DDL, DML, roles, cron jobs, Vault entries or migrations.
- The fees app goes on writing its own rows in normal use. That is not us.
- Any fees-side setting the owner chooses to change through the fees app's
  own screens is listed as an owner question (Q7, Q8). It is never done by
  tooling.

**I-3. Every read of live is read-only by construction.**
- `pg_dump` and `psql` run with `default_transaction_read_only=on`, inside
  one `REPEATABLE READ READ ONLY` transaction with an exported snapshot.
- Supabase-js clients are wrapped so that only `select`, Storage `list`,
  Storage `download` and `createSignedUrl` exist. Every other method
  throws, and a test proves it.
- This amends `CLAUDE.md` rule 3 ("read live only through
  `replicate-live.mjs`") for `scripts/migrate/*` only. It needs a D-number.

**I-4. Money rules are copied, not rewritten.**
- The fee SQL engine arrives by schema dump.
- Every intentional difference in One's fee functions is listed in §5.3,
  with before and after `fee_contract_fingerprints()`.

**I-5. No real personal data in git** (rules 3 and 6).
- Snapshots, id maps and per-student reports stay in
  `%USERPROFILE%\.vppsone-migration\<run>\`.
- Copied `auth.users` rows hold password hashes. They are treated as
  secrets: kept in an encrypted folder and deleted after each load.
- Reports in the terminal or in PRs carry counts, sums and hashes only.

**I-6. Secrets are handled by name only.**
- The live DB connection string goes into the secrets file
  (`%USERPROFILE%\.schoolfees-secrets\`), never into chat.

**I-7. One sender per channel at any moment.**
- Before T0, only the fees app mints pay codes, opens Razorpay orders,
  posts money and messages parents. After T0, only One does.

**I-8. Every importer is idempotent.**
- Each one has `--dry-run` as the default and refuses any target other
  than its own.
- Each run writes a row to `vppsone.migration_runs`.

**I-9. The owner says yes to each step that can't be undone.**
- The new project and its cost, the start of cutover, the One Razorpay
  webhook, template submission, the first real parent send, and retiring
  the fees app.

---

## 2. Where things stand today (30 Oct)

**Databases**

| | Ref | What it holds |
|---|---|---|
| Fees live | `vgqyilgstjvgohrsiwkb` | The real data. Postgres 17.6, ap-south-1. Has all 11 fee migrations of 26–30 Oct (online payments, `_v6` reminders). No `vppsone` schema. |
| Dev | `wtgxcptmucjerhufzjcf` | A masked copy of live from 22 Sep, plus One's `vppsone` schema and all of One's test and QA activity. one.vpps.co.in runs on it today. Its fee schema is 11 migrations behind live. |

**Live control totals for 2026-27** (fees MCP, 30 Oct 09:44Z). The copy must
match these exactly at the moment it is taken.

| Figure | Value |
|---|---|
| On roll / collectable | 509 / 512 |
| Expected | ₹1,32,66,950 |
| Paid | ₹62,53,084 |
| Fees pending | ₹70,06,866 |
| Late fee charged / waived / pending | ₹3,84,000 / ₹8,59,000 / ₹3,77,750 |
| Discount / closeouts | ₹14,95,600 / ₹17,250 |
| Carry-forward original / collected / pending | ₹8,95,000 / ₹6,12,825 / ₹2,49,800 |
| Students | 616: 509 active and 28 left in 2026-27, 79 in TEST-2026-27 |
| Receipts | 775: 708 in 2026-27 totalling ₹65,05,784, 67 in TEST |
| Sessions | `2026-27` (current), `2027-28` (classes only), `TEST-2026-27` |

**What One already has**
- The fee app port at fees `48beb9a6` (#32), under `src/app/(app)/fees/*`.
- The fees session switcher and the session pill components
  `src/ui/shell/{session-pill,shell-session-pill,mobile-session-pill}.tsx`.
  They are ported but **not rendered**: VxShell only shows the session in
  the role line (`src/vx/shell/shell.tsx:121-123`).
- The TEST styling already exists (`globals.css:807-827`).
- AiSensy at the base version.
- The staff-notice outbox (D-214).

**What One is missing**
- All Razorpay code.
- 37 fee commits (`4ac3a292..8a0cd47c`).
- Any rule about who may see a test session.
- A notion of a test account on live.
- Any importer or reconciliation tooling.

**Dev's test data has the real label.** Almost all of One's dev activity is
labelled `2026-27`. Because `replicate-live.mjs` keeps primary keys, dev
student and class ids **equal live ids**. Copying dev rows across as they
are would attach test attendance and marks to real children.

**Open fact to settle first.** D-334 and D-335 suggest real staff already
use one.vpps.co.in, for example office document uploads to Drive. Any real
activity on dev has to be found and kept (Phase 4, Q12).

---

## 3. Phases, in order

There is one PR per phase into One's `main` (rule 5). Dates assume the
owner answers §6 by 4 Nov. T0 is proposed for **Sunday 13 Dec 2026**
(Q3), which leaves a 4-week parallel run before installment 4 on 20 Jan.

| Phase | What | Proposed dates | Gate to move on |
|---|---|---|---|
| 0 | Decisions and access | 2–4 Nov | §6 answered; live read access set up |
| 1 | New database, guards, schema bootstrap | 4–7 Nov | Schema equal to live |
| 2 | Importer, reconciliation, mirror mode | 6–16 Nov | 3 exact nightly reconciles |
| 3 | Session pill, TEST session, test accounts | 9–17 Nov | Visibility test matrix green |
| 4 | Test-data quarantine and real master data | 16–21 Nov | Quarantine checks pass; owner signs the promote list |
| 5 | Port the fee changes | 9–20 Nov | Ported fee tests green; export diff clean |
| 6 | AiSensy for parents | 16 Nov–1 Dec | Staging sends to allowlisted phones only |
| 7 | Razorpay | 20 Nov–4 Dec | Test-mode end-to-end on staging |
| 8 | Staff WhatsApp | 23 Nov–4 Dec | Every kind sent once to a test phone |
| 9 | Monitoring, backups, env | 1–8 Dec | Health pack and restore test |
| 10 | Rehearsals 1 and 2 | 6 and 10 Dec | Under 3 hours, all green |
| 11 | Cutover | T0, Sun 13 Dec | Runbook §11 |
| 12 | Parallel run, then sign-off | 13 Dec–10 Jan | §12.4 criteria |

Templates take Meta 1–3 days to approve. They are submitted early: the
parent set by 18 Nov, the staff set by 20 Nov.

---

### Phase 0 — Decisions and access

**PR-0 adds new D-numbers from D-338.** Each one supersedes something:

| New decision | Supersedes |
|---|---|
| Copy model | D-3, D-310 |
| One's own production database | — |
| The live read path for `scripts/migrate/*` | rule 3 |
| The `vp1_` payment reference prefix | — |
| The receipt suffix band | — |
| Test-session visibility | — |
| Staff WhatsApp | — |
| App-sent parent fee messages (receipt, reminder, fee statement, school notice) | D-10, D-76, D-270, D-291 |

- Mark these as superseded: `README.md:6-13`, `PLAN.md` §1 and §9,
  the fee section of `PARITY.md`, `CUTOVER.md` and
  `LIVE-MIGRATION-PLAN.md`.

**Live read access**
- `pg_export_snapshot` needs a session-mode Postgres connection to live:
  the Supavisor session pooler on port 5432, or the IPv4 add-on.
- Only the dev DB password exists locally today. The owner adds the live
  connection string to the secrets file.
- The owner also allows read-only production access for the named scripts
  in the Claude permission settings. In this session the classifier
  refused live SELECTs.

**Vercel plan**
- Check the team plan. A custom "staging" environment with Vercel
  Authentication needs Pro.
- On Hobby, use a protected preview branch deployment with its own env set
  instead.
- On Hobby, crons fire anywhere within the hour. So time-critical jobs
  (auto-day-close, day summary, staff notices) run from pg_cron on One's
  database, not from Vercel cron.

---

### Phase 1 — New database, guards, schema bootstrap (PR-1)

**1.1 Project**
- Create `vppsone-live` in ap-south-1 on Postgres 17, in the same org,
  with point-in-time recovery switched on. The owner creates it and
  approves the cost (Q1).

**1.2 Target guards**
- `src/platform/supabase/target-guard.ts:29-32` and
  `scripts/target-guard.mjs:16-17`:
  - add `ONE_LIVE_PROJECT_REF`;
  - rename the live fee ref to `FEES_SOURCE_PROJECT_REF`. The app may
    never target it.
  - `VPPSONE_ENV=live` allows only `ONE_LIVE_PROJECT_REF`.
- `scripts/migrate/*` may open the fees ref only through
  `openFeesReadOnly()`.
- Check that `testSignInEnabled()`, `smokeLabEnabled()` and the day-run
  checks still fail closed on the new ref. Then `/login/test`,
  `/login/dayrun*` and `/lab/*` must answer 404 in production.

**1.3 `scripts/migrate/bootstrap-schema.mjs` (read-only on live)**

1. Dump schemas `public` and `private` with `pg_dump --schema-only`.
   - **Keep privileges.** `--no-privileges` would leave every money RPC
     executable by anon until the grants are re-applied.
   - Gate: per role, the anon and authenticated EXECUTE and table grants
     equal live's.
2. Dump the objects a schema-restricted dump leaves out, by catalog SELECT,
   and replay them:
   - Storage RLS policies on `storage.objects` (photos, voice notes,
     backups, notice documents).
   - The `auth.users` trigger `sync_staff_profile_from_auth_users`.
   - Realtime publication membership for `office_sync_events`, which
     `OfficeSyncListener` depends on.
   - `ALTER DEFAULT PRIVILEGES`.
   - The extensions list.
   - Bucket definitions.
   - The `supabase_migrations` ledger.
   - Not dumped: `cron` and `vault` contents. One creates its own at
     cutover (§11).
3. Apply One's `vppsone` migrations one at a time, in filename order.
   - Skip the six D-skip files (smoke lab ×3, QA fixtures, QA cleanup,
     overnight QA sessions).
   - Include the four files the old plan never classified:
     `late_cover_assign`, `assist`, `document_storage_providers` and
     `drive_central_backup`.
   - Then `20260922100000`, `20261006043431` and
     `docs/cutover/fee-collector-posts-payments.sql`. These are now
     allowed, because this is One's own database.
   - Then the new One-only migrations from Phases 2, 3, 7 and 8.
   - Expose `vppsone` to PostgREST.
4. Take the fingerprints twice: right after the dump, and after One's
   fee-function changes (§5.3). Both are recorded.

**1.4 Role precedence (D-207) must be decided before PR-1 (Q5)**
- Once the auth trigger is replayed, every account created in One's
  `/staff` also gets a `public.users` row with a `read_only_staff` role.
- `current_staff_role()` reads `public.users` first. So One's admins and
  accountants would fail `has_permission('payments:write')`.
- Map the 10 fee users to One roles in a table, and give each a
  `vppsone.staff_profiles` row.
- Rehearsal 1 checks `private.current_staff_role()` under every seat's
  token.

**1.5 Dev catch-up**
- Apply the 11 fee migrations (26–30 Oct) to dev so that One's tests meet
  the schema they will meet in production.
- **Strip their `cron.schedule` blocks first.** Otherwise dev's pg_cron
  calls the production fees app at `schoolfees-two.vercel.app`.
- Afterwards, assert that dev's `cron.job` contains no `schoolfees-two`
  URL.
- Add a sweep migration that revokes anon EXECUTE on dev's 22
  SECURITY DEFINER functions.

---

### Phase 2 — Importer, reconciliation, mirror mode (PR-2)

**2.1 Bookkeeping tables** (One-only migration)
- `vppsone.migration_runs`
- `vppsone.migration_id_map(source_project, source_table, source_id, target_id, batch_id)`
- `vppsone.migration_watermarks`

**2.2 `extract-live.mjs`**
- Opens one read-only transaction and calls `pg_export_snapshot()`.
- Inside that snapshot:
  - `pg_dump --data-only --snapshot=…` of `public`, without the matviews;
  - the `auth.users` and `auth.identities` rows for the fee users;
  - the control totals (§2.5).
- **The watermark is the snapshot itself:** its id plus the `now()` read
  inside the same transaction. It is not a wall-clock time recorded
  beforehand.

**2.3 `load-snapshot.mjs --dry-run|--apply`**
- Loads into `import_stage.<t>`, created `LIKE public.<t>`, by rewriting
  each `COPY public.` line to `COPY import_stage.`. It refuses to run if
  any `COPY public.` line is left.
- Diffs staging against `public` by primary key.
- With `--apply`, in one transaction:
  - disable the named user triggers (append-only, audit, matview queue).
    Do not use `session_replication_role=replica`, which also switches
    off foreign keys;
  - upsert the changed rows;
  - delete the rows missing from the source, except protected rows (§4.3);
  - re-enable the triggers;
  - check for foreign-key orphans on every constraint in `pg_constraint`;
  - refresh the matviews and run `setval`.
- **It refuses to run at all once `migration_runs` holds a `cutover` row or
  `fee_writes_enabled=true`.** After T0, a stray re-run would otherwise
  delete every receipt One has posted.

**2.4 Imports with special rules**

| Table | Rule |
|---|---|
| `app_settings` | One-owned keys are never overwritten: `online_payment_*`, the receipt and reversal notice switches, `receipt_suffix_floor`, the staff WhatsApp cap |
| `online_payment_orders`, `_intents` | Imported only in a terminal state. Anything else is rewritten to `imported` (a One-only enum value), so One's reconciler never touches it |
| `online_payment_captures`, `online_payment_events` | Only terminal rows |
| `notification_outbox` | Only terminal rows. Anything else becomes `suppressed`, or One's drain would re-send fees receipts to parents |
| `whatsapp_reminder_sends`, `school_notice_sends`, campaigns, runs | Every kind, so that One's cadence and claim indexes see the fees history |
| `auth.users` | Upsert by id; refuse on an email clash. Password hashes kept or forced to reset per Q6 |
| Staging and backup history (`import_*`, `backup_runs`) | Skipped, unless the owner says otherwise |

**2.5 `reconcile.mjs`**
- Runs on both sides, inside the same snapshot. It exits non-zero on any
  difference and prints counts, sums and hashes only.
- What it checks:
  1. Row count and an ordered md5 for every copied table.
  2. The session money summary for `2026-27` and `TEST-2026-27`, using the
     exact definitions in `workers/schoolfees-mcp/src/scope.mjs:27-54`.
     Cross-checked once against the fees MCP `get_session_money_summary`.
  3. Per-class rollups.
  4. A per-student checksum over `v_workbook_student_financials`. On a
     mismatch it prints the first 20 student ids.
  5. Receipts:
     - count and sum per mode per date;
     - the maximum suffix per (prefix, date);
     - distinct receipt numbers equal the row count.
  6. The online invariant `Captured = On receipts + In review + Waiting`.
  7. WhatsApp send counts per status and per kind.
  8. Storage object counts and bytes per bucket.
- Late fees depend on the date. So every comparison across days uses a
  fixed `as_of` date (`private.workbook_installment_snapshot(…, as_of,
  true)`), and EMI late fees are a line of their own.
- The quarantine shells and rows recorded in `migration_id_map` are
  excluded and counted separately. Without that, equality could never
  pass after Phase 4.

**2.6 `storage-copy.mjs`**
- Reads from fees through the sealed client and copies `student-photos`,
  `parent-documents` and `defaulter-voice-notes` to the same paths,
  idempotent by path and size. It skips `nightly-backups`.

**2.7 Mirror mode**
- A full snapshot, diff-apply and reconcile runs nightly at 23:30 IST,
  and on demand. The data is about 60,000 rows plus 43,000 audit rows, so
  every run starts from scratch and heals itself.
- **`fee_writes_enabled=false` is enforced in the database, not only in
  the app.**
  - A One-only guard inside `private.post_student_payment_core` and the
    other money RPCs reads it, and EXECUTE is revoked from
    `authenticated` while it is off.
  - The app check sits in one place, the fee Supabase server-client
    wrapper, covering every write into `public`: payments, student edits,
    bulk update, imports, family links, concessions, promotion,
    `defaulter_contacts`, `refresh_defaulter_recovery_state` and policy.
  - A test tries a direct RPC call and expects it to be refused.

---

### Phase 3 — Session pill, TEST session, test accounts (PR-3)

**3.1 Sessions**
- They are the fees app's own sessions, copied with the same ids:
  `2026-27` (current), `2027-28` and `TEST-2026-27`.
- **The test session is the existing `TEST-2026-27`.** Do not invent a new
  `TEST` label: `fee-rules.ts:19-20` requires `(PREFIX-)YYYY-YY`, and a
  second test label brings back the sorting trap (D-187).
- `app_settings.active_session_label` stays `2026-27`. Use
  `pickSessionLabel()`, never sort labels.

**3.2 Test accounts**

New One migration:
- `vppsone.staff_profiles.is_test_account boolean not null default false`.
- It is changed only by a non-test admin, through a SECURITY DEFINER RPC
  that refuses to act on oneself and is logged to
  `staff_authority_changes`.

One shared definition, used by both the database and the app:

| Function | Meaning |
|---|---|
| `is_test_session(label)` | `label ~* '^(TEST\|UAT\|DEMO)-\d{4}-\d{2}$'`, the same as `isTestAcademicSessionLabel` |
| `current_is_test_account()` | The viewer's `is_test_account` flag |
| `is_real_admin()` | Role admin **and not** a test account |
| `can_see_test_sessions()` | `is_real_admin() or current_is_test_account()` |

Live test accounts are ordinary auth users with mailboxes the owner
controls. The proposed seats are admin, accountant, fee_collector, office,
2 teachers and academic coordinator (Q4). The owner creates them in
`/staff`. They never reuse dev ids or `@qa.vpps.local`.

A **test admin is fenced to TEST like every other test account**. It can
never read or write real 2026-27.

**3.3 The pill, the same as the fees app**
- Render `ShellSessionPill` inside `<Suspense>` in the VxShell top bar, and
  `MobileSessionPill` at phone width. Diff both against fees HEAD first.
- Persistence stays the fees app's:
  - the cookie `vpps_view_session` (30 days, `sameSite=lax`);
  - `?session=` wins over the cookie;
  - the existing sync guard.
- Native screens follow the pill:
  - `src/app/(app)/layout.tsx:28-43` uses `resolveViewSession` for every
    viewer allowed to switch;
  - `resolveSessionLabel(requested)` in `academics-repo.ts:513` threads the
    requested label through.
- On dev, drop the "Live ·" prefix.
- Admin "view as" (`src/vx/view-as.ts`) shows the sessions the previewed
  role would see.
- `getSessionSwitcherData` caches the unfiltered list and filters per
  viewer after the cache.
- Who sees the pill (Q2). Recommended:
  - fee readers, coordinators, admin and test accounts;
  - teachers stay on the active session, with no pill;
  - `2027-28` is visible to fee readers, as in the fees app.

**3.4 Where TEST visibility is enforced** — no single layer is trusted.

1. **The switcher list** (`switcher.ts:46`, `listAvailableSessionsAction`).
   Split `REQUIRED_OFFICE_SESSION_LABELS` into production and test lists.
2. **Setting the session.** `setViewSessionAction` (`fees/session/actions.ts:17`)
   refuses a forbidden label and leaves the cookie as it was.
3. **Resolving the session.** `resolveViewSession` falls back to the active
   session for a forbidden cookie or URL label and deletes the cookie.
   Test accounts default to `TEST-2026-27`.
4. **Loaders by id and by number**, which take no session. A new
   `assertStudentVisible(staff, studentId)` (student → class → session) is
   applied to:
   - `/fees/students/[id]`
   - receipt detail and print
   - student and receipt search
   - student summary
   - family pages
   - exports
   - `/pay/[code]`
   - `assist`
5. **Writes.** `assertSessionWritable` is called in every action that takes
   a session label:
   - fee: desk, family payment, reversal, waivers, reminders;
   - native: attendance, marks, notes, cover, collection.
6. **The database**, `vppsone` only. One RESTRICTIVE policy per
   session-labelled table, covering USING and WITH CHECK:
   `(is_test_session(session_label) = current_is_test_account()) or is_real_admin()`.
   Child tables (`attendance_marks`, `marks` and so on) get an `EXISTS`
   join to their parent's label.
7. **Jobs and crons** run on the active session only.

**Accepted limit, signed by the owner (Q4).** The fee tables in `public`
keep the fees app's permission-only RLS while mirror mode runs. A test
account reading PostgREST directly could see real fee rows. Points 3–5
close this in the app. The database gap is reviewed after the fees app
retires.

**3.5 Checks**
- A unit test matrix: role × label × read/write.
- Playwright:
  - office and teacher: never see TEST; `?session=TEST-2026-27` lands on
    2026-27; opening a TEST student by id is refused;
  - admin: switches in and sees the fuchsia border;
  - test admin: cannot open a real student by id and cannot write 2026-27;
  - mobile width.
- SQL under each seat's token.
- Pill screenshots at desktop and 375px, compared with the fees app.

---

### Phase 4 — Test-data quarantine and real master data (PR-4)

**4.1 Classify** — `classify-dev-vppsone.mjs`, read-only on dev, prints
counts per bucket.

| Bucket | Rows | What happens |
|---|---|---|
| A. Real master data | Subjects, class aliases and seats, bells, cover policy, calendar, report schemes, note kinds, templates, school settings, real teacher profiles | Promoted to real 2026-27. The owner signs the list |
| B. Test activity | Attendance, marks, assessments, notes, records, follow-ups, support plans, absences, cover, substitutions, staff notices, message sends and campaigns, parent queue and replies, collection, tasks, leave, enquiries, admissions, report cards, fee promises, day close, desk requests, reminder batches, exports, documents, photo proposals | Moved into `TEST-2026-27` |
| C. Never copied | Smoke and QA machinery, `data_replica`, `external_student_ids`, SamPark import rows, `job_runs`, `assist_log`, `drive_*`, dev's whole masked `public` | Left behind |

**4.2 Promote** (`promote-dev-master-data.mjs`)
- Re-import the timetable from `tests/fixtures/timetable-2026-27.csv` with
  `seed-timetable.mjs` (1,038 slots, 172 assignments) rather than copying
  dev's two edited versions.
- `role_permissions` comes from the migration seed, not from dev.
- Drop any row written by, or pointing at, a QA, smoke or day-run profile.
- Null `user_id` on every promoted profile. The real staff sign in again
  on the new project.
- Scan promoted text for `qa.vpps.local`, `vercel.app` and `99999`.
- Dev has 20 classes for 2026-27 and live has 19. The extra one is listed
  for the owner to map or drop.

**4.3 Quarantine** (`quarantine-dev-test-data.mjs`; source is dev, target
is the new project only)
- **Every dev profile, real teacher or QA seat, is mapped to a test
  account.** Quarantined tasks, cover duties and notices therefore never
  appear on a real teacher's screen or reach the dispatcher.
- Students:
  - Dev students that are already live TEST students (same ids) map to
    those.
  - Any other student referenced by bucket B gets a TEST shell:
    `admission_no 'TEST-D-0001…'`, a uuid v5, the masked name, a TEST
    class, and **every phone, email and address null**.
  - Protected rows are the shells and anything in `migration_id_map`. The
    mirror never deletes them.
- Every other id gets a new uuid v5 from `dev:<table>:<id>`, so a re-run is
  idempotent and every mapping is recorded in `migration_id_map`.
- Every `session_label` becomes `TEST-2026-27`.
- Every phone, destination and token column on quarantined rows is nulled.
  The masked `99999…` numbers are real, reachable mobile numbers.
- `message_sends` become `cancelled` with `sent_at` null; `send_status` has
  no `suppressed` value. `staff_notices` become `suppressed`.
- Documents: metadata only, unless the owner wants the files (Q12).

**4.4 Real activity on dev.** If real staff have been using
one.vpps.co.in, the owner names which dev activity is real (Q12):
- Real activity is promoted, not quarantined.
- Before C1, dev goes read-only (a maintenance flag). Classify, quarantine
  and promote then run again inside the freeze.

**4.5 The 79 live TEST students.** They arrive with real contact numbers.
- Their phones are nulled in One, or added to the test allowlist (Q12).
- A `reset-test-session.mjs` script names `TEST-2026-27` explicitly. In
  Aug 2026 a bulk import moved 372 real students into TEST.

**4.6 Checks** (all must pass on the new project)
- No quarantined row points at a real student. Repeated for every
  student-keyed table.
- `vppsone` rows labelled 2026-27 are bucket A only.
- No TEST row carries a phone number.
- RLS: the office token sees 0 TEST rows; the test teacher token sees 0
  real rows and cannot insert into 2026-27. Repeated in the app, because
  the app writes with the service role (D-179).
- A dry-run re-run reports 0 inserts.
- The real 2026-27 reconcile hash is the same before and after.

---

### Phase 5 — Port the fees app's changes (PR-5, plus parts of PR-6 and PR-7)

**5.1 What to port.** The fees app runs `48beb9a6..8a0cd47c`, 37 commits.
Map paths `src/app/protected/` → `src/app/(app)/fees/` and re-run
`scripts/port-rewrite-imports.mjs`. Every new file goes inside
`PORTED_TREES`.

| # | Fees change | Size |
|---|---|---|
| P1 | SBC category; category labels match regardless of case (`311d2c31`, `22e86f35`) | S |
| P2 | Anon EXECUTE revoked on two analytics functions (#85). Arrives with the dump; dev gets the sweep (§1.5) | S |
| P3 | Faster deletion-safety reads, an audit index, single-pass segment counts (`55702747`) | S |
| P4 | Student export with photos (#79) | S |
| P5 | `online` reads "UPI (Razorpay)", never Cash, everywhere (#86, #103). Also the TEST-session resend rule in `run-sender.ts` | S–M |
| P6 | Reminder profiles, the ladder, school notices, `_v6` with Pay now, cost (#82) | L |
| P7 | "Why N?", chips, per-phone billing (`f6e09bc5`) | M |
| P8 | Fast reminders (`0320bd4e`) | M |
| P9 | Installments and last year's dues in one message (`e4454db9`, `5ea84a5b`) | M |
| P10 | Send-system sweep, late fee waived by default, RTE rule, desk fixes (`1b932785`) | M |
| P11 | Linked siblings get one reminder (#105) | S |
| P12 | Razorpay online payments, receipt on posting, no late fee online (#84–#104, `f2990cf1`) | L — Phase 7 |
| P13 | Dependency fixes | S |

Order: P1–P5, then P6–P11 as one block with P11 last, then P12.

**5.2 Which decisions win where One differs from the fees app (Q9)**

| Decision | Recommendation |
|---|---|
| D-318, One's due rule on screens | Keep it for display. Reconciliation uses the engine's views only. Training explains the two figures |
| D-274, no counter concession | Keep it. It avoids a known ledger bug in the fees app |
| D-270, receipt WhatsApp sent by hand only | Supersede at cutover: automatic, as in the fees app |
| D-291, no reminder job | Supersede once parity is proven |
| D-10, D-76, the app may not send to parents | Supersede for the four fee categories only |
| D-180, office is view-only | Owner's call (Q9). Office posts in the fees app today |

**5.3 Every intentional difference in One's fee functions**
- The `vp1_` reference prefix (Phase 7).
- The receipt suffix floor (Phase 7).
- The TEST receipt prefix, generated outside the core function (Q10).
- The `fee_writes_enabled` guard (§2.7).
- `fee-collector-posts-payments.sql`.
- `20260922100000`.

Each one gets a `begin … rollback` dry-run script and a fingerprint entry.

**5.4 Checks**
- Every ported fees unit and integration test passes in One.
- `npm run verify:fee-parity` matches the bootstrap baseline.
- On the same snapshot, fees and One are compared for:
  - every export, sheet by sheet: `ai-context-bundle` (its sheet and
    column names must not change; the owner's `vpps-fee-list` skill reads
    them), student master, previous-year dues, left-student dues, EMI,
    receipt register, defaulters, class-wise dues, concessions and
    transactions;
  - 10 receipts on A4 and on the office printer: cash, UPI, online, cheque,
    discount, family and carry-forward. This covers Hindi fonts, the
    `NEXT_PUBLIC_SCHOOL_*` header and the One footer.
- At rehearsal 2 the accountant signs a per-route acceptance sheet:
  48 screens and 16 API routes. Deliberate gaps are marked.

---

### Phase 6 — AiSensy for parents, the same as the fees app (PR-6)

**6.1 Port**
- P6–P11, plus the receipt, reversal, fee-statement and school-notice
  senders at fees HEAD.
- The same endpoint, `AISENSY_API_KEY` and AiSensy project.
- `source` becomes `vppsone/…` so AiSensy reports can tell the two apps
  apart.
- Recipients: the father, else the mother; the second parent after two
  sends; `no_call`, cadence `never` and bad numbers excluded.
- `student_collection_flags.no_call` defaults to TRUE, so every insert
  passes `false` explicitly.

**6.2 Templates**
- Reused unchanged, because they have no URL button:
  - receipt `_v5` (fallback `_v3`)
  - fee statement and reversal `_v1`
  - school notices `_v1`
  - `late_fee_applied`
- **New `_v7` set:** the 11 situations that carry Pay now, in Hindi and
  English, so 22 templates.
  - The `_v6` buttons are fixed by Meta to `schoolfees-two.vercel.app/pay/`.
  - `_v7` keeps **exactly the `_v6` parameter layout**; only the host
    changes to `one.vpps.co.in/pay/`.
  - A unit test checks the parameter count for each situation against
    `APPROVED_V7`.
- One never sends `_v6`. If `_v7` is not yet approved, the text-only form
  is sent instead.
- Before the first `_v7` send, families get a notice that Pay now comes
  from a new address.

**6.3 One choke point for every parent send** (`src/modules/whatsapp/data/aisensy.ts:61`)

Today the ported senders call AiSensy directly and ignore `parent_dispatch`.
The new gate checks, in this order, and fails closed:

1. `VPPSONE_ENV === "live"`.
2. `runtime_flags.parent_dispatch` is on.
3. `parent_dispatch_categories` includes this kind.
4. If the session is a test session, the actor is a test account, or this
   is not the production deployment, the number must be in
   `vppsone.message_test_recipients`.

Staging therefore never messages a real parent.

**6.4 Duplicates**
- One's sender refuses any student who already had any send that day, or
  inside the cadence window, **whatever the campaign**. The claim index
  includes `campaign_name`, so a fees `_v6` send and a One `_v7` send
  would otherwise both go out.
- Retry and reconcile are refused for imported rows (`created_at` before
  the cutover watermark).
- `/pay/[code]` refuses pay codes the fees app minted.
- "Absent today" messages to parents have one owner (Q13): either the
  ported fees school notice or One's native attendance message (D-320),
  never both.

**6.5 Crons on One's own database, created only at cutover**

They are set up by a runbook file, `docs/cutover/one-live-cron-jobs.sql`,
so dev never gets production URLs.

| Job | Schedule |
|---|---|
| `whatsapp-scheduled-runs` | 09:30 IST |
| `refresh-workbook-materialized-views` | every 2 minutes |
| `enqueue-workbook-refresh-daily` | daily |
| `charge-emi-late-fees-daily` | daily |
| `online-payments-reconcile` | every 10 minutes |
| `staff-notices` | every 5 minutes (Phase 8) |

- Every campaign stays manual, not `schedule.auto`, until at least T+14
  (Q11).

---

### Phase 7 — Razorpay, the same as the fees app (PR-7)

**7.1 Port from fees HEAD**
- Domain: `payments/domain/online/*` and `upi-open.ts`.
- Data: `razorpay-client`, `service`, `orders`, `after-posting`.
- The webhook at `/api/webhooks/razorpay`, the same path shape as the fees
  app, plus `/api/fees/webhooks/razorpay`.
- The cron `/api/fees/cron/online-payments`.
- The parent page `/pay/[code]` with every piece of it, and `status`.
- The staff screen `/fees/payments/online`, gated `fees:accounts`.
- All `online-*`, `pay-request-origin` and `upi-payment-link` tests, and
  the three dry-run scripts.
- The database side arrives with the dump.

**7.2 Make these paths public in the middleware**
- One's middleware redirects any request without a session to `/login`,
  except `PUBLIC_PATHS` and `/r`, `/t`, `/w`, `/api/jobs` and `/api/lab`
  (`src/platform/supabase/middleware.ts:29,44-55`).
- Without this change, Razorpay's webhook, the crons and parents tapping
  Pay now would all land on the staff login page.
- Add `/pay`, `/api/webhooks`, `/api/fees/webhooks` and `/api/fees/cron`.
  Each route keeps its own secret or signature check.
- An architecture test lists every route that has a secret or token and
  checks that it answers a cold request with no cookie.

**7.3 The two apps never process each other's payments**
- One mints `vp1_` references: intents `vp1_…`, orders `vp1_o_<uuid-hex>`.
  The fees app ignores them, because its ownership check is `vpps_`.
- **The order path matches only on `provider_order_id`, so the prefix check
  is also added there.** One refuses `vpps_` in:
  - the TypeScript: `processOrderPayment`, `reconcileOpenOrders`, the
    intents pass, `applyCapture` and `applyOrderCapture`;
  - the SQL `online_payment_{record,apply}_{order_,}capture` functions.
- A test sends a fees `order_*` event to One's webhook after the order was
  imported, and expects `not_ours`.

**7.4 Receipt numbers**
- Every receipt is copied with its number. One carries on each day's
  sequence.
- **From T0 until written sign-off, `receipt_suffix_floor=5000` is
  mandatory**, so One issues `SVP<date>-5001…`. Fees receipts from the tail
  and any receipts re-entered on rollback can then never collide with
  One's.
- Check that the 4-digit regex and the prefix check accept the floor.

**7.5 `/r/` path clash**
- In One, `/r/` is SamPark's token route. The fees receipt-verify link
  `/r/{receiptNumber}` would 404 there.
- Port the verify page at `/rv/[code]` and point `verifyUrl` at it, or
  remove `verifyUrl`.

**7.6 Env and switches**
- Env, names only, Production only:
  - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
  - `RAZORPAY_WEBHOOK_SECRET`, a new secret for One's own endpoint
  - `RAZORPAY_ACCOUNT_ID`
  - `ONLINE_PAYMENTS_CRON_SECRET`
  - Vault `VPPS_ONLINE_PAYMENTS_CRON_SECRET`, a new value
- A `rzp_live_` key outside `VPPSONE_ENV=live` refuses to start.
- The seven switches stay off until C7, then are set to these values:

| Switch | Value from C7 |
|---|---|
| `links_enabled` | on |
| `checkout_enabled` | on |
| `auto_posting_enabled` | on, but only after the §7.3 filters are deployed |
| `receipts_enabled` | on |
| `checkout_all_sessions` | per Q14 |
| `waive_late_fees` | true for 2026-27; on the year-end checklist |
| `order_max_rupees` | the fees app's value |

**7.7 Order of switching on**
1. Dev with test keys.
2. Staging with test keys, TEST session only.
3. At T0: the owner pays ₹100 with live keys on a TEST student.
4. An opt-in pilot.
5. All families (Q14).

The Razorpay account checklist confirms, without changing:
- post-payment receipts off
- link reminders off
- support number
- the webhook event list

**7.8 Fees Pay-now links already sent (the tail)**

Path A codes live until `pay_code_expires_on`, which can be months away;
Path B codes last 21 days. A family could pay at One's desk and then pay
the same installment again on an old fees link. Choose one (Q8):

| Option | What happens | Tail after T0 |
|---|---|---|
| **(a) Recommended** | At T0 the owner turns off the fees app's `online_payment_links_enabled` and `online_payment_checkout_enabled` on the fees app's own online screen. This is a settings change made through normal use of the fees app, by the owner, not by tooling | About 2 hours (orders already open) |
| (b) No fees change at all | The tail runs to the latest Path A expiry. Every tail payment goes to a review queue in One and is posted through One's own engine with its fees receipt number. Raw `payments` rows are never copied. One's Pay now skips any student with a fees code still payable. Overpayments are refunded by hand | Up to the latest Path A expiry |

- With either option, payments made to the HDFC static QR are a manual tail
  with no end date.
- **`tail-sync.mjs`** reads the fees `audit_logs` after the watermark as a
  complete change feed. It is insert-only, with no deletes and no trigger
  bypass.
  - It upserts `online_payment_events` on `provider_event_id`, because
    Razorpay sends every event to both webhooks.
  - It never writes outbox rows.
  - It alerts on any fees write outside the tail allow-list.

---

### Phase 8 — WhatsApp to staff, new (PR-8)

**8.1 Pipeline**
- The `vppsone.staff_notices` outbox (D-214: claim under lease; "Unknown"
  is never retried by the machine), with `STAFF_NOTICE_TRANSPORT=aisensy`.
- The kinds that go through `message_sends` and "send by hand" today
  (weekly summary, missing marks, staff broadcast) are moved into the
  outbox.
- A pg_cron job ticks every 5 minutes, so the kill switch, quiet hours and
  the digest all work. Today the job runs once a day.

**8.2 Events** — the owner picks the final list (Q15).

| Event | To | Template | State |
|---|---|---|---|
| Cover assigned, changed or cancelled; late cover | Covering teacher | `vppsone_cover_*` | Exists |
| Cover refused | Coordinator | `vppsone_cover_escalation` | Exists |
| Register not saved | Class teacher | attendance reminder (one name to be settled; see below) | Exists |
| Task assigned, task reminder | Teacher | `vppsone_teacher_task*` | Exists |
| Staff notice | Chosen staff | `vx_staff_notice` | By hand → API |
| Weekly summary, missing marks | Coordinators, admin | `vppsone_weekly_summary`, `vppsone_marks_reminder` | By hand → API |
| Online payment needs review | Accountant, admin | `vx_staff_online_review_v1` | New |
| Day's collection summary, 19:00 IST | Admin, accountant | `vx_staff_day_collection_v1` | New |
| Day not closed, 20:00 IST | Accountant | `vx_staff_day_not_closed_v1` | New |
| Write-off or reversal requested | Admin | `vx_staff_money_request_v1` | New |
| Write-off or reversal decided | Requester | `vx_staff_money_decision_v1` | New |
| Leave requested or decided | Approver, teacher | `vx_staff_leave_*_v1` | New |

- The attendance reminder template name differs:
  `vppsone_attendance_reminder` in dev's templates,
  `vppsone_staff_attendance_reminder` in the code. Settle one name.
- No message carries a parent's phone number. Student names appear only if
  the owner allows it (Q15).

**8.3 Phones, consent, limits, logs**
- Phone source: `staff_profiles.whatsapp_phone`, else `phone`, entered by
  the owner in `/staff`. No usable number means `suppressed / no_number`.
- Consent (new migration):
  - `whatsapp_opt_in_at`, `_source`, `_opt_out_at`
  - `staff_notice_prefs(kind, enabled)`
  - a toggle in `/preferences`; admin can record consent collected at
    training
  - no consent means no send
- Limits:
  - at most 8 a day per person, except cover;
  - the send window is 07:00–20:00 IST, except cover;
  - more than 3 of the same kind within 30 minutes becomes one digest;
  - a monthly cap shared with the parent cap (proposed 1,000 for staff);
  - 1 request a second to AiSensy.
- Log and kill switches:
  - the log is a staff tab in `/messages` with the monthly cost;
  - kill switches: `staff_notice_dispatch` in the database (instant),
    `STAFF_NOTICE_TRANSPORT=disabled`, and a per-kind map.
- Test sessions and test accounts send to the allowlist only.
- All staff templates, existing and new, are on the pre-flight approval
  list.

---

### Phase 9 — Monitoring, backups, env (PR-9)

**9.1 Health pack** — a daily query, counts only, with alerts by staff
WhatsApp to the owner. It watches:
- Razorpay webhook responses that are not 2xx. An uptime check posts a bad
  signature and expects 401.
- `cron.job_run_details` failures and `vppsone.job_runs` failures.
- Online events pending or failed after 3 attempts, and captures in
  `review_required`.
- Outbox rows that are `uncertain` or `failed`.
- The AiSensy wallet and caps.
- Supabase advisors.
- Sentry, by setting `NEXT_PUBLIC_SENTRY_DSN` up properly.

**9.2 Backups**
- Point-in-time recovery on `vppsone-live`.
- The Drive configuration re-seeded by the owner, for the
  `drive-backup` and `document-backup` jobs (D-334).
- The fees `nightly-backup` job moved over.
- **A test restore before T0**, not only at sign-off.

**9.3 Env**
- A name-only diff of fees Production env against One Production env,
  settled row by row.
- These names are missing from the old list:
  - `NEXT_PUBLIC_SCHOOL_NAME`, `_PHONE`, `_ADDRESS`, `_EMAIL`
  - `REPAYMENT_PLANS`
  - `AISENSY_CAMPAIGN_PREFIX`, `AISENSY_WEBHOOK_SECRET`
  - `LOCALE_SWITCHER_ENABLED`
  - `SCHOOLFEES_DOC_TOKEN`
  - `ANTHROPIC_API_KEY`
  - Sentry
  - the Google workload-identity settings
- Remove `QA_LOGIN_KEY`.

**9.4 Auth on the new project**
- Site URL and redirect `https://one.vpps.co.in/**`.
- SMTP with SPF and DKIM for `vpps.co.in`, and Hindi and English email
  templates.
- The new project has a new JWT secret, so every staff member signs in
  again at C5. Announce this beforehand.

**9.5 AI and Notion**
- The fees MCP and the Notion sync read the fees database. From T0 they
  freeze, and the owner is told.
- Deploy a second read-only MCP worker pointed at `vppsone-live`.
- Notion sync is recreated against One, or dropped (Q13).
- One's `assist` feature reading real data needs the owner's yes (Q13).

---

### Phase 10 — Rehearsals (6 and 10 Dec)

Each rehearsal is a full run on `vppsone-live`:

1. Wipe One's fee data, keeping protected rows.
2. Extract, load, reconcile, quarantine, promote.
3. Create staff profiles and rebuild enrolments.
4. Smoke test:
   - a desk posting into TEST;
   - a Razorpay test order, paid and posted;
   - a staff notice to the allowlisted phone;
   - the pill and TEST visibility for every role;
   - a cold request to each public path;
   - `current_staff_role()` checked per seat.

Every step is timed. The freeze window allows 3 hours of work. The
accountant attends rehearsal 2 and signs the route sheet.

**Unknowns that rehearsal 1 must settle:**
- Whether Supabase's `postgres` role may disable triggers in this way.
- Whether `auth.users` rows can be inserted with fixed UUIDs.
- How long the pg_dump and pg_restore steps take.

---

### Phase 11 — Cutover runbook (T0 = Sunday 13 Dec, owner confirms)

**Go / no-go (T-3 and T-1)**
- Every `_v7` and staff template is approved.
- The Razorpay checklist is done.
- The fees app has no `schedule.auto` campaigns (`fees-quiet-check.mjs`,
  read-only).
- Vault secrets exist.
- Auth and SMTP are ready; real staff and test accounts exist.
- Training is done.
- **7 green nightly reconciles in a row.**
- A point-in-time recovery mark, plus an offline read-only `pg_dump` of
  fees live.
- The owner's written go.

| Step | When (IST) | Action |
|---|---|---|
| F1 | Sat 18:00 | Desk stops. Staff told: from now on One; the fees app is for lookups only |
| F2 | Sat 18:00–20:00 | Last day close in the fees app. Dev goes read-only (§4.4) |
| C1 | Sun 08:00 | Final extract → load → reconcile, which **must be exact**. Its snapshot is the watermark. The control-totals hash is stored as the cutover baseline. Final quarantine and promote run on frozen dev |
| C2 | | Refresh the matviews. `verify:fee-parity` |
| C3 | | One settings: `fee_writes_enabled=true`, `receipt_suffix_floor=5000`, receipt notice per Q9, online switches still off. A `cutover` row goes into `migration_runs`, which locks out `load-snapshot` |
| C4 | | Run `one-live-cron-jobs.sql`. Add `auto-day-close` to pg_cron in exactly one place |
| C5 | | Point Vercel Production env at `vppsone-live` (names in §9.3). Redeploy. Staff sign in again |
| C6 | | Add One's webhook in the Razorpay dashboard. The fees webhook stays |
| C7 | | Smoke as the test admin in TEST: desk receipt, PDF, allowlisted WhatsApp receipt. The owner pays ₹100 live on a TEST student: posted once in One, and only an `ignored` event row in fees (checked read-only). Set the seven switches (§7.6). If Q8 = (a), the owner turns off the fees online switches |
| C8 | | Check 10 real students' dues in One against the frozen baseline. Rebuild enrolments: the count equals on roll plus left. Every class has its class teacher |
| C9 | Sun 14:00 | Go. `parent_dispatch=true` for receipts only. No reminder run on T0 or T0+1 |

**Links**
- No DNS change: one.vpps.co.in already serves One.
- One's links to fees.vpps.co.in become links to One's own fee screens.
- An admin-only "Fees app (read-only)" link stays for the parallel run.

**Training (T-7 to T-2)**
- About 30 minutes per role. A one-page sheet in Hindi and English.
- An admin operations sheet: kill switches, test accounts, staff consent,
  online review.
- A printed fallback for the desk if One is down.
- Floor support on T+1 and T+2.

---

### Phase 12 — Parallel run, rollback, sign-off (13 Dec – 10 Jan)

**12.1 Daily checks** (read-only on fees)
- `tail-sync`, then `reconcile-post`: the frozen baseline plus One's
  postings plus tail imports equal One's totals, at a fixed `as_of` date.
- `fees-quiet-check`: no fees desk receipts and no fees reminder sends.
  Tail payments are listed.
- The online invariant holds.
- Day close matches the cash, signed by the accountant.
- The duplicate-message query.

**12.2 What gets switched on, and when**

| Day | What |
|---|---|
| T+3 | The first manual reminder run from One |
| T+7 | Staff WhatsApp for cover and attendance |
| T+14 | The other staff kinds; possibly one automatic campaign |

**12.3 Rollback**

Triggers:
- any unexplained money difference;
- a payment posted twice;
- a receipt number collision;
- a wrong or duplicate parent message;
- One down for more than 2 desk hours;
- the owner's call.

Steps:
1. In One, turn off `fee_writes_enabled`, the online switches,
   `parent_dispatch` and `staff_notice_dispatch`.
2. Remove One's pg_cron jobs and Vercel crons.
3. Disable One's Razorpay webhook.
4. The desk goes back to fees.vpps.co.in.
5. `rollback-export.mjs`, driven by One's `audit_logs`, lists every fee
   change since the watermark, not only receipts:
   - waivers, write-offs, reversals and refunds
   - EMI plans, family links, concessions
   - student edits, admissions and leavers
   - contacts and promises
   - reminder sends
6. Re-entering those in the fees app writes fees data through its own
   screens. It needs the owner's approval (Q16).
   - The fees desk has no `online` mode, so these go in as `upi` with the
     Razorpay id as the reference.
   - The fees receipt notices are switched off during re-entry so parents
     are not messaged again.
   - The suffix band keeps the numbers apart.
7. The fees database also kept changing by its own crons (EMI late fee,
   day close) throughout, so it is not frozen at T0.

**12.4 Sign-off** — all of these, then the owner signs:
- 28 days without an unexplained difference.
- At least 20 day closes matched to cash.
- Every online capture posted or resolved.
- The tail is empty: past the latest fees Path A expiry and Path B plus
  21 days.
- No duplicate parent messages.
- Each role's acceptance recorded.
- A tested restore.

**Afterwards**
- Remove the fees webhook.
- Rotate the Razorpay keys. They were once pasted in chat, and the fees
  app holds the same pair until then.
- Optionally rotate the AiSensy key.
- Clear the suffix floor.
- Remove the fees link.
- Retiring the fees app is a separate owner decision.

---

## 4. Risks

| Risk | Mitigation |
|---|---|
| Live read access stays blocked | Phase 0 sets it up. The fallback is the fees MCP plus sealed select-only reads, which give no consistent snapshot |
| Public endpoints redirect to login | §7.2, plus a cold-request test |
| A fees payment is posted in One, or the reverse | `vp1_` prefix on both paths; imported orders made terminal (§2.4, §7.3) |
| A parent is charged twice across the two apps | Q8 option (a); otherwise the review queue and refunds |
| A parent gets duplicate messages | One choke point, a same-day check across campaigns, no retry of imported rows, terminal-only outbox import |
| Test data attached to real children | New ids for every row, phones nulled, every dev profile mapped to a test account, §4.6 checks |
| A test account sees real data | Five app layers plus RLS on `vppsone`; the gap on `public` accepted in writing |
| A mirror re-run after T0 deletes One receipts | `load-snapshot` locks out on the `cutover` row |
| Meta rejects `_v7` | Submit early; the text-only form meanwhile; move T0 if needed |
| Staff confused by different "pending" figures (D-318) | Training sheet; reconciliation uses engine views only |
| Vercel Hobby cron timing | Time-critical jobs on pg_cron |
| The fees MCP and Notion show figures frozen at T0 | Told at T0; a One MCP worker |

---

## 5. What this plan has not verified

- The live receipt maximum per session, the `app_settings` values and
  `fee_policy_configs`: live SELECTs were refused in this session.
- The overlap of dev and live student ids. It is inferred from
  `replicate-live.mjs:295-330`; confirm with a count.
- Whether real staff already use one.vpps.co.in (§4.4).
- The trigger-disable and fixed-UUID auth inserts on Supabase (rehearsal 1).
- The Vercel team plan.
- The fees desk's list of payment modes. It comes from the mapping notes;
  the desk screen itself was not opened.

---

## 6. Questions for the owner

**Needed before Phase 1**

1. **Answered 30 Oct:** One's main database is `wtgxcptmucjerhufzjcf`
   (§0.1). Still open: upgrade the org to Pro for backups and
   point-in-time recovery?
2. **The pill.** Shown to fee readers, coordinators, admin and test
   accounts; teachers stay on the active session; 2027-28 visible to fee
   readers. Agreed?
3. **T0.** Sunday 13 Dec, with a 4-week parallel run?
4. **Test accounts.** Which mailboxes and roles, magic link or password?
   And do you accept, in writing, that the fee tables can't hide real rows
   from a test account at the database level while the fees app is still
   running?
5. **D-207.** Is `vppsone.staff_profiles` the authority for roles in One?
6. **The 10 fee users' passwords.** Keep them, or force a reset at
   cutover?

**Needed before Phase 7**

7. **Fees auto campaigns.** If any is set to automatic at T-7, may you turn
   it off in the fees app's own screen?
8. **The fees Pay-now tail.** Option (a), you turn off the fees online
   switches at T0, or option (b), no fees change and a longer tail?
9. **Where One differs from the fees app.**
   - Supersede D-270, D-291, D-10 and D-76 for fee messages?
   - Keep D-274 and D-318?
   - May office post money (D-180)?
10. **A separate receipt prefix for TEST**, for example `TST`, so test
    postings stop using real SVP numbers?
11. **Automatic reminder schedules.** No earlier than T+14?

**Needed before Phases 4, 6 and 8**

12. **Test data.**
    - Which activity on one.vpps.co.in is real staff work?
    - Keep One's dev history in TEST at all?
    - Copy the documents, or metadata only?
    - Where does the 20th dev class go?
    - Do you sign the list of master data to promote?
    - The 79 TEST students' phones: null them, or allowlist them?
13. **Ownership of some flows.**
    - Who owns "absent today" parent messages?
    - Notion fee sync: from One, or dropped?
    - May `assist` read real data?
14. **Online payments.** All families straight after the ₹100 test, or an
    opt-in pilot first? Also apply for Razorpay website approval of
    `one.vpps.co.in` now?
15. **Staff WhatsApp.**
    - Which events?
    - What monthly budget?
    - Who gets the daily collection summary?
    - May messages carry student names?

**Needed before T0**

16. **Rollback.** If we roll back, may the accountant re-enter One's
    changes in the fees app?
17. **Retention.** How long are the offline fees snapshot and the migration
    files kept (D-334)?
18. **After sign-off.** Does the fees app keep running read-only, or is it
    retired?
19. **Where does development go?** Once `wtgxcptmucjerhufzjcf` is
    production, where do these point?
    - Vercel Preview and Development, local development and smoke tooling.
      Options: a new dev project (the free plan allows two active
      projects, so this means Pro or freeing a slot), or no database for
      previews.
    - The fees app's local `.env.local` and its dry-run scripts. You
      repoint these; this plan never edits the fees repo.
