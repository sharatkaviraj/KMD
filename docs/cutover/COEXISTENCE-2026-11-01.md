# Fees and One coexistence implementation

The owner authorized implementation, migrations and live deployment on
1 November 2026. Fees remains the canonical financial ledger. One keeps its
academic database and a separately verified projection of shared identities.
The existing Fees app, payment links, provider webhooks, fee messages and
day-close jobs continue to own those operations.

## Decisions

- Preserve every pre-existing One activity record as TEST.
- The two held teachers, Ravina and Jainendra, and the Office, Admin and Viewer
  profiles are real accounts. Preserve their existing login addresses and
  passwords for now. Revoke their old QA shortcuts before activation.
- The reviewed 17 teacher identities plus the two held teachers form the real
  timetable master. TEST twins retain earlier activity.
- QA Fee Collector remains TEST. Four unambiguous current Fees staff accounts
  were provisioned with their existing passwords; no access emails were sent.
- The two applications never independently post the same money. One's payment
  command invokes the existing source engine with a durable command UUID.
- No new parent test send, plan purchase, password reset or fabricated real
  collection is part of deployment validation.

## Operation inventory

| One entry | Canonical owner | Current behavior and recovery |
| --- | --- | --- |
| Payment Desk search and standing | Fees `/api/one/v1/students` | Verified One identity and explicit source actor/session grant; uncached source reads |
| Review payment and default late-fee waiver | Fees `/quote` | Source permission checks, current balance and source policy; no write |
| Collect payment | Fees `/payments` | Same source posting engine and receipt numbering; both environment and source command gates must be open |
| Lost response/reload | Fees `/commands/:id` | Browser stores the original command before dispatch; checks status and retries only that ID |
| Receipt display/print and real `/rv` | Fees receipt/public verification | Canonical receipt and source print link; no duplicate One receipt |
| Reversal, refund, correction, duplicate override | Existing Fees screens | One opens the supported canonical workflow |
| Households, student master, fee setup, bulk operations | Existing Fees screens | One opens the supported canonical workflow |
| Financial reports/exports, day close, reminders, payment links | Existing Fees screens/jobs | One never runs a competing financial schedule/provider |
| Academic roster, attendance, marks, enquiries, seats | One | Authorized real roster projection; earlier academic activity remains TEST |
| TEST financial rehearsal | One isolated TEST engine | Does not fall back to the source or use real command credentials |

Current native One collection supports ordinary payments. Advanced financial
operations remain fully available through Fees. Source photos are placeholders
in One until a separate source-owned media contract is introduced. Retired
identity snapshots are retained; existing academic rows are never cascaded away.

## Sync and reconciliation

The source records invalidations in the same transaction as changes. Explicit
capture scope covers the source's financial, roster and household write paths.
The service claims a consumer lease with a monotonically increasing fence,
obtains a coherent complete snapshot and commits it to One before acknowledging
the exact claimed event UUIDs. A failed target commit leaves source work pending.
Late commits are not skipped by a timestamp or maximum-ID watermark.

One validates the source project, contract, revision, snapshot age, calculation
day, counts, unique IDs and all class/session references. One applies only rows
whose content changed, retires removed identities, and verifies the actual typed
fields as well as the original JSON. This avoids rewriting the whole roster on
each payment. Concurrent workers are fenced; ordinary lease contention does
not mark the bridge unhealthy.

An idle poll releases its lease and records a successful check without writing
the roster. A new IST calculation day or the nightly `?verify=1` request forces
a fresh complete snapshot and verification. `fees_bridge_runs` records each
verified generation's revision, counts, hash and time. No nightly equality claim
compares two moving live queries.

Publication is separate from loading. A database guard rejects publication
without a fresh verified snapshot or with TEST/real student or class ID
collisions. The application refuses current roster/identity decisions after
five minutes without a successful check and shows an outage banner. Canonical
financial lookup remains a direct source request. One's academic records remain
stored during a source outage.

## Configuration and operational controls

Source production variables: `ONE_BRIDGE_ENABLED`, `ONE_BRIDGE_KEY`,
`ONE_BRIDGE_SYNC_SECRET`, `ONE_BRIDGE_AUTH_URL`, `ONE_BRIDGE_AUTH_ANON_KEY`.
The Auth URL is pinned to One. `private.one_bridge_config` and explicit
`private.one_bridge_grants` independently control read/sync/command access.

One production variables: `FEES_BRIDGE_ENABLED`, `FEES_BRIDGE_ORIGIN`,
`FEES_BRIDGE_KEY`, `FEES_BRIDGE_SYNC_KEY`, `FEES_BRIDGE_CRON_SECRET`, and
`FEES_BRIDGE_WRITES_ENABLED`. The only allowed origin is
`https://fees.vpps.co.in`. Production secrets are never installed in preview.
Normal One Supabase clients retain One's own project.

The scheduler POSTs `/api/jobs/fees-bridge-sync` with the dedicated bearer
secret. A separate 02:00 IST request adds `?verify=1`. Vault stores the scheduler
secret; neither cron command text nor reports contain it. Check the latest HTTP
status, `fees_bridge_state.last_checked_at/last_error_code`, source pending age
and capture health. A visible stale state is a failure, not an empty school.

To stop native One collections, close the source command gate and One write
flag; collect in Fees. To stop sync, disable the bridge schedule and source
sync gate. Do not repoint One, enable its local real fee engine, re-enter a
tail payment or shut down existing Fees links. For a bad projection, keep One
unpublished and rebuild from a complete source snapshot. Preserve source
command records and receipts; retries must reuse their original IDs.

## Evidence and release record

