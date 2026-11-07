/**
 * True when PostgREST says a table is not there: the transport migration
 * (20261107165000) has not reached this database yet. The screen then shows
 * the routes and says the bus times and drivers are being set up, instead of
 * failing. Anything else is a real error and is not hidden.
 */
export function missingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /could not find the table|relation .* does not exist/i.test(error.message ?? "");
}
