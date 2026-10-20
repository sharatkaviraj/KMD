import { t, type Localized } from "@/platform/i18n/language";

/**
 * Who may do what. One file, no database import, no framework import — so it
 * can be read end to end and tested exhaustively.
 *
 * The role list is `vppsone.staff_role` and the map below is PLAN §3. VPPS One
 * defines its own roles: being an accountant in the fee app says nothing about
 * teaching here (D-6).
 *
 * **A permission is not a row filter.** `attendance:mark` says a teacher may
 * mark attendance; it does not say *whose*. "Own classes" is enforced by the
 * queries in `src/modules/**\/data/`, which scope to the staff member's own
 * `teaching_assignments`. Anything that must not leak across classes needs
 * both: the permission here and the scope there.
 */

export const staffRoles = [
  "admin",
  "office",
  // The two fee roles. They are this app's own now: the fee app is being
  // folded in and will be retired, so "accountant" has to mean something
  // here rather than being a fact about a different application (D-6 still
  // holds — the role is read from vppsone.staff_profiles, never from
  // public.users.role).
  "accountant",
  "fee_collector",
  "academic_coordinator",
  "exam_coordinator",
  "teacher",
  "view_only",
] as const;

export type StaffRole = (typeof staffRoles)[number];

/**
 * Every permission the platform will have, including the ones whose screens
 * are still phases away. Naming them now is what makes the map below readable
 * as a whole rather than as six lists that grew apart.
 */
export const staffPermissions = [
  "dashboard:view",

  // Master data (Phase 1.3–1.6).
  "staff:view",
  "staff:manage",
  "academics:view",
  "academics:manage",

  // Timetable and substitutions (Phases 2 and 4).
  "timetable:view",
  "timetable:manage",
  "substitutions:view",
  "substitutions:manage",

  // The teacher's day (Phase 3).
  "attendance:view",
  "attendance:mark",
  // The office marking for a teacher who could not. Separate from
  // `attendance:mark` because it is a different act: one is "I taught this
  // period", the other is "I am recording it on somebody's behalf".
  "attendance:mark_on_behalf",
  "attendance:correct",
  "notes:view",
  "notes:write",

  // Collection — the Sampark merge (Phase 5).
  "collection:view",
  "collection:manage",
  "documents:view",
  "documents:manage",

  // Assessments and reports (Phase 6).
  "assessments:view",
  "assessments:manage",
  "marks:view",
  "marks:write",
  "reports:view",

  // The student directory (R2.3).
  //
  // A real searchable roster rather than reaching a child through whichever
  // register they happen to be on. PLAN section 3 puts Students on the admin
  // and office navigation and nowhere else: a teacher already has her own
  // classes on `/teach`, and the school roster is not hers to browse.
  "students:view",

  // The other two apps (R1.1).
  //
  // Not "may open School Fees" — nothing here can grant that, and the fee app
  // decides for itself. This is only "is offered the way there", which PLAN §3
  // gives the admin and the office. A teacher has no errand in either.
  "apps:view",

  // Fees.
  //
  // Three, not twenty-eight. The fee app has a permission for every
  // financial act and those still decide what happens *inside* a fee
  // screen — `feePermissionsFor()` hands them over unchanged. These three
  // only answer the question this app asks: which tabs does this person
  // get, and may they take money.
  "fees:view",
  "fees:collect",
  // The accounts side of taking money (D-261): closing and reopening the
  // day, reversing a receipt, the bank books, refunds, bulk entry and pausing
  // reminders. `fees:collect` is the counter; this is the back office.
  "fees:accounts",
  "fees:manage",

  // Platform (Phase 7).
  "jobs:view",
  "jobs:run",
  "audit:view",

  // The redesigned app (docs/design-handoff). Messages sends a notice to
  // staff or families; Settings holds school-wide settings and the role
  // matrix. Rows in `20261010100247_vx_role_permissions.sql`.
  "messages:send",
  "settings:manage",
] as const;

export type StaffPermission = (typeof staffPermissions)[number];

/**
 * A pair per role, rendered in whichever language the reader asked for. The
 * two halves used to be separate maps that every screen printed side by side;
 * they are one value now so the choice can be made where it belongs (D-35).
 */
export const roleLabels: Record<StaffRole, Localized> = {
  admin: t("प्रशासक", "Admin"),
  office: t("कार्यालय", "Office"),
  accountant: t("लेखाकार", "Accountant"),
  fee_collector: t("वसूली कर्मी", "Fee Collector"),
  academic_coordinator: t("शैक्षणिक संयोजक", "Academic Coordinator"),
  exam_coordinator: t("परीक्षा संयोजक", "Exam Coordinator"),
  teacher: t("अध्यापक", "Teacher"),
  view_only: t("केवल देखें", "View only"),
};

export function roleLabel(role: StaffRole): Localized {
  return roleLabels[role];
}

