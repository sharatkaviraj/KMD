import type { StaffRole } from "@/platform/auth/permissions";

/**
 * Who should be able to open each screen — read out of PLAN §3, not out of the
 * code.
 *
 * **This file exists because `smoke:roles` was checking the app against
 * itself.** It read the permission each page's own `requirePermission()` names,
 * worked out from `permissions.ts` what that implied, and then checked the app
 * agreed. A page that asks for the wrong permission agrees with itself
 * perfectly, and 216 green combinations say nothing about it (B-09).
 *
 * So this is a second opinion, written from the product description rather
 * than from the implementation:
 *
 *  - Teacher — own classes: today, attendance, marks, timetable, cover. "No
 *    office request builder or fee cards."
 *  - Admin — everything.
 *  - Office — student work, collection, documents, attendance on behalf,
 *    master data.
 *  - Academic coordinator — cover, timetable, classes, calendar.
 *  - Exam coordinator — exams, marks, reports.
 *  - View only — "Read-only information; **no editable forms or per-child
 *    actions**."
 *
 * Where the two readings disagree, the row carries a `difference` naming what
 * the implementation does instead, why it has not been changed here and who
 * owns it. A disagreement without one of those is a failure: that is what
 * stops a drift being absorbed quietly, which is the whole failure mode this
 * file is for.
 */

export type ExpectationDifference = {
  /** Roles the implementation treats differently from the product reading. */
  roles: readonly StaffRole[];
  direction: "implementation-allows" | "implementation-denies";
  /** The defect or decision that owns the disagreement. */
  owner: string;
  note: string;
};

export type RouteExpectation = {
  route: string;
  allow: readonly StaffRole[];
  /** The sentence in PLAN §3 this row comes from. */
  because: string;
  difference?: ExpectationDifference;
};

const EVERYONE: readonly StaffRole[] = [
  "admin",
  "office",
  "accountant",
  "fee_collector",
  "academic_coordinator",
  "exam_coordinator",
  "teacher",
  "view_only",
];

/**
 * Everyone whose work is the children's day.
 *
 * Not "everyone who works in the app", which is what this used to say and is
 * no longer the same set. The fee desk works in the app too — it just does not
 * work on registers, rosters or per-child records, and an accountant is no
 * more entitled to a class list than a teacher is to a payment screen. That is
 * the same rule PLAN §3 applies to keep fee cards off a teacher's home, read
 * in the other direction.
 *
 * The viewer looks at the app rather than working in it, and gets none of
 * these either.
 */
const STAFF_AT_WORK: readonly StaffRole[] = [
  "admin",
  "office",
  "academic_coordinator",
  "exam_coordinator",
  "teacher",
];

/**
 * Everyone the school's own timetable is for — which is not everyone.
 *
 * This row used to say `EVERYONE`, written when `EVERYONE` had six members.
 * Adding `accountant` and `fee_collector` to `staffRoles` for the fee port
 * grew this list by two without anybody deciding that it should, and so it
 * quietly asserted that an accountant ought to be able to open the timetable.
 * The permission map never agreed, and the disagreement surfaced the moment
 * the role matrix could see the fee screens.
 *
 * The map is right. Janmejay's instruction was that the fee desk sees *the fee
 * app*, and the fee app has no timetable in it. The viewer stays: PLAN §3 puts
 * Timetable on the viewer's navigation, and `view_only` holds `timetable:view`.
 */
const EVERYONE_BUT_THE_FEE_DESK: readonly StaffRole[] = [
  ...STAFF_AT_WORK,
  "view_only",
];

/**
 * Resolved in R1.2, and kept as a comment because the shape is worth
 * remembering.
 *
 * `view_only` used to hold `attendance:view`, which guards six screens — the
 * teacher workspace, the register form, a class roster, the corrections queue,
 * the monthly register and a child card. Every one is either an editable form
 * or a list of named children, and PLAN section 3 gives the viewer neither. The
 * permission map and the guards agreed with each other perfectly, so nothing in
 * this repository could see it until this file gave the role smoke a second
 * opinion to compare against (B-09, B-22).
 *
 * There is no `difference` on any row now, which is what lets
 * `npm run smoke:roles -- --strict` pass. A new one has to be written here
 * with an owner before the runner will tolerate it.
 */

