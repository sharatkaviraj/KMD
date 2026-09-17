import { t, type Localized } from "@/platform/i18n/language";
import type { CollectionField } from "@/modules/collection/domain/fields";

/**
 * "Only the children we are missing this for."
 *
 * **The office almost never wants a whole class.** It wants the nine children
 * whose phone number is blank. Before this, seeing those nine meant asking
 * nineteen teachers about five hundred, and the nine got lost in the five
 * hundred — which is how a gap survives three rounds of asking (S-03).
 *
 * Pure: what "missing" means for one child and one field. Turning that into a
 * query is `data/rounds-repo.ts`, and it is built from *these* rules rather
 * than from a second set written in SQL — the day they were two implementations
 * is the day the preview could show nine children and the round cover eleven.
 */

/**
 * Where a value for a field can come from, for one child.
 *
 * Two sources and a fixed precedence, the same one the link and the review
 * queue use: VPPS One's own accepted answer wins, and the fee app's column is
 * what the school holds otherwise.
 */
export type HeldValue = {
  /** `vppsone.student_records.value` — an answer somebody accepted here. */
  recorded: string | null;
  /** The fee app's own column, when the field names one. */
  fee: string | null;
};

/**
 * What the school currently holds for a child and a field.
 *
 * One function, used by the gap filter, the preview count and the freeze, so
 * "missing" cannot come to mean three different things on three screens.
 */
export function heldValue(value: HeldValue): string | null {
  const own = blankToNull(value.recorded);
  if (own !== null) return own;
  return blankToNull(value.fee);
}

/**
 * Whether this child is a gap for this field.
 *
 * **Blank is missing; anything else is not.** Deliberately not "looks wrong" —
 * a phone number with nine digits is a different problem from no phone number
 * at all, and rolling them together would put a child the office needs to fix
 * itself onto a teacher's list with nothing to tell her which she is looking
 * at. Validity is `validateField`'s job, on the way in.
 */
export function isGap(value: HeldValue): boolean {
  return heldValue(value) === null;
}

/** Trimmed, with the empty string treated as nothing at all. */
function blankToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The fee columns a set of gap filters needs read.
 *
 * Deduplicated, and empty when no chosen field names one — which matters,
 * because `select("id, ")` with a trailing comma is a PostgREST error rather
 * than a smaller read.
 */
export function feeColumnsFor(fields: readonly CollectionField[]): string[] {
  return [
    ...new Set(
      fields
        .map((field) => field.feeColumn)
        .filter((column): column is string => Boolean(column)),
    ),
  ];
}

/**
 * The fields named by a set of gap keys, in the order they were registered.
 *
 * A key naming a field that has been deactivated since the round was written
 * is **dropped, not guessed at**: dropping narrows the audience, and every
 * other reading of an unknown key would widen it (D-150).
 */
export function gapFields(
  fields: readonly CollectionField[],
  keys: readonly string[],
): CollectionField[] {
  const wanted = new Set(keys);
  return fields.filter((field) => wanted.has(field.key));
}

/**
 * Whether a child is a gap for **every** one of these filters.
 *
 * Every, not any, and this is the one that catches people out: "no phone
 * number and no date of birth" selects the children missing *both*, which is a
 * *smaller* set than either alone. It is the same AND-across-dimensions rule
 * the audience follows (D-150), and a round that used "any" would go to more
 * children than the office picked.
 *
 * No filters selects nobody rather than everybody, for the same reason an
 * empty audience does: a missing filter must never widen the blast radius.
 */
export function isGapForAll(
  held: ReadonlyMap<string, HeldValue>,
  keys: readonly string[],
): boolean {
  if (keys.length === 0) return false;
  return keys.every((key) => isGap(held.get(key) ?? { recorded: null, fee: null }));
}

/**
 * How the filter reads in a sentence, for the teacher.
 *
 * **A subset of a class reads as a broken list unless it says why.** A teacher
 * sent nine of her forty-six children with no explanation assumes the link is
 * wrong, and the honest ones ring the office to check — which is the cost this
 * sentence exists to avoid (S-03). Both halves are built, because the teacher
 * surface is bilingual and deriving Hindi from English afterwards is not a
 * thing this app can do.
 */
export function describeGaps(fields: readonly CollectionField[]): Localized | null {
  if (fields.length === 0) return null;

  // **"And", never "or", because the filter is AND.** Two gaps select the
  // children missing *both*, which is the smaller set — and a sentence saying
  // "or" describes a bigger one than the round actually covers. Getting this
  // backwards is not a wording problem: it is a teacher told she is being
  // asked about a different nine children than she is.
  //
  // More than two is counted rather than listed, following SamPark: a
  // four-item list in a WhatsApp message is a sentence nobody reads to the end.
  if (fields.length > 2) {
    return t(
      `${fields.length} जानकारियाँ दर्ज नहीं हैं`,
      `${fields.length} things missing`,
    );
  }

  const hi = fields.map((field) => field.labelHi).filter(Boolean);
  const en = fields.map((field) => field.labelEn).filter(Boolean);

  // A function rather than a message key, for the reason `countOfPair()` is
  // one: the labels are authored by the office, Hindi puts the verb last, and
  // a connector assembled from two translated fragments comes out backwards
  // (D-63).
  return t(`${hi.join(" और ")} दर्ज नहीं है`, `no ${en.join(" and ")} on record`);
}
