import { describe, expect, it } from "vitest";

import {
  belowLine,
  childCount,
  fixBanner,
  fixItems,
  heldIds,
  noMarkYet,
  outOf,
  pressKey,
  readTyped,
  tally,
  tallyLine,
  typedProblem,
  undoLine,
  type Cell,
} from "@/vx/screens/exams/domain/entry";
import { suggestRemarks } from "@/vx/screens/exams/domain/messages";
import { pickState, resultsLine } from "@/vx/screens/exams/domain/pick";

/*
 * The marks fixes from the 20 Oct school-day smoke run (stream "marks"):
 * a slip in a box is never saved as its first digits, the counter never says
 * done while marks need fixing, the list never says "Done ✓ · All 14 sent"
 * over blanks, and Hindi says the whole before the part.
 */

describe("a slip in a mark box (group 2)", () => {
  it("reads only a finished, valid mark as something to save", () => {
    expect(readTyped("", 80, 1)).toEqual({ kind: "blank" });
    expect(readTyped("8", 80, 1)).toEqual({ kind: "value", value: 8 });
    expect(readTyped("58", 80, 1)).toEqual({ kind: "value", value: 58 });
    // 85 on a paper out of 80 used to keep and save the 8.
    expect(readTyped("85", 80, 1)).toEqual({ kind: "bad", reason: "over" });
    // "6o" (a letter o for zero) used to keep and save the 6.
    expect(readTyped("6o", 80, 1)).toEqual({ kind: "bad", reason: "nan" });
    expect(readTyped("-5", 80, 1)).toEqual({ kind: "bad", reason: "nan" });
    expect(readTyped("7.5", 80, 1)).toEqual({ kind: "bad", reason: "step" });
    expect(readTyped("72.", 80, 1)).toEqual({ kind: "bad", reason: "step" });
    expect(readTyped("72.", 80, 0.5)).toEqual({ kind: "partial" });
    expect(readTyped("85.", 80, 0.5)).toEqual({ kind: "bad", reason: "over" });
    expect(readTyped("72.5", 80, 0.5)).toEqual({ kind: "value", value: 72.5 });
    expect(readTyped("0", 80, 1)).toEqual({ kind: "value", value: 0 });
  });

  it("says what is wrong beside the child, Hindi included, keeping the words typed", () => {
    const over = typedProblem("85", "over", 80, 1);
    expect(over.en).toBe("85 is more than 80. Fix this mark.");
    expect(over.hi).toBe("85 — पूर्णांक 80 से ज़्यादा है। अंक ठीक करें।");
    expect(typedProblem("6o", "nan", 80, 1).en).toContain('"6o"');
    expect(typedProblem("6o", "nan", 80, 1).hi).toContain("सिर्फ़ अंक");
    expect(typedProblem("7.5", "step", 80, 1).en).toContain("whole marks only");
    expect(typedProblem("7.3", "step", 80, 0.5).en).toContain("half");
  });

  it("names every child whose box holds a slip", () => {
    const texts = { a: "85", b: "58", c: "6o", d: "", e: "72." };
    expect(heldIds(["a", "b", "c", "d", "e"], texts, 80, 1)).toEqual(["a", "c", "e"]);
    expect(heldIds(["a", "b", "c", "d", "e"], texts, 80, 0.5)).toEqual(["a", "c"]);
  });

  it("lets the pad show a mark that is too high instead of dropping the digit", () => {
    expect(pressKey("8", "5", 80, 1)).toBe("85");
    expect(readTyped(pressKey("8", "5", 80, 1), 80, 1).kind).toBe("bad");
    // Never more whole digits than the paper's maximum has.
    expect(pressKey("85", "5", 80, 1)).toBe("85");
    expect(pressKey("10", "0", 100, 1)).toBe("100");
  });
});