export const ROUTE_EXPECTATIONS: readonly RouteExpectation[] = [
  { route: "/school-office", allow: ["admin", "office"], because: "The school office issues and retains school certificates under its own authority." },
  { route: "/school-office/batch", allow: ["admin", "office"], because: "Certificate issuers prepare one document for every child in a class." },
  { route: "/school-office/template", allow: ["admin"], because: "Template and signatory policy are school administration settings." },
  { route: "/school-office/certificates/[id]", allow: ["admin", "office"], because: "Certificate details and original reprints belong to authorized school-office staff." },
  { route: "/school-office/returns", allow: ["admin", "office"], because: "School-office staff prepare official reference sheets and verified return files." },
  { route: "/school-office/returns/[id]", allow: ["admin", "office"], because: "Official batches retain private source files and reconciliation history." },
  { route: "/school-office/returns/d/[key]", allow: ["admin", "office"], because: "A destination's readiness grid names every child blocked from an official return." },
  { route: "/school-office/returns/[id]/copilot", allow: ["admin", "office"], because: "The manual entry assistant shows a prepared official list row by row for portal entry." },
  { route: "/school-office/returns/formats", allow: ["admin"], because: "An administrator approves a supported format against its current specimen." },
  { route: "/exam-office/board", allow: ["admin", "office", "exam_coordinator"], because: "Board readiness uses a separate sourced cycle and official-outcome capability." },
  { route: "/exam-office/official-results", allow: ["admin", "office", "exam_coordinator"], because: "Official results remain separate from internal assessment marks." },
  {
    route: "/dashboard",
    allow: EVERYONE,
    because: "Every account has a Home (PLAN §3, one Home per role).",
  },
  {
    route: "/more",
    allow: EVERYONE,
    because: "The overflow hub is whatever did not fit on that role's bar.",
  },
  {
    route: "/access-denied",
    allow: EVERYONE,
    because: "Somewhere you are sent, never somewhere you go.",
  },
  {
    route: "/preferences",
    allow: EVERYONE,
    because:
      "Your own settings, on your own profile row. PLAN §3a asks for self-service language choice, and the one setting somebody may need precisely because they cannot read the screen they are on cannot be gated behind a role.",
  },

  /* ------------------------------------------------------- the teacher's day */

  {
    route: "/teach",
    allow: STAFF_AT_WORK,
    because:
      "The teacher's own day. Office marks on behalf, coordinators and admin need the same view; a viewer's nav is Home, Timetable and Summary.",
  },
  {
    route: "/teach/attendance",
    allow: STAFF_AT_WORK,
    because: "An editable register. A viewer gets no editable forms.",
  },
  {
    route: "/teach/class/[id]",
    allow: STAFF_AT_WORK,
    because: "A class's children by name. A viewer gets no per-child records.",
  },
  {
    route: "/teach/register",
    allow: STAFF_AT_WORK,
    because:
      "A month of per-child attendance. Completion is a per-class figure; this is not that.",
  },
  {
    route: "/teach/student/[id]",
    allow: STAFF_AT_WORK,
    because: "One child's record. The clearest per-child screen there is.",
  },

  /* ------------------------------------------------------------- timetable */

  {
    route: "/timetable",
    allow: EVERYONE_BUT_THE_FEE_DESK,
    because:
      "Timetable is named in every role's navigation, the viewer's included — " +
      "but not the fee desk's, which sees the fee app and the fee app has no timetable.",
  },
  {
    route: "/timetable/[id]",
    allow: EVERYONE_BUT_THE_FEE_DESK,
    because: "One version of the same thing.",
  },
  {
    route: "/timetable/import",
    allow: ["admin", "academic_coordinator"],
    because: "Publishing a timetable is the academic coordinator's job.",
  },

  /* ----------------------------------------------------------------- cover */

  {
    route: "/duty/[id]",
    allow: EVERYONE,
    because:
      "Where a cover notice and Today both lead. Any signed-in member of staff may open it; " +
      "the row decides what they see — the holder, a former holder, the office — and anybody " +
      "else, a forwarded link included, sees that it is not for them and nothing more (P5).",
  },

  {
    route: "/substitutions",
    allow: ["admin", "office", "academic_coordinator", "teacher"],
    because:
      "The coordinator plans it, a teacher needs to know she is covering, the office answers the phone about it.",
  },
  {
    route: "/substitutions/policies",
    allow: ["admin", "academic_coordinator"],
    because: "Who is on site and how much cover they take is a planning setting.",
  },
  {
    route: "/substitutions/rules",
    allow: ["admin", "academic_coordinator"],
    because:
      "Bell times and how many of a team must be present are school rules the people who arrange cover set (P2).",
  },

  /* ----------------------------------------------------------- assessments */

  {
    route: "/assessments",
    allow: STAFF_AT_WORK,
    because: "Exams are the exam coordinator's; a teacher needs the papers she marks.",
  },
  {
    route: "/assessments/[id]",
    allow: STAFF_AT_WORK,
    because:
      "One exam and its papers. A teacher opens it to find the paper she is marking.",
  },
  {
    route: "/assessments/marks/[paperId]",
    allow: STAFF_AT_WORK,
    because: "The marks grid a teacher enters into.",
  },
  {
    route: "/assessments/exports",
    allow: ["admin", "office", "academic_coordinator", "exam_coordinator"],
    because:
      "An export is a copy of the school's records leaving the building; PLAN §3 gives a teacher marks, not the register of exports.",
  },
  {
    route: "/assessments/report/[studentId]",
    allow: ["admin", "office", "academic_coordinator", "exam_coordinator"],
    because:
      "Report cards are issued by the exam coordinator. PLAN §3's teacher row is marks and attendance, not reports.",
  },
  {
    route: "/assessments/scheme",
    allow: ["admin", "office", "academic_coordinator", "exam_coordinator"],
    because:
      "The rules a card is worked out by are read by whoever reads cards, and approved by the exam office (P8).",
  },

  /* ------------------------------------------------------- the directory */

  {
    route: "/students",
    allow: ["admin", "office"],
    because:
      "PLAN section 3 puts Students on the admin and office navigation and nowhere else. A teacher already has her own classes on /teach, and the school roster is not hers to browse.",
  },

  /* ------------------------------------------------------------ collection */

  {
    route: "/collection",
    allow: ["admin", "office"],
    because: "PLAN §3: a teacher gets no office request builder.",
  },
  {
    route: "/collection/[id]",
    allow: ["admin", "office"],
    because:
      "One request, with its link and its progress. The teacher's side of it is the token link, which needs no account at all.",
  },
  {
    route: "/collection/fields",
    allow: ["admin", "office"],
    because: "What may be asked for is an office setting.",
  },
  {
    route: "/collection/messages",
    allow: ["admin", "office"],
    because: "The office presses send (D-10).",
  },
  {
    route: "/collection/import",
    allow: ["admin", "office"],
    because: "Bringing SamPark's records in and deciding the rows no id could match is office work (P10b).",
  },
  {
    route: "/collection/photos",
    allow: ["admin", "office"],
    because: "Placing children's photographs, one at a time or a folder by filename, is office work (P10c).",
  },
  {
    route: "/collection/policy",
    allow: ["admin", "office"],
    because: "Whoever sends parent messages reads the policy; only an administrator changes it (P9).",
  },
  {
    route: "/collection/review",
    allow: ["admin", "office"],
    because: "Reviewing what came back is office work.",
  },
  {
    route: "/collection/rounds",
    allow: ["admin", "office"],
    because:
      "A round is one question asked of many classes. Building and tracking it is the same office work as a single request, and a teacher's side of it is still a token link with no account behind it.",
  },
  {
    route: "/collection/rounds/new",
    allow: ["admin", "office"],
    because:
      "Choosing who a round reaches is the office deciding what to ask the school for. Guarded on collection:manage rather than :view, because the preview it renders reads every child in scope.",
  },
  {
    route: "/collection/rounds/upload",
    allow: ["admin", "office"],
    because:
      "A sheet of specific children, for the case no filter can find: the office is the only thing that knows which families those are. Same guard as building a round, because it creates one.",
  },
  {
    route: "/collection/rounds/[id]",
    allow: ["admin", "office"],
    because: "One round, with what it asks and who it covers.",
  },

  /* ------------------------------------------------------------ test tools */

  {
    route: "/smoke",
    allow: ["admin"],
    because:
      "The Smoke Lab hands out sign-in passes for test accounts, so it is the administrator's alone — and a 404 on the live database and for the smoke accounts themselves (D-311, D-314).",
  },

  /* --------------------------------------------------------- master data */

  {
    route: "/staff",
    allow: ["admin", "office", "academic_coordinator", "exam_coordinator"],
    because:
      "Coordinators need the roster to plan against; a teacher does not administer colleagues.",
  },
  {
    route: "/staff/[id]",
    allow: ["admin", "office", "academic_coordinator", "exam_coordinator"],
    because:
      "One colleague's profile: their classes, their cover policy, their number. A coordinator plans against it.",
  },
  {
    route: "/staff/new",
    allow: ["admin", "office"],
    because: "Office holds master data, and a profile is not an account (D-11).",
  },
  {
    route: "/staff/[id]/edit",
    allow: ["admin", "office"],
    because:
      "Changing a colleague's record is master data, which PLAN §3 gives the office; a coordinator reads it.",
  },
  {
    route: "/academics",
    allow: ["admin", "office", "academic_coordinator", "exam_coordinator"],
    because: "Subjects and classes are what a timetable and an exam resolve against.",
  },
  {
    route: "/academics/classes",
    allow: ["admin", "office", "academic_coordinator", "exam_coordinator"],
    because:
      "The label each class carries on the timetable sheet. Getting it wrong is what makes an import fail to resolve.",
  },
  {
    route: "/academics/class-teachers",
    allow: ["admin", "office", "academic_coordinator", "exam_coordinator"],
    because:
      "Who holds which class, with history. It decides whose register a class's is, so the office and the coordinators both need it.",
  },
  {
    route: "/academics/subjects",
    allow: ["admin", "office", "academic_coordinator", "exam_coordinator"],
    because:
      "The subject list a timetable import and an exam paper both resolve against.",
  },
  {
    route: "/academics/subjects/new",
    allow: ["admin", "office", "academic_coordinator"],
    because:
      "Creating a subject changes what a timetable import resolves against; the exam coordinator reads it.",
  },
  {
    route: "/academics/subjects/[id]",
    allow: ["admin", "office", "academic_coordinator"],
    because:
      "Editing a subject changes what a timetable import resolves against; the exam coordinator reads it rather than changing it.",
  },
  {
    route: "/calendar",
    allow: ["admin", "office", "academic_coordinator", "exam_coordinator"],
    because:
      "Which days are not ordinary decides whether a register is taken and when a paper can be sat.",
  },
  {
    route: "/enrolments",
    allow: ["admin", "office", "academic_coordinator", "exam_coordinator"],
    because: "The academic roll, reconciled against the fee app's students.",
  },

  /* ------------------------------------------------------ the other apps */

  {
    route: "/apps",
    allow: EVERYONE,
    because:
      "No longer a screen. Since the native navigation (#51) the school's work opens inside VPPS One, and `/apps` only sends an old bookmark to its owner's own Home — which every account may reach. Nothing on it is shown to anybody.",
  },

  /* -------------------------------------------------------------- platform */

  {
    route: "/archives",
    allow: ["admin"],
    because: "Building archives and running restore drills is the school record owner's; the administrator holds it (P11).",
  },
  {
    route: "/jobs",
    allow: ["admin"],
    because: "PLAN §3 gives the admin failed jobs; nobody else needs the console.",
  },

  /* ------------------------------------------------------------- the fee desk */

  ...feeDeskScreens(),
  ...redesign(),
];

