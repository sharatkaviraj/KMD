import { describe, expect, it } from "vitest";

import {
  MASTER_AUDIENCE_LABEL,
  audienceKindLabel,
  audienceKinds,
  emptyAudience,
  groupCount,
  isAudienceEmpty,
  isAudienceKind,
  isChangeAgainstSnapshot,
  isFrozenSelection,
  narrowedBy,
  parseAudience,
  snapshotIsStale,
  type Audience,
  type GroupScope,
} from "@/modules/collection/domain/audience";

/**
 * Who a round asks, and what the people asked were shown.
 *
 * Two families of test, and they fail in opposite directions. An audience that
 * is read too widely sends five hundred messages nobody asked for; a snapshot
 * that quietly follows today's record is B-07 wearing the shape of a feature —
 * every comparison still passes, and every one of them is against a value the
 * teacher never saw.
 */

const audience = (over: Partial<Audience>): Audience => ({
  ...emptyAudience,
  ...over,
});

const scope = (kind: GroupScope["kind"], label: string): GroupScope => ({
  kind,
  label,
  classId: null,
});

describe("reading an audience out of jsonb", () => {
  it("survives an empty column", () => {
    expect(parseAudience({})).toEqual(emptyAudience);
    expect(parseAudience(null)).toEqual(emptyAudience);
    expect(parseAudience(undefined)).toEqual(emptyAudience);
  });

  it("does not trip over a column that is not an object at all", () => {
    expect(parseAudience("class")).toEqual(emptyAudience);
    expect(parseAudience(42)).toEqual(emptyAudience);
    expect(parseAudience([1, 2, 3])).toEqual(emptyAudience);
  });

  it("keeps what it recognises", () => {
    expect(
      parseAudience({
        classIds: ["c6", "c7"],
        houses: ["Rana Pratap"],
        gaps: [{ fieldKey: "guardian_phone" }],
        search: "  Sharma ",
      }),
    ).toEqual(
      audience({
        classIds: ["c6", "c7"],
        houses: ["Rana Pratap"],
        gaps: [{ fieldKey: "guardian_phone" }],
        search: "  Sharma ",
      }),
    );
  });

  it("drops entries of the wrong shape instead of carrying them", () => {
    const parsed = parseAudience({
      studentIds: ["a", 7, null, "b"],
      gaps: [{ fieldKey: "phone" }, { field: "phone" }, "phone", null],
      notes: { a: "uncle's number", b: 7, c: "   ", d: "blurred" },
    });

    expect(parsed.studentIds).toEqual(["a", "b"]);
    expect(parsed.gaps).toEqual([{ fieldKey: "phone" }]);
    expect(parsed.notes).toEqual({ a: "uncle's number", d: "blurred" });
  });

  it("only ever drops, because dropping narrows", () => {
    // The direction matters and is the whole reason this parser is tolerant.
    // A value it cannot read makes the send smaller; a parser that guessed
    // could make it bigger, and that is the one thing it must never do.
    const parsed = parseAudience({ allEnrolled: "yes", classIds: "c6" });

    expect(parsed.allEnrolled).toBe(false);
    expect(parsed.classIds).toEqual([]);
    expect(isAudienceEmpty(parsed)).toBe(true);
  });

  it("reads `from` back without letting it resolve anything", () => {
    const parsed = parseAudience({
      studentIds: ["a", "b"],
      from: { classIds: ["c6"], gaps: [{ fieldKey: "phone" }], studentIds: ["x"] },
    });

    expect(parsed.studentIds).toEqual(["a", "b"]);
    expect(parsed.from?.classIds).toEqual(["c6"]);
    // `from` is what the round's page says out loud. Carrying a student list
    // inside it would be a second, stale audience nobody meant to keep.
    expect(parsed.from).not.toHaveProperty("studentIds");
    expect(parsed.from).not.toHaveProperty("from");
  });
});

describe("what an audience covers", () => {
  it("counts an audience with nothing set as nobody", () => {
    // **A missing filter must never widen the blast radius.** The failure mode
    // of a half-built audience is an empty round, not one that goes to the
    // whole school.
    expect(isAudienceEmpty(emptyAudience)).toBe(true);
  });

  it("counts `allEnrolled` as the deliberate way to say everybody", () => {
    expect(isAudienceEmpty(audience({ allEnrolled: true }))).toBe(false);
  });

  it("counts any one dimension as an audience", () => {
    expect(isAudienceEmpty(audience({ classIds: ["c6"] }))).toBe(false);
    expect(isAudienceEmpty(audience({ houses: ["Chetak"] }))).toBe(false);
    expect(isAudienceEmpty(audience({ routeIds: ["r1"] }))).toBe(false);
    expect(isAudienceEmpty(audience({ search: "Sharma" }))).toBe(false);
  });

  it("does not count whitespace as a search", () => {
    expect(isAudienceEmpty(audience({ search: "   " }))).toBe(true);
  });

  it("counts a gaps-only audience, because a gap can only narrow", () => {
    expect(isAudienceEmpty(audience({ gaps: [{ fieldKey: "phone" }] }))).toBe(false);
  });

  it("counts an explicit list even when it names one child", () => {
    expect(isAudienceEmpty(audience({ studentIds: ["a"] }))).toBe(false);
    expect(isFrozenSelection(audience({ studentIds: ["a"] }))).toBe(true);
    expect(isFrozenSelection(emptyAudience)).toBe(false);
  });

  // Two classes are one dimension; two gaps are two reasons.
  it("says how many dimensions are narrowing it", () => {
    expect(narrowedBy(emptyAudience)).toBe(0);
    expect(narrowedBy(audience({ allEnrolled: true }))).toBe(0);
    expect(
      narrowedBy(
        audience({
          classIds: ["c6", "c7"],
          houses: ["Chetak"],
          gaps: [{ fieldKey: "phone" }, { fieldKey: "dob" }],
        }),
      ),
    ).toBe(4);
  });
});

