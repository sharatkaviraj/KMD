import type { StaffRole } from "@/platform/auth/permissions";
import {
  rolePermissions as feeRolePermissions,
  type StaffPermission as FeeStaffPermission,
  type StaffRole as FeeStaffRole,
} from "@/modules/fees/platform/roles";

/**
 * The one place the two role vocabularies meet.
 *
 * VPPS One has eight roles and three fee permissions; the ported fee code has
 * five roles and twenty-eight permissions, and ~90 call sites ask it what the
 * signed-in person may do. Rewriting those call sites would have meant
 * rewriting the guard inside every fee screen — so instead the fee vocabulary
 * survives intact and this file translates into it.
 *
 * Pure: no database, no framework, no request. That is what lets
 * `tests/fee-roles.test.ts` enumerate every role exhaustively, and it is why
 * the file sits beside `permissions.ts` in the architecture test's allowlist
 * of things `domain/` may import.
 *
 * **D-6 still holds.** The role being translated here was read from
 * `vppsone.staff_profiles`. Nothing in this app reads `public.users.role`, and
 * the fee app's own `resolveStaffRole()` is deliberately not called: a JWT
 * claim or a `public.users` row is not a second opinion we want.
 */
export function feeRoleFor(role: StaffRole): FeeStaffRole {
  switch (role) {
    case "admin":
      return "admin";

    case "accountant":
      return "accountant";

    case "fee_collector":
      return "fee_collector";

    // A teacher reading a fee screen reads it as the fee app's teacher: every
    // tab, no financial write. In practice no teacher is offered the way in —
    // `fees:view` is not on their VPPS One permission list — so this is the
    // answer for an admin who has been demoted mid-session, not a door.
    case "teacher":
      return "teacher";

    /*
     * Everyone else lands on the fee app's most limited role.
     *
     * `office` is the interesting one, and it is a deliberate reduction:
     * office staff do post payments in the fee app today. Posting is granted
     * one person at a time through `accountant` now, rather than by being in
     * the office. Janmejay's call, recorded in DECISIONS.md.
     *
     * No `default:` clause. The exhaustive switch is the point — adding a role
     * to `staffRoles` without deciding what it means financially should fail
     * the build, not silently inherit `view_only`.
     */
    case "office":
    case "academic_coordinator":
    case "exam_coordinator":
    case "view_only":
      return "view_only";
  }
}

/**
 * What this person may do inside a fee screen, in the fee app's own words.
 *
 * The fee app's map is handed over **unmodified**. Its permission split is the
 * product of a year of running a fee desk — which acts are admin-only, why
 * reversing a receipt is separate from adjusting a ledger — and re-deriving it
 * from VPPS One's three-permission summary would lose all of that.
 */
export function feePermissionsFor(role: StaffRole): readonly FeeStaffPermission[] {
  return feeRolePermissions[feeRoleFor(role)];
}

export type { FeeStaffPermission, FeeStaffRole };
