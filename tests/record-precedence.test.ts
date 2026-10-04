import { describe, expect, it } from "vitest";

import { decisionSentence, recordChangeNote } from "@/modules/collection/domain/review";

/**
 * P10: what a decision tells the person who pressed the button, and what a
 * line in a child's record history says about itself.
 */

const none = { decided: 0, recorded: 0, confirmed: 0, alreadyDecided: 0, superseded: 0, recordMoved: 0 };

describe("decisionSentence()", () => {
  it("says what was recorded and what was confirmed as it was", () => {
    const sentence = decisionSentence({ ...none, accept: true, decided: 5, recorded: 2, confirmed: 3 });
    expect(sentence.en).toBe("Accepted 5: 2 recorded, 3 confirmed as they were.");
    expect(sentence.hi).toContain("5 स्वीकृत");
  });

  it("names every refusal, so a batch of five never reads as a clean three", () => {
    const sentence = decisionSentence({
      ...none,
      accept: true,
      decided: 3,
      recorded: 3,
      superseded: 1,
      recordMoved: 1,
    });
    expect(sentence.en).toContain("1 not taken: a newer answer for the same child is waiting.");
    expect(sentence.en).toContain("1 not taken: the record changed after the answer.");
    expect(sentence.en).toContain('"Replace the newer value"');
  });

  it("says somebody else got there first, and that theirs stands", () => {
    const sentence = decisionSentence({ ...none, accept: false, decided: 0, alreadyDecided: 2 });
    expect(sentence.en).toBe("Rejected 0. 2 had already been decided by somebody else; theirs stands.");
  });

  it("keeps both halves in their own script", () => {
    const sentence = decisionSentence({ ...none, accept: true, decided: 1, recorded: 1, superseded: 1, recordMoved: 1, alreadyDecided: 1 });
    expect(/[ऀ-ॿ]/.test(sentence.en)).toBe(false);
    expect(/[ऀ-ॿ]/.test(sentence.hi)).toBe(true);
  });
});

describe("recordChangeNote()", () => {
  it("is silent on an ordinary write", () => {
    expect(recordChangeNote({ outcome: "written", reason: null })).toBeNull();
  });

  it("says why an import was not applied", () => {
    expect(recordChangeNote({ outcome: "blocked", reason: "human_value" })?.en).toBe(
      "Not applied: a value a person recorded is kept",
    );
    expect(recordChangeNote({ outcome: "blocked", reason: "other_source" })?.en).toBe(
      "Not applied: a different import recorded this",
    );
  });

  it("marks what was held before history was kept, and a person's confirmation", () => {
    expect(recordChangeNote({ outcome: "written", reason: "held_before_history" })?.en).toBe("Held before changes were kept");
    expect(recordChangeNote({ outcome: "written", reason: "confirmed_by_person" })?.en).toBe(
      "The same value, confirmed by a person",
    );
  });
});
