/**
 * Where the school's three applications actually live.
 *
 * **Every hostname in this file was resolved from Vercel project metadata and
 * then fetched, on 2026-09-17 (R0.1)**, and VPPS One's own again when it moved
 * to `one.vpps.co.in` on 2026-10-30. None of them is remembered, inferred
 * from a repository name or copied from an older note, because two of the
 * guesses a reader would make are wrong:
 *
 * - The fee app is served at `vpps-one.vercel.app`. The name that looks like
 *   it — `schoolfees.vercel.app` — answers 200 with `<title>Ecolage
 *   Desktop</title>` and belongs to somebody else entirely.
 * - SamPark is served at `sampark-theta-eight.vercel.app`. `sampark.vercel.app`
 *   answers 500 and is not ours either.
 *
 * Sending a member of staff to a stranger's login form is the failure this
 * file exists to make impossible, so the two wrong hostnames are listed below
 * as `FOREIGN_ORIGINS` and a test asserts no origin here is one of them.
 *
 * `npm run verify:origins` re-checks each entry over the network by fetching
 * `probePath` and looking for `identifiedBy` in the response. When an origin
 * moves, that command is what finds out.
 *
 * This file holds *facts about deployments* and nothing else. The link
 * builders, display names, role visibility and the `/apps` hub are the app
 * registry's job (PLAN §2, task R1.1); they import this.
 */

/** Stable ids from PLAN §2. They are used in URLs and evidence records. */
export const APP_IDS = ["vppsone", "sampark", "schoolfees"] as const;

export type AppId = (typeof APP_IDS)[number];

/**
 * Whether a string off a form, a URL or a database column names one of them.
 *
 * Here rather than at the call site because the id list is here: a stored
 * `app:<something>` is untrusted text until this says otherwise, and a second
 * copy of the list somewhere else is the copy that falls behind.
 */
export function isAppId(value: string): value is AppId {
  return (APP_IDS as readonly string[]).includes(value);
}

/**
 * Which dataset an origin serves — not which Vercel target it is.
 *
 * VPPS One's production deployment is a `dev` origin, because it is pointed at
 * schoolfees-dev (rule 3). Both siblings are `live`. That mismatch is the whole
 * reason this field exists: a student id taken from `dev` does not exist in
 * `live`, so a deep link across the boundary is a 404 with a child's name on
 * it. R1.1's link builder degrades to the destination's own search screen
 * whenever the two sides disagree.
 */
export type OriginEnvironment = "dev" | "live";

export type VerifiedOrigin = {
  appId: AppId;
  /** Scheme and host, no trailing slash. */
  origin: string;
  environment: OriginEnvironment;
  /** The Vercel project the origin was resolved from. */
  vercelProject: string;
  /** Path fetched by `npm run verify:origins`. Redirects are followed. */
  probePath: string;
  /**
   * Text the probe response must contain for the origin to be itself.
   *
   * A title rather than a status code: every one of these hosts answers *some*
   * 200, and "responded" is not "is the application we meant".
   */
  identifiedBy: string;
  /** ISO date this entry was last confirmed over the network. */
  verifiedOn: string;
};

/**
 * Hostnames that look right and are not.
 *
 * Kept in code rather than in prose so `tests/app-origins.test.ts` can refuse
 * them mechanically. Neither is fetched by `verify:origins` — they are other
 * people's servers and there is no reason for this repository to poll them.
 */
export const FOREIGN_ORIGINS = [
  "https://schoolfees.vercel.app",
  "https://sampark.vercel.app",
] as const;

export const VERIFIED_ORIGINS: readonly VerifiedOrigin[] = [
  {
    appId: "vppsone",
    // The school's own subdomain since 30 Oct 2026 (D-336, docs/DOMAIN.md).
    // `vppsone.vercel.app` still serves the same deployment and is kept for
    // the smoke scripts and anyone with the old address bookmarked.
    origin: "https://one.vpps.co.in",
    // The deployment is Vercel "production"; the data behind it is dev, and
    // that is what callers need to know.
    environment: "dev",
    vercelProject: "vppsone",
    probePath: "/login",
    identifiedBy: "VPPS One",
    verifiedOn: "2026-10-30",
  },
  {
    appId: "schoolfees",
    origin: "https://vpps-one.vercel.app",
    environment: "live",
    vercelProject: "schoolfees",
    probePath: "/",
    identifiedBy: "Fee Admin",
    verifiedOn: "2026-09-17",
  },
  {
    appId: "sampark",
    origin: "https://sampark-theta-eight.vercel.app",
    environment: "live",
    vercelProject: "sampark",
    probePath: "/login",
    identifiedBy: "Sampark",
    verifiedOn: "2026-09-17",
  },
];

export function verifiedOrigin(appId: AppId): VerifiedOrigin {
  const found = VERIFIED_ORIGINS.find((entry) => entry.appId === appId);

  if (!found) {
    // Unreachable while `VERIFIED_ORIGINS` covers `APP_IDS`, which a test
    // asserts. Throwing rather than returning undefined keeps callers from
    // building `undefined/protected/students`.
    throw new Error(`No verified origin recorded for ${appId}`);
  }

  return found;
}

/**
 * Whether an id from `from` may be interpolated into a URL on `to`.
 *
 * The rule is deliberately "same dataset", not "same app": ids are only
 * meaningful within the database that minted them. Today this returns false
 * for every VPPS One → sibling pair, and saying so out loud is the point —
 * R1.1 builds the fallback around it instead of discovering it in testing.
 */
export function idsTravelBetween(
  from: OriginEnvironment,
  to: OriginEnvironment,
): boolean {
  return from === to;
}

/** Same approved production deployment, verified through Vercel and browser UI
 * 2026-10-18. Fixed overnight QA pairing only; not a sibling application. */
export const DAYRUN_ORIGINS = {
  owner: "https://vppsone.vercel.app",
  role: "https://vppsone-veerpattas-projects.vercel.app",
} as const;
