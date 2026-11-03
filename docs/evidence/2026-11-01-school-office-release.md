# School Office release — 1 November 2026

Owner direction: integrated actions plus a School Office register; implement and
deploy live. The owner approved the existing letterhead, manual principal
signature/seal, and `VPPS/STUDY/<session>/0001`. No financial cutover is included.

## Staff workflows

- Student profile: **Study certificate** prepares the approved document in one
  action. Missing required details appear inline. Office readers get a student
  record link and administrator correction guidance; source editors get the
  existing Admissions editor. School-issued documents sit beside uploaded files.
- School Office: search/filter issued documents, open original stored PDFs,
  record download/print requests and manual handover, or intentionally create
  another issue. Corrections/cancellations retain the original and its number.
  A failed file can resume its exact reserved issue even after a newer issue.
- Government returns: choose destination, purpose, school/session and cohort;
  check details, then prepare a reference workbook or a school-verified format.
  Unsupported formats remain explicit manual-reference sheets. A prepared or
  downloaded file is never called submitted or accepted.
- Returned files: exact supported headers and text identifiers, review immutable
  differences, resolve conflicts at source, then apply only external registration
  identifiers/statuses. Current identity, source and every external revision are
  checked at application. Acknowledgement/evidence and exact accepted rows record
  full/partial acceptance separately from submission.
- Exam Office: configure Class 5/8 or RBSE 10/12 cycles from actual circulars,
  subject selections and attempts. Verified deadlines appear in Calendar from
  this same store. Verified registrations freeze examination membership so
  departures/promotions cannot erase a candidate or their denominator. Official
  results retain exact issued values/statuses and immutable correcting revisions;
  pending/withheld values and unknown appearance are distinct. Student Learning
  links into an exact pupil filter; internal marks remain separate.
- Today/Needs you: current certificate blockers, unfinished files and latest
  unresolved import conflicts link to their existing owners. Corrected blockers
  disappear through read-time re-evaluation, with no GET mutations.

## Configuration dependencies

The approved manual Study Certificate is active. Template language/wording and
minimal required fields are versioned under School Office settings. The PDF
never loads a stored signature asset; every copy requires manual signature.

No PSP API or annual upload contract is assumed. A real current blank specimen,
school/session, exact mappings and source reference must be reviewed by an
authorized administrator before a supported flat CSV/XLSX format is activated.
Other formats keep working as reference sheets. Current circulars, deadlines,
registration evidence and authority-issued outcomes are school inputs, not seeds.

## Database and source boundary

Only One project `wtgxcptmucjerhufzjcf` was migrated. Five applied migrations,
with local filenames aligned to their actual ledger versions:

| Version | Name |
| --- | --- |
| 20261101170720 | school_office_certificates |
| 20261101170731 | school_office_role_permissions |
| 20261101170841 | school_office_government_records |
| 20261101171208 | school_office_board_records |
| 20261101171212 | school_office_attention |

All new application tables/functions live in `vppsone`; two private storage
buckets hold immutable files/evidence. New mutation RPCs are service-only and
recheck current active actor, capability, school-wide scope, session and TEST
confinement. Cookie SELECTs use RLS. New real issuance/roster commands fail closed
for disabled, stale or errored bridge state; existing stored certificate reprints
remain available through a source outage. Fees remains the financial authority.

Read-only checks before/after found One's local payments/receipts at 1,151/669,
and `fee_writes_enabled=false`. No source Fees database, money, parent dispatch,
real certificate or official portal submission was used for verification.
All transactional document, batch, evidence and board fixtures were rolled back.

The security advisor introduced only the intended INFO entries for service-only
certificate counters/receipts having RLS with no authenticated policies. No new
WARN/ERROR finding was introduced. Deny-by-default is deliberate; see
[Supabase's policy diagnostic](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Verification

- Full Vitest: 428 files / 19,206 tests passed. Later board fixes also passed
  their focused 6,310-test architecture/command/UI gate.
- Typecheck passed after nullable empty-cycle typing; lint has no errors, with
  the 15 pre-existing warnings. Theme: all 430 tokens match School Fees. All
  828 ported imports pass. Production build and route bundle checks pass.
- Three rollback-only PostgreSQL scripts passed 19 groups of actual commands,
  including serial/reprint/recovery idempotency, immutable snapshots/files,
  service/RLS/TEST denials, disabled/stale/error bridge failures, stale unchanged
  rows, exact leading-zero imports, acceptance evidence/row scope, retained exam
  membership, official correction/replay and read-only attention resolution.
  Scripts: `verify-school-office.sql`, `verify-school-office-board.sql`, and
  `verify-school-office-attention-returns.sql` under `scripts/`.
- Synthetic English/Hindi/bilingual PDFs, including long mixed-script names,
  were rendered and visually inspected. Stored-byte route tests verify hashing,
  private authorization, original-byte reuse and no generation on GET.
- Browser: 46 distinct scenarios, including 30 combinations of
  360/390/430/1280/1440px, en/hi/both and light/dark, visiting ten actual screens
  each, plus 16 workflows. Full run passed 44; two ENOSPC artifact failures passed
  the same assertions on a targeted rerun without code changes. Mobile fixes
  wrap long names/registration capsules and preserve readable heading rows.
- Fresh independent whole-branch and targeted reviews found source fallback,
  exact-resume, unchanged-revision, retained-membership, request receipt and
  board replay gaps. All were corrected with focused and/or PostgreSQL checks.

Evidence stays under `D:\Codex\scratch\school-office-release-2026-11-01`:
test/build logs, synthetic PDF renders and browser coverage summary/screenshots.
Viewport emulation is not physical-phone/printer validation. The browser fixture
does not establish actual portal compatibility or acceptance. Shared-browser
control was disabled in Work settings; live checks use deployment metadata and
authorized TEST HTTP reads instead.

## Release record

Branch: `feat/school-office-operations`, base `c3c05f1`. Pull request, exact CI
head, production merge/deployment and authenticated live results are recorded
after publication below. Do not infer live status from local validation.
