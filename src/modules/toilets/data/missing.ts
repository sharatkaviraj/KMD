/**
 * True when PostgREST says a table is not there: the toilet checks migration
 * (20261117112752) has not reached this database yet. The screen then says
 * Toilet checks is being set up, instead of failing. Anything else is a real
 * error and is not hidden.
 */
export function missingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /could not find the table|relation .* does not exist/i.test(error.message ?? "");
}