/** Admin is "everything" by construction, not by a list that can fall behind. */
const adminPermissions: readonly StaffPermission[] = staffPermissions;

/**
 * Office: master data, attendance on behalf, collection, documents (PLAN §3).
 *
 * `staff:manage` is included because Phase 1.3 files staff under master data,
 * and because a staff profile is not an account: `user_id` is nullable and
 * logins are created by an admin in Supabase Auth, never here. Editing a
 * profile therefore cannot grant anybody access to the app (D-11).
 */
const officePermissions: readonly StaffPermission[] = [
  "dashboard:view",
  "staff:view",
  "staff:manage",
  "academics:view",
  "academics:manage",
  "timetable:view",
  "substitutions:view",
  "attendance:view",
  "attendance:mark_on_behalf",
  "attendance:correct",
  "notes:view",
  "collection:view",
  "collection:manage",
  "documents:view",
  "documents:manage",
  "assessments:view",
  "marks:view",
  "reports:view",
  "apps:view",
  "students:view",
  "messages:send",
  // Reads the fee screens, cannot take money. Office staff do post
  // payments in the fee app today, so this is a real reduction — and a
  // deliberate one: posting is granted one person at a time through the
  // `accountant` role rather than by being in the office.
  "fees:view",
];

/**
 * Academic coordinator: timetable, substitutions, assignments, calendar.
 *
 * `academics:manage` comes with the territory — the calendar lives there, and
 * so do the subjects and class aliases a timetable import resolves against
 * (task 2.2 reports what is missing "grouped by the screen that fixes it",
 * and this is the person sent to those screens).
 */
const academicCoordinatorPermissions: readonly StaffPermission[] = [
  "dashboard:view",
  "staff:view",
  "academics:view",
  "academics:manage",
  "timetable:view",
  "timetable:manage",
  "substitutions:view",
  "substitutions:manage",
  "attendance:view",
  // Attendance oversight (design AcadAttendance): marks a class for a teacher
  // on leave and approves teachers' change requests, as the office does.
  "attendance:mark_on_behalf",
  "attendance:correct",
  "notes:view",
  "assessments:view",
  "marks:view",
  "reports:view",
  "messages:send",
];

/** Exam coordinator: assessments, marks, report cards. */
const examCoordinatorPermissions: readonly StaffPermission[] = [
  "dashboard:view",
  "staff:view",
  "academics:view",
  "timetable:view",
  "attendance:view",
  "assessments:view",
  "assessments:manage",
  "marks:view",
  "marks:write",
  "reports:view",
  "messages:send",
];

/**
 * Teacher: own classes — attendance, notes, marks, timetable.
 *
 * Every one of these is scoped to their own classes by the query, not by this
 * list. See the note at the top of the file.
 */
const teacherPermissions: readonly StaffPermission[] = [
  "dashboard:view",
  "timetable:view",
  "substitutions:view",
  "attendance:view",
  "attendance:mark",
  "notes:view",
  "notes:write",
  "assessments:view",
  "marks:view",
  "marks:write",
];

/**
 * View only: read-only dashboards.
 *
 * Deliberately not "every `:view` permission". This role exists for oversight
 * — the daily numbers and who is teaching what — so it stops short of per-child
 * records: no notes, no marks, no documents, no collection.
 *
 * **`attendance:view` was here and is not any more (B-22).** Six screens are
 * guarded on it — the teacher's workspace, the register form, a class's roster,
 * the corrections queue, the monthly register and a child's card — and every
 * one is either an editable form or a list of named children, which is exactly
 * what PLAN §3 says this role does not get. It also put a Teach tab on a
 * viewer's bar leading to an empty teacher workspace. Nothing could see it
 * until `role-expectations.ts` gave the smoke a second opinion to compare
 * against, because the map and the guards agreed with each other perfectly.
 *
 * The attendance *figures* PLAN §3 does promise this role — "school summary,
 * attendance completion" — are a count on their own Home, read server-side
 * under `dashboard:view`. A permission is about screens, not about rows, so
 * R2.2 does not need this one back to build them.
 */
const viewOnlyPermissions: readonly StaffPermission[] = [
  "dashboard:view",
  "timetable:view",
];

/**
 * Accountant: the fee desk. This is the role that sees the fee app.
 *
 * It gets nothing academic. An accountant is not a teacher, and the
 * register, the marks grid and the collection rounds are not theirs — the
 * same reasoning that keeps fee figures off a teacher's screen, pointed the
 * other way.
 *
 * Not `students:view` either, which looks like an omission and is not.
 * That permission opens **this** app's directory, and PLAN §3 gives it to
 * the admin and the office. The fee desk has its own student screen, with
 * its own columns and its own money on it, and that one arrives with the
 * fee screens under `fees:view`. Two directories, and this role gets the
 * one built for the work it does.
 */
