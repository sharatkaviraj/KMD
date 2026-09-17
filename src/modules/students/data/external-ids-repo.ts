import "server-only";

import { verifiedOrigin, type AppId } from "@/platform/config/app-origins";
import { createAdminClient } from "@/platform/supabase/admin";
import {
  mappingFor,
  type ExternalStudentId,
} from "@/modules/students/domain/external-ids";

/**
 * Which child in another app is this child (S-10).
 *
 * Service-role, because the mapping is read while rendering a student card and
 * a staff cookie cannot see `public.students` at all (D-32). The table itself
 * is `vppsone`'s own, so the choice is about the join, not about permission.
 */

type Row = {
  app_id: string;
  external_id: string;
  student_id: string;
  source_environment: string;
  matched_on: string | null;
};

const toMapping = (row: Row): ExternalStudentId => ({
  appId: row.app_id as AppId,
  externalId: row.external_id,
  studentId: row.student_id,
  // Anything that is not "live" is a dataset this app must not deep-link from,
  // which is exactly what "dev" already means to `mappingApplies`.
  sourceEnvironment: row.source_environment === "live" ? "live" : "dev",
  matchedOn: row.matched_on,
});

/**
 * The other app's id for one child, or null.
 *
 * Null covers every reason: no row, a row matched in a different dataset, and
 * two rows where there should be one. The caller cannot tell them apart on
 * purpose — all three mean "send them to the search box", and a caller that
 * could distinguish them would eventually treat one of them as a link.
 */
export async function externalIdFor(
  appId: AppId,
  studentId: string,
): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("external_student_ids")
    .select("app_id, external_id, student_id, source_environment, matched_on")
    .eq("app_id", appId)
    .eq("student_id", studentId)
    .returns<Row[]>();

  // **Never throws.** This decorates a link on a screen whose job is something
  // else; a missing mapping degrades to search, and so does a failed read.
  // Turning a card into an error page over a nice-to-have would be the wrong
  // trade in both directions.
  if (error) return null;

  const reading = verifiedOrigin("vppsone").environment;
  const mapping = mappingFor((data ?? []).map(toMapping), appId, studentId, reading);

  return mapping?.externalId ?? null;
}

/**
 * The same, for a list — one read rather than one per row.
 *
 * Returns a Map keyed by `public.students.id`, missing every child with no
 * usable mapping.
 */
export async function externalIdsFor(
  appId: AppId,
  studentIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (studentIds.length === 0) return out;

  const { data, error } = await createAdminClient()
    .from("external_student_ids")
    .select("app_id, external_id, student_id, source_environment, matched_on")
    .eq("app_id", appId)
    .in("student_id", [...studentIds])
    .returns<Row[]>();

  if (error) return out;

  const reading = verifiedOrigin("vppsone").environment;
  const mappings = (data ?? []).map(toMapping);

  for (const studentId of studentIds) {
    const mapping = mappingFor(mappings, appId, studentId, reading);
    if (mapping) out.set(studentId, mapping.externalId);
  }

  return out;
}