describe("the kinds a link can be scoped to", () => {
  it.each(audienceKinds)("%s is a kind the app knows", (kind) => {
    expect(isAudienceKind(kind)).toBe(true);
  });

  it("does not claim to know a kind it has never heard of", () => {
    expect(isAudienceKind("hostel")).toBe(false);
  });

  it("reads an unknown kind back as itself rather than throwing", () => {
    // A row written by a later version is history, not corruption. A reader
    // that threw on it would turn one new feature into a dead review screen.
    expect(audienceKindLabel("hostel")).toEqual({ hi: "hostel", en: "hostel" });
  });

  it("labels every kind it knows in both languages", () => {
    for (const kind of audienceKinds) {
      const label = audienceKindLabel(kind);
      expect(label.hi).not.toBe("");
      expect(label.en).not.toBe("");
      // The fallback returns the raw value for both halves. A real label never
      // does, so this is what catches a kind added without a message pair.
      expect(label.hi).not.toBe(label.en);
    }
  });

  it("keeps the master label constant, because the unique index depends on it", () => {
    // `(round_id, audience_kind, audience_label)` is unique, so a fixed label
    // is what makes "one master link per round" a database guarantee rather
    // than something a double-tapped Resume can get past.
    expect(MASTER_AUDIENCE_LABEL).toBe("All classes");
  });
});

describe("how many links a round will mint", () => {
  it("counts the scopes, not the classes that were ticked", () => {
    // An uploaded list of forty children spread over six classes is six
    // links, and nothing but resolving the roster can say so — which is why
    // this counts what came back rather than what was chosen.
    expect(
      groupCount([scope("class", "Class 6"), scope("class", "Class 7")]),
    ).toBe(2);
  });

  it("counts one master link however many classes it covers", () => {
    expect(groupCount([scope("master", MASTER_AUDIENCE_LABEL)])).toBe(1);
  });

  it("counts a repeated scope once", () => {
    // Two rows for one group is what the unique index refuses at the database.
    // Counting them twice would promise a message that is never sent.
    expect(
      groupCount([scope("class", "Class 6"), scope("class", "Class 6")]),
    ).toBe(1);
  });

  it("tells two kinds with the same label apart", () => {
    // A house and a class could both be called "6". They are two links.
    expect(groupCount([scope("class", "6"), scope("house", "6")])).toBe(2);
  });

  it("counts nothing as nothing", () => {
    expect(groupCount([])).toBe(0);
  });
});

describe("whether an answer is a change", () => {
  const member = { snapshot: { phone: "9800000001", aadhaar: null } };

  it("is a change when the answer differs from what was shown", () => {
    expect(isChangeAgainstSnapshot(member, "phone", "9800000002")).toBe(true);
  });

  it("is not a change when the answer matches what was shown", () => {
    expect(isChangeAgainstSnapshot(member, "phone", "9800000001")).toBe(false);
  });

  it("is a change when we held nothing and she typed something", () => {
    expect(isChangeAgainstSnapshot(member, "aadhaar", "111122223333")).toBe(true);
  });

  it("treats a blank as no answer, never as an erase (D-72)", () => {
    expect(isChangeAgainstSnapshot(member, "phone", "")).toBe(false);
    expect(isChangeAgainstSnapshot(member, "phone", null)).toBe(false);
  });

  it("treats a field that was never on the link as held-nothing", () => {
    expect(isChangeAgainstSnapshot(member, "house", "Chetak")).toBe(true);
    expect(isChangeAgainstSnapshot(member, "house", null)).toBe(false);
  });

  it("compares against the snapshot, not against today's record", () => {
    // The whole of S-02 in one assertion. The office corrected the number
    // after the link went out; she confirmed the old one. That is a change,
    // and a queue that reports agreement here has lost the correction.
    const shown = { snapshot: { phone: "9800000001" } };
    const correctedSince = "9800000009";

    expect(isChangeAgainstSnapshot(shown, "phone", "9800000001")).toBe(false);
    expect(snapshotIsStale(shown, "phone", correctedSince)).toBe(true);
  });
});

describe("whether the record moved after the link went out", () => {
  const member = { snapshot: { phone: "9800000001", aadhaar: null } };

  it("is not stale while the record still matches", () => {
    expect(snapshotIsStale(member, "phone", "9800000001")).toBe(false);
  });

  it("is stale once the record has been corrected", () => {
    expect(snapshotIsStale(member, "phone", "9800000002")).toBe(true);
  });

  it("is stale when the record was filled in after the ask", () => {
    expect(snapshotIsStale(member, "aadhaar", "111122223333")).toBe(true);
  });

  it("is stale when the record was cleared after the ask", () => {
    expect(snapshotIsStale(member, "phone", null)).toBe(true);
  });

  it("holds nothing against nothing", () => {
    expect(snapshotIsStale(member, "aadhaar", null)).toBe(false);
    expect(snapshotIsStale(member, "never-asked", null)).toBe(false);
  });
});
