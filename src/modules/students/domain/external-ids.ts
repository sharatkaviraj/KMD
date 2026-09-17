import type { AppId, OriginEnvironment } from "@/platform/config/app-origins";

/**
 * Which child in another app is this child.
 *
 * **S-10.** SamPark keys its students on its own text id — `S1001`, from its
 * own imports — and there is no arithmetic that turns `public.students.id`
 * into one. So `apps.ts` has never emitted a SamPark deep link: it hands the
 * reader SamPark's search box, because guessing by name is the one thing
 * PARITY.md says never to do.
 *
 * Pure: what a mapping is, and the one question worth asking about it — is
 * this row allowed to produce a link right now. The reads are in
 * `data/external-ids-repo.ts`.
 */

export type ExternalStudentId = {
  appId: AppId;
  /** The other app's own id, exactly as it holds it. */
  externalId: string;
  /** `public.students.id` as VPPS One holds it. */
  studentId: string;
  /** The dataset `studentId` belongs to. */
  sourceEnvironment: OriginEnvironment;
  /** `admission_no` | `sr_no` | `hand`, or null for a row from before this. */
  matchedOn: string | null;
};

/**
 * An id as it will be stored and compared.
 *
 * Trimmed and upper-cased, because these arrive from spreadsheets: `s1001`,
 * ` S1001` and `S1001` are one child, and storing all three means the unique
 * index stops meaning anything. Not stripped of punctuation — `S-1001` may
 * genuinely be a different id in a school that issues both, and deciding it is
 * not is the matcher's business, not this function's.
 */
export function normaliseExternalId(value: string): string {
  return value.trim().toUpperCase();
}

/** Whether a string could be an id at all, before a lookup is worth doing. */
export function isExternalId(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64;
}

/**
 * Whether this mapping may be turned into a link, from where we are standing.
 *
 * **The whole safety rule, in one comparison.** VPPS One reads schoolfees-dev
 * and both siblings read live, so a `student_id` means only what it means in
 * the dataset it was matched in. A link built from a dev-matched row while
 * reading live data would not 404 — it would open a different child, quietly,
 * with somebody's name on it. That is worse than the search box.
 *
 * So a mapping is usable only when it was matched in the dataset being read.
 * `apps.ts` applies this *on top of* the existing environment rule, never
 * instead of it: two separate reasons a deep link may not be emitted, and both
 * have to clear.
 */
export function mappingApplies(
  mapping: Pick<ExternalStudentId, "sourceEnvironment">,
  reading: OriginEnvironment,
): boolean {
  return mapping.sourceEnvironment === reading;
}

/**
 * The one mapping for this child in this app, or null.
 *
 * Takes a list rather than a row because a lookup returns what it finds, and
 * "found two" is a real state — a matcher re-run before the unique index
 * existed, or two apps' rows read in one query. Two is treated as none: a link
 * that depends on row order is a link that will one day open the wrong child.
 */
export function mappingFor(
  mappings: readonly ExternalStudentId[],
  appId: AppId,
  studentId: string,
  reading: OriginEnvironment,
): ExternalStudentId | null {
  const found = mappings.filter(
    (row) =>
      row.appId === appId &&
      row.studentId === studentId &&
      mappingApplies(row, reading),
  );

  return found.length === 1 ? found[0] : null;
}
