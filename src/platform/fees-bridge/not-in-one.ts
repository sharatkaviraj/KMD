/*
 * Screens One does not have yet (owner, 6 Nov 2026: One never sends staff to
 * the Fees app). Instead of a redirect or an "Open in Fees" link, the person
 * lands on One's own /not-in-one page, which names the screen (see
 * src/vx/not-in-one.ts) and says it is not in One yet. Pure.
 */

/** The One path the person asked for, kept to a plain path: no host, query or odd characters. */
export function cleanFromPath(from: string | null | undefined): string {
  const path = (from ?? "").split(/[?#]/, 1)[0];
  return /^\/[A-Za-z0-9/_-]{0,200}$/.test(path) ? path : "";
}

/** One's own "not in One yet" page for a path, never the Fees app. */
export function notInOneHref(from: string): string {
  const path = cleanFromPath(from);
  return path ? `/not-in-one?${new URLSearchParams({ from: path })}` : "/not-in-one";
}
