import { ACTIVE_SESSION_KEY, pickSessionLabel } from "../src/platform/config/active-session.ts";

/**
 * Ask the database which session it is working in, for the seeding scripts.
 *
 * The *decision* lives in `src/platform/config/active-session.ts`, which the
 * application and the tests share; this is only the two reads that feed it,
 * kept here because the scripts hold an untyped client and the app does not.
 *
 * Every one of these scripts used to decide for itself, by sorting the labels
 * and taking the last — which chooses the rehearsal session `TEST-2026-27`
 * over the real `2026-27` on any database that carries both. That comment is
 * worth reading before changing this.
 */
export async function readActiveSession(db, requested = null) {
  const pub = db.schema("public");

  const [{ data: setting }, { data: classes, error }] = await Promise.all([
    pub.from("app_settings").select("value").eq("key", ACTIVE_SESSION_KEY).maybeSingle(),
    pub.from("classes").select("session_label"),
  ]);

  if (error) throw new Error(`Could not read the sessions: ${error.message}`);

  const label = pickSessionLabel({
    requested,
    configured: process.env.VPPSONE_SESSION_LABEL,
    active: setting?.value,
    labels: [...new Set((classes ?? []).map((row) => row.session_label))],
  });

  if (!label) throw new Error("This database has no academic session at all.");

  return label;
}
