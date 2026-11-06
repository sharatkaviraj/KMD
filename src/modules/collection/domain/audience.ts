import * as m from "@/messages/pairs";
import type { Localized } from "@/platform/i18n/language";

/**
 * Who a round is asking about, and what each of its links is scoped to.
 *
 * **Two different things, and conflating them is a bug this file already made
 * once.** An *audience* is the selection — "classes 6 to 8, Rana Pratap house,
 * the ones with no phone number". A *scope* is what one link covers, because a
 * round fans out to one link per group. SamPark keeps them apart (`Audience`
 * and `GroupScope` in `students.ts` / `fanout.ts`) and so does the schema:
 * `collection_rounds.audience` is the selection, `collection_requests`'
 * `audience_kind` / `audience_label` are the scope.
 *
 * Ported from SamPark `830548c` (`src/lib/students.ts`), including the reading
 * rule below, which is the part that is easy to get backwards.
 *
 * Pure: what an audience *is*. Resolving one against real children is
 * `data/rounds-repo.ts`.
 */

/* ------------------------------------------------------- the selection */

/** A gap filter: "only the children we are missing this for". */
export type AudienceGap = { fieldKey: string };

/**
 * Who a round is asking about.
 *
 * **OR within a dimension, AND across them.** `{classIds: [6,7,8], houses:
 * ["Rana Pratap"]}` means those three classes *and* that house, not their
 * union — which is what the office means by "classes 6 to 8, Rana Pratap
 * house". The union reading quietly sends to the whole school.
 *
 * `allEnrolled` is the deliberate way to say "everyone". An audience with no
 * dimension set and no `allEnrolled` selects **nobody**: a missing filter must
 * never widen the blast radius, so the failure mode of a half-built audience
 * is an empty round rather than one that goes to five hundred children.
 */
export type Audience = {
  classIds: readonly string[];
  houses: readonly string[];
  routeIds: readonly string[];
  /** Free text, matched the way the directory matches it. */
  search: string;
  /**
   * Narrow any of the above to children missing these fields.
   *
   * A gap only ever narrows, so a gaps-only audience is a strict subset of
   * `allEnrolled` and cannot widen anything. The *reason* a teacher is being
   * shown nine of her forty-six children has to travel with the link (S-03) —
   * which is why this is part of the audience rather than applied afterwards.
   */
  gaps: readonly AudienceGap[];
  /** The deliberate "everybody on the roll". */
  allEnrolled: boolean;
  /**
   * An explicit list of children. **When it is set it is the whole audience**
   * and every dimension above is ignored.
   *
   * Two things produce one: an uploaded ask list, and a round freezing what it
   * resolved. ANDing a frozen list back together with the gaps it came from is
   * exactly the nondeterminism freezing exists to remove — six numbers arrive
   * overnight, Resume re-resolves, and it finishes a round with a smaller set
   * than the links it is completing.
   */
  studentIds: readonly string[];
  /**
   * What was actually chosen, when `studentIds` was frozen from it.
   *
   * **Never read when resolving.** It exists so the round's page can still say
   * "no phone number, Classes 6 to 8" rather than "504 children", and so a
   * later reader can tell a frozen gap round from an uploaded list.
   */
  from?: Omit<Audience, "studentIds" | "from"> | null;
  /**
   * A line about one child, by student id, from an uploaded list.
   *
   * **Explains, never resolves** — a note for a child the audience does not
   * cover is ignored, not an extra recipient. It lives here rather than only
   * on the creation input so a Resume days later still has the notes for the
   * groups it has yet to create.
   */
  notes: Readonly<Record<string, string>>;
};

export const emptyAudience: Audience = {
  classIds: [],
  houses: [],
  routeIds: [],
  search: "",
  gaps: [],
  allEnrolled: false,
  studentIds: [],
  from: null,
  notes: {},
};

const strings = (input: unknown): string[] =>
  Array.isArray(input)
    ? input.filter((entry): entry is string => typeof entry === "string")
    : [];

const gapsIn = (input: unknown): AudienceGap[] =>
  Array.isArray(input)
    ? input
        .map((entry) =>
          entry &&
          typeof entry === "object" &&
          typeof (entry as AudienceGap).fieldKey === "string"
            ? { fieldKey: (entry as AudienceGap).fieldKey }
            : null,
        )
        .filter((entry): entry is AudienceGap => entry !== null)
    : [];

const notesIn = (input: unknown): Record<string, string> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
};

/**
 * Read an audience back out of the round's jsonb, tolerating anything.
 *
 * Tolerant rather than strict, in one direction only: a value it cannot read
 * is dropped, and dropping narrows. A round nobody can parse is a round the
 * office cannot close, so throwing here would turn one bad write into a dead
 * screen — but a parser that *guessed* could widen a send, which is the one
 * thing it must never do.
 */
export function parseAudience(value: unknown): Audience {
  const raw = (value ?? {}) as Record<string, unknown>;

  const audience: Audience = {
    classIds: strings(raw.classIds),
    houses: strings(raw.houses),
    routeIds: strings(raw.routeIds),
    search: typeof raw.search === "string" ? raw.search : "",
    gaps: gapsIn(raw.gaps),
    allEnrolled: raw.allEnrolled === true,
    studentIds: strings(raw.studentIds),
    notes: notesIn(raw.notes),
    from: null,
  };

  if (raw.from && typeof raw.from === "object") {
    // Dropped rather than carried: `from` is what the round's page says out
    // loud, and a student list nested inside it is a second, stale audience
    // that something would eventually resolve.
    const nested = parseAudience(raw.from);
    delete (nested as Partial<Audience>).studentIds;
    delete (nested as Partial<Audience>).from;
    audience.from = nested;
  }

  return audience;
}

