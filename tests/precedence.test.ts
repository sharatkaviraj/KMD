import { describe, expect, it } from "vitest";

import {
  keyOf,
  stalenessOf,
  supersededIds,
  type Answerish,
} from "@/modules/collection/domain/precedence";

/**
 * Two things that go wrong between a teacher answering and the office
 * accepting, both of which look like nothing at all.
 *
 * A stale answer renders as an ordinary row with a reasonable value in it, and
 * accepting it reverts a correction somebody made on purpose. A superseded one
 * renders as a *second* ordinary row, and the office adjudicates a question it
 * cannot see the shape of.
 */

const answer = (over: Partial<Answerish> = {}): Answerish => ({
  id: "a1",
  studentId: "s1",
  fieldId: "f1",
  status: "pending",
  submittedAt: "2026-04-01T10:00:00Z",
  ...over,
});

describe("whether the record moved under an answer", () => {
  it("is not stale while the record still says what she was shown", () => {
    expect(stalenessOf({ shown: "9800000001", heldNow: "9800000001" })).toEqual({
      stale: false,
    });
  });

  it("is stale once the record has been corrected", () => {
    // **S-07.** Neither value is wrong and this is not an error: it is a
    // decision somebody has to take deliberately rather than by default, so
    // both values come back and nothing is refused.
    const verdict = stalenessOf({ shown: "9800000001", heldNow: "9800000009" });

    expect(verdict.stale).toBe(true);
    expect(verdict.stale && verdict.shown).toBe("9800000001");
    expect(verdict.stale && verdict.heldNow).toBe("9800000009");
    expect(verdict.stale && verdict.note.hi).not.toBe("");
    expect(verdict.stale && verdict.note.en).not.toBe("");
  });

  it("is stale when the record was filled in after the ask", () => {
    expect(stalenessOf({ shown: null, heldNow: "9800000009" }).stale).toBe(true);
  });

  it("is not stale when we now hold nothing at all", () => {
    // **There has to be something to conflict with.** The warning exists to
    // stop the office silently reverting somebody correction; with no current
    // value there is no correction to undo, and accepting simply fills a hole.
    //
    // Flagging this put a warning on four rows out of four in the dev fixture
    // - every answer whose shown value came from the fee column - and a flag
    // on every row is a flag nobody reads.
    expect(stalenessOf({ shown: "9800000001", heldNow: null }).stale).toBe(false);
  });

  it("holds nothing against nothing", () => {
    expect(stalenessOf({ shown: null, heldNow: null }).stale).toBe(false);
  });

  it("does not call whitespace a change", () => {
    // An imported empty cell arrives as "" and a hand-typed one as " ". A
    // queue that flagged those would flag everything, and a flag on every row
    // is a flag nobody reads.
    expect(stalenessOf({ shown: "  ", heldNow: null }).stale).toBe(false);
    expect(stalenessOf({ shown: " 9800000001 ", heldNow: "9800000001" }).stale).toBe(
      false,
    );
  });
});

describe("which answers a later one has overtaken", () => {
  it("supersedes the earlier of two answers for one child and field", () => {
    // The ordinary case, not an edge: the office asks in April, half come
    // back, and it asks the stragglers again in June.
    const april = answer({ id: "april", submittedAt: "2026-04-01T10:00:00Z" });
    const june = answer({ id: "june", submittedAt: "2026-06-01T10:00:00Z" });

    expect([...supersededIds([april, june])]).toEqual(["april"]);
  });

  it("does not care which order they were read in", () => {
    const april = answer({ id: "april", submittedAt: "2026-04-01T10:00:00Z" });
    const june = answer({ id: "june", submittedAt: "2026-06-01T10:00:00Z" });

    expect([...supersededIds([june, april])]).toEqual(["april"]);
  });

  it("leaves answers about different fields alone", () => {
    expect(
      supersededIds([answer({ id: "a" }), answer({ id: "b", fieldId: "f2" })]).size,
    ).toBe(0);
  });

  it("leaves answers about different children alone", () => {
    expect(
      supersededIds([answer({ id: "a" }), answer({ id: "b", studentId: "s2" })]).size,
    ).toBe(0);
  });

  it("never supersedes a decision somebody already took", () => {
    // **Rewriting an accepted row would make the audit trail a record of what
    // the app thinks rather than of what anybody did.**
    const accepted = answer({
      id: "accepted",
      status: "accepted",
      submittedAt: "2026-04-01T10:00:00Z",
    });
    const later = answer({ id: "later", submittedAt: "2026-06-01T10:00:00Z" });

    expect([...supersededIds([accepted, later])]).toEqual([]);
  });

  it("supersedes nothing when two answers cannot be ordered", () => {
    // Picking one by row order is how a queue starts depending on which way a
    // query happened to sort. Neither wins, and the office sees both.
    const one = answer({ id: "one" });
    const two = answer({ id: "two" });

    expect(supersededIds([one, two]).size).toBe(0);
  });

  it("supersedes all but the newest of three", () => {
    const rows = [
      answer({ id: "first", submittedAt: "2026-04-01T10:00:00Z" }),
      answer({ id: "second", submittedAt: "2026-05-01T10:00:00Z" }),
      answer({ id: "third", submittedAt: "2026-06-01T10:00:00Z" }),
    ];

    expect([...supersededIds(rows)].sort()).toEqual(["first", "second"]);
  });

  it("supersedes nothing in nothing", () => {
    expect(supersededIds([]).size).toBe(0);
  });

  it("keys a child and a field together", () => {
    expect(keyOf({ studentId: "s1", fieldId: "f1" })).toBe("s1|f1");
    expect(keyOf({ studentId: "s1", fieldId: "f1" })).not.toBe(
      keyOf({ studentId: "s1", fieldId: "f2" }),
    );
  });
});
