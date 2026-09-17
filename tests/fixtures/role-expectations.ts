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
  "academic_coordinator",
  "exam_coordinator",
  "teacher",
  "view_only",
];

/** Everyone who works in the app. The viewer looks at it. */
const STAFF_AT_WORK: readonly StaffRole[] = [
  "admin",
  "office",
  "academic_coordinator",
  "exam_coordinator",
  "teacher",
];

/**
 * The one disagreement this reading has with the implementation today.
 *
 * `view_only` holds `attendance:view`, and six screens are guarded on it — the
 * teacher's workspace, the register form, a class's roster, the corrections
 * queue, the monthly register and a child's card. Every one of those is either
 * an editable form or a list of named children, and PLAN §3 gives the viewer
 * neither. It also puts a "Teach" tab on a viewer's navigation bar leading to
 * an empty teacher workspace.
 *
 * Not changed here: it is a permission-map change and R1.2 owns the role
 * navigation it belongs with. Named so that it cannot be absorbed silently in
 * the meantime.
 */
const VIEWER_REACH: ExpectationDifference = {
  roles: ["view_only"],
  direction: "implementation-allows",
  owner: "B-22 → R1.2",
  note: "view_only holds attendance:view, so it can open the register form and per-child screens PLAN §3 says it should not have, and gets a Teach tab it has no use for.",
};

export const ROUTE_EXPECTATIONS: readonly RouteExpectation[] = [
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

  /* ------------------------------------------------------- the teacher's day */

  {
    route: "/teach",
    allow: STAFF_AT_WORK,
    because:
      "The teacher's own day. Office marks on behalf, coordinators and admin need the same view; a viewer's nav is Home, Timetable and Summary.",
    difference: VIEWER_REACH,
  },
  {
    route: "/teach/attendance",
    allow: STAFF_AT_WORK,
    because: "An editable register. A viewer gets no editable forms.",
    difference: VIEWER_REACH,
  },
  {
    route: "/teach/class/[id]",
    allow: STAFF_AT_WORK,
    because: "A class's children by name. A viewer gets no per-child records.",
    difference: VIEWER_REACH,
  },
  {
    route: "/teach/corrections",
    allow: STAFF_AT_WORK,
    because: "Per-child correction requests, with an approval on them.",
    difference: VIEWER_REACH,
  },
  {
    route: "/teach/register",
    allow: STAFF_AT_WORK,
    because:
      "A month of per-child attendance. Completion is a per-class figure; this is not that.",
    difference: VIEWER_REACH,
  },
  {
    route: "/teach/student/[id]",
    allow: STAFF_AT_WORK,
    because: "One child's record. The clearest per-child screen there is.",
    difference: VIEWER_REACH,
  },

  /* ------------------------------------------------------------- timetable */

  {
    route: "/timetable",
    allow: EVERYONE,
    because: "Timetable is named in every role's navigation, the viewer's included.",
  },
  {
    route: "/timetable/[id]",
    allow: EVERYONE,
    because: "One version of the same thing.",
  },
  {
    route: "/timetable/import",
    allow: ["admin", "academic_coordinator"],
    because: "Publishing a timetable is the academic coordinator's job.",
  },

  /* ----------------------------------------------------------------- cover */

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
    route: "/collection/review",
    allow: ["admin", "office"],
    because: "Reviewing what came back is office work.",
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
    allow: ["admin", "office"],
    because:
      "PLAN §3 puts Apps on the admin and office navigation and nowhere else: a teacher gets no fee cards, and neither coordinator has an errand in SamPark or School Fees.",
  },

  /* -------------------------------------------------------------- platform */

  {
    route: "/jobs",
    allow: ["admin"],
    because: "PLAN §3 gives the admin failed jobs; nobody else needs the console.",
  },
];

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
  const expectation = expectationFor(route);
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
