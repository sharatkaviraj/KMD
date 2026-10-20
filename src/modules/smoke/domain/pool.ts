/**
 * The Smoke Lab's account pool: who the AI agents sign in as.
 *
 * Every seat is a `smoke.*@qa.vpps.local` address — never a real member of
 * staff — and only these can be signed in with a smoke pass. Teachers are
 * attached to existing teacher profiles on the test database (a real class,
 * real periods, real marks to enter); every other role gets a profile of its
 * own. Created and linked by `scripts/smoke-pool.mjs`.
 *
 * Pure and dependency-free: the node script imports this file directly.
 */

export const SMOKE_EMAIL_DOMAIN = "@qa.vpps.local";

export type SmokeRole = "admin" | "office" | "accountant" | "fee_collector" | "academic_coordinator" | "exam_coordinator" | "teacher" | "view_only";

export type SmokeSeat = {
  email: string;
  role: SmokeRole;
  /** What the admin page and the agent brief call this seat. */
  label: string;
  /** Short name for a profile created for this seat (teachers keep their own). */
  shortName: string;
  /** The reading language set on the profile, so both Hindi and English get exercised. */
  language: "hi" | "en" | "both";
};

const seat = (key: string, role: SmokeRole, label: string, shortName: string, language: SmokeSeat["language"]): SmokeSeat => ({
  email: `smoke.${key}${SMOKE_EMAIL_DOMAIN}`,
  role,
  label,
  shortName,
  language,
});

export const SMOKE_SEATS: readonly SmokeSeat[] = [
  seat("admin", "admin", "Smoke admin", "SmkAdm", "en"),
  seat("office", "office", "Smoke office", "SmkOff", "both"),
  seat("accountant", "accountant", "Smoke accountant", "SmkAcc", "en"),
  seat("collector1", "fee_collector", "Smoke fee collector 1", "SmkCo1", "hi"),
  seat("collector2", "fee_collector", "Smoke fee collector 2", "SmkCo2", "en"),
  seat("academic", "academic_coordinator", "Smoke academic coordinator", "SmkAca", "en"),
  seat("exam", "exam_coordinator", "Smoke exam coordinator", "SmkExm", "both"),
  seat("viewonly", "view_only", "Smoke view only", "SmkVw", "en"),
  seat("teacher1", "teacher", "Smoke teacher 1", "SmkT1", "hi"),
  seat("teacher2", "teacher", "Smoke teacher 2", "SmkT2", "both"),
  seat("teacher3", "teacher", "Smoke teacher 3", "SmkT3", "en"),
  seat("teacher4", "teacher", "Smoke teacher 4", "SmkT4", "hi"),
  seat("teacher5", "teacher", "Smoke teacher 5", "SmkT5", "en"),
  seat("teacher6", "teacher", "Smoke teacher 6", "SmkT6", "both"),
  seat("teacher7", "teacher", "Smoke teacher 7", "SmkT7", "hi"),
  seat("teacher8", "teacher", "Smoke teacher 8", "SmkT8", "hi"),
  seat("teacher9", "teacher", "Smoke teacher 9", "SmkT9", "en"),
  seat("teacher10", "teacher", "Smoke teacher 10", "SmkT10", "both"),
  seat("teacher11", "teacher", "Smoke teacher 11", "SmkT11", "hi"),
  seat("teacher12", "teacher", "Smoke teacher 12", "SmkT12", "both"),
  seat("teacher13", "teacher", "Smoke teacher 13", "SmkT13", "hi"),
  seat("teacher14", "teacher", "Smoke teacher 14", "SmkT14", "en"),
  seat("teacher15", "teacher", "Smoke teacher 15", "SmkT15", "hi"),
  seat("teacher16", "teacher", "Smoke teacher 16", "SmkT16", "both"),
  seat("teacher17", "teacher", "Smoke teacher 17", "SmkT17", "hi"),
  seat("teacher18", "teacher", "Smoke teacher 18", "SmkT18", "hi"),
  seat("teacher19", "teacher", "Smoke teacher 19", "SmkT19", "en"),
  seat("teacher20", "teacher", "Smoke teacher 20", "SmkT20", "both"),
];

/** A smoke account: the pattern the database's `smoke_pool` check also enforces. */
export function isSmokeEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && /^smoke\.[a-z0-9._-]+@qa\.vpps\.local$/.test(email.toLowerCase());
}

/**
 * A smoke account, from a session's claims. `app_metadata.smoke_lab` is set
 * by the pool script with the service role and cannot be changed by the
 * account itself, so it still identifies the account if it changes its own
 * email (D-314). The email pattern covers accounts made before the flag.
 */
export function isSmokeAccount(claims: { email?: unknown; app_metadata?: unknown } | null | undefined): boolean {
  if (!claims) return false;
  const meta = claims.app_metadata;
  if (meta && typeof meta === "object" && (meta as Record<string, unknown>).smoke_lab === true) return true;
  return isSmokeEmail(typeof claims.email === "string" ? claims.email : null);
}