const accountantPermissions: readonly StaffPermission[] = [
  "dashboard:view",
  "fees:view",
  "fees:collect",
  "fees:accounts",
];

/**
 * Fee collector: the follow-up list and the counter. Reads the fee screens,
 * logs contact, and takes money at the Payment Desk with a receipt — granted
 * by Janmejay on 11 Oct 2026 (D-261). The back office (`fees:accounts`:
 * closing the day, reversals, bank books, refunds) stays with the accountant
 * and the admin.
 */
const feeCollectorPermissions: readonly StaffPermission[] = [
  "dashboard:view",
  "fees:view",
  "fees:collect",
];

export const rolePermissions: Record<StaffRole, readonly StaffPermission[]> = {
  admin: adminPermissions,
  office: officePermissions,
  accountant: accountantPermissions,
  fee_collector: feeCollectorPermissions,
  academic_coordinator: academicCoordinatorPermissions,
  exam_coordinator: examCoordinatorPermissions,
  teacher: teacherPermissions,
  view_only: viewOnlyPermissions,
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (staffRoles as readonly string[]).includes(value);
}

/**
 * A role value from outside TypeScript's reach — a database column, a JWT
 * claim — narrowed to one this app knows.
 *
 * Unknown falls back to `view_only`, the least-privileged role, so a role
 * added to the enum before the code that understands it cannot hand anybody
 * more than the dashboards.
 */
export function resolveStaffRole(value: unknown): StaffRole {
  return isStaffRole(value) ? value : "view_only";
}

/**
 * Who is asking, as `can()` needs it: a role, and — once the signed-in
 * profile has been read — the permissions `vppsone.role_permissions` holds
 * for that role *now* (Staff → Roles edits them). Without `permissions` the
 * map above answers, which is also the seed the database started from.
 */
export type PermissionSubject = {
  role: StaffRole;
  permissions?: readonly string[] | null;
  /** A Smoke Lab test account (D-311): never manages people or settings (D-314). */
  smokeLab?: boolean;
};

/**
 * What a Smoke Lab account may never do, whatever its role: make or change
 * accounts, roles and permissions, or the school's settings. Without this the
 * admin seat could mint itself a password account that outlives its run.
 */
export const SMOKE_LAB_DENIED: readonly StaffPermission[] = ["staff:manage", "settings:manage"];

/**
 * The permissions a role has in the matrix as the database holds it, narrowed
 * to the ones this app knows. Admin is locked to everything (the matrix editor
 * refuses to change it), so an edited row can never lock the school out.
 */
export function effectivePermissions(subject: PermissionSubject): readonly StaffPermission[] {
  const granted = grantedPermissions(subject);
  return subject.smokeLab ? granted.filter((permission) => !SMOKE_LAB_DENIED.includes(permission)) : granted;
}

function grantedPermissions(subject: PermissionSubject): readonly StaffPermission[] {
  if (subject.role === "admin") return adminPermissions;
  if (subject.permissions) {
    const known = new Set<string>(subject.permissions);
    // Teachers never see money (RULES F), whatever a row says.
    return staffPermissions.filter(
      (permission) =>
        known.has(permission) && !(subject.role === "teacher" && permission.startsWith("fees:")),
    );
  }
  return rolePermissions[subject.role] ?? [];
}

/** The one permission check. Everything that guards anything calls this. */
export function can(
  staff: PermissionSubject | null | undefined,
  permission: StaffPermission,
): boolean {
  if (!staff) {
    return false;
  }

  if (!rolePermissions[staff.role]) {
    return false;
  }

  return effectivePermissions(staff).includes(permission);
}

export function canAny(
  staff: PermissionSubject | null | undefined,
  permissions: readonly StaffPermission[],
): boolean {
  return permissions.some((permission) => can(staff, permission));
}

export function permissionsFor(role: StaffRole): readonly StaffPermission[] {
  return rolePermissions[role];
}

/**
 * The roles whose work is every class, not a few of them.
 *
 * A permission says what kind of thing somebody may do; this says over which
 * classes. The office and the administrator run the school and the two
 * coordinators oversee it, so a register, a roll or a mark sheet from any
 * class is theirs to open. A teacher's classes are the ones she holds or
 * teaches — `classScopeFor()` reads them — and nothing else, however many
 * `:view` permissions she has (P1).
 *
 * `vppsone.reads_every_class()` asks the same question in SQL, and
 * `tests/scoped-reads.test.ts` holds the two lists equal.
 */
export const SCHOOL_WIDE_ROLES: readonly StaffRole[] = [
  "admin",
  "office",
  "academic_coordinator",
  "exam_coordinator",
];

export function readsEveryClass(staff: { role: StaffRole } | null | undefined): boolean {
  return Boolean(staff && SCHOOL_WIDE_ROLES.includes(staff.role));
}
