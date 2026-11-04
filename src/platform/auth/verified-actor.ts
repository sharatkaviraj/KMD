import { can, readsEveryClass, type StaffPermission } from "@/platform/auth/permissions";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { canAccessSession } from "@/platform/auth/test-session-policy";

/**
 * A member of staff resolved without this request's cookie — today only by the
 * AI connection, from a One-issued token, on every call
 * (`src/modules/mcp/data/staff.ts`, plan §5.3 step 4).
 *
 * The screens' readers ask `assertStaff()` / `assertPermission()`, which read
 * the cookie. Their `…As(actor, …)` twins take one of these instead and make
 * the same check against it with the functions below.
 *
 * Being one is not a field anybody can set: `mintVerifiedActor` freezes the
 * object and records it in a module-private WeakSet, and only the resolver
 * calls it (`tests/mcp/verified-actor.test.ts` holds that). A look-alike
 * object — the same fields, even a copy of a real one — is refused.
 */
declare const verified: unique symbol;

type ActorFields = CurrentStaff & {
  /** A day-run QA identity (`dayrun-policy.ts`): never eligible for an AI connection. */
  qaAccount?: boolean;
};

export type VerifiedActor = Readonly<ActorFields> & { readonly [verified]: true };

const minted = new WeakSet<object>();

/** Only `resolveStaffForUser` (src/modules/mcp/data/staff.ts) may call this. */
export function mintVerifiedActor(staff: ActorFields): VerifiedActor {
  const actor = Object.freeze({ ...staff, permissions: staff.permissions ? Object.freeze([...staff.permissions]) : staff.permissions });
  minted.add(actor);
  return actor as unknown as VerifiedActor;
}

export function isVerifiedActor(value: unknown): value is VerifiedActor {
  return typeof value === "object" && value !== null && minted.has(value);
}

/** `assertStaff()` for a verified actor: minted by the resolver, active. */
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

/**
 * The `test_session_fence` the database applies to a cookie read, which a
 * service-role twin does not pass through: a test account reads only TEST
 * sessions, everybody else only real ones, a real admin both
 * (`canAccessSession`, test-session-policy.ts). Every twin that takes a
 * session label calls this before it reads.
 */
export function assertActorSession(actor: unknown, sessionLabel: string): VerifiedActor {
  const staff = assertActorStaff(actor);
  if (!canAccessSession(staff, sessionLabel)) throw new Error("Session not available to this account.");
  return staff;
}
