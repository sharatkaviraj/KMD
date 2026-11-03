import { can, readsEveryClass, type StaffPermission } from "@/platform/auth/permissions";
import type { CurrentStaff } from "@/platform/auth/current-staff";

/**
 * A member of staff resolved without this request's cookie — today only by the
 * AI connection, from a One-issued token, on every call
 * (`src/modules/mcp/data/staff.ts`, plan §5.3 step 4).
 *
 * The screens' readers ask `assertStaff()` / `assertPermission()`, which read
 * the cookie. Their `…As(actor, …)` twins take one of these instead and make
 * the same check against it with the functions below. The `verifiedBy` mark
 * is what makes a hand-built object stand out in review: only the resolver
 * sets it, and the twins refuse anything without it.
 */
export type VerifiedActor = CurrentStaff & {
  readonly verifiedBy: "ai_connection";
  /** A day-run QA identity (`dayrun-policy.ts`): never eligible for an AI connection. */
  qaAccount?: boolean;
};

export function isVerifiedActor(value: unknown): value is VerifiedActor {
  return typeof value === "object" && value !== null && (value as { verifiedBy?: unknown }).verifiedBy === "ai_connection";
}

/** `assertStaff()` for a verified actor: present, marked, active. */
export function assertActorStaff(actor: unknown): VerifiedActor {
  if (!isVerifiedActor(actor) || actor.isActive !== true) throw new Error("Not signed in.");
  return actor;
}

/** `assertPermission()` for a verified actor. */
export function assertActorPermission(actor: unknown, permission: StaffPermission): VerifiedActor {
  const staff = assertActorStaff(actor);
  if (!can(staff, permission)) throw new Error(`Permission denied: ${permission}`);
  return staff;
}

/**
 * A school-wide read the screen gets through RLS — `reads_every_class()` in
 * SQL. A twin that reads through the service role instead must refuse anyone
 * the policy would have filtered down to their own classes.
 */
export function assertActorEveryClass(actor: unknown, permission: StaffPermission): VerifiedActor {
  const staff = assertActorPermission(actor, permission);
  if (!readsEveryClass(staff)) throw new Error("Permission denied: every class");
  return staff;
}
