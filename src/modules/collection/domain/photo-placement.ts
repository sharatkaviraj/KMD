import { t, type Localized } from "@/platform/i18n/language";
import { idKey } from "@/modules/collection/domain/sampark-import";

/**
 * Which child a photograph is of, from its filename alone (P10c, S-11).
 *
 * Ported from SamPark's `photo-filename.ts` (`tokensOf`, `sanitiseKey`, the
 * joined-pair recovery of an id a filename split, `placeFiles`), with one
 * deliberate change: **SamPark's third tier, matching the child's name inside
 * a class, is not ported.** Plan §11 forbids joining pupils by name, and a
 * wrong match here puts one child's face on another child's record — which no
 * spreadsheet can reveal. A file with no id in its name goes to the tray,
 * where a person places it by looking (D-236).
 *
 * The rule, hardest evidence first:
 *
 *   1. the child's SamPark id (or this app's id), as a whole token;
 *   2. the SR number, as a whole token.
 *
 * More than one child at a tier is a refusal, never a coin toss. Two files in
 * one drop for the same child are both refused — that is somebody's retake,
 * and which photograph is the real one is a person's choice.
 *
 * Nothing here writes anything.
 */

export type PhotoTarget = {
  studentId: string;
  /** SamPark's id for the child, when a mapping exists. */
  externalId: string | null;
  srNo: string | null;
};

export type PhotoMatch =
  | { kind: "matched"; studentId: string; by: "id" | "sr" }
  | { kind: "ambiguous"; studentIds: string[]; why: PhotoAmbiguity }
  | { kind: "none" };

export type PhotoAmbiguity = "several_ids" | "several_srs" | "same_child_twice";

/**
 * Everything in a filename that could be an identifier: split on anything
 * that is not a letter or a digit, after dropping the extension, so
 * `IMG_20260903_S1001 (2).jpeg` yields IMG, 20260903, S1001, 2.
 */
export function tokensOf(filename: string): string[] {
  return filename
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** Letters and digits only, upper-cased — applied to both sides. */
export function sanitiseKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * An id that a filename split in two: `228/12RTE` cannot survive a Windows
 * filename and arrives as "228" and "12RTE". Adjacent pairs recover it; two
 * tokens is as far as this goes, because three would start matching dates.
 */
function joinedPairs(tokens: string[]): string[] {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 1) pairs.push(tokens[i]! + tokens[i + 1]!);
  return pairs;
}

const unique = (ids: string[]) => [...new Set(ids)];

/** Match one filename against one roster — the class or round being worked on, nothing wider. */
export function matchPhotoFilename(filename: string, roster: PhotoTarget[]): PhotoMatch {
  const tokens = tokensOf(filename);
  if (tokens.length === 0 || roster.length === 0) return { kind: "none" };
  const keys = new Set([...tokens, ...joinedPairs(tokens)].map(sanitiseKey).filter(Boolean));

  const byId = roster.filter(
    (target) =>
      keys.has(sanitiseKey(target.studentId)) || (target.externalId !== null && keys.has(sanitiseKey(target.externalId))),
  );
  if (byId.length === 1) return { kind: "matched", studentId: byId[0]!.studentId, by: "id" };
  if (byId.length > 1) return { kind: "ambiguous", studentIds: unique(byId.map((target) => target.studentId)), why: "several_ids" };

  const bySr = roster.filter((target) => {
    const sr = idKey(target.srNo);
    return sr !== null && keys.has(sanitiseKey(sr));
  });
  if (bySr.length === 1) return { kind: "matched", studentId: bySr[0]!.studentId, by: "sr" };
  if (bySr.length > 1) return { kind: "ambiguous", studentIds: unique(bySr.map((target) => target.studentId)), why: "several_srs" };

  return { kind: "none" };
}

export type PlacedPhoto = { filename: string; match: PhotoMatch };

/** Place a whole drop, never two files on one child. Order is the caller's. */
export function placePhotos(filenames: string[], roster: PhotoTarget[]): PlacedPhoto[] {
  const first = filenames.map((filename) => ({ filename, match: matchPhotoFilename(filename, roster) }));
  const claims = new Map<string, number>();
  for (const placed of first) {
    if (placed.match.kind === "matched") claims.set(placed.match.studentId, (claims.get(placed.match.studentId) ?? 0) + 1);
  }
  return first.map((placed) =>
    placed.match.kind === "matched" && (claims.get(placed.match.studentId) ?? 0) > 1
      ? { filename: placed.filename, match: { kind: "ambiguous", studentIds: [placed.match.studentId], why: "same_child_twice" } }
      : placed,
  );
}

export const photoAmbiguityLabels: Record<PhotoAmbiguity, Localized> = {
  several_ids: t("नाम में एक से ज़्यादा बच्चों के नंबर हैं", "The name holds more than one child's id"),
  several_srs: t("नाम में एक से ज़्यादा SR नंबर हैं", "The name holds more than one SR number"),
  same_child_twice: t("इस बच्चे की एक से ज़्यादा फ़ोटो हैं — एक चुनें", "More than one photograph for this child; choose one"),
};

/** The largest side, in pixels, a photograph is stored at. A face on a card needs no more. */
export const PHOTO_MAX_SIDE = 600;
/** Refused above this, before or after shrinking. */
export const PHOTO_MAX_BYTES = 200 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
