import { describe, expect, it } from "vitest";

import { classesWord, classSubject, examWord, joinPairs, marksTileLine, openNotesP } from "@/vx/screens/teach/domain/today";
import { lead, p } from "@/vx/text";

/*
 * Verification 21 Oct: a Hindi-only teacher (language "hi") still read
 * "Class 4 की हाज़िरी", "Class 7 · Chemistry", "2 open notes" and "Half
 * yearly" on Today and More. Every label is a pair now, and the Hindi side
 * holds no English the school's lists can say in Hindi.
 */

describe("class labels for a Hindi reader", () => {
  it("reads कक्षा, for one class, a list and a combined period", () => {
    expect(classesWord("Class 4")).toEqual({ en: "Class 4", hi: "कक्षा 4" });
    expect(classesWord("Class 7, Class 8")).toEqual({ en: "Class 7, Class 8", hi: "कक्षा 7, कक्षा 8" });
    expect(classesWord("Class 1 · 2 · 3").hi).toBe("कक्षा 1 से 3 एक साथ");
    expect(lead(p(`Class 4 attendance`, `${classesWord("Class 4").hi} की हाज़िरी`), "hi")).toBe("कक्षा 4 की हाज़िरी");
  });

  it("puts the class and its subject on one line in each language", () => {
    const tile = classSubject("Class 7", p("Chemistry", "रसायन"));
    expect(tile).toEqual({ en: "Class 7 · Chemistry", hi: "कक्षा 7 · रसायन" });
    expect(lead(tile, "hi")).not.toMatch(/[A-Za-z]/);
    // A subject with no Hindi name falls back to its English name, never blank.
    expect(classSubject("Class 9", p("Robotics")).hi).toBe("कक्षा 9 · Robotics");
  });
});

describe("exam names for a Hindi reader", () => {
  it("reads the exam's Hindi name, the English only when none was typed", () => {
    expect(lead(examWord("Half yearly", "अर्धवार्षिक परीक्षा"), "hi")).toBe("अर्धवार्षिक परीक्षा");
    expect(lead(examWord("Half yearly", ""), "hi")).toBe("Half yearly");
    expect(lead(examWord("Half yearly", null), "en")).toBe("Half yearly");
  });
});

describe("open notes, counted in both languages", () => {
  it("says one note as one note", () => {
    expect(openNotesP(1)).toEqual({ en: "1 open note", hi: "1 खुला नोट" });
    expect(openNotesP(2)).toEqual({ en: "2 open notes", hi: "2 खुले नोट" });
  });

  it("joins a child's reasons without leaving English in the Hindi", () => {
    const detail = joinPairs([p("68% attendance", "68% हाज़िरी"), null, openNotesP(2)]);
    expect(detail).toEqual({ en: "68% attendance · 2 open notes", hi: "68% हाज़िरी · 2 खुले नोट" });
  });
});

describe("the Marks tile on More", () => {
  it("names the class in Hindi and counts one remark as one", () => {
    expect(marksTileLine({ classLabel: "Class 7", entered: 3, total: 20 }, 1).hi).toBe("कक्षा 7 · 20 में से 3 भरे · 1 रिपोर्ट-कार्ड टिप्पणी बाकी");
    expect(marksTileLine(null, 41).hi).toBe("41 रिपोर्ट-कार्ड टिप्पणियाँ बाकी");
  });
});