Source runtime shipped through schoolfees PR118 and PR119. One's main runtime
shipped through PR152. The verified source projection and approved real
timetable are published; the 30-second scheduler, 02:00 IST full verification
and scoped scheduler-history retention are active. Collection has independent
source and One environment gates; the final readiness report records their
operator acceptance state rather than inferring it from a deployment alone.

- Source production merge `6973f9009c3c3db939c2624fec4fc0c02cba9e0b`, deployment
  `dpl_CUTFnMutrjdbCXkhGUbYjeNUz4c7`, verified on `fees.vpps.co.in`.
- One PR152 merge `3b642e2ef45561763f5da62601bbe1b3b36b52a9`, deployment
  `dpl_GcQnGwTsMrxUbN6KUE9t5kduJqQ9`, verified on `one.vpps.co.in`.
  Its exact reviewed head passed all 23 checks: 401 test files, 18,546 tests
  passed and one skipped, plus build, synthetic mobile, concurrency and scope
  checks. Later directory/session and operator-tool refinements have separate
  focused regression coverage and deployment acceptance.
- Applied source migrations: `20261101041255_one_bridge_source` and
  `20261101051321_one_bridge_standing_paid_amount`. The forward correction uses
  canonical net cash for total paid, excluding write-off reversals. There are
  32 healthy capture triggers. No source financial schema history was repaired.
- Applied One migrations: `20261101041404_fees_bridge_projection`,
  `20261101042523_fees_bridge_academic_identity` and
  `20261101045818_fees_bridge_current_identity_guards`. Remote migration history
  was fetched into an isolated staging workspace; only new migrations were
  pushed. Actual-database rollback tests preceded application.
- Identity conversion passed 248 checks: 513 TEST student shells, 22 TEST staff
  twins, five approved logins retained and three old QA shortcuts revoked.
  Four new real accounts preserve source password hashes through Admin import.
  QA Fee Collector remains TEST. All six existing exams remain TEST; no real
  marks, attendance or documents were fabricated for acceptance.
- Nine reviewed real account mappings preserve the intersection of existing
  roles: six readers and five potential collectors. Initial scope is `2026-27`.
  One's native real fee engine and parent/staff dispatch remain disabled.
  Source financial messages, providers, payment links and day close remain
  owned by Fees. Auth's site URL is now `https://one.vpps.co.in`; public sign-up
  remains disabled. No passwords were changed or access emails sent.
- The first deployed worker completed in 6.679 seconds. Its frozen source
  snapshot matched One in all four full-content SHA256 manifests: one session,
  19 classes, 537 students and 419 households. All 15 comparisons passed:
  financial totals, typed fields, class/session references, enrolments and TEST
  isolation. All 34 native-table fingerprints were unchanged. Eleven source
  events were acknowledged only after the verified target commit.
- The published real timetable has 1,038 slots and 172 assignments. Actual
  rollback rehearsal passed before atomic application. TEST timetable history
  and all 15 class-teacher rows retained identical hashes. Classes 1, 2, 3 and
  6 currently have no class teacher; no assignment was invented.
- Repeated scheduled calls returned HTTP200 and correctly skipped unchanged
  snapshots. An explicit diagnostic journal invalidation, which changed no
  business record, was delivered and acknowledged by the scheduler in 22.036
  seconds. A manual call of the nightly full-verification path passed in
  4.042 seconds. These measurements do not establish an SLA or claim an
  overnight observation period.
- Deployed API acceptance passed source read, quote, receipt, command status,
  missing-key/token/session/actor denials and the disabled command gate.
  One's authenticated payment, account and admission pages rendered correctly.
  Public One `/rv` delegated to the exact canonical Fees receipt: number, date,
  amount and reversal state matched, with no private student identity exposed.
- One isolated source TEST payment of INR1 was recovered and replayed using
  its original durable command. SQL proved exactly one command, receipt and
  payment, zero notification outbox rows and one each of the expected audit and
  office-sync events. Only the exact TEST policy changed to prefix `TST`; both
  real policy rows were unchanged. Temporary TEST bridge access was revoked.
- Signed-in API/SSR acceptance confirmed current session resolution, all three
  real Student360 tabs, the timetable, the assessment picker and attendance.
  The Sunday attendance summary contained the exact 18-student class roster;
  no marking action was invoked. TEST real-student requests were denied by
  permission without student data. This case is not a substitute for the
  separate SQL and unit tests of student-session authorization.

### Fresh recovery evidence

- Fees application checkpoint, 1 November 2026 11:03:35 IST: all 116
  public/private tables, 93,897 rows, exact same-snapshot archive count parity,
  full archive decoding and no omissions. Archive SHA256
  `1b086003ea7474a1ec9bbea7288537ab50c0daee65f6e127b4b53aef8f908f99`.
- One postload checkpoint, 1 November 2026 11:21:57 IST: all 236 application
  tables, 55,242 rows, including the verified roster and published timetable.
  Restore rehearsal matched all 236 row counts, money checks and content
  hashes; no restore schemas remained. Manifest SHA256
  `6ddcee0ef7b25564c2ec7e1e1dce495b47d37b4e62fd34993296de89e6fee339`.
- Separate One schema archive includes functions, views and grants. A separate
  private cron checkpoint contains eight jobs, six active. These are application
  recovery artifacts; Auth, Storage, global roles and a full-platform restore
  are outside these drills. Supabase plan purchases were not performed.

The owner selected API-only live verification. Synthetic mobile tests are
separate evidence; no physical phone, printer, browser interaction, real money
collection, parent test send or marks/attendance save is claimed. Proposed
seven-day observation windows have not elapsed. Advanced financial lists,
filters, reports, corrections and bulk workflows remain available in Fees;
One's school directory uses the verified academic roster and links to those
canonical financial screens. Existing login addresses remain unchanged as
requested, including the five QA-domain addresses that cannot receive reset
email. Operational class-teacher assignments and longer observation remain
school follow-up work.
