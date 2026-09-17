# Screen map and role-specific composition

All examples open through `index.html?screen=SCREEN_ID`. Desktop and mobile PNGs are in `screenshots/SCREEN_ID-desktop.png` and `SCREEN_ID-mobile.png`. The screen registry is also in `screens.json`.

This maps **design families**, not a promise that every current URL has its own unique pixel mockup. Reuse the family for related create/edit/detail routes while preserving the workflow requirements in `PARITY.md`. The 32 concrete compositions cover role homes, principal work, entry/navigation, recovery and shared foundations.

## Homes

| ID / persona | Information hierarchy | Mobile design | Desktop design | Implementation home |
|---|---|---|---|---|
| `accountant` / School Fees accountant | Receive payment → collection/dues → recent receipts → follow-up | Payment action near title; 2×2 metrics; receipt rows; fee-first bottom bar | Full fee navigation; payment desk and recent collections beside collection mix | **Original School Fees** `/protected/dashboard`; link registry already has its home |
| `teacher` / `teacher` | Own class → attendance → requests → lessons | Attendance above metrics; short task list; four familiar tabs | Work list beside day agenda; assigned class context throughout | VPPS One `/teach` |
| `teacher-hi` / `teacher` | Same teacher hierarchy in Hindi | Hindi labels wrap naturally; no reduced font to fit English-sized boxes | Same content order and component spacing | Account language variant of `/teach`, not a new route |
| `admin` / `admin` | Exceptions → cross-school workspaces → supporting progress | Open cover and pending review first; secondary overview lower down | Combined attendance, authorized fee summary, SamPark, cover and exams | `/dashboard` admin composition |
| `office` / `office` | Find child → review corrections → rounds → photos / fees link | Find-student action first; office destinations in the bar | Directory/review tasks plus round progress | `/dashboard` office composition |
| `academic` / `academic_coordinator` | Uncovered periods → available staff → registers → timetable | Two uncovered lessons with immediate assignment actions | Work items alongside daily cover and workload context | `/dashboard` coordinator composition |
| `exam` / `exam_coordinator` | Missing marks → readiness → reports | Resume unfinished marks first | Class progress, assessment queue and readiness side by side | `/dashboard` exam composition |
| `viewer` / `view_only` | Published summary → timetable | Summary cards with no editing or child-list destinations | Aggregate attendance/enrolment/operations summary | `/dashboard` viewer composition |

The preview personas `academic`, `exam` and `viewer` are abbreviated design names. Map them to the actual role identifiers above. `accountant` has **no implicit equivalent in VPPS One**. Preserve the current role model until an explicit, reviewed role/landing mapping exists. Never derive account type from an email, a menu label, or a mock query parameter.

When a valid destination deep link exists after sign-in, preserve it if permitted; these homes are the fallback for a fresh visit. A teacher with multiple assignments needs an own-class selector. A teacher with none gets the no-assignment state, never an empty register suggesting no students exist.

For the original School Fees roles, derive variants from its actual permission matrix: `fee_collector` uses the payment-first composition with only permitted collection actions; its `view_only` uses read-only fee summaries/reports; its `teacher` receives only whatever the fee app actually permits. These are permission-filtered variants of the fee patterns, not equivalent to VPPS One's teacher/viewer roles, and are not additional fully rendered personas in this atlas.

## Workflows

