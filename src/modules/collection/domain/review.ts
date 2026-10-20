import { z } from "zod";

import { encodeMessage, t, type Localized } from "@/platform/i18n/language";
import type { CollectionField } from "@/modules/collection/domain/fields";

/**
 * What happens to an answer after it arrives.
 *
 * Ported in spirit from `sampark/src/lib/submissions.ts` and `precedence.ts`.
 * Two rules from there are worth stating out loud, because they are the reason
 * the tool was trusted:
 *
 * **An accepted teacher answer outranks every import, forever.** It lives in
 * code rather than as an editable row on purpose — a row can be changed, and
 * no administrative convenience is worth the day a teacher discovers her
 * approved correction was quietly undone by somebody re-importing last term's
 * export.
 *
 * **A repeated phone number is not an error.** Siblings share a parent's
 * number. The office sees a neutral "also on N other children" line so they
 * can tell a shared number from a mistyped one; the teacher sees nothing,
 * because for her it is simply the right answer.
 */

export const submissionStatuses = ["pending", "accepted", "rejected"] as const;
export type SubmissionStatus = (typeof submissionStatuses)[number];

export const submissionStatusLabels: Record<SubmissionStatus, Localized> = {
  pending: t("प्रतीक्षा में", "Waiting"),
  accepted: t("स्वीकृत", "Accepted"),
  rejected: t("अस्वीकृत", "Rejected"),
};

export const recordSources = ["teacher", "office", "import"] as const;
export type RecordSource = (typeof recordSources)[number];

export const recordSourceLabels: Record<RecordSource, Localized> = {
  teacher: t("अध्यापक", "A teacher"),
  office: t("कार्यालय", "The office"),
  import: t("आयात", "An import"),
};

export type Submission = {
  requiresAdmin?: boolean;
  id: string;
  requestId: string;
  requestTitleHi: string;
  requestTitleEn: string;
  classLabel: string;
  studentId: string;
  studentName: string;
  rollNo: string | null;
  fieldId: string;
  fieldKey: string;
  fieldLabelHi: string;
  fieldLabelEn: string;
  value: string | null;
  previousValue: string | null;
  status: SubmissionStatus;
  submittedAt: string;
  submittedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;

  /* ------------------------------------------------ round context (R3.4) */

  /** The round this link belongs to, or null for a one-off request. */
  roundId: string | null;
  /** `class` | `house` | `route` | `list` | `master`. */
  audienceKind: string;
  /** The group as it read on the link: "Class 6", "Chetak", "All classes". */
  audienceLabel: string;
  /**
   * What VPPS One holds for this child and field **now**.
   *
   * Never a replacement for `previousValue`, which is what the teacher was
   * shown and is frozen. This is the other side of the comparison, so the
   * office can see the record moved since she answered (S-07).
   */
  heldNow: string | null;
  /** A newer pending answer for the same child and field has arrived. */
  isSuperseded: boolean;
};

/**
 * Sources a person put there deliberately. An import never overwrites one.
 */
const HUMAN_SOURCES: ReadonlySet<RecordSource> = new Set(["teacher", "office"]);

export type PrecedenceVerdict =
  | { write: true }
  | { write: false; reason: Localized };

/**
 * Whether an incoming value may replace what is held.
 *
 * The ranking is deliberately short: a human beats a machine, and between two
 * humans the later one wins. Everything else — which import is better at which
 * field — is a question this app does not have to answer, because it does not
 * import anything yet. When it does (Phase 7), the table goes below this rule,
 * not above it.
 */
export function mayReplace(input: {
  incoming: RecordSource;
  held: RecordSource | null;
}): PrecedenceVerdict {
  if (input.held === null) return { write: true };
  if (HUMAN_SOURCES.has(input.incoming)) return { write: true };

  if (HUMAN_SOURCES.has(input.held)) {
    return {
      write: false,
      reason: t(
        "यह किसी व्यक्ति ने दर्ज किया था — आयात इसे नहीं बदलेगा।",
        "A person recorded this. An import does not overwrite it.",
      ),
    };
  }

  return { write: true };
}

/**
 * Whether accepting this submission would change anything.
 *
 * "Unchanged" is a real and useful answer — it means a teacher looked at the
 * row and confirmed it — but it is not a change to write, and a review queue
 * that made somebody approve four hundred of them would be a queue nobody
 * finishes. They are accepted in bulk and never shown one at a time.
 */
