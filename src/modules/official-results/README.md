# Board office records

`/exam-office/board` configures an authority/session/attempt and its real existing
classes, subject codes, checklist and checked circular. No annual mandatory rules,
subject defaults, portal submission or fee clearance is inferred. A separately
verified, current, conflict-free deadline is the only date exposed to Calendar.

Candidate registration maps canonical student IDs to an authority registration,
roll and selected registered subjects. First verification freezes a minimal exact
identity, enrolment and class snapshot from the current canonical roster. Results require that verified mapping and
an exact authority-issued source reference; optional private PDF/PNG/JPEG evidence
is limited to 750 KiB. No file-import contract has been assumed. Raw outcome values
and source statuses remain strings, with pending/withheld values null.

One atomic service-only RPC rechecks the active actor, permission, confinement,
session, source freshness, canonical enrolment, selected class membership and all
expected versions. It serializes commands by cycle and retains idempotent receipts.
Authenticated grants are SELECT-only with scoped RLS. Result revisions and command
history reject UPDATE/DELETE. A result correction appends a superseding revision;
another authority attempt gets its own cycle. Financial and internal mark tables
are not referenced by the writer.

Class/authority/attempt/subject scope freezes once any registration exists. A
candidate's registration/roll/subjects freeze once a result exists. Circular or
checklist edits increment cycle revision; older readiness checks must be checked
again against that revision. Their prior receipt remains in history.

`BoardOfficeLinks` and `BoardDeadlineLinks({sessionLabel})` are server components
for the existing Exam Office, School Office and Calendar. Alternatively Calendar
can consume `loadBoardDeadlines(sessionLabel)`, which returns a date, label,
authority, attempt, checked-on date, source reference and a link to the single
cycle editor. Both components check the current outcomes-view capability.

Counts combine the current selected-class roster with frozen verified registrations
and their registered subject sets. Leaving school or moving class cannot remove a
registered candidate from that examination's denominator. The exact frozen name
and class remain attached to that cycle. Readiness and outcome corrections can use
that immutable registration after departure; registration/subject edits still need
current verified canonical identity in the configured classes.
Issued subject outcomes include absent/cancelled; missing/pending/withheld remain
unresolved. Appearance is recorded separately and unknown candidates are counted
explicitly. Every write still requires a fresh current source revision through
`school_board_source`, which delegates to the canonical roster's freshness gate;
an empty active TEST roster uses the same empty-set revision hash as that roster.
Source outages disable entry and produce unavailable metrics, never zeroes, while
retaining the already authorized historical snapshot for inspection.

The school must supply/check the current applicable circular and actual result
specimen before using real requirements or outcomes. Local tests use only synthetic
fixtures; migrations, database verification and deployment are coordinated by the
release owner.
