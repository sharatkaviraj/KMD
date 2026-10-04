/**
 * The scripts' half of `src/platform/supabase/target-guard.ts`.
 *
 * Every script that writes has said "refusing to run: .env.local is not the
 * dev project" since the first week, and every one of them checked it with
 * `url.includes(ref)` — which passes `https://elsewhere.example/?<dev ref>`.
 * This compares the hostname exactly instead. Plain JavaScript because half
 * the scripts run without the alias hook; `tests/target-guard.test.ts` keeps
 * the constants here and in the TypeScript module the same.
 *
 * `scripts/replicate-live.mjs` is the one script that reads live, and it does
 * not use this: its live client is sealed in a closure that can only
 * `.select()` (rule 3), and it is the documented exception.
 */

export const DEV_PROJECT_REFS = ["wtgxcptmucjerhufzjcf"];
export const PROTECTED_LIVE_PROJECT_REF = "vgqyilgstjvgohrsiwkb";

/** The project ref a Supabase URL addresses, or null if it is not one. */
export function projectRefOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = /^([a-z]{20})\.supabase\.(co|in)$/.exec(host);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** True only for a URL whose host is exactly a dev project. */
export function isDevProjectUrl(url) {
  const ref = projectRefOf(url ?? "");
  return ref !== null && DEV_PROJECT_REFS.includes(ref);
}

/**
 * Exit before any client is made unless `url` is a dev project.
 *
 * Says which rule it is enforcing, and names the live project explicitly when
 * that is what it found, because "not the dev project" undersells it.
 */
export function assertDevTarget(url, label = "this script") {
  if (isDevProjectUrl(url)) return;

  const ref = projectRefOf(url ?? "");
  const why =
    ref === PROTECTED_LIVE_PROJECT_REF
      ? "that is the live fee project"
      : ".env.local is not the dev project";

  console.error(`Refusing to run ${label}: ${why} (rule 3).`);
  process.exit(1);
}