/**
 * Whether this audience selects nobody.
 *
 * The guard the "missing filter must not widen" rule needs: an audience with
 * nothing set is empty, and the caller refuses rather than resolving it into
 * the whole school.
 */
export function isAudienceEmpty(audience: Audience): boolean {
  if (audience.allEnrolled) return false;
  // An explicit list is an audience even when it names one child.
  if (audience.studentIds.length > 0) return false;
  // A gap narrows, so a gaps-only audience is a strict subset of everybody.
  if (audience.gaps.length > 0) return false;

  return (
    audience.classIds.length === 0 &&
    audience.houses.length === 0 &&
    audience.routeIds.length === 0 &&
    audience.search.trim() === ""
  );
}

/** Whether the selection has already been frozen into a list of children. */
export function isFrozenSelection(audience: Audience): boolean {
  return audience.studentIds.length > 0;
}

/**
 * How many dimensions are narrowing this audience.
 *
 * Shown beside the count, because "504 children" and "504 children, no filter
 * at all" are different news.
 */
export function narrowedBy(audience: Audience): number {
  return (
    (audience.classIds.length > 0 ? 1 : 0) +
    (audience.houses.length > 0 ? 1 : 0) +
    (audience.routeIds.length > 0 ? 1 : 0) +
    (audience.search.trim() !== "" ? 1 : 0) +
    audience.gaps.length
  );
}

/* ----------------------------------------------- what one link is scoped to */

/**
 * The kinds of group a round's links are scoped to.
 *
 * Not a TypeScript union used as a database enum: `audience_kind` is text on
 * purpose, so a fifth kind costs nothing (see the migration). This list is
 * what the app knows *today*, and `audienceKindLabel()` handles a value it has
 * never heard of rather than throwing at a reader.
 */
export const audienceKinds = ["class", "house", "route", "list", "master"] as const;

export type AudienceKind = (typeof audienceKinds)[number];

export function isAudienceKind(value: string): value is AudienceKind {
  return (audienceKinds as readonly string[]).includes(value);
}

/** One link's group: what it covers, and how that reads. */
export type GroupScope = {
  kind: AudienceKind;
  /** "Class 6", "Rana Pratap", "Amet City", "All classes". */
  label: string;
  /** The class this link's children are in, when the scope has one. */
  classId: string | null;
};

/**
 * The constant label every master link carries, in every round.
 *
 * **It is a constant and that is load-bearing.** The unique index is on
 * `(round_id, audience_kind, audience_label)`, so a fixed label is what makes
 * "one master link per round" a database guarantee rather than a check
 * somebody remembers to write. A double-tapped Resume hits the index.
 */
export const MASTER_AUDIENCE_LABEL = "All classes";

/**
 * What a group is called on screen and in the message.
 *
 * A kind the app has never heard of reads as its own value rather than
 * throwing: a row written by a later version is history, not corruption.
 */
export function audienceKindLabel(kind: string): Localized {
  switch (kind) {
    case "class":
      return m.audienceClass;
    case "house":
      return m.audienceHouse;
    case "route":
      return m.audienceRoute;
    case "list":
      return m.audienceList;
    case "master":
      return m.audienceMaster;
    default:
      return { hi: kind, en: kind };
  }
}

/**
 * How many links a set of scopes will mint.
 *
 * Shown before anything is created, because "this will send 19 messages" is
 * the fact somebody needs before pressing the button, not after. It counts
 * **scopes**, not selected classes: an uploaded list of forty children spread
 * over six classes is six links, and only resolving the roster can say so.
 */
export function groupCount(scopes: readonly GroupScope[]): number {
  return new Set(scopes.map((scope) => `${scope.kind}|${scope.label}`)).size;
}

/* --------------------------------------------------------- the snapshot */

/**
 * What the teacher was shown, per child, per field.
 *
 * Stored on the member row and **never re-derived**. Every answer is compared
 * against this to decide what changed, so "old → new" on the review screen
 * refers to what she actually saw — however many times the office has
 * corrected the record since (S-02, B-07).
 */
export type MemberSnapshot = Record<string, string | null>;

export type FrozenMember = {
  studentId: string;
  rollNo: string | null;
  snapshot: MemberSnapshot;
  askNote: string | null;
};

/**
 * Whether an answer is a change or a confirmation.
 *
 * Against the **snapshot**, not against today's record. A teacher who confirms
 * a number the office has since corrected has confirmed the old one, and the
 * queue has to be able to say so rather than silently reporting agreement.
 */
export function isChangeAgainstSnapshot(
  member: Pick<FrozenMember, "snapshot">,
  fieldKey: string,
  answer: string | null,
): boolean {
  const held = member.snapshot[fieldKey] ?? null;
  const given = answer === "" ? null : answer;

  // Blank means no change, never erase (D-72).
  if (given === null) return false;

  return given !== (held ?? null);
}

/**
 * Whether the record has moved since this link went out.
 *
 * The thing a stale review has to notice: the teacher answered a question
 * about a value that is no longer the current one, so accepting her answer is
 * a decision somebody should take deliberately rather than by default (S-07).
 */
export function snapshotIsStale(
  member: Pick<FrozenMember, "snapshot">,
  fieldKey: string,
  currentValue: string | null,
): boolean {
  const held = member.snapshot[fieldKey] ?? null;
  return (currentValue ?? null) !== held;
}