| ID | View / key design decision | Phone vs desktop | Route family / owner |
|---|---|---|---|
| `payments` | Choose student, enter payment, review allocation | Stacked sections / form plus persistent summary column | Original School Fees `/protected/payments`; current ledger/actions preserved |
| `dues` | Searchable outstanding list, clear status and next action | Student cards / sortable labelled table | Original fees `/protected/defaulters`, `/protected/reminders`; reminder preview/queue is an extension using same patterns |
| `receipts` | Recorded payment identity, allocations, balance and actions | Readable receipt / receipt beside action panel | Original fees `/protected/transactions` family; recheck actual detail routes before linking |
| `fee-report` | Collection totals separate from concessions/write-offs | Summary and mode breakdown / period panel beside reconciliation | Original fee reports; check the source repo's current navigation for exact report paths |
| `students` | Search by name/SR; visible class/session scope | Labelled identity cards / table | VPPS One directory planned in R2.3/R4.1; confirm implemented URL from current branch rather than guessing |
| `student` | Identity, approved details, provenance, attendance, next task | Stacked profile / core details plus scoped task panel | Current `/teach/student/[id]`; upcoming directory detail can reuse composition with role-specific sections |
| `attendance` | Mark exceptions, reconcile status totals, save explicitly | Four labelled status targets under each name / horizontal roster with summary | `/teach/attendance`, class roster `/teach/class/[id]`; monthly register and corrections reuse table/status patterns |
| `requests` | Due work and completed history together | Short action inbox / inbox and contextual help | Teacher request inbox planned in R3.3; preserve actual token destinations |
| `request-link` | One focused no-login task with issued values and reason | Single child card, confirm/correct / limited reading width | `/r/[token]`, `/t/[token]`, `/w/[token]`; exact content and scope differ, shared state/identity design |
| `sampark` | Step 2: audience selection + preview count + reason | Form then summary / simultaneous form-summary columns | `/collection`, `/collection/[id]`; R3 request/batch wizard; SamPark original `/requests` remains available |
| `review` | Sent value, teacher correction, current approved record | Side-by-side value cards where fit, stacked actions / diff plus queue | `/collection/review`; comparison must use frozen snapshot and stale-review rules |
| `cover` | An uncovered lesson with suitable candidates and workload | Lesson context before large assign controls / side-by-side work and open queue | `/substitutions`; preserve existing engine, pins, availability and publication steps |
| `timetable` | Useful per-person/per-class scope | One day agenda / week matrix | `/timetable`, `/timetable/[id]`; import and conflict preview reuse form/review patterns |
| `marks` | Score, absent, incomplete remain distinct | Compact labelled rows with comfortable fields / keyboard-friendly grid | `/assessments/marks/[paperId]`; teacher scope comes from assignments, not the preview role |
| `reports` | Report preview, completeness and publication | Readable stacked report / report plus readiness column | `/assessments`, `/assessments/[id]`, `/assessments/report/[studentId]`, `/assessments/exports` |
| `documents` | Missing photos first, identity before upload | Camera/file actions under child cards / batch placement grid | `/documents/[id]` existing protected download; photo capture/batch UI R4.2 is not yet implied by this URL |

## Entry, navigation and shared views

| ID | Purpose | Implementation mapping |
|---|---|---|
| `apps` | Explicit doors to School Fees and SamPark; destination identity and access | `/apps`; **use `src/platform/config/apps.ts` / `app-origins.ts`**, never guessed hostnames |
| `settings` | Personal language/display; separate school settings | Current/new preferences route from implementing branch; keep existing authored language handling |
| `more` | Role-specific mobile overflow, never a generic product catalog | `/more`; every permitted destination reachable; mobile priority and desktop completeness independently tested |
| `login` | Simple entry, issued-link guidance, no role selector | `/login`, `/auth/confirm`; actual account admission chooses the authorized default |
| `staff` | Staff role and teaching assignment visibly separate | `/staff`, `/staff/new`, `/staff/[id]`, `/staff/[id]/edit`; use shared form/diff patterns for editing |
| `setup` | School settings grouped by academic/collection/operations purpose | `/academics`, class/subject/class-teacher routes, `/calendar`, `/enrolments`, `/collection/fields`, `/jobs`, `/substitutions/policies` |
| `states` | Loading, empty, failed, saved, unavailable access, stale write, closed link, missing assignment | Route loading/error/not-found boundaries plus task-local state components |
| `components` | Semantic palette, typography, controls and statuses | Extend current shared primitives and shell rather than copy prototype markup into every page |

## Detailed variants to complete during implementation

These are **specified follow-on variants**, not already fully interactive screens in the atlas:

- SamPark wizard steps 1/3/4, custom-list import with per-row issues, batch progress, master-link progress, reminder delivery history and conflicts. Compose from `sampark`, `review`, `students`, `states`; preserve every S-01–S-14 parity requirement.
- Fee admission, fee configuration, discounts, concessions, write-offs, leaver date, reversals, cancellation, protected transactions, message previews and reports. Apply the visual patterns in the original fee repo, using its existing rules and F-parity register. Do not infer financial behavior from example amounts.
- Teacher class selector, real full register, monthly register print, corrections history, cover assignments, note entry and all permitted request types. Four-row samples do not establish acceptable full-class scroll cost.
- Photo camera/crop/upload/retry and desktop batch file matching. The atlas contains the landing composition and preview dialog; actual file handling remains implementation work.
- Staff create/edit, timetable import, subject configuration, school calendar, job detail, message queues and activity history. Their shared form/table/state design is established; each still needs workflow-specific content and validation.

The screenshots are a visual target. They are not a reason to remove capabilities that are absent from a simplified sample. Add the missing workflow controls using this language and record a deliberate deviation when actual staff work requires it.
