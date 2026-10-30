/**
 * Which Supabase project a client may be pointed at, decided before it is made.
 *
 * Every script in `scripts/` has refused the wrong project since the first
 * week, and the app's own clients never did: they trusted whatever
 * `NEXT_PUBLIC_SUPABASE_URL` said. So the target is checked where a client is
 * created, from the URL itself.
 *
 * Two projects matter, and since 30 Oct they are not "dev" and "live"
 * (D-338, D-346):
 *
 *  - **ONE_MAIN_PROJECT_REF** (`wtgxcptmucjerhufzjcf`) is One's own database:
 *    production from go-live on, and the only test bed there will ever be.
 *    There is no separate dev database. Testing happens in it, under
 *    TEST-2026-27, and whether it is production right now is said by the
 *    database itself (`vppsone.deployment`), not by its ref.
 *  - **FEES_SOURCE_PROJECT_REF** (`vgqyilgstjvgohrsiwkb`) is the fees app's
 *    live database. One copies from it and never writes to it. The app — and
 *    every script except `scripts/migrate/*`'s sealed select-only reader — may
 *    never target it, whatever `VPPSONE_ENV` says.
 *
 * The rule:
 *
 *  - the fees source project is refused, always;
 *  - **live** (`VPPSONE_ENV=live`, the production deployment's own
 *    declaration) may reach ONE_MAIN_PROJECT_REF and nothing else, and never
 *    from a test runner — a test that inherits `VPPSONE_ENV=live` is not a
 *    deployment;
 *  - **dev** (everything else: previews, `next dev`, tests) may reach
 *    ONE_MAIN_PROJECT_REF or a local Supabase. An unknown project is refused —
 *    "fail closed" means an unfamiliar ref is not assumed to be a test.
 *
 * A hostname is compared exactly. `url.includes(ref)` — the scripts' old check
 * — passes `https://elsewhere.example/?wtgxcptmucjerhufzjcf`.
 *
 * Pure, and imported by the browser client as well, so it holds no secrets and
 * reads nothing but what it is given. `scripts/target-guard.mjs` is its twin
 * for the Node scripts; `tests/target-guard.test.ts` keeps the two agreeing.
 */

/** One's main database: production from go-live, and the only test bed (D-338). */
export const ONE_MAIN_PROJECT_REF = "wtgxcptmucjerhufzjcf";

/** The fees app's live database. A read-only source for migration scripts; never a target. */
export const FEES_SOURCE_PROJECT_REF = "vgqyilgstjvgohrsiwkb";

export type SupabaseTarget =
  | { kind: "project"; ref: string }
  | { kind: "local" }
  | { kind: "placeholder"; host: string }
  | { kind: "unknown"; host: string };

/** Supabase project refs are twenty lowercase letters. */
const PROJECT_REF_SHAPE = /^[a-z]{20}$/;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "host.docker.internal"]);

export function supabaseTargetOf(url: string): SupabaseTarget {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { kind: "unknown", host: url };
  }

  if (LOCAL_HOSTS.has(host)) return { kind: "local" };

  const match = /^([^.]+)\.supabase\.(co|in)$/.exec(host);
  if (!match) return { kind: "unknown", host };

  const label = match[1];
  if (PROJECT_REF_SHAPE.test(label)) return { kind: "project", ref: label };

  // A subdomain that cannot be a project ref, like CI's `ci-build-only`.
  return { kind: "placeholder", host };
}

/** Is this URL exactly One's main project? */
export function isOneMainProject(url: string): boolean {
  const target = supabaseTargetOf(url);
  return target.kind === "project" && target.ref === ONE_MAIN_PROJECT_REF;
}

export type TargetContext = {
  environment: "dev" | "live";
  /** Vitest, Playwright, or anything else that set NODE_ENV=test. */
  underTest: boolean;
  /** GitHub Actions and most CI providers set CI=true. */
  ci: boolean;
};

export class ProtectedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtectedTargetError";
  }
}

function describe(target: SupabaseTarget): string {
  switch (target.kind) {
    case "project":
      return `project ${target.ref}`;
    case "local":
      return "a local Supabase";
    default:
      return `host ${target.host}`;
  }
}

/**
 * The reason a client may not be created for this URL, or `null` if it may.
 *
 * Returned rather than thrown so the decision can be tested as data; the
 * clients call `assertPermittedTarget()`.
 */
export function refusalFor(url: string, context: TargetContext): string | null {
  const target = supabaseTargetOf(url);

  if (target.kind === "project" && target.ref === FEES_SOURCE_PROJECT_REF) {
    return (
      "NEXT_PUBLIC_SUPABASE_URL is the fees app's live database. One copies from it " +
      "and never targets it (D-338, D-339); One's database is " +
      `${ONE_MAIN_PROJECT_REF}.`
    );
  }

  if (context.environment === "live") {
    if (context.underTest) {
      return "VPPSONE_ENV=live under a test runner: a test is not the production deployment.";
    }
    if (target.kind === "project" && target.ref === ONE_MAIN_PROJECT_REF) return null;
    return `VPPSONE_ENV=live may only reach One's main project, not ${describe(target)}.`;
  }

  if (target.kind === "project" && target.ref === ONE_MAIN_PROJECT_REF) return null;

  if (target.kind === "local") return null;

  // The CI build compiles against an inert placeholder host; it is not a
  // project and cannot hold data. Anywhere else it is a misconfiguration.
  if (target.kind === "placeholder" && context.ci) return null;

  return (
    `Refusing ${describe(target)}: it is not One's main project. ` +
    "An unfamiliar target is not assumed to be a test one."
  );
}

export function currentTargetContext(): TargetContext {
  const declared = process.env.VPPSONE_ENV?.trim().toLowerCase();
  return {
    environment: declared === "live" ? "live" : "dev",
    underTest:
      process.env.NODE_ENV === "test" ||
      Boolean(process.env.VITEST) ||
      Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL),
    ci: process.env.CI === "true" || process.env.CI === "1",
  };
}

/** Throws before any request leaves this process if the target is refused. */
export function assertPermittedTarget(url: string, context = currentTargetContext()): string {
  const reason = refusalFor(url, context);
  if (reason) throw new ProtectedTargetError(reason);
  return url;
}