/**
 * The ported School Fees screens.
 *
 * Written as a group rather than forty-eight hand-typed rows, because for this
 * file's purpose they are one decision, made once: **`fees:view` is the door
 * into the fee desk, and `src/app/(app)/fees/layout.tsx` is where it is
 * checked.** Every screen under `/fees` is behind that one guard.
 *
 * The group is still a *list* and not a filesystem walk. A walk would make the
 * expectation derive from the implementation, which is exactly the thing this
 * file exists to stop (B-09): a screen added under `/fees` must be added here
 * too, and until it is, `role-expectations.test.ts` says so.
 *
 * **These rows used to say only "may this role open the fee area".** That was
 * the honest limit of the question at the time, because `smoke:roles` could
 * only read `requirePermission` out of a `page.tsx` and a ported fee screen
 * has none — its guard is `requireStaffPermission("payments:view")`, written
 * in the fee app's own vocabulary. So all forty-eight screens sat behind one
 * coarse answer, and the matrix could not have caught a fee screen that
 * forgot its guard entirely.
 *
 * The matrix reads both vocabularies now, so these rows have to answer the
 * finer question too. **The product reading for them is the fee app's own
 * `roleDescriptions`** — quoted below — because Janmejay's instruction was
 * that the accountant sees the fee app exactly as it is today. That prose is
 * a genuine second opinion: it is what the fee app says each role is *for*,
 * not a copy of the permission arrays the guards consult.
 *
 * VPPS One's `office` reaches these screens as the fee app's Viewer, which is
 * a narrower role than "office reads fees" sounds — Viewer is defined as
 * "Dashboard, Students, Defaulters, and Receipts" and nothing else. That is a
 * live product question, not a defect, and it is written up in PROGRESS.
 */