describe("the counter tells the truth (smoke: '14 of 14 saved · 0 left' with two to fix)", () => {
  const order = ["a", "b", "c", "d"];
  const saved: Record<string, Cell> = {
    a: { state: "value", value: 50 },
    b: { state: "value", value: 77.5 },
    c: { state: "absent", value: null },
    d: { state: "blank", value: null },
  };

  it("counts a saved mark that must be fixed as to fix, not as saved", () => {
    const t = tally(order, saved, ["b"]);
    expect(t).toEqual({ total: 4, ready: 2, toFix: 1, blank: 1 });
    expect(tallyLine(t)).toEqual({ en: "2 of 4 saved · 1 to fix · 1 left", hi: "4 में से 2 सहेजे · 1 ठीक करने हैं · 1 बाकी" });
  });

  it("counts a blank whose box holds a slip as to fix, not as left", () => {
    expect(tally(order, saved, ["b", "d"])).toEqual({ total: 4, ready: 2, toFix: 2, blank: 0 });
    expect(tallyLine(tally(order, { ...saved, b: { state: "value", value: 7 }, d: { state: "value", value: 1 } }, []))).toEqual({ en: "4 of 4 saved", hi: "4 में से 4 सहेजे" });
  });

  it("names the marks to fix and why, in that order", () => {
    const banner = fixBanner([{ name: "Child A", value: 70.5 }, { name: "Child B", value: 49.5 }], 80, 1);
    expect(banner.en).toBe("2 marks must be fixed before you can send: Child A (70.5), Child B (49.5). This paper takes whole marks only — change each to a whole number.");
    expect(banner.en).not.toContain("kept exactly as saved");
    expect(banner.hi).toContain("भेजने से पहले 2 अंक ठीक करने हैं");
    expect(fixBanner([{ name: "Child C", value: 85 }], 80, 1).en).toBe("1 mark must be fixed before you can send: Child C (85). This paper is out of 80.");
  });

  it("names the slips still in their boxes too, so the banner and the counter agree (verification 21 Oct)", () => {
    // "85" of 80 and "6o" typed, plus a saved 53.5 on a whole-mark paper:
    // the counter said "3 to fix" while the banner said "1 mark must be fixed".
    const order = ["a", "b", "c", "d"];
    const cells: Record<string, Cell> = {
      a: { state: "value", value: 53.5 },
      b: { state: "blank", value: null },
      c: { state: "value", value: 40 },
      d: { state: "value", value: 60 },
    };
    const texts = { a: "53.5", b: "85", c: "6o", d: "60" };
    const names: Record<string, string> = { a: "Child A", b: "Child B", c: "Child C", d: "Child D" };
    const items = fixItems(order, texts, cells, (id) => names[id], 80, 1);
    expect(items).toEqual([
      { name: "Child A", value: "53.5" },
      { name: "Child B", value: "85" },
      { name: "Child C", value: "6o" },
    ]);
    const held = heldIds(order, texts, 80, 1);
    expect(tally(order, cells, [...new Set([...held, "a"])]).toFix).toBe(items.length);
    const banner = fixBanner(items, 80, 1);
    expect(banner.en).toBe("3 marks must be fixed before you can send: Child A (53.5), Child B (85), Child C (6o).");
    expect(banner.hi).toBe("भेजने से पहले 3 अंक ठीक करने हैं: Child A (53.5), Child B (85), Child C (6o)।");
  });

  it("names a saved misfit once, by the slip in its box when the teacher has started fixing it", () => {
    const cells: Record<string, Cell> = { a: { state: "value", value: 53.5 } };
    expect(fixItems(["a"], { a: "95" }, cells, () => "Child A", 80, 1)).toEqual([{ name: "Child A", value: "95" }]);
    // Saved misfit with nothing typed over it: the saved value is named.
    expect(fixItems(["a"], {}, cells, () => "Child A", 80, 1)).toEqual([{ name: "Child A", value: 53.5 }]);
    // Only typed slips that are over the paper: the reason is said once.
    expect(fixBanner([{ name: "Child B", value: "85" }], 80, 1).en).toBe("1 mark must be fixed before you can send: Child B (85). This paper is out of 80.");
  });
});

