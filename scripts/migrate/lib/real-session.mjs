/**
 * The real session the school works in, for the phase-H scripts — decided by
 * the app's own `pickSessionLabel()` (CLAUDE.md rule 3a: never by sorting
 * the labels; `TEST-2026-27` sorts above `2026-27`). Reads over an open
 * `postgres` connection.
 */

import { isTestSessionLabel } from "./quarantine-rules.mjs";

export async function readRealSession(sql) {
  const { ACTIVE_SESSION_KEY, pickSessionLabel } = await import("../../../src/platform/config/active-session.ts");
  const [setting] = await sql`select value from public.app_settings where key = ${ACTIVE_SESSION_KEY}`;
  const labels = (await sql`select distinct session_label from public.classes`).map((r) => r.session_label);
  const label = pickSessionLabel({ requested: null, configured: process.env.VPPSONE_SESSION_LABEL, active: setting?.value, labels });
  if (!label) throw new Error("This database has no academic session at all.");
  if (isTestSessionLabel(label)) throw new Error(`The active session is ${label}, a TEST session; refusing to treat it as real.`);
  return label;
}
