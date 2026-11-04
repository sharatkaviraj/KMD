/**
 * How long the AI helper's log is kept.
 *
 * `vppsone.assist_log` holds metadata only — who asked, which feature, the
 * tokens, the estimated cost and what the person did with the draft; never the
 * prompt or the answer. The owner approved keeping metadata-only AI tool logs
 * for 180 days (MCP feasibility D8), and this log gets the same: nothing that
 * reads it looks further back than the current month (the budget and the
 * usage panel), so a row past 180 days is history nobody uses about a member
 * of staff.
 */
export const ASSIST_LOG_RETENTION_DAYS = 180;

/** Rows per delete. Ids go into the request URL, so this stays under `IN_FILTER_CHUNK_SIZE`. */
export const ASSIST_LOG_PURGE_BATCH = 200;

/** Batches per run. A backlog larger than this finishes on the following nights. */
export const ASSIST_LOG_PURGE_MAX_BATCHES = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows created strictly before this instant are past retention. */
export function assistLogCutoff(now: Date, days: number = ASSIST_LOG_RETENTION_DAYS): Date {
  if (!Number.isInteger(days) || days < 1) throw new Error(`Retention must be a whole number of days, got ${days}`);
  return new Date(now.getTime() - days * DAY_MS);
}
