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

  // The other two apps (R1.1).
  //
  // Not "may open School Fees" — nothing here can grant that, and the fee app
  // decides for itself. This is only "is offered the way there", which PLAN §3
  // gives the admin and the office. A teacher has no errand in either.
  "apps:view",

  // Platform (Phase 7).
  "jobs:view",
  "jobs:run",
  "audit:view",
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
  "notes:view",
  "assessments:view",
  "marks:view",
  "reports:view",
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
 */
const viewOnlyPermissions: readonly StaffPermission[] = [
  "dashboard:view",
  "timetable:view",
  "attendance:view",
];

export const rolePermissions: Record<StaffRole, readonly StaffPermission[]> = {
  admin: adminPermissions,
  office: officePermissions,
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

/** The one permission check. Everything that guards anything calls this. */
export function can(
  staff: { role: StaffRole } | null | undefined,
  permission: StaffPermission,
): boolean {
  if (!staff) {
    return false;
  }

  const permissions = rolePermissions[staff.role];

  if (!permissions) {
    return false;
  }

  return permissions.includes(permission);
}

export function canAny(
  staff: { role: StaffRole } | null | undefined,
  permissions: readonly StaffPermission[],
): boolean {
  return permissions.some((permission) => can(staff, permission));
}

export function permissionsFor(role: StaffRole): readonly StaffPermission[] {
  return rolePermissions[role];
}
