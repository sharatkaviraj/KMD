/**
 * Which Supabase project a client may be pointed at, decided before it is made.
 *
 * Every script in `scripts/` has refused the wrong project since the first
 * week, and the app's own clients never did: they trusted whatever
 * `NEXT_PUBLIC_SUPABASE_URL` said. A deployment with the live URL and
 * `VPPSONE_ENV` forgotten — which `getVppsOneEnvironment()` reads as `dev` —
 * would have written cover plans and test registers into the school's real
 * database, and the only thing between the two was a variable nobody re-reads.
 *
 * So the target is checked where a client is created, from the URL itself:
 *
 *  - **dev** may reach the dev project or a local Supabase, and nothing else.
 *    The live fee project is refused by name. An unknown project is refused
 *    too — "fail closed" means an unfamiliar ref is not assumed to be a test.
 *  - **live** may reach the live project and nothing else, and never from a
 *    test runner. `VPPSONE_ENV=live` is the cutover's own declaration
 *    (`docs/CUTOVER.md`); a test that inherits it is not a cutover.
 *
 * A hostname is compared exactly. `url.includes(ref)` — the scripts' old check
 * — passes `https://elsewhere.example/?wtgxcptmucjerhufzjcf`.
 *
 * Pure, and imported by the browser client as well, so it holds no secrets and
 * reads nothing but what it is given. `scripts/target-guard.mjs` is its twin
 * for the Node scripts; `tests/target-guard.test.ts` keeps the two agreeing.
 */

/** schoolfees-dev. The only database this app is built against (rule 3). */
export const DEV_PROJECT_REFS = ["wtgxcptmucjerhufzjcf"] as const;

/** The live School Fees project. Never a target before the cutover. */
export const PROTECTED_LIVE_PROJECT_REF = "vgqyilgstjvgohrsiwkb";

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

  if (target.kind === "project" && target.ref === PROTECTED_LIVE_PROJECT_REF) {
    if (context.underTest) {
      return "The live fee project is never a test target, whatever VPPSONE_ENV says.";
    }
    if (context.environment !== "live") {
      return (
        "NEXT_PUBLIC_SUPABASE_URL is the live fee project but VPPSONE_ENV is not " +
        "'live'. Until the cutover this app is built against schoolfees-dev only (rule 3)."
      );
    }
    return null;
  }

  if (context.environment === "live") {
    return `VPPSONE_ENV=live may only reach the live fee project, not ${describe(target)}.`;
  }

  if (target.kind === "project" && (DEV_PROJECT_REFS as readonly string[]).includes(target.ref)) {
    return null;
  }

  if (target.kind === "local") return null;

  // The CI build compiles against an inert placeholder host; it is not a
  // project and cannot hold data. Anywhere else it is a misconfiguration.
  if (target.kind === "placeholder" && context.ci) return null;

  return (
    `Refusing ${describe(target)}: it is not a known dev project. ` +
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
