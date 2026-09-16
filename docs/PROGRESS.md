# VPPS One — progress

**The next task is the first row below that is not `done`.**
An agent updates its row before it stops. Never delete a row; add `N.x-fix` rows
under the task they fix.

Status: `todo` · `in progress` · `pr open` · `done` · `blocked (reason)`

## Phase 0 — setup (done by Janmejay + Claude, 2026-09-16)

| # | What | Status |
|---|---|---|
| 0.1 | Repo `veerpatta/vppsone` created, private | done |
| 0.2 | Next.js 16 app scaffolded, Supabase + zod installed | done |
| 0.3 | Vercel project linked, env vars set to schoolfees-dev | done |
| 0.4 | Plan, rules and sources written | done |

### Applied to schoolfees-dev

Migrations are applied through the Supabase MCP, and the file is named for the
version the MCP recorded (D-22), so this list and
`supabase_migrations.schema_migrations` agree.

| Version | File | Task |
|---|---|---|
| 20260916191746 | `create_vppsone_schema` | 1.1 |
| 20260916191757 | `create_staff_profiles` | 1.1 |
| 20260916191935 | `expose_vppsone_to_postgrest` | 1.1 |

## Phase 1 — foundation

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 1.1 | Supabase clients, Auth, login, middleware, `vppsone` schema, `staff_role`, `staff_profiles`, permissions | done | `p1-1-foundation` | `50f674d` ([#1](https://github.com/veerpatta/vppsone/pull/1)) | Creating the schema was not enough — PostgREST answered `PGRST106 Invalid schema: vppsone` until it was exposed, so that is now its own migration (D-19). A proxy that bounced any signed-in visitor off `/login` looped forever against a session whose profile was deactivated; the login page decides that now, from the profile rather than the JWT (D-23). The env badge and a bare `/dashboard` exist but the shell is 1.2's; `requirePermission()` throws rather than rendering an error screen until 1.2 gives it one |
| 1.2 | App shell: mobile layout, bottom nav, top bar, tokens, env badge | todo | `p1-2-shell` | | Inherits the placeholder badge in `src/ui/environment-badge.tsx` and needs a real surface for a denied permission |
| 1.3 | Master data — staff | todo | `p1-3-staff` | | |
| 1.4 | Master data — subjects, class aliases | todo | `p1-4-subjects-classes` | | |
| 1.5 | Master data — class teachers, academic calendar | todo | `p1-5-class-teachers-calendar` | | |
| 1.6 | Enrolments from `public.students` + consistency check | todo | `p1-6-enrolments` | | |

## Phase 2 — timetable

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 2.1 | Parser port from `timetable2025/scripts/data.js` + fixture tests | todo | `p2-1-parser` | | |
| 2.2 | Import dry run, resolve against master data | todo | `p2-2-import` | | |
| 2.3 | Versions: upload → check → draft → publish | todo | `p2-3-versions` | | |
| 2.4 | Views: class / teacher / day / free | todo | `p2-4-views` | | |

## Phase 3 — teacher workspace

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 3.1 | `/teach` shell + Today | todo | `p3-1-teach-shell` | | |
| 3.2 | Attendance screen | todo | `p3-2-attendance` | | |
| 3.3 | Corrections + office on-behalf | todo | `p3-3-corrections` | | |
| 3.4 | Notes | todo | `p3-4-notes` | | |
| 3.5 | Student card | todo | `p3-5-student-card` | | |
| 3.6 | Monthly register PDF | todo | `p3-6-register-pdf` | | |

## Phase 4 — substitutions

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 4.1 | Engine port (tests first) | todo | `p4-1-engine` | | |
| 4.2 | Planner UI | todo | `p4-2-planner` | | |
| 4.3 | Publish → assignments → notify | todo | `p4-3-publish` | | |
| 4.4 | Shift policies | todo | `p4-4-shift-policies` | | |

## Phase 5 — collection

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 5.1 | Token links + field registry | todo | `p5-1-token-links` | | |
| 5.2 | Submissions + review queue | todo | `p5-2-review-queue` | | |
| 5.3 | Student records + documents | todo | `p5-3-documents` | | |
| 5.4 | WhatsApp templates | todo | `p5-4-whatsapp` | | |

## Phase 6 — assessments and reports

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 6.1 | Assessments admin | todo | `p6-1-assessments` | | |
| 6.2 | Marks grid | todo | `p6-2-marks` | | |
| 6.3 | Progress view | todo | `p6-3-progress` | | |
| 6.4 | Report card PDF | todo | `p6-4-report-cards` | | |
| 6.5 | Academic exports | todo | `p6-5-exports` | | |

## Phase 7 — automations and cutover

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 7.1 | Job platform + console | todo | `p7-1-jobs` | | |
| 7.2 | Scheduled jobs | todo | `p7-2-automations` | | |
| 7.3 | Cutover to live data (PLAN §7) | todo | — | | Janmejay decides when |