export function isChange(submission: Pick<Submission, "value" | "previousValue">): boolean {
  const before = (submission.previousValue ?? "").trim();
  const after = (submission.value ?? "").trim();
  if (after === "") return false;
  return before !== after;
}

export function splitByChange(submissions: Submission[]): {
  changes: Submission[];
  confirmations: Submission[];
} {
  return {
    changes: submissions.filter(isChange),
    confirmations: submissions.filter((entry) => !isChange(entry)),
  };
}

/**
 * How many other children hold this same phone number.
 *
 * Shown to the office as a neutral count, never as a warning, and never to the
 * teacher at all. Two siblings is the ordinary case; eleven children on one
 * number is worth a second look, and the office is the one who can tell which
 * is which.
 */
export function sharedPhoneCount(
  value: string | null,
  field: Pick<CollectionField, "inputType">,
  phoneOwners: Map<string, string[]>,
  studentId: string,
): number {
  if (field.inputType !== "tel" || !value) return 0;
  const owners = phoneOwners.get(value) ?? [];
  return owners.filter((owner) => owner !== studentId).length;
}

/** Waiting first, then newest — the order the office works down. */
export function byReviewOrder(a: Submission, b: Submission): number {
  if (a.status !== b.status) {
    if (a.status === "pending") return -1;
    if (b.status === "pending") return 1;
  }
  return a.submittedAt < b.submittedAt ? 1 : -1;
}

export function pendingCount(submissions: Submission[]): number {
  return submissions.filter((entry) => entry.status === "pending").length;
}

/**
 * What a decision did, in one sentence, for the person who pressed the button.
 *
 * Every number is said, and so is every refusal by name: "decided 3" over a
 * batch of five, with nothing about the other two, is the queue lying by
 * omission.
 */
export function decisionSentence(receipt: {
  accept: boolean;
  decided: number;
  recorded: number;
  confirmed: number;
  alreadyDecided: number;
  superseded: number;
  recordMoved: number;
}): Localized {
  const hi: string[] = [];
  const en: string[] = [];
  if (receipt.accept) {
    hi.push(`${receipt.decided} स्वीकृत — ${receipt.recorded} रिकॉर्ड में दर्ज, ${receipt.confirmed} पहले जैसे।`);
    en.push(`Accepted ${receipt.decided}: ${receipt.recorded} recorded, ${receipt.confirmed} confirmed as they were.`);
  } else {
    hi.push(`${receipt.decided} अस्वीकृत।`);
    en.push(`Rejected ${receipt.decided}.`);
  }
  if (receipt.alreadyDecided > 0) {
    hi.push(`${receipt.alreadyDecided} पर किसी और ने पहले फ़ैसला कर दिया था — उनका फ़ैसला रहेगा।`);
    en.push(`${receipt.alreadyDecided} had already been decided by somebody else; theirs stands.`);
  }
  if (receipt.superseded > 0) {
    hi.push(`${receipt.superseded} नहीं लिए गए — उसी बच्चे का नया जवाब इंतज़ार में है।`);
    en.push(`${receipt.superseded} not taken: a newer answer for the same child is waiting.`);
  }
  if (receipt.recordMoved > 0) {
    hi.push(`${receipt.recordMoved} नहीं लिए गए — जवाब के बाद रिकॉर्ड बदल चुका है; दोनों देखकर "नया मान बदलें" चुनें।`);
    en.push(`${receipt.recordMoved} not taken: the record changed after the answer. Look at both, then choose "Replace the newer value".`);
  }
  return t(hi.join(" "), en.join(" "));
}

export const decideSchema = z.object({
  submissionIds: z.array(z.uuid()).min(1, {
    message: encodeMessage(t("कुछ चुनें", "Choose something to decide")),
  }),
  accept: z.boolean(),
  /** Minted by the form, so a lost answer is asked about, never decided twice. */
  commandId: z.uuid(),
  /** Accept even though the record moved after she answered — a person who saw both. */
  replaceNewer: z.boolean(),
  note: z
    .string()
    .trim()
    .max(300, {
      message: encodeMessage(t("टिप्पणी बहुत लंबी है", "That note is too long")),
    })
    .transform((value) => (value === "" ? null : value))
    .nullable(),
});

export type DecideInput = z.infer<typeof decideSchema>;

/* ------------------------------------------------------------ documents */

export const documentKinds = [
  "aadhaar",
  "birth_certificate",
  "transfer_certificate",
  "photo",
  "report",
  "other",
] as const;

export type DocumentKind = (typeof documentKinds)[number];

