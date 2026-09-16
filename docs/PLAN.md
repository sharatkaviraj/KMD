# VPPS One — the plan

One mobile-friendly platform for Shri Veer Patta Senior Secondary School.
Fees stay where they are; everything else the school runs on comes here.

## 1. Why this is a new repo

The first attempt built School One *inside* the live fee app. The rule was "the
fee module is read-only", and it was honoured — but the platform around the fee
module was not. Forty-five existing files were changed: the app shell, both
layouts, the role matrix, the navigation config, the auth middleware, the
message catalogues, the cron routes, `vercel.json`. Per-user feature flags hide
a *route*; they cannot hide a rewritten shell, which every user loads on every
request. So the guarantee the whole design rested on was never real.

A separate repo, a separate Vercel project and a separate schema make that
guarantee structural instead of procedural. Nothing here can reach the fee app,
so nothing here needs a flag, a canary user, a release type or an approval gate.
**That is the point of the restart: the safety lives in the boundary, so the
work inside the boundary can move fast.**

## 2. Architecture

| Piece | Choice |
|---|---|
| Repo | `veerpatta/vppsone`, private |
| Local | `C:\Users\AnandKumari\Desktop\vppsone` |
| App | Next.js 16, App Router, TypeScript, Tailwind v4, React 19 |
| Hosting | Vercel project `vppsone`, its own domain |
| Database | Supabase `schoolfees-dev` (`wtgxcptmucjerhufzjcf`), Mumbai |
| Schema | everything VPPS One owns lives in the `vppsone` schema |
| Auth | Supabase Auth, the same `auth.users` the fee app uses |
| Files | Supabase Storage; Cloudflare R2 later only if storage cost bites |

### The database decision

VPPS One is built entirely against `schoolfees-dev`, on **test-session data**.
That project is a restore of the production schema, so `public` already holds
`students`, `classes`, `sessions`, `installments` and the rest — real shapes,
test rows. VPPS One reads them and never writes them.

Everything VPPS One creates goes in a **separate Postgres schema, `vppsone`**.
That is what makes the cutover a non-event: creating one new schema in the live
database adds nothing to `public`, touches no fee table, and could be dropped
whole if it ever had to be. It also means no table name can ever collide.

When the app is built and proven, the cutover (§7) points it at the live
database — same code, same schema, real rows.

### Environments

| | URL | Database | Data |
|---|---|---|---|
| Production (today) | `vppsone.vercel.app` | schoolfees-dev | test session |
| Preview | per-branch Vercel URL | schoolfees-dev | test session |
| Production (after cutover) | same URL | live fee DB | real |

There is deliberately no separate staging. One app, one database, push to main.

## 3. Roles

VPPS One defines its own roles in `vppsone.staff_role`; it does not read the fee
app's `public.users.role`. A person can be an accountant in the fee app and a
class teacher here without either fact touching the other.

| Role | Sees |
|---|---|
| `admin` | everything |
| `office` | master data, attendance on behalf, collection, documents |
| `academic_coordinator` | timetable, substitutions, assignments, calendar |
| `exam_coordinator` | assessments, marks, report cards |
| `teacher` | own classes: attendance, notes, marks, timetable |
| `view_only` | read-only dashboards |

Permission checks live in one place (`src/platform/auth/permissions.ts`) and are
enforced server-side. A page's guard is a function call, not a flag lookup.

## 4. Data model, in outline

All in schema `vppsone`. Every row carries `created_by` and `created_at`; rows
that are a fact about one academic year also carry `session_label`.

**People and academics**
`staff_profiles` (display_name, short_name — the timetable's join key —, phone,
is_teaching), `subjects`, `class_aliases` (maps the fee app's class rows to the
labels the timetable uses), `class_teachers` (with history: replaced, never
edited), `academic_calendar_days`, `enrolments` (which child in which class in
which year — the academic record, built from `public.students` + history).

**Timetable**
`timetable_versions` (draft → published → archived), `timetable_slots`,
`teaching_assignments` (regenerated on every publish), `staff_shift_policies`,
`substitution_plans`, `substitution_assignments`.

**Day to day**
`attendance_registers`, `attendance_marks`, `attendance_corrections`,
`notes`, `note_kinds`.

**Collection (Sampark merge)**
`collection_requests`, `collection_fields`, `collection_submissions`,
`student_records`, `student_documents`.

**Assessments**
`assessments`, `marks`, `marks_change_log`, `report_cards`.

**Platform**
`job_runs` (every scheduled job writes one row), `audit_log`.

Foreign keys to fee data are plain id columns (`student_id`, `class_id`,
`session_id`) with no constraint back into `public` — a constraint would be a
write into the fee app's schema, and rule 2 forbids it.

## 5. Phases

Each numbered item is one Claude Code task: one branch, one PR, merged by the
agent when CI is green. `docs/PROGRESS.md` carries the live status of every row;
the next task is the first row that is not done.