function feeDeskScreens(): RouteExpectation[] {
  /**
   * "Read-only access for oversight: Dashboard, Students, Defaulters, and
   * Receipts." — the fee app's Viewer, which is what `office` maps to.
   */
  const OVERSIGHT: readonly StaffRole[] = [
    "admin",
    "office",
    "accountant",
    "fee_collector",
  ];

  /**
   * The working fee desk. The accountant "reads everything else"; the fee
   * collector "reads every other tab". The Viewer does not.
   */
  const FEE_DESK: readonly StaffRole[] = ["admin", "accountant", "fee_collector"];

  /**
   * "Day-close/refund/correction stays admin-only", and so does anything that
   * edits a child, a fee structure, master data or staff.
   */
  const FEE_ADMIN: readonly StaffRole[] = ["admin"];

  const rows = (
    routes: readonly string[],
    allow: readonly StaffRole[],
    because: string,
  ) => routes.map((route) => ({ route, allow, because }));

  return [
    ...rows(
      [
        // No guard of their own: old URLs kept alive, and the role-dispatching
        // entry. Whoever may enter the fee area may follow them.
        "/fees",
        "/fees/admin-tools/whatsapp-reminders",
        "/fees/advanced",
        "/fees/collections",
        "/fees/dues",
        "/fees/password",
        "/fees/setup",
        // The four things the fee app's Viewer is defined by.
        "/fees/dashboard",
        "/fees/settings/glossary",
        "/fees/students",
        "/fees/students/[studentId]",
        "/fees/students/[studentId]/statement",
        "/fees/students/family/[familyGroupId]/statement",
        "/fees/defaulters",
        "/fees/receipts",
        "/fees/receipts/[receiptId]",
        "/fees/admin-tools/recovery",
        "/fees/transactions",
      ],
      OVERSIGHT,
      "Oversight: the fee app's Viewer is 'Dashboard, Students, Defaulters and " +
        "Receipts', and `office` reaches the fee screens as the Viewer.",
    ),

    ...rows(
      [
        "/fees/admin-tools",
        "/fees/admin-tools/activity",
        "/fees/admin-tools/prev-year-dues",
        "/fees/admin-tools/session-health",
        "/fees/admin-tools/whatsapp",
        "/fees/exports",
        "/fees/fee-setup",
        "/fees/fee-setup/time-travel",
        "/fees/fee-structure",
        "/fees/finance-controls",
        "/fees/imports",
        "/fees/ledger",
        "/fees/payments",
        "/fees/reminders",
        "/fees/reminders/campaigns",
        "/fees/reminders/families",
        "/fees/reminders/fix",
        "/fees/reminders/ladder",
        "/fees/reminders/lists",
        "/fees/reminders/notices",
        "/fees/reminders/runs/[runId]",
        "/fees/reminders/unreachable",
        "/fees/reports",
        "/fees/reports/ledger/[studentId]/print",
        "/fees/settings",
      ],
      FEE_DESK,
      "The working fee desk: the accountant 'reads everything else' and the fee " +
        "collector 'reads every other tab'. The Viewer reads none of it.",
    ),

    ...rows(
      [
        "/fees/admin-tools/promotion",
        "/fees/admin-tools/promotion/[runId]",
        "/fees/fee-setup/generate",
        "/fees/master-data",
        "/fees/payments/bulk",
        "/fees/staff",
        "/fees/students/[studentId]/edit",
        "/fees/students/bulk-update",
        "/fees/students/new",
      ],
      FEE_ADMIN,
      "Admin-only in the fee app: 'no edits outside the Payment Desk' for the " +
        "accountant, and day-close, corrections, staff and master data are the " +
        "admin's alone.",
    ),
  ];
}

