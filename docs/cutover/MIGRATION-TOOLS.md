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
request but GET / HEAD and the two Storage read POSTs (`object/list`,
`object/sign`). `tests/migrate-readonly.test.ts` proves both.

Optional, secondary: `withFeesReadOnlySnapshot()` for a `LIVE_DB_URL` in the
secrets file (none today). It connects with `default_transaction_read_only=on`,
runs one `REPEATABLE READ READ ONLY` transaction and exports a snapshot;
refuses a URL that does not name the fees ref, and the transaction pooler
(6543), which cannot hold a snapshot.

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
  and `shape/student.mjs`).

Output in `<run>/`: `tables/*.ndjson`, `views/*.ndjson`
(`v_workbook_student_financials`, `v_online_payment_reconciliation`),
`secrets/auth-users.json.enc`, `control-totals.json`, `manifest.json`.

## `control-totals.mjs` — compare with the fees MCP

```
node scripts/migrate/control-totals.mjs --run <id> [--mcp <file.json>]
```

`<file.json>`: what `get_session_money_summary` returned, keyed by session
label. Field-by-field comparison (headcount, every money figure, segments);
exit 1 on any difference.

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
node scripts/migrate/load-snapshot.mjs --run <id> --purge-secrets
```

**Guards (`lib/guards.mjs`), checked before and again inside the write
transaction.** `--apply` refuses when:

- `vppsone.migration_runs` has a `cutover` row (after T0 a stray mirror would
  delete every One receipt — critique0 #7);
- `app_settings.fee_writes_enabled = 'true'`;
- `vppsone.deployment` is not `production`, unless `--allow-dev-target`
  (a rehearsal on a throwaway target only; it never lifts the other two);
- `--first-load` and an applied load already exists.

**Dry run is read-only**: one `READ ONLY` transaction; no staging table, no
`migration_runs` row. It prints the per-table plan, blocked deletes, predicted
FK orphans and unique conflicts, missing auth parents, the auth plan and the
guard verdict.

**What the plan decides (`lib/diff.mjs`, `lib/import-rules.mjs`):**

| Rule | |
|---|---|
| Never touched | `backup_runs`, `workbook_materialized_view_refresh_queue`, `office_sync_events`; tables not in One's `public` (live's empty One-style tables) |
| Terminal-state import | `online_payment_orders` open/pending/paid/review_required → `abandoned`; `_intents` link_pending/link_created/paid/review_required → `cancelled`; `_events` pending/failed → `ignored`; `_captures` pending/review_required → **not imported** (the only terminal value, `applied`, would claim a receipt); `notification_outbox` queued/processing/failed → `suppressed` (and `locked_until` cleared). Every target is allowed by the table's CHECK (read from wtgx) — critique0 #2, #3 |
| One-owned settings | `app_settings` keys `online_payment_*`, `whatsapp_receipt_notice_enabled`, `whatsapp_reversal_notice_enabled`, `receipt_suffix_floor`, `staff_whatsapp_month_cap`, `fee_writes_enabled`: never inserted, updated or deleted. Cells in `vppsone.one_owned_fee_settings` (TEST-2026-27 `receipt_prefix` = `TST`) keep One's value |
| TEST sessions (T1) | Rows with a `*session_label` column holding a test label, `app_settings` keys ending `:<test label>`, and everything reached down a foreign key from them (students in TEST classes → installments, receipts, payments, waivers, family rows, sends, orders…), plus `audit_logs` rows about them. Without `--first-load`: never inserted, updated or deleted, on either side. With `--first-load`: live's TEST rows are inserted/updated; One's own TEST rows are still never deleted |
| Protected rows | `students.admission_no LIKE 'TEST-D-%'`, every `migration_id_map` target, and everything keyed on them (and their audit rows): never updated or deleted; a live row with the same key is counted as a conflict. Source rows the fees project re-keyed through the map are skipped |
| Blocked deletes | A row that stays never loses its parent: the parent's delete is dropped and counted |
| Order | Parents first (topological over `pg_constraint`); deletes children-first; the nullable side of a cycle (`installments.carry_forward_balance_id`, `student_repayment_plans.supersedes/superseded_by_plan_id`) is written in a second pass |

**Apply, in one transaction:** auth users upserted by id (an email that
belongs to a different One user refuses the load; the password hash is never
copied or overwritten; identities inserted if missing) → loaded tables locked
`EXCLUSIVE` → plan rebuilt inside the transaction → refused on any predicted
orphan, unique conflict or missing auth parent → every source row staged into
`import_stage.<t>` (`LIKE public.<t>`) → each table's **named** user triggers
disabled (`ALTER TABLE … DISABLE TRIGGER "name"`, never
`session_replication_role`, so foreign keys stay on) → deletes, inserts,
updates, deferred columns → triggers re-enabled → orphan count per foreign key
in `pg_constraint` (any orphan aborts) → matviews refreshed in dependency
order → owned sequences `setval` → `vppsone.migration_watermarks`. Then a
`migration_runs` row (`load-snapshot`, `run`, counts and the watermark in
`summary`) and the run's sealed auth rows are deleted.

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
objects and bytes per bucket.

**As-of:** late fees depend on the date, and both sides come from their
matviews. A read-only client cannot evaluate the fees side at another date, so
`--as-of` must equal the source's IST date (the extract day, or today with
`--live`) — reconcile refuses otherwise. Run extract, load and reconcile on the
same day. Exit 1 on any mismatch; a JSON report goes to the run folder.

Run on 30 Oct against the unloaded replica: 62 mismatches, as expected
(One still holds the masked 22 Sep replica).

## `storage-copy.mjs` — files

```
node scripts/migrate/storage-copy.mjs [--apply] [--bucket <b>] [--allow-dev-target]
```

`student-photos`, `parent-documents`, `defaulter-voice-notes` → the same paths
on One; never `nightly-backups`. Download through the sealed client, upload
with `upsert` to One. Idempotent by path + size; nothing on One is deleted.
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

- Fees receipts → **`vppsone.tail_receipts_review`** (migration
  `20261030132121_tail_receipts_review.sql`), with payments, order lines and
  captures as evidence (ids and amounts). Never raw `receipts` / `payments`
  rows (critique0 #8). A person posts each through One's engine, or marks it a
  duplicate or rejected.
- `online_payment_events` → upsert on `provider_event_id`, the fees row wins
  (critique1 A7), after the terminal rule.
- Orders, intents, unpaid order lines → inserted when absent, after the
  terminal rules.
- `whatsapp_reminder_sends`, `school_notice_sends` → inserted when absent,
  every kind (critique0 #11); a send whose receipt is not in One is deferred.
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
rows), `detail.csv`, `summary.json`. The fees database keeps changing by its
own crons throughout (critique1 B12), so re-entry starts from its current
state.

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

Tests: `tests/migrate-readonly.test.ts` (both seals),
`tests/migrate-tooling.test.ts` (every pure rule above),
`tests/migrate-foundation.test.ts` (A1).