### Phase 1 — foundation
| # | What |
|---|---|
| 1.1 | Supabase clients (browser/server/admin), Auth, login, session middleware, the `vppsone` schema, `staff_role` enum, `staff_profiles`, permissions module |
| 1.2 | App shell: mobile-first layout, bottom nav, top bar, design tokens, environment badge, empty/loading/error states |
| 1.3 | Master data — staff: list, create, edit, deactivate. `short_name` immutable |
| 1.4 | Master data — subjects and class aliases (fee classes ↔ timetable labels) |
| 1.5 | Master data — class teachers (with history) and the academic calendar |
| 1.6 | Enrolments: build the academic record for the test session from `public.students`, plus a consistency check |

### Phase 2 — timetable
| # | What |
|---|---|
| 2.1 | Port the parser from `timetable2025/scripts/data.js` as pure TypeScript, with its counts pinned by fixture tests |
| 2.2 | Import dry run: resolve every class label, teacher short name and subject against master data; report what is missing, grouped by the screen that fixes it |
| 2.3 | Versions: upload → check → create draft → publish. Publishing archives the current version and regenerates `teaching_assignments` |
| 2.4 | Views: by class, by teacher, by day, and who is free in a given period |

### Phase 3 — teacher workspace
| # | What |
|---|---|
| 3.1 | `/teach` shell and the Today card (your periods, your classes, what needs doing) |
| 3.2 | Attendance: one screen, offline-tolerant queue, idempotent submit |
| 3.3 | Corrections, approvals, and the office marking on behalf of a teacher |
| 3.4 | Notes: per student and per class, typed by `note_kinds` |
| 3.5 | Student card: attendance %, notes, marks, fee status read from the fee tables |
| 3.6 | Monthly printable attendance register (PDF) |

### Phase 4 — substitutions
| # | What |
|---|---|
| 4.1 | Port the substitution engine from `timetable2025`, its own test suite first |
| 4.2 | Planner: mark absences, generate a plan, adjust it by hand |
| 4.3 | Publish a plan → assignments → notify the covering teachers → Today card |
| 4.4 | Shift policies editor (who can cover which period) |

### Phase 5 — collection (the Sampark merge)
| # | What |
|---|---|
| 5.1 | Token links `/r` `/t` `/w` and the field registry, ported from `sampark` |
| 5.2 | Submissions and the review queue |
| 5.3 | Student records and document storage |
| 5.4 | WhatsApp templates via AiSensy; parent-facing sends stay human-pressed |

### Phase 6 — assessments and reports
| # | What |
|---|---|
| 6.1 | Assessments admin: terms, exams, subjects, max marks |
| 6.2 | Marks grid with per-cell save and a change log |
| 6.3 | Progress view per student and per class |
| 6.4 | Report card PDF |
| 6.5 | Academic exports, logged |

### Phase 7 — automations and cutover
| # | What |
|---|---|
| 7.1 | Job platform (`runJob`, `job_runs`, per-job secret) and the jobs console |
| 7.2 | Scheduled jobs: open today's registers, attendance reminder, missing-marks nudge, daily summary |
| 7.3 | **Cutover to live data** — see §7 |

## 6. Copying instead of rebuilding

Three sibling repos on the laptop hold code that already works in production.
`docs/SOURCES.md` lists what to take from where. The rule: port it with its
tests, and where the port changes behaviour, say so in the PR. A parser that has
run the school's timetable for a year is evidence; a rewrite is a guess.

## 7. Cutover to live data

Runs once, when the app is built and Janmejay has used it on test data long
enough to trust it. It is short because §2 was designed for it.

1. Apply every `vppsone` migration to the live Supabase project
   `vgqyilgstjvgohrsiwkb`. They only ever `create schema vppsone` and create
   objects inside it — `public` is not touched, so the fee app cannot notice.
   This includes `expose_vppsone_to_postgrest`, which is a PostgREST setting
   rather than a schema object: skip it and the app answers `PGRST106 Invalid
   schema: vppsone` on its first request. It appends and never replaces, so the
   fee app keeps `public` (D-19, `docs/SETUP.md`).
2. Point the Vercel project's production environment variables at the live
   project and redeploy. `VPPSONE_ENV=live`.
3. Seed the master data for real: staff, subjects, class aliases, class
   teachers, the calendar, the real timetable version.
4. Build `enrolments` from the real `public.students`.
5. Check the fee app is unchanged — it should be, since nothing in `public`
   moved, but look anyway.

Rollback is pointing the environment variables back at dev. Nothing in the fee
app has to be undone, because nothing in the fee app was done.

## 8. How work runs

```
docs/PROGRESS.md  → first row that is not done
  → git checkout main && git pull && git checkout -b <branch>
  → paste the task into Claude Code
  → agent builds, tests, opens a PR, merges it when CI is green
  → Vercel deploys; Janmejay uses it on test data
  → what to change becomes the next row
```

No flags to flip, no migrations to hand-apply in a separate session, no release
windows, no approval before merging. If something breaks, it breaks on a test
database in an app only Janmejay uses, and the fix is the next commit.