/*
 * The redesigned app (docs/design-handoff, docs/ui/DECISIONS.md). One row per
 * screen the new navigation names, read from the design's role menus
 * (XSide.dc.html) and PLAN §3: the fee desk gets money, coordinators their
 * office, teachers their own classes, and admin everything.
 */
function redesign(): RouteExpectation[] {
  const FEE_READERS: readonly StaffRole[] = ["admin", "office", "accountant", "fee_collector"];
  const COORDINATORS_AND_TEACHERS: readonly StaffRole[] = ["admin", "office", "academic_coordinator", "exam_coordinator", "teacher"];
  const row = (route: string, allow: readonly StaffRole[], because: string): RouteExpectation => ({ route, allow, because });
  return [
    row("/menu", EVERYONE, "The phone Menu tab: everything a role's bottom bar has no room for, filtered by the same permissions."),
    row("/", EVERYONE, "The doorway: the admin menu's Today, filtered by permission; every other menu is sent on to its own home."),
    row("/students/[id]", ["admin", "office"], "Student 360 is the Students list's detail, so it follows the list: admin and office (PLAN section 3)."),
    row("/inbox", ["admin", "office", "academic_coordinator"], "Needs you: the admin's queue of corrections, leave and approvals (design F01/D02)."),
    row("/attendance", ["admin", "office", "academic_coordinator"], "Whole-school attendance and marking on a teacher's behalf: the office's act, and the academic coordinator's attendance oversight (design AcadAttendance)."),
    row("/payments", ["admin", "accountant"], "Taking money is granted one person at a time through the accountant role, never by job title."),
    row("/payments/bulk", ["admin", "accountant"], "Bulk entry opens for whoever takes money; saving many at once stays admin-only (payments:bulk) inside the screen."),
    row("/receipts", FEE_READERS, "Receipts and the day close are fee screens, read by everyone who reads the fee app."),
    row("/receipts/[receiptNumber]", FEE_READERS, "One receipt: print, share preview and reversal, read by everyone who reads receipts."),
    row("/dues", FEE_READERS, "Who owes what; the fee collector's follow-up list starts here."),
    row("/reminders", FEE_READERS, "Fee reminders are drafted from the dues list by the fee desk."),
    row("/fee-setup", FEE_READERS, "Fee setup is read by the fee desk; changing it stays admin-only inside the screen."),
    row("/reports", FEE_READERS, "Money reports belong to the fee desk and the office."),
    row("/accounts", FEE_READERS, "The accountant's home: the day's money at a glance."),
    row("/accounts/books", FEE_READERS, "The books: ledger and day closes, read-only for the fee desk."),
    row(
      "/fees/payments/online",
      ["admin", "accountant"],
      "Razorpay money (go-live Phase E): the back office's (`fees:accounts`, the nav gate), like the bank books — a payment to post or a review to close is accounts work, not the counter's.",
    ),
    row("/admissions", ["admin"], "Admitting a child creates a fee record; the fee app keeps that to the admin."),
    row("/admissions/new", ["admin"], "The admission wizard creates the fee record, so it sits behind the same door as Admissions."),
    row("/admissions/seats", ["admin"], "Seats per class are school policy, set by the admin; Admissions reads seats left from them."),
    row("/admissions/[studentId]", ["admin"], "Editing or withdrawing a student changes the fee record; admin only, as in the fee app."),
    row("/student-tools", ["admin"], "Promotion and bulk changes are the admin's alone in the fee app."),
    row("/preferences/password", EVERYONE, "Changing your own password is your own business; every account can do it."),
    row("/preferences/session", EVERYONE, "Which session you are looking at is a per-person view choice, open to every account."),
    row("/academics/progress", COORDINATORS_AND_TEACHERS, "Class progress from marks, for the people who teach and plan."),
    row("/academics/attendance", COORDINATORS_AND_TEACHERS, "Attendance trends by class, for the people who teach and plan."),
    row("/academics/setup", ["admin", "office", "academic_coordinator", "exam_coordinator"], "The old Academics hub, kept as set-up: subjects, class labels, class teachers and attendance rules."),
    row("/calendar/days", ["admin", "office", "academic_coordinator", "exam_coordinator"], "The day-by-day calendar editor the redesigned calendar's holidays view links to."),
    row("/exams", COORDINATORS_AND_TEACHERS, "The exam list: who sits what, when."),
    row("/exam-office", ["admin", "exam_coordinator"], "The exam coordinator's home (PLAN §3: exams, marks, reports)."),
    row("/exam-office/plan", ["admin", "exam_coordinator"], "Planning an exam is the exam coordinator's job."),
    row("/exam-office/results", ["admin", "exam_coordinator"], "Publishing results and report cards is the exam coordinator's job."),
    row("/notes", ["admin", "office", "academic_coordinator", "teacher"], "Notes on children, read by the people responsible for them."),
    row("/messages", ["admin", "office", "academic_coordinator", "exam_coordinator"], "Notices go out from the office and the coordinators, never from a single teacher's account."),
    row("/settings", ["admin"], "School-wide settings and the role matrix are the admin's."),
    row("/settings/ai-connection", ["admin"], "The AI connection's school switch and every staff member's connections (owner decision D9) are the admin's."),
    row("/staff/classic", ["admin", "office", "academic_coordinator", "exam_coordinator"], "The classic staff list, kept reachable beside Staff & roles; same readers as /staff."),
    row("/timetable/classic", EVERYONE_BUT_THE_FEE_DESK, "The classic timetable screen, kept reachable beside the redesigned week grid; same readers as /timetable."),
    row("/teach/marks", ["admin", "exam_coordinator", "teacher"], "A teacher enters marks for her own class-subjects."),
    row("/teach/notes", ["admin", "teacher"], "A teacher writes notes on her own classes."),
    row("/teach/tasks", STAFF_AT_WORK, "Staff see their own assigned work; source authority is rechecked on read and save."),
    row("/teach/tasks/[id]", STAFF_AT_WORK, "Only the currently assigned teacher can open a task and its selected children."),
    row("/teach/more", COORDINATORS_AND_TEACHERS, "The teacher's overflow menu."),
    row("/teach/class", STAFF_AT_WORK, "A teacher's own class: children by name, attendance and marks, never money."),
  ];
}

