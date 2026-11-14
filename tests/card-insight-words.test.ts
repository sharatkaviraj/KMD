import { describe, expect, it } from "vitest";

import type { CardInsight } from "@/modules/assessments/domain/card-insight";
import { effortWords, focusWords, gradeTone, growthWords, insightView, strengthWords } from "@/vx/screens/exams/domain/card-insight-words";

/*
 * The lines the report card prints about effort (D-612). The Hindi never needs
 * the child's gender: it names the move, not the child.
 */

const journey = [
  { code: "FA1", en: "Test I", hi: "टेस्ट I", percent: 40, classAvg: 50 },
  { code: "FA2", en: "Test II", hi: "टेस्ट II", percent: 55, classAvg: 52 },
  { code: "SA1", en: "Half Yearly", hi: "अर्धवार्षिक", percent: 62, classAvg: 54 },
];

const insight = (over: Partial<CardInsight> = {}): CardInsight => ({
  version: 1,
  subjects: [
    { subjectCode: "Maths", percent: 70, classAvg: 60, classTop: 90, exams: [], growth: 12, trend: "up" },
    { subjectCode: "English", percent: 66, classAvg: 60, classTop: 88, exams: [], growth: 8, trend: "up" },
    { subjectCode: "Hindi", percent: 48, classAvg: 58, classTop: 80, exams: [], growth: -7, trend: "down" },
    { subjectCode: "EVS", percent: 60, classAvg: 59, classTop: 81, exams: [], growth: 1, trend: "steady" },
  ],
  journey,
  growth: 18.4,
  trend: "up",
  effort: { measured: 4, up: 2, steady: 1, down: 1 },
  strengths: ["Maths", "English"],
  focus: ["Hindi"],
  classSize: 30,
  ...over,
});

describe("card insight words", () => {
  it("says how far the child moved against the class, in whole points, from the first exam", () => {
    expect(growthWords(insight())).toEqual({ en: "Moved up 18 points against the class since Test I", hi: "टेस्ट I से कक्षा के मुकाबले 18 अंक की बढ़त" });
    expect(growthWords(insight({ growth: -6.3, trend: "down" }))?.en).toBe("Fell 6 points behind the class since Test I");
    expect(growthWords(insight({ growth: 2, trend: "steady" }))?.hi).toBe("टेस्ट I से कक्षा के साथ बराबरी बनी रही");
    expect(growthWords(insight({ growth: null, trend: null }))).toBeNull();
  });

  it("measures from the first exam the child sat", () => {
    const missedFirst = insight({ journey: [{ ...journey[0], percent: null }, journey[1], journey[2]] });
    expect(growthWords(missedFirst)?.en).toContain("since Test II");
  });

  it("lists the subjects by the way they went, rising first", () => {
    expect(effortWords(insight())).toEqual([
      { trend: "up", en: "Rising in Maths, English", hi: "बढ़त: गणित, अंग्रेज़ी" },
      { trend: "steady", en: "Steady in EVS", hi: "बराबर: पर्यावरण" },
      { trend: "down", en: "Slipping in Hindi", hi: "गिरावट: हिंदी" },
    ]);
    expect(effortWords(insight({ subjects: [] }))).toEqual([]);
  });

  it("names the strongest subjects and the ones to practise", () => {
    expect(strengthWords(insight())).toEqual({ en: "Strongest: Maths, English", hi: "सबसे मज़बूत: गणित, अंग्रेज़ी" });
    expect(focusWords(insight())).toEqual({ en: "More practice: Hindi", hi: "और अभ्यास चाहिए: हिंदी" });
    expect(strengthWords(insight({ strengths: [] }))).toBeNull();
    expect(focusWords(insight({ focus: [] }))).toBeNull();
  });

  it("colours grades from the top band down, word grades too", () => {
    expect(["A1", "Outstanding", "B2", "Good", "C1", "Growing", "D", "E", "", null].map(gradeTone)).toEqual(["good", "good", "fine", "fine", "watch", "watch", "watch", "low", "plain", "plain"]);
  });

  it("gives the preview every line ready to draw", () => {
    const view = insightView(insight(), 33);
    expect(view.subjects[0]).toEqual({ subject: { en: "Maths", hi: "गणित" }, percent: 70, classAvg: 60, trend: "up" });
    expect(view.journey[2].name).toEqual({ en: "Half Yearly", hi: "अर्धवार्षिक" });
    expect(view.passLine).toBe(33);
  });
});