export const documentKindLabels: Record<DocumentKind, Localized> = {
  aadhaar: t("आधार", "Aadhaar"),
  birth_certificate: t("जन्म प्रमाणपत्र", "Birth certificate"),
  transfer_certificate: t("स्थानांतरण प्रमाणपत्र", "Transfer certificate"),
  photo: t("फ़ोटो", "Photograph"),
  report: t("रिपोर्ट", "Report"),
  other: t("अन्य", "Other"),
};

/** What the bucket accepts. Kept here so the form and the action agree. */
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type StudentDocument = {
  id: string;
  studentId: string;
  kind: DocumentKind;
  storagePath: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  note: string | null;
  uploadedByName: string | null;
  createdAt: string;
};

export function checkDocument(input: {
  contentType: string;
  byteSize: number;
}): { ok: true } | { ok: false; reason: Localized } {
  if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(input.contentType)) {
    return {
      ok: false,
      reason: t(
        "केवल PDF या फ़ोटो भेजें।",
        "Only a PDF or a photograph can be stored here.",
      ),
    };
  }

  if (input.byteSize <= 0 || input.byteSize > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      reason: t(
        "फ़ाइल 10 MB से बड़ी नहीं होनी चाहिए।",
        "That file is larger than 10 MB.",
      ),
    };
  }

  return { ok: true };
}

/**
 * Where the file goes in the bucket.
 *
 * Keyed by child, then by a random name — never by the original filename. Two
 * parents both sending "aadhaar.pdf" must not collide, and a path a stranger
 * could guess is a document a stranger could ask for.
 */
export function documentPath(input: {
  sessionLabel: string;
  studentId: string;
  id: string;
  fileName: string;
}): string {
  const extension = input.fileName.includes(".")
    ? `.${input.fileName.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "")}`
    : "";
  return `${input.sessionLabel}/${input.studentId}/${input.id}${extension}`;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Where a stored value came from, for the badge beside it.
 *
 * `record_source` is plain text in the database, so a value the app has never
 * heard of is a row from a later version rather than corruption. It reads as
 * itself instead of being forced into one of the three known labels — saying
 * "an import" about something that was not one is worse than saying a word
 * nobody recognises.
 */
export function recordSourceLabel(source: string): Localized {
  return (
    recordSourceLabels[source as RecordSource] ?? { hi: source, en: source }
  );
}

/**
 * Why a line in a child's record history reads the way it does (P10). Null
 * for an ordinary write, which needs no note.
 */
export function recordChangeNote(change: { outcome: "written" | "blocked"; reason: string | null }): Localized | null {
  if (change.outcome === "blocked") {
    return change.reason === "human_value"
      ? t("लागू नहीं हुआ — किसी व्यक्ति का दर्ज मान रखा गया", "Not applied: a value a person recorded is kept")
      : change.reason === "other_source"
        ? t("लागू नहीं हुआ — यह किसी दूसरे आयात ने दर्ज किया था", "Not applied: a different import recorded this")
        : t("लागू नहीं हुआ", "Not applied");
  }
  if (change.reason === "held_before_history") {
    return t("बदलाव रखे जाने से पहले से दर्ज", "Held before changes were kept");
  }
  if (change.reason === "confirmed_by_person") {
    return t("किसी व्यक्ति ने यही मान पक्का किया", "The same value, confirmed by a person");
  }
  return null;
}

/* ------------------------------------------------------- bulk decisions */

/**
 * Whether one pending change may go into a bulk decision (D-263).
 *
 * The notes (§7) asked for useful bulk approval "with selected records,
 * fields and conflicts visible", and no unexplained Approve all. So a bulk
 * decision covers only rows the reviewer ticked, and two kinds of row are
 * never in one:
 *
 *  - **conflict**: the record moved after the answer was given and the answer
 *    differs from what is held now. Accepting it would revert somebody, so it
 *    is decided on its own, where "Accept and replace the newer value" is.
 *  - **superseded**: a newer answer for the same child and field waits, so
 *    this one can only be rejected on its own.
 */
export type BulkEligibility = "ok" | "conflict" | "superseded";

export function bulkEligibility(entry: Pick<Submission, "isSuperseded" | "previousValue" | "heldNow" | "value">): BulkEligibility {
  if (entry.isSuperseded) return "superseded";
  const shown = entry.previousValue?.trim() || null;
  const held = entry.heldNow?.trim() || null;
  const value = entry.value?.trim() || null;
  if (held !== null && shown !== held && held !== value) return "conflict";
  return "ok";
}