export function expectationFor(route: string): RouteExpectation {
  const found = ROUTE_EXPECTATIONS.find((entry) => entry.route === route);

  if (!found) {
    // A screen with no product expectation is a screen nobody decided the
    // access rules for. Failing here is what makes the matrix keep up with the
    // app instead of quietly covering less of it.
    throw new Error(
      `No product expectation for ${route}. Add it to tests/fixtures/role-expectations.ts before shipping the screen.`,
    );
  }

  return found;
}

/** What the product reading says should happen when this role opens this route. */
export function productAllows(route: string, role: StaffRole): boolean {
  return expectationFor(route).allow.includes(role);
}

/**
 * Whether a disagreement between the two readings is one somebody has already
 * looked at and written down.
 *
 * An unlisted disagreement is a failure. A listed one is a defect with an
 * owner, and the run prints it every time so it stays uncomfortable.
 */
export function differenceFor(
  route: string,
  role: StaffRole,
  implementationAllows: boolean,
): ExpectationDifference | null {
  return differenceIn(expectationFor(route), role, implementationAllows);
}

/**
 * The same question, asked of one expectation rather than of a route.
 *
 * Split out so the *mechanism* stays tested when the live list has no
 * disagreements left in it — which is where R1.2 got it to. A test that only
 * exercised real rows would quietly stop running the day the last one was
 * fixed, and would be back to a silent pass by the time the next appeared.
 */
export function differenceIn(
  expectation: RouteExpectation,
  role: StaffRole,
  implementationAllows: boolean,
): ExpectationDifference | null {
  const product = expectation.allow.includes(role);

  if (product === implementationAllows) return null;

  const difference = expectation.difference;
  if (!difference || !difference.roles.includes(role)) return null;

  const matches =
    difference.direction === "implementation-allows"
      ? implementationAllows && !product
      : product && !implementationAllows;

  return matches ? difference : null;
}
