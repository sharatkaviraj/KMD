import { t, type Localized } from "@/platform/i18n/language";

/**
 * Two things that can go wrong between a teacher answering and the office
 * accepting, and what to do about each.
 *
 * Both are invisible without this file. The answer is in the queue, the value
 * looks reasonable, and accepting it does something nobody intended.
 *
 * Pure. The reads are `data/submissions-repo.ts`.
 */

/* --------------------------------------------------------------- stale */

/**
 * **She answered a question about a value that has since changed.**
 *
 * A request freezes what the teacher was shown (R3.1), which is what makes
 * "old → new" on the review screen mean anything. But the record underneath
 * carries on: the office corrects a number on Tuesday, the teacher's Monday
 * answer arrives on Wednesday, and accepting it silently reverts Tuesday's
 * correction.
 *
 * Neither value is wrong and this is not an error — it is a decision somebody
 * has to take deliberately rather than by default, which is the whole of S-07.
 * So it is surfaced, with both values, and nothing is refused.
 *
 * **There has to be something to conflict with.** The warning exists to stop
 * the office silently reverting somebody's correction, so "she was shown a
 * number and we hold nothing now" is not stale: accepting simply fills a hole,
 * and there is no correction to undo. Flagging it put a warning on four rows
 * out of four in the dev fixture, and a flag on every row is a flag nobody
 * reads.
 */
export type Staleness =
  | { stale: false }
  | {
      stale: true;
      /** What the teacher was shown when the link went out. */
      shown: string | null;
      /** What the record says now. */
      heldNow: string | null;
      note: Localized;
    };

const trimmed = (value: string | null | undefined): string | null => {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
};

/**
 * Whether the record moved under this answer.
 *
 * Compared against the **frozen** value the submission carries, never against
 * a value re-read now — re-reading is the bug freezing exists to remove, and
 * doing it here would make every answer look current.
 */
export function stalenessOf(input: {
  /** `collection_submissions.previous_value` — frozen at issue. */
  shown: string | null;
  /** What `student_records` (or the fee column) holds today. */
  heldNow: string | null;
}): Staleness {
  const shown = trimmed(input.shown);
  const heldNow = trimmed(input.heldNow);

  if (shown === heldNow) return { stale: false };

  // Nothing held now is a hole to fill, not a correction to revert.
  if (heldNow === null) return { stale: false };

  return {
    stale: true,
    shown,
    heldNow,
    note: t(
      "यह जवाब आने के बाद रिकॉर्ड बदल चुका है — दोनों देखकर तय कीजिए।",
      "The record changed after this answer was given — decide with both in view.",
    ),
  };
}

/* ---------------------------------------------------------- superseded */

/**
 * One answer per child per field, and the office should only be shown one.
 *
 * Two rounds asking the same class for the same thing is the ordinary case,
 * not an edge: the office asks in April, half the answers come back, and it
 * asks the stragglers again in June. A teacher who answers both leaves two
 * pending rows for one child and one field, and a queue that shows both asks
 * the office to adjudicate a question it cannot see the shape of.
 *
 * **The later answer wins, and the earlier one is marked superseded rather
 * than deleted.** Deleted, the queue is tidy and the history is gone; the
 * question "what did she say in April" is a real one when June's answer looks
 * wrong.
 */
export type Answerish = {
  id: string;
  studentId: string;
  fieldId: string;
  status: string;
  submittedAt: string;
};

export function keyOf(answer: Pick<Answerish, "studentId" | "fieldId">): string {
  return `${answer.studentId}|${answer.fieldId}`;
}

/**
 * Which pending answers a later one has overtaken.
 *
 * Only **pending** rows are superseded. An answer somebody already accepted or
 * rejected is a decision that was taken, and rewriting it after the fact would
 * make the audit trail a record of what the app thinks rather than of what
 * anybody did.
 *
 * Ties go to nobody: two submissions with the same timestamp for one child and
 * one field cannot be ordered, and picking one by row order is how the queue
 * starts depending on which way a query happened to sort.
 */
export function supersededIds(answers: readonly Answerish[]): Set<string> {
  const latest = new Map<string, Answerish>();
  const tied = new Set<string>();

  for (const answer of answers) {
    if (answer.status !== "pending") continue;

    const key = keyOf(answer);
    const held = latest.get(key);

    if (!held) {
      latest.set(key, answer);
      continue;
    }

    if (answer.submittedAt === held.submittedAt) {
      tied.add(key);
      continue;
    }

    if (answer.submittedAt > held.submittedAt) latest.set(key, answer);
  }

  const superseded = new Set<string>();

  for (const answer of answers) {
    if (answer.status !== "pending") continue;

    const key = keyOf(answer);
    if (tied.has(key)) continue;

    const winner = latest.get(key);
    if (winner && winner.id !== answer.id) superseded.add(answer.id);
  }

  return superseded;
}

/** How a superseded row reads, so the office knows why it is greyed out. */
export const supersededNote: Localized = t(
  "इसी बच्चे की इसी जानकारी का नया जवाब आ चुका है।",
  "A newer answer for this child and this field has arrived.",
);
