/**
 * The Needs you badge, counted as `loadInbox` builds its list (perf fix 2).
 * Pure, so the rule that keeps the badge equal to the list is tested on its
 * own (`tests/vx-speed.test.ts`).
 */

/** Needs you shows at most this many single-field changes; the rest wait on the review screen. */
export const SUBMISSION_ITEMS_MAX = 40;

export function inboxBadgeCount(parts: {
  /** Some class has not saved today's register (one item, however many classes). */
  notMarked: boolean;
  /** Live cover duties that need somebody (one item each). */
  coverNeeded: number;
  /** Pending field changes (one item each, up to the cap). */
  changes: number;
  /** Pending "nothing changed" confirmations (one item for all of them). */
  confirmations: number;
  /** Money decisions waiting (one item each). */
  refunds: number;
  /** Jobs whose last run failed (one item each). */
  failedJobs: number;
  /** Teachers' leave asked and not yet decided (one item each). */
  leave?: number;
  /** A parent's suggestions this reader decides here (one item each, D-598). */
  parents?: number;
}): number {
  return (
    (parts.notMarked ? 1 : 0) +
    parts.coverNeeded +
    Math.min(parts.changes, SUBMISSION_ITEMS_MAX) +
    (parts.confirmations > 0 ? 1 : 0) +
    parts.refunds +
    parts.failedJobs +
    (parts.leave ?? 0) +
    (parts.parents ?? 0)
  );
}
