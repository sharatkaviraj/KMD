/**
 * The night's copy of the Fees app into One (D-644, D-648), the pure half.
 *
 * With the Fees link off, One's real-year children, classes and money are a
 * copy of the Fees app taken once a night (D-457: never more often). The
 * database does the copy (`vppsone.fees_copy_nightly`) and then asks
 * `/api/jobs/fees-copy-done` to clear One's saved screens. These are the
 * rules that request and the "updated from Fees" line follow.
 */

/**
 * A tag `vppsone.fees_copy_cache_tags()` may name: a real year's fee reads
 * (`session:`, `dues-badge:`) or one child's (`student:`). Anything else it
 * returned is dropped rather than expired: the request clears screens, and a
 * malformed row must not become a different tag.
 */
const COPY_TAG =
  /^(?:session:\d{4}-\d{2}|dues-badge:\d{4}-\d{2}|student:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * Tags every copy makes stale, whatever it brought, each with where it is
 * cached. Every one of them also expires by itself within five minutes; the
 * three in `COPY_TAG` do not, which is why the request exists.
 */
export const FEES_COPY_FIXED_TAGS = [
  // The fee policy and the Fee Setup summary (`modules/fees/data/policy.ts`).
  "fee-policy",
  // Fee Setup's readiness (`modules/fees/data/setup-queries.ts`).
  "setup-readiness",
  // The active year (`modules/fees/platform/session-context/active.ts`,
  // `CACHE_TAGS.appSettings`). The copy brings it from Fees.
  "app-settings",
  // Class names and who teaches a class (`CACHE_TAGS.classes`).
  "vx-classes",
] as const;

/** The tags to expire after a copy: the fixed ones, then the database's own, once each. */
export function feesCopyTags(fromDatabase: readonly unknown[]): string[] {
  const named = fromDatabase.filter((tag): tag is string => typeof tag === "string" && COPY_TAG.test(tag));
  return [...new Set<string>([...FEES_COPY_FIXED_TAGS, ...named])];
}

/**
 * How long a copy counts as last night's: the night's run (02:00 in the
 * school's time) plus a whole working day and a margin. Past it, the line
 * says the copy did not run.
 */
export const FEES_COPY_FRESH_HOURS = 30;

export type FeesCopyFreshness = "fresh" | "stale" | "never";

/** Is the last copy that wrote recent enough to call last night's? */
export function feesCopyFreshness(finishedAt: string | null | undefined, now: Date): FeesCopyFreshness {
  if (!finishedAt) return "never";
  const at = Date.parse(finishedAt);
  if (!Number.isFinite(at)) return "never";
  return now.getTime() - at <= FEES_COPY_FRESH_HOURS * 3_600_000 ? "fresh" : "stale";
}

/** A real academic year's label (`2026-27`); a practice year (`TEST-2026-27`) is never copied. */
const REAL_YEAR = /^\d{4}-\d{2}$/;

/**
 * Does the shell show the "updated from Fees" line? While the Fees link is
 * off, to an active, real member of staff looking at a real year: the same
 * people the link's own "roster updated" line spoke to, in the years the copy
 * brings. Never in a confined deployment, which reads only practice data.
 */
export function showsFeesCopyStatus(input: {
  bridgeOn: boolean;
  confined: boolean;
  viewer: { isActive: boolean; isTestAccount?: boolean; confined?: boolean };
  sessionLabel: string | null | undefined;
}): boolean {
  return (
    !input.bridgeOn &&
    !input.confined &&
    input.viewer.isActive &&
    input.viewer.isTestAccount !== true &&
    input.viewer.confined !== true &&
    REAL_YEAR.test(input.sessionLabel ?? "")
  );
}
