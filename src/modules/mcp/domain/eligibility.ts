import type { StaffRole } from "@/platform/auth/permissions";

/**
 * Who may hold an AI connection. One function, asked at the consent page and
 * again on every tool call (plan §5.3 steps 4–6), so the two can never
 * disagree.
 *
 * Owner decision D7, "admins first, then teachers": the pilot is the admin
 * role. Opening it to teachers is adding `"teacher"` to this list — one line —
 * after the M1 gates in the plan (§8) are met; nothing else changes, because
 * every tool already asks for its own permission and scope.
 */
export const AI_CONNECTION_ROLES: readonly StaffRole[] = ["admin"];

export type EligibilityRefusal =
  /** No staff profile, or `is_active` false. */
  | "inactive"
  /** The role is not (yet) one that may connect (D7). */
  | "not_eligible"
  /** A test account that is not an admin: owner decision D11, "only admins account can use test". */
  | "test_not_admin"
  /** A Smoke Lab or day-run QA identity: they exist for screen tests, never for a provider grant. */
  | "qa_account";

export type ConnectionSubject = {
  role: StaffRole;
  isActive: boolean;
  /** Profile flag, or any account on a confined deployment (Preview, local). */
  isTestAccount?: boolean;
  smokeLab?: boolean;
  qaAccount?: boolean;
};

export function aiConnectionEligibility(
  staff: ConnectionSubject | null | undefined,
): { ok: true } | { ok: false; reason: EligibilityRefusal } {
  if (!staff || !staff.isActive) return { ok: false, reason: "inactive" };
  if (staff.smokeLab || staff.qaAccount) return { ok: false, reason: "qa_account" };
  // D11 before D7, so the TEST rule still holds the day teachers are added:
  // a non-admin test account — every account on a Preview or local build —
  // never reaches TEST data through this connection.
  if (staff.isTestAccount === true && staff.role !== "admin") return { ok: false, reason: "test_not_admin" };
  if (!AI_CONNECTION_ROLES.includes(staff.role)) return { ok: false, reason: "not_eligible" };
  return { ok: true };
}
