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

## Evidence and rollout state

Implementation is in progress. This section must be updated with actual
merged/deployed SHAs, applied migrations, publication proof and live acceptance
before declaring rollout complete.

- Target migrations `20261101041404_fees_bridge_projection` and
  `20261101042523_fees_bridge_academic_identity` applied through Supabase CLI.
  Remote history was fetched into a private staging workspace; the dry run
  listed exactly these two migrations. No migration history was repaired.
  Verified afterward: disabled, unpublished, revision zero, no projected rows,
  and no direct authenticated projection access.

- Source checkpoint: 1 November 2026 09:53 IST; public/private application
  archive 110 tables and 93,836 rows, with same-snapshot archive count parity.
  SHA-256 `1773583cf626ab464a4bfa1b12718b4689eb5932a6a3228dc73a7b1409d2debe`.
  This is application backup evidence, not a full Auth/Storage restore drill.
- One checkpoint: 1 November 2026 08:07 IST; 228 tables, 51,509 rows; restore
  rehearsal matched all 228 tables and the financial/hash checks.
- Source synthetic PostgreSQL integration includes duplicate command,
  concurrent same-command posting, late commits, TEST side-effect isolation,
  stale quote, role/session denial and lease fencing.
- Target rollback SQL tests cover atomic apply, lost-ack replay, mismatched
  payload/fence, invalid foreign key, typed/payload corruption, retired/revived
  identity, TEST publication refusal and no financial table mutations.
- The proposed seven-day read-only and payment observation windows have not
  elapsed. Staff acceptance, physical printing and real operational experience
  cannot be claimed from automated tests.