describe("Hindi word order and plurals (group 21)", () => {
  it("says the whole before the part in Hindi", () => {
    expect(outOf(50.9, 80)).toEqual({ en: "50.9 out of 80", hi: "80 में से 50.9" });
    expect(belowLine(26, 80)).toEqual({ en: "Children below 33% (under 26 of 80)", hi: "33% से कम वाले बच्चे (80 में से 26 से कम)" });
  });

  it("counts one child as one child", () => {
    expect(childCount(1)).toEqual({ en: "1 child", hi: "1 बच्चा" });
    expect(childCount(14)).toEqual({ en: "14 children", hi: "14 बच्चे" });
    expect(noMarkYet(1)).toEqual({ en: "1 child has no mark yet", hi: "1 बच्चे के अंक अभी नहीं भरे" });
    expect(noMarkYet(3).en).toBe("3 children have no mark yet");
  });

  it("says how long Undo has left in minutes, never a wall-clock time after तक", () => {
    expect(undoLine(9.2)).toEqual({ en: "Made a mistake? You can take these marks back for 10 more minutes.", hi: "गलती हुई? अगले 10 मिनट तक ये अंक वापस ले सकते हैं।" });
    expect(undoLine(0.4).en).toContain("1 more minute.");
    expect(undoLine(3).hi).not.toMatch(/तक \d/);
  });
});

describe("the marks list never says done over blanks (group 12)", () => {
  it("is green only when every child was sent", () => {
    const s = pickState({ status: "done", entered: 14, total: 14, submittedToName: "Exam Office" });
    expect(s.tone).toBe("ok");
    expect(s.line).toEqual({ en: "14 of 14 sent to Exam Office", hi: "14 में से 14 Exam Office को भेजे" });
  });

  it("names the blanks of a paper sent with children missing", () => {
    const s = pickState({ status: "done", entered: 3, total: 14 });
    expect(s.tone).toBe("warn");
    expect(s.pill).toEqual({ en: "Sent · 11 blank", hi: "भेजा · 11 खाली" });
    expect(s.line.en).toBe("3 of 14 sent · 11 blank — tell the exam office");
    expect(s.line.hi).toBe("14 में से 3 भेजे · 11 खाली — परीक्षा प्रभारी को बताएँ");
  });

  it("never says 'All 0 sent'", () => {
    const s = pickState({ status: "done", entered: 0, total: 0 });
    expect(s.tone).toBe("warn");
    expect(s.line.en).not.toContain("All 0");
    expect(s.line.en).toContain("No children");
  });

  it("is not done while a sent mark needs fixing", () => {
    expect(pickState({ status: "done", entered: 14, total: 14, invalid: 2 }).tone).toBe("warn");
    expect(pickState({ status: "in_progress", entered: 14, total: 14, invalid: 2 }).line.en).toBe("14 of 14 entered · 2 to fix");
  });

  it("speaks of a results day already gone in the past", () => {
    expect(resultsLine("Sat 17 Oct (PTM)", true).en).toBe("results were on Sat 17 Oct (PTM)");
    expect(resultsLine("Sat 24 Oct", false)).toEqual({ en: "results on Sat 24 Oct", hi: "परिणाम Sat 24 Oct को" });
  });
});

describe("report-card remark suggestions", () => {
  it("names subjects as a parent reads them, in Hindi inside the Hindi line", () => {
    const list = suggestRemarks({ percent: 70, attendancePct: null, strongest: "HINDI", weakest: "MATHS" });
    const subjects = list.find((r) => r.source === "subjects");
    expect(subjects?.text.en).toBe("Strong in Hindi; more practice in Maths will help.");
    expect(subjects?.text.hi).toBe("हिंदी में अच्छा; गणित में और अभ्यास मदद करेगा।");
    expect(subjects?.text.hi).not.toMatch(/[A-Z]{3,}/);
  });
});
