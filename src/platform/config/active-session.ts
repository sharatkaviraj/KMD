/**
 * Which academic session this database is working in — decided once, in one
 * place, by a function with no database in it.
 *
 * **The same wrong answer was written six times.** `resolveSessionLabel()`,
 * the nightly job runner, three seeding scripts and the e2e harness each
 * derived the session by reading every `session_label` out of
 * `public.classes`, sorting them, and taking the last. Each was written while
 * `schoolfees-dev` held exactly one session, where "the only one" and "the
 * last one alphabetically" are the same answer and the shortcut is invisible.
 *
 * They diverge the moment a database holds more than one, and they diverge
 * badly: **`TEST-2026-27` sorts above both `2027-28` and `2026-27`**, because
 * `T` sorts above `2`. `TEST-2026-27` is the rehearsal session — the fee app's
 * own bulk-payment template tells people to practise in it — and the live fee
 * database has carried it for months alongside the two real years.
 *
 * So on live, every one of those six would have chosen the rehearsal session.
 * Ninety-two call sites ask `resolveSessionLabel()`: every register, every
 * mark, every cover plan, the teacher's day, the dashboard. They would read
 * empty, because the real children are in `2026-27`, and anything saved would
 * be written into the rehearsal year. Nothing raises. A teacher sees "no
 * timetable in effect" on a school day and has no way to find out why.
 *
 * It could not be seen until dev held more than one session, which is what
 * copying live's data into it produced. It is what cutover would have hit on
 * its first morning.
 *
 * The application does not have to guess. `app_settings.active_session_label`
 * is the row the fee app's own `getActiveSessionLabel()` reads, so both halves
 * of the merged application now answer this question the same way.
 *
 * This function takes the answers rather than fetching them: the callers hold
 * very differently-typed Supabase clients, and the part worth having in one
 * place is the *order of preference*, which is also the part that can be
 * tested without a database.
 */
export const ACTIVE_SESSION_KEY = "active_session_label";

export type SessionChoice = {
  /** A session named explicitly by the request, e.g. the session switcher. */
  requested?: string | null;
  /** `VPPSONE_SESSION_LABEL`, for the weeks when two sessions overlap. */
  configured?: string | null;
  /** `app_settings.active_session_label` — what the application itself says. */
  active?: string | null;
  /** Every session the database knows about. */
  labels: readonly string[];
};

export function pickSessionLabel({
  requested,
  configured,
  active,
  labels,
}: SessionChoice): string | null {
  const known = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    return trimmed && labels.includes(trimmed) ? trimmed : null;
  };

  // A session somebody asked for, then one this deployment was configured
  // with, then the one the application stores. Only if none of those is
  // available does it fall back to guessing — and a database with no
  // `active_session_label` at all has nothing better to offer.
  return (
    known(requested) ??
    known(configured) ??
    known(active) ??
    [...labels].sort().reverse()[0] ??
    null
  );
}
