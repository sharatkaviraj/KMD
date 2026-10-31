/**
 * Did this query fail only because the database does not have `column` yet?
 *
 * Code and migrations ship separately. A deployment that lands a moment
 * before its migration would otherwise break the paths that touch the new
 * column — for `whatsapp_reminder_sends.pay_scope` (`20261028140100`) that is
 * every reminder send and every Pay now page. The callers retry the same
 * query without the column, so the old behaviour carries on until the
 * migration arrives.
 *
 * PostgREST reports an unknown column as PGRST204 on a write and passes
 * Postgres's 42703 through on a read. Either one counts only when the message
 * names this column, so an unrelated schema error is never swallowed.
 */
export function isMissingColumn(
  error: { code?: string | null; message?: string | null } | null | undefined,
  column: string,
): boolean {
  if (!error) return false;
  if (error.code !== "PGRST204" && error.code !== "42703") return false;
  return String(error.message ?? "").includes(column);
}
