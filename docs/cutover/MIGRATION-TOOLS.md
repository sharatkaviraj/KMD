# Migration tools — `scripts/migrate/`

The tools that copy the fees app's real data into One's database and prove
the copy is right (plan `GO-LIVE-2026-27-PLAN.md` Phase 2, §7.8, §12; D-339,
D-346, D-348). Built in phase A2 (`feat/golive-migrate-tooling`).

**Two databases, two directions, never reversed.**

| | Ref | How the tools reach it |
|---|---|---|
| Fees live (source) | `vgqyilgstjvgohrsiwkb` | **Read only**, through `lib/fees-readonly.mjs` — REST with the service-role key from `%USERPROFILE%\.schoolfees-secrets\env.local.production.20260915-1137.bak` |
| One (target) | `wtgxcptmucjerhufzjcf` | `lib/one-db.mjs` (direct Postgres, session pooler, refuses every other ref) and, for Storage, One's own service-role client |

Personal data never enters the repo or the terminal. Every file with rows goes
to `%USERPROFILE%\.vppsone-migration\<run>\`; the terminal shows counts, sums
and md5s (and, from reconcile, student **ids** that differ — never names).

Every script is `--dry-run` by default and writes only with `--apply`.

---

## The sealed reader — `lib/fees-readonly.mjs`

The only door to the fees database. `openFeesReadOnly(secrets)` refuses any
URL whose host is not exactly `vgqyilgstjvgohrsiwkb.supabase.co`, and returns
an object — not a supabase-js client — with only:

- `from(t).select(...)` and read-only builder methods (filters, order, range, limit, single);
- `storage.listBuckets()`, `storage.from(b).list / download / createSignedUrl / createSignedUrls`;
- `authAdmin.listUsers / getUserById` (GoTrue reads; no password hashes come back);
- `openApi()` (GET of the PostgREST document).

Everything else throws `FeesReadOnlyError`: insert, update, upsert, delete,
rpc, schema, storage remove / upload / move / copy / update and bucket
changes, auth createUser / deleteUser / updateUserById / inviteUserByEmail /
generateLink. Setting a property on a query builder (e.g. `method = "DELETE"`)
throws too. A second seal sits on the wire: the client's `fetch` refuses any
request but GET / HEAD and the two Storage read POSTs, matched on the whole
path (`^/storage/v1/object/list/<bucket>$`, `^/storage/v1/object/sign/<bucket>…`),
so an upload whose path merely contains one is still refused.
`tests/migrate-readonly.test.ts` proves both.

Optional, secondary, **not wired**: `withFeesReadOnlySnapshot()` for a
`LIVE_DB_URL` in the secrets file (none today). It connects with
`default_transaction_read_only=on`, runs one `REPEATABLE READ READ ONLY`
transaction and exports a snapshot; refuses a URL that does not name the fees
ref, and the transaction pooler (6543), which cannot hold a snapshot. No
script calls it: `extract-live.mjs` is REST-only, and wiring it in is a change
for the day a live Postgres password exists.

---

## `extract-live.mjs` — copy live out

```
node scripts/migrate/extract-live.mjs [--run <id>] [--tables a,b] [--no-auth] [--max-attempts 5]
```

- Enumerates every table from PostgREST's OpenAPI document (`v_*` are the
  views; checked against One's catalog), with primary keys from its `<pk/>`
  markers. 88 tables on 30 Oct.
- Reads every row, paginated by primary key (keyset for one-column keys).
- **Consistency without a snapshot:** a fingerprint — exact row count, the
  maximum of every change timestamp the table has (`updated_at`, `created_at`,
  `received_at`, …) and the newest `audit_logs` row with the ids at that
  instant — before and after the read. Equal, or the whole read repeats.
- **Watermark** = the stable fingerprint: the newest change over all tables,
  the newest `audit_logs.created_at` and its tie-set ids (audit ids are uuids,
  so time orders the tail).
- `auth.users` + identities for the `public.users` ids are **secrets**
  (critique0 #28): sealed with AES-256-GCM (`lib/secrets-box.mjs`, key in the
  secrets folder) into `<run>/secrets/`, deleted after a load.
- Control totals per session with the fees MCP's own definitions
  (`lib/control-totals.mjs`, ported from `workers/schoolfees-mcp/src/scope.mjs`
  and `shape/student.mjs`), **including `yearSplit`** (current year against
  carry-forward on `is_carry_forward`), ported from the fee schema's
  `get_dashboard_fee_split` RPC and computed over the extracted
  `v_workbook_installment_balances` + students, classes, payments, receipts.
- **Matview freshness.** The totals come from the fees matviews, so the
  extract records the fees refresh queue in `manifest.matviewFreshness` and
  treats a pending refresh, or a money-table change after the last refresh,
  as "not stable": it reads again and refuses after `--max-attempts`
  (`--allow-stale-matview` records it and goes on).
- `--tables` makes a **subset** run (`manifest.subset`): never "the latest
  extract", never loadable.
- Views PostgREST reports no key for are paged by a stable key
  (`lib/live-read.mjs VIEW_KEYS`), not by bare ranges.

Output in `<run>/`: `tables/*.ndjson`, `views/*.ndjson`
(`v_workbook_student_financials`, `v_workbook_installment_balances`,
`v_online_payment_reconciliation`), `secrets/auth-users.json.enc`,
`control-totals.json`, `manifest.json`.

"The latest run", where a read-only tool defaults to it, is the manifest with
the newest `finishedAt` that is not a subset — never a sort of folder names
(run ids are free text; CLAUDE.md rule 3a).

## `control-totals.mjs` — compare with the fees MCP

```
node scripts/migrate/control-totals.mjs --run <id> [--mcp <file.json>]
```

`<file.json>`: what `get_session_money_summary` returned, keyed by session
label. Field-by-field comparison (headcount, every money figure, segments,
and `yearSplit` when the file has it); exit 1 on any difference. The
30 Oct run predates the year split, so its comparison below covers the
headcount and money blocks only.

**First real run, 30 Oct (run `20261030-a2-first`):** 88 tables, 73,573 rows,
stable on the first attempt, 10 auth users. Against the MCP the same afternoon:

| | Ours | MCP |
|---|---|---|
| 2026-27 on roll / collectable | 509 / 512 | 509 / 512 |
| Expected / paid / fees pending | 1,32,66,950 / 62,53,084 / 70,06,866 | same |
| Late fee charged / waived / pending | 3,84,000 / 8,59,000 / 3,77,750 | same |
| Discount / closeouts | 14,95,600 / 17,250 | same |
| TEST-2026-27 on roll / collectable / paid | 76 / 77 / 2,46,006 | same |

**MATCH on every field, both sessions.**

---

## `load-snapshot.mjs` — load an extract into One

```
node scripts/migrate/load-snapshot.mjs [--run <id>]                       # dry run
node scripts/migrate/load-snapshot.mjs --run <id> --apply [--first-load] [--allow-dev-target]
node scripts/migrate/load-snapshot.mjs --run <id> --rollback-only [--first-load]
node scripts/migrate/load-snapshot.mjs --run <id> --purge-secrets
```

`--apply` and `--rollback-only` need an explicit `--run`.

**Guards (`lib/guards.mjs`), checked before, and again inside the write
transaction AFTER its locks** (`vppsone.migration_runs` and
`public.app_settings` EXCLUSIVE, `vppsone.deployment` SHARE, then every loaded
table — so a cutover row, a marker change or an owner turning fee writes on
cannot commit between the check and the writes). `--apply` refuses when:

- `vppsone.migration_runs` has a `cutover` row (after T0 a stray mirror would
  delete every One receipt — critique0 #7);
- `vppsone.fee_writes_open()` is not false — the database's own rule, under
  which a missing key counts as open on a target not marked production — or
  `fee_writes_enabled = 'true'`; unreadable counts as open;
- `vppsone.deployment` is not `production`, unless `--allow-dev-target`
  (a rehearsal on a throwaway target only; it never lifts the other two);
- `--first-load` and an applied load already exists;
- **public sign-ups are on** on One's project (plan §6 Q21, D-355 (1)):
  `lib/auth-settings.mjs` GETs GoTrue's public `/auth/v1/settings` with the
  publishable key (One's own host only) and anything but
  `disable_signup: true` — including an unreadable answer — refuses. Twelve
  `public` tables let any signed-in user read under the fees app's policies,
  so a self-registered account could read the parent data a real load
  brings. The owner turns sign-ups off in the dashboard; `--rollback-only`
  persists nothing and is not stopped by it. **31 Oct: on**, so `--apply`
  refuses today;
- the run is a `--tables` subset, or its auth rows carry no identities
  (a user loaded without one cannot sign in).

**`--rollback-only`** runs every step of `--apply` in the same transaction and
then rolls it back: proof that the SQL path (staging, trigger disable/enable,
detach, deletes, inserts, updates, deferred columns, count check, orphan check,
matview refresh, setval, watermarks) works, with nothing persisted — not even
the run row. It lifts the environment and fee-writes guards, never the
cutover guard, and stops on the same plan blockers as `--apply`.
**Not yet run:** every run today stops on the plan blockers (the 6 email
clashes, and run `20261030-a2-first` has no identities), before the SQL path;
it is the first thing to run once a fresh extract plans clean.

**Dry run is read-only**: one `READ ONLY` transaction; no staging table, no
`migration_runs` row. It prints the per-table plan, blocked deletes, predicted
FK orphans and unique conflicts, missing auth parents, the auth plan and the
guard verdict.

**What the plan decides (`lib/diff.mjs`, `lib/import-rules.mjs`):**

| Rule | |
|---|---|
| Never touched | `backup_runs`, `workbook_materialized_view_refresh_queue`, `office_sync_events`, `staff_push_subscriptions` (the fees app's browsers, on the fees VAPID key; One has its own) |
| Live data One cannot hold | A live table One's `public` lacks is loaded nowhere — so `--apply` **refuses** when such a table has a row, or when a live table has a column One lacks, unless it is on `NOT_MIGRATED` / `NOT_MIGRATED_COLUMNS` (`lib/import-rules.mjs`, table → reason); reconcile reports the same as a MISMATCH. See the 13 tables below |
| Terminal-state import | Checked against the reconcilers' **actual** filters (`RECONCILER_FILTERS`, ported from fees `orders.ts reconcileOpenOrders` and `service.ts`; a test runs them over imported rows and expects no match). `online_payment_orders` open/pending/paid/review_required/**superseded** → `abandoned` (reconcileOpenOrders re-checks open/superseded/paid created in the last 24 h); `_intents` link_pending/link_created/paid/review_required → `cancelled`, and **every non-`accounted` intent gets `provider_cancelled_at`** (its updated_at, else created_at) — the intent reconciler also picks up superseded/expired/cancelled/failed with a null `provider_cancelled_at`, records their captures and cancels the (fees-owned) Razorpay link; `_events` pending/failed → `ignored`; `_captures` pending/review_required → **not imported** (the only terminal value, `applied`, would claim a receipt); `notification_outbox` queued/processing/failed → `suppressed` (and `locked_until` cleared); `staff_payment_alerts` push `queued` → `no_devices` and WhatsApp `queued`/`partial`/`failed` → `off` (and `locked_until` cleared), so `staff_payment_alert_claim` never re-announces a payment the fees app already did (Phase D review). Every target is allowed by the table's CHECK (read from wtgx) — critique0 #2, #3 |
| One-owned settings | `app_settings` keys `online_payment_*`, `whatsapp_receipt_notice_enabled`, `whatsapp_reversal_notice_enabled`, `receipt_suffix_floor`, `staff_whatsapp_month_cap`, `fee_writes_enabled`: never inserted, updated or deleted. Cells in `vppsone.one_owned_fee_settings` (TEST-2026-27 `receipt_prefix` = `TST`) keep One's value |
| TEST sessions (T1) | Rows with a `*session_label` column holding a test label, `app_settings` keys ending `:<test label>`, and everything reached down a foreign key from them (students in TEST classes → installments, receipts, payments, waivers, family rows, sends, orders…), plus `audit_logs` rows about them, plus the two online tables with no FK: `online_payment_events` (by a TEST capture's `provider_payment_id` or a TEST intent's/capture's `provider_link_id`) and `online_payment_audit` (by `intent_id` / `capture_id` / `event_id`). Without `--first-load`: never inserted, updated or deleted, on either side. With `--first-load`: live's TEST rows are inserted/updated; One's own TEST rows are still never deleted |
| Protected rows | `students.admission_no LIKE 'TEST-D-%'`, every `migration_id_map` target, and everything keyed on them (and their audit rows): never updated or deleted; a live row with the same key is counted as a conflict. Source rows the fees project re-keyed through the map are skipped |
| Blocked deletes | A row that stays never loses its parent: the parent's delete is dropped and counted |
| Re-pointed children | A row that stays but moves from parent P (deleted) to P2 (a re-anchor or merge): deletes run first, so P's ON DELETE CASCADE would take the row with it and its update would match nothing. The plan lists these (`findRepointedChildren`); `--apply` nulls their FK before any delete and the update writes P2. A NOT NULL FK of that kind refuses the load |
| Order | Parents first (topological over `pg_constraint`); deletes children-first; the nullable side of a cycle (`installments.carry_forward_balance_id`, `student_repayment_plans.supersedes/superseded_by_plan_id`) is written in a second pass |

**Apply, in one transaction:** locks, then guards (above) → auth users
upserted by id (an email that belongs to a different One user refuses the
load; the password hash is never copied or overwritten; identities inserted if
missing) → plan rebuilt inside the transaction → refused on any predicted
orphan, unique conflict, missing auth parent, re-pointed row that cannot be
detached, or live data One cannot hold → every source row staged into
`import_stage.<t>` (`LIKE public.<t>`) → each table's **named** user triggers
disabled (`ALTER TABLE … DISABLE TRIGGER "name"`, never
`session_replication_role`, so foreign keys stay on) → refuses if a delete
would reach a row outside `public` (a `vppsone` row keyed on a fee row) →
re-pointed children detached → deletes, inserts, updates, deferred columns →
triggers re-enabled → **written counts must equal the plan's, table by table**
(a cascade or a key that matched nothing aborts; an orphan check cannot see a
missing row) → staging tables dropped (they hold personal data), and the
`import_stage` schema when empty → orphan count per foreign key in
`pg_constraint` (any orphan aborts) → matviews refreshed in dependency order,
and the refresh queue marked refreshed → owned sequences `setval`, a bigint
identity to at least `ONE_IDENTITY_FLOOR` (1,000,000,000) so rows One writes
(`online_payment_audit`, today its TEST online testing) take ids live never
reaches → `vppsone.migration_watermarks`. Then a `migration_runs` row
(`load-snapshot`, `run`, counts and the watermark in `summary`) and the run's
sealed auth rows are deleted.

**Live tables not in One's `public` (13, run `20261030-a2-first`):**

| Table | Rows | Why not loaded |
|---|---|---|
| `feature_flags` | 4 | `NOT_MIGRATED`: the fees app's own feature toggles; One switches features through `app_settings` and its own code |
| `job_runs` | 1 | `NOT_MIGRATED`: the fees app's cron history; One keeps its own |
| ~~`staff_payment_alerts`~~ | 0 | **In One since 31 Oct (Phase D)**: fees `20261030170000_online_payment_staff_alerts` caught up in `supabase/fee-migrations/`, with the failure desk's `20261030190000` (`whatsapp_send_attempts`, `whatsapp_number_health`, seven `whatsapp_reminder_sends` columns). Dry run of extract `20261031-pd-catchup`: no live table or column refused |
| `class_aliases`, `enrolments`, `subjects`, `teaching_assignments`, `timetable_slots`, `timetable_versions` | 0 | One-style academic tables the fees schema grew; One keeps these in `vppsone`. Empty; the loader refuses if one gains a row |
| `staff_directory`, `staff_profiles`, `staff_access_links`, `staff_push_subscriptions` | 0 | One-style staff tables; One's staff live in `vppsone.staff_profiles`. Empty; same refusal |

**Run `20261030-a2-first` cannot be loaded:** its sealed auth rows were written
before identities were fetched (`manifest.auth.identities = 0`), so the
loader refuses it. Purge them (`load-snapshot.mjs --run 20261030-a2-first
--purge-secrets` — an owner/orchestrator step, it deletes a private file) and
extract again before the first load.

The loader connects as the database owner, so the D-347 table guards (which
apply to API callers) do not apply to it, by design.

**Dry run against wtgx, 30 Oct (read-only):** insert 60,659, update 6,996,
delete 8,605, unchanged 3,434. TEST rows held back per table (e.g. students
79, receipts 67, payments 85). 13 live tables are not in One's `public`.
`--apply` would stop today on: **6 fees users share an email with a different
One auth user** (and so 37 FKs to `auth.users` lack a parent), and the marker
says `dev`. The email clashes are the Q5 / Phase 3 user-mapping question; they
must be resolved before the first real load.

## `reconcile.mjs` — is One equal to live?

```
node scripts/migrate/reconcile.mjs [--run <id>] [--live] [--as-of YYYY-MM-DD] [--no-storage]
```

Read-only on both sides. Source = the run (the snapshot that was loaded) or
`--live`. Equality is decided by the same plan code as the loader, so the
transforms, One-owned settings, TEST rows and protected rows are treated
identically. **Real sessions only**; TEST figures and protected-row counts are
printed separately and never fail the run (critique0 #18).

Checks: table counts + ordered md5 + loader diff per table; session money
summary (MCP definitions); per-class rollups; per-student checksum over
`v_workbook_student_financials` (first 20 differing student ids); receipts per
mode per date, highest suffix per (prefix, date), distinct numbers = rows; the
online invariant (captured = on receipts + review + waiting, every applied
capture has its receipt); WhatsApp sends per status/kind, school notices,
outbox; EMI late fees per session as their own line (critique1 A8); storage
objects and bytes per bucket; live tables with rows / columns One has no place
for (NOT_MIGRATED aside); the year split per real session; and **event twins**
(critique1 A7): every fees `online_payment_events` row `processed` after the
watermark has a One twin that is not `ignored`, or its payment is in One as a
capture or listed in `vppsone.tail_receipts_review` evidence
(`eventTwinViolations`).

**As-of:** late fees depend on the date, and both sides come from their
matviews. A read-only client cannot evaluate the fees side at another date, so
`--as-of` must equal the source's IST date (the extract day, or today with
`--live`) — reconcile refuses otherwise. It also refuses unless the fees
matviews were fresh at the extract (`manifest.matviewFreshness`; the queue's
pending flag with `--live`) **and** One's matviews were refreshed on the
as-of day with nothing pending (a load marks the queue); `--allow-stale-matview`
turns both into warnings. Run extract, load and reconcile on the same day.
Exit 1 on any mismatch; a JSON report goes to the run folder.

Run on 30 Oct against the unloaded replica: 62 mismatches, as expected
(One still holds the masked 22 Sep replica).

## `storage-copy.mjs` — files

```
node scripts/migrate/storage-copy.mjs [--apply] [--bucket <b>] [--allow-dev-target] [--overwrite-different]
```

`student-photos`, `parent-documents`, `defaulter-voice-notes` → the same paths
on One; never `nightly-backups`. Download through the sealed client; only
objects **missing** on One are uploaded (created, never upserted). An object
on One with a different size is reported and kept — a photo replaced in One is
not reverted — unless `--overwrite-different`. A failed listing of One's bucket
stops the run (only "bucket not found" counts as empty). Idempotent by path +
size; nothing on One is deleted.
`--apply` only on a production marker (or `--allow-dev-target`). Dry run on
30 Oct: 484 photos (13.1 MB), 176 documents (11.6 MB), 0 voice notes to copy.

## `tail-sync.mjs` — the fees app's writes after cutover

```
node scripts/migrate/tail-sync.mjs [--apply] [--watermark <run-id>] [--allow-dev-target]
```

Feed (`lib/tail-feed.mjs`): fees `audit_logs` after the watermark, unioned
with a timestamp scan of every table — the online, WhatsApp, outbox and
waiver tables are not audited by the fees app. Insert-only: no deletes, no
trigger bypass, a normal postgres session.

- Fees receipts → **`vppsone.tail_receipts_review`** (migrations
  `20261030132121_tail_receipts_review.sql`, and
  `20261030145719_tail_receipts_review_grants.sql`: service_role may select,
  insert, update — never delete or truncate), with payments, order lines,
  captures and accounted intents as evidence (ids and amounts). Never raw
  `receipts` / `payments` rows (critique0 #8), and never a row whose
  `receipt_id` names such a receipt: an accounted intent or a paid order line
  goes into the evidence, not into `public` (its receipt FK would fail).
- `online_payment_events` → upsert on `provider_event_id` after the terminal
  rule; the fees row replaces One's twin **only when One's is `ignored`**
  (critique1 A7). A One `pending` / `failed` / `processed` row is One's own
  payment in flight and is kept; the run reports how many.
- `whatsapp_campaign_runs`, `whatsapp_reminder_sends`, `school_notice_sends`,
  then orders, intents, unpaid order lines → inserted when absent, parents
  first (`TAIL_INSERT_ORDER`), after the terminal rules; sends of every kind
  (critique0 #11). A row whose foreign-key parent is neither in One nor
  earlier in the batch (a send for a student admitted in the fees app after
  T0, an order on such a send, a send whose receipt is in review) is
  **deferred** with the reason printed; the next run reads it again.
  `ON CONFLICT DO NOTHING` does not catch an FK violation, so without this one
  such row rolled back the whole apply (`planTailInserts`).
- `notification_outbox` → never (critique0 #3).
- Any other fees write → **ALERT**, exit 2.

`--apply` only after a `cutover` row exists (the watermark is the last
applied load's) and on production. Writes a `migration_runs` row.

## `fees-quiet-check.mjs` — is the fees app quiet?

```
node scripts/migrate/fees-quiet-check.mjs [--watermark <run-id>]
```

Read-only. Counts: campaigns with `schedule.auto = true`; fees desk receipts
and their sum after the watermark; reminder sends and school notices after
the watermark; online tail receipts; captures waiting in the fees review
screen (critique1 B12); open pay codes and the **tail end date**
(`lib/tail.mjs tailEnd`: the later of Path B created + 21 days and the latest
Path A `pay_code_expires_on`; open-ended while any code has no expiry; HDFC
static-QR payments are a manual tail with no end — critique0 #5); every other
fees write outside the tail allow-list. Exit 2 when not quiet.

30 Oct: quiet; open Path A codes 739 (latest expiry **2027-01-31**), Path B
240 (latest 2026-11-20). Without the fees online switch-off at T0 (plan §7.8
option a), the tail runs to 31 Jan.

## `access-email-check.mjs` — before any sign-in email (Q6)

```
node scripts/migrate/access-email-check.mjs                 # after the load: must print ok
node scripts/migrate/access-email-check.mjs --before-load   # a look before it; clears nothing
```

Read-only on both databases (the sealed reader on live; a `read only`
transaction on One). The owner answered plan Q6 on 31 Oct: the fees users
with **no** One account sign in at cutover by password reset / sign-in link;
the ones whose email is already a One account are remapped onto it
(`lib/auth-import.mjs`, D-350) and keep their One login and password — the
loader never writes their `auth.users` row, and never copies or overwrites
any password hash (pinned by `tests/access-email-check.test.ts`).

For each user of the first kind it prints the fees role and whether the
address One holds for that id equals live's — compared as lowercase, trimmed
SHA-256 hashes (`lib/access-email.mjs`), never printed. `not loaded` means the
first real load has not brought the user yet — nothing was compared for it.

The verdict is `ok` (exit 0) only when **every** row is `yes` and nobody is
ambiguous. Any `no` or ambiguous email: `STOP` (exit 2). Any `not loaded`:
`NOT VERIFIED` (exit 2) — a load that skipped a user is not a green light for
that user's email. `--before-load` turns only the `not loaded` case into an
informational run (exit 0, and it says it clears no email); it never lifts a
`no` or a clash. **Run it without the flag after the load that will be live,
and send no access email until it prints `ok`** (plan runbook step C5a);
nothing is sent by it or by this phase.

31 Oct, before the first real load: 4 fees users with no One account
(admin 1, accountant 2, view_only 1), all `not loaded`; 6 remapped; 0
ambiguous. That run predates the verdict above; today it would print
`NOT VERIFIED`, or the informational line with `--before-load`.

## `rollback-export.mjs` — what One changed, for a rollback

```
node scripts/migrate/rollback-export.mjs [--watermark <run-id>] [--since <iso>]
```

Read-only on One. One's own `audit_logs` since the watermark, plus a
timestamp scan of the unaudited tables, sorted into the re-entry lists of
plan §12.3 (receipts, write-offs, waivers, reversals and adjustments, refunds,
EMI plans, family links, concessions and overrides, admissions / leavers /
edits, contacts and promises, reminder sends and notices, online payments).
TEST-session changes are counted apart. Terminal: counts per category and per
table/action. Private folder `rollback-<ts>/`: `detail.ndjson` (before/after
rows), `detail.csv` (each line with its **procedure id** `R1`…`R12`, sorted in
re-entry order), `summary.json`. **How to re-enter each category** — fees
screen or RPC, fields to carry, order, and how to avoid double-applying
against what the fees crons did meanwhile (critique1 A11, B12) — is
[`ROLLBACK-REENTRY.md`](ROLLBACK-REENTRY.md).

## `export-parity.mjs` — are the two apps' exports the same shape?

```
npm run migrate:export-parity -- <fees.xlsx> <one.xlsx> [--ignore-row-counts] [--json]
```

Plan §5.4 / critique1 B5, at rehearsal. Download the same export from the
fees app and from One **on the same snapshot and session**, save both in
`%USERPROFILE%\.vppsone-migration\exports-<date>\` (never the repo: they hold
names, phones and amounts), and compare. Sheet names and order, each sheet's
column headers and order, and each sheet's data row count; it never prints a
cell below the header. Exit 1 on any difference. Read-only; touches no
database.

Run it for every export, `ai-context-bundle` first — the owner's
`vpps-fee-list` skill reads `VPPSaicontextbundle*.xlsx` by sheet and column
name, so a renamed column there breaks it silently: ai-context-bundle,
student master, previous-year dues, left-student dues, EMI, receipt register,
defaulters, class-wise dues, concessions, transactions. Use
`--ignore-row-counts` only when the two files are knowingly from different
snapshots.

Rehearsal checklist items this tool and Phase 5 leave open (also on the
Phase 10 row of `docs/PROGRESS.md`):

- [ ] every export above compared, fees vs One, on one snapshot — 0 differences;
- [ ] 10 receipts printed from both apps on A4 **and** on the office printer —
      cash, UPI, online, cheque, discount, family, carry-forward — checking
      Hindi fonts, the `NEXT_PUBLIC_SCHOOL_*` header and One's footer.

## `health.mjs` — the health pack in a terminal (Phase G)

```
npm run migrate:health -- [--hours 24] [--json] [--probe https://one.vpps.co.in]
```

Plan §9.1, critique1 B9. Reads `vppsone.ops_health_counts()` (counts only;
service role / postgres) through One's direct connection, read-only, and
judges it with the app's own rules (`src/modules/ops-health/domain/health.ts`)
— the same verdict as the `health` job (`/api/jobs/health`, 08:00 IST), which
WhatsApps the real admins (`ops_alert`, off until the owner turns it on). It
counts Razorpay events stuck (pending/failed, attempts ≥ 3), captures in
`review_required`, receipt outbox `uncertain`/`failed`, pg_cron failures in
the window (with the job names), `vppsone.job_runs` failed or stuck, hours
since the last good Drive backup, staff WhatsApp failed/unknown, parent sends
failed (reminders, school notices, One's own), and this month's AiSensy sends
against each cap (a problem from 80%). A count the database could not read is
reported as such, never as zero. `--probe` POSTs a bad signature to One's own
Razorpay webhook and expects 401 (404 = webhook secret unset: "not configured
yet" before the cutover line, a problem after it), and asks the test-only
doors (`/login/test`, `/login/test/clock`, `/login/dayrun`, `/lab/enter`,
`/lab/clock`) cold — each must refuse a stranger. Exit 0 quiet, 1 something
to look at, 2 unreadable.

Added after review (migration `20261031125856_ops_health_more_counts`):
`net_http_failed` (pg_net calls the C4 timers made that One answered ≥ 400,
timed out or missed — pg_cron itself records them as succeeded; pg_net keeps
about 6 h of responses), `online_events_pending_old` (pending > 30 min,
whatever the attempts: a reconciler that never runs), receipt notices and
One's parent sends this month, `aisensy_month_total` across every lane
against the owner-set `aisensy_month_plan_cap` (off until set), and
`cutover_rows`. The scheduled `health` job runs the webhook probe against
its own origin every morning (production only).

**31 Oct on wtgx:** one problem — `refresh-sibling-groups-matview` failed 720
times in 24 h (it calls a function that does not exist on wtgx; removed at C4
by `one-live-cron-jobs.sql`); webhook probe 404 (secret not set yet, as
expected before C6).

## `env-names-diff.mjs` — the env inventory (Phase G)

```
npm run migrate:env-names -- [--fees-repo <path>] [--check]
npm run migrate:env-names -- --vercel     # live Production names against the committed snapshot
```

`--vercel` runs `vercel env ls production --project <p>` for `vppsone` and
`schoolfees` (names only; the CLI prints values as "Encrypted") and exits 1
if either differs from `VERCEL_PRODUCTION` in the script — the T-3/T-1
go/no-go runs it so a Production env changed after 31 Oct cannot reach C5
unseen. Equal on 31 Oct (13 and 35 names).

Plan §9.3, critique1 B7. A static scan of which env variable NAMES each
codebase reads (`lib/env-scan.mjs`; the fees repo by file reads only, no git,
no script), against each Vercel Production project's names (`vercel env ls
production`, values hidden), with an owner and a status per name. Writes
`docs/cutover/ENV-INVENTORY.md`. `--check` exits 1 on any name nobody has
settled. Names only, never a value.

## `backup-one.mjs` — backup and restore test (Phase G)

```
npm run migrate:backup-one                          # dump
npm run migrate:backup-one -- --restore-test <run>  # prove it restores
```

Plan §9.2, critique1 B8. Every table in `public` and `vppsone`, in one
`REPEATABLE READ READ ONLY` snapshot, `COPY` text → gzip in
`%USERPROFILE%\.vppsone-migration\backup-<run>\`, with a manifest of counts,
money sums and SHA-256 per table, and a `migration_runs` row (`backup-one`).
The restore test loads it into a throw-away schema inside one transaction,
compares rows, sums and a re-dump's hash per table, drops the schema and
rolls back (`backup-one-restore-test` row). Run on 31 Oct:
`docs/cutover/BACKUP-EVIDENCE.md` (228 tables, 51,482 rows, all equal).

```
npm run migrate:backup-one -- --restore <run> [--schema public|vppsone] [--tables s.t,…]   # dry run
npm run migrate:backup-one -- --restore <run> … --rollback-only | --apply
```

The rollback of cutover steps 3–4: puts the live tables back to the backup in
one transaction (locks, then `decideRestoreGuard` — never after the cutover
row; `--apply` only on production with fee writes shut), TRUNCATE + COPY
parents first with a second pass for the one FK cycle, every table compared
with the manifest, fee writes and both dispatches left off, orphan check,
sequences forward only, matviews refreshed, a `backup-one-restore` /
`rollback` row naming the loads it undid. Never rewrites the marker or
`migration_runs`. Rehearsed with `--rollback-only` on 31 Oct: 226 tables /
51,481 rows equal, 37 s (`BACKUP-EVIDENCE.md`).

## `reconcile-post.mjs` — the parallel run's money check (Phase G)

```
npm run migrate:reconcile-post -- --baseline           # once, at C3
npm run migrate:reconcile-post -- --as-of <today IST>  # every morning after T0
```

Plan §12.1; `PARALLEL-RUN.md` check 5; the first rollback trigger. After T0
One and the fees app differ by design, so `reconcile.mjs` no longer applies.
Read-only on One (never opens the fees database). `--baseline` freezes One's
ledger at the `cutover` row — receipts per real session and mode, their
allocations, EMI late-fee installments, the money summary — in a
`reconcile-post` migration_runs row. The daily run checks the baseline is
unchanged and baseline + desk postings + tail postings (receipts a posted
`tail_receipts_review` row names) = One's receipts now; no receipt number
twice; none at or under `receipt_suffix_floor`; every posted tail row's
receipt exists, after the line, for its amount. EMI late fees since the line,
the money summary's change and TEST are printed apart. Exit 1 = a rollback
trigger. Arithmetic in `lib/reconcile-post.mjs`
(tests/migrate-reconcile-post.test.ts); on 31 Oct it refuses (no cutover
row), and with a trial line of 1 Oct on wtgx's data all checks were equal.

---

## Libraries

| File | |
|---|---|
| `lib/fees-readonly.mjs` | the sealed reader (above) |
| `lib/one-db.mjs` | One's direct connection (A1) |
| `lib/env.mjs` | env files, run folders (refuses a folder inside the repo), args |
| `lib/live-read.mjs` | OpenAPI enumeration, fingerprint, paginated reads, NDJSON |
| `lib/catalog.mjs` | One's catalog: tables, keys, FKs, triggers, sequences, matview order |
| `lib/import-rules.mjs` | skip tables, terminal rules, One-owned settings, TEST and protected classification |
| `lib/diff.mjs` | the load plan, blocked deletes, orphan/unique prediction, load order |
| `lib/guards.mjs` | when a tool may write |
| `lib/auth-import.mjs` | auth users: plan (email clash) and apply |
| `lib/secrets-box.mjs` | AES-GCM for auth rows; purge |
| `lib/control-totals.mjs` | the MCP's money definitions |
| `lib/reconcile-checks.mjs` | the figures reconcile compares |
| `lib/tail.mjs`, `lib/tail-feed.mjs`, `lib/watermark.mjs` | the tail: end date, allow-list, actions, feed, watermark |
| `lib/storage-list.mjs` | bucket listing and copy plan |
| `lib/env-scan.mjs` | which env names a codebase reads (static scan) |

Tests: `tests/migrate-readonly.test.ts` (both seals),
`tests/migrate-tooling.test.ts` (every pure rule above),
`tests/migrate-tooling-review.test.ts` (the review fixes: reconciler filters,
unmigrated data, TEST online rows, re-pointed children, count check, auth
identities, tail insert order and deferral, event twins, matview freshness,
year split, latest run, storage, rollback procedures, review-queue grants),
`tests/migrate-foundation.test.ts` (A1).

## Phase H — conversion, quarantine, promotion, enrolments

Runbook steps 2, 3 and C8 (`CUTOVER-RUNBOOK-2026-27.md`). Each is a dry run
unless given `--apply`; each but `classify` has `--rollback-only` (every
write, its checks, then ROLLBACK). The rules are pure and tested
(`lib/quarantine-rules.mjs`, `lib/quarantine-sql.mjs`, `lib/uuid5.mjs`;
`tests/migrate-quarantine.test.ts`). Dry-run counts on wtgx:
`QUARANTINE-REPORT.md`.

| Script | Does | `--apply` refuses unless |
|---|---|---|
| `convert-to-production.mjs` | fee writes `'false'`, TEST prefix `TST`, marker `production`, QA / smoke / day-run login profiles → test accounts (never banned), test accounts' off-allowlist numbers nulled, `smoke-enforce` kept only if provably confined, dispatch flags off; `--revert <step>` from the run row | a backup-one run < 24 h on this machine; every `supabase/migrations` file in the ledger; no cutover |
| `classify-dev-vppsone.mjs` | read-only: rows per bucket (A promote / B quarantine / R rebuilt / C never / K keep), unclassified tables, real classes with no live partner (sealed reader), the owner's own activity | — |
| `quarantine-in-place.mjs` | every B row (and TEST rows of A/R tables) into TEST-2026-27 in place: relabel; TEST twin classes; `TEST-D-` shells (uuid v5 `dev:students:<id>`); test twins for real-teacher profiles (their logins move; held day-run / QA-named profiles get none); class / student / staff references re-pointed — foreign keys, `class_id` / `student_id`, and the no-foreign-key columns and uuid[] arrays TABLES lists; phones / tokens / phone-field record answers nulled or rotated; sends cancelled, notices suppressed; append-only tables delete + insert-copy (ids kept) with named triggers off; every new identity and class / staff re-map in `migration_id_map`. `--with-promote` / `--with-reset` (rehearsal) add the promotion and a TEST reset before the checks. The rehearsal lists every table written and checks each is one `backup-one --restore` puts back | marker `production`, fee writes `'false'`, a backup < 24 h, no applied load, no cutover, no unclassified table, no unlisted reference column, no held profile (`--accept-held <short,…>`) |
| `promote-master-data.mjs` | role_permissions = migration seed; real A rows about QA profiles / from the QA fixture / on a class with no live partner dropped; QA authors nulled; text scan; real-teacher profiles made real (no login, no phone); then `seed-timetable.mjs --production-promote`. Sign-off list (candidates and held) → private folder | marker `production`, fee writes `'false'`, a succeeded quarantine, live classes readable, no TEST row on a candidate, no held profile (`--accept-held`), the re-seed resolves |
| `verify-quarantine.sql` | the §4.6 checks as one read-only SELECT, one row per check | — |
| `repoint-test-class-rows.mjs` | TEST-labelled rows on a real class → its TEST twin (the general rule alone); `--revert <run>` | touches TEST rows only |
| `rebuild-enrolments.mjs` | C8 (runbook: after step 5, before step 8): real-session enrolments = on roll + left from `public.students`; classes without a current class teacher | marker `production`, fee writes `'false'`, a first load or cutover row |
| `../reset-test-session.mjs --session TEST-2026-27` | deletes One's TEST-2026-27 activity (B tables, children first; a table's BEFORE DELETE guard triggers off for its one DELETE); keeps the TEST bed and every fee row; `--rollback-only` rehearses. `--null-test-phones`: nulls TEST-class students' phones that are not on the allowlist (after the first load) | the session named exactly; ≤ 150 students in TEST classes, not counting the quarantine's `TEST-D-` shells |

`load-snapshot.mjs` writes a `vppsone.data_replica` row (`REAL fee data …`,
nothing masked) with each load, and `--first-load --apply` refuses while any
bucket-B `vppsone` row still carries a real session (the quarantine has not
run, or real activity happened since). There is no `purge-dev-fee-data` script:
the first real load replaces `public`, deleting the masked replica's rows
except protected ones (shells, the TEST twin class).
