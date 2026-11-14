import { absentExams, partialSubjects, type CardExam, type ReportRow } from "@/modules/assessments/domain/report-card";

import { subjectPair } from "./groups";

/*
 * Notes a report card prints about its own numbers, in both languages on
 * every copy. Kept apart from `card-words.ts`, which the client boards import:
 * this reads the card's domain module, and that pulls zod with it.
 */

/**
 * The exams a subject's child was absent from, said beside that subject's
 * marks: "Absent in SA1 · SA1 में अनुपस्थित". An absent paper counts as 0
 * (D-319), so without this a subject read "15.5/100" as if the child had
 * written 15.5 (verification 21 Oct). Empty when the child sat every paper.
 */
export function absentLine(exams: readonly CardExam[], held = false): string {
  if (exams.length === 0) return "";
  const en = exams.map((e) => e.en || e.code).join(", ");
  const hi = exams.map((e) => e.hi || e.en || e.code).join(", ");
  // Under a class group's rule (D-611) a missed paper holds the result instead of counting as 0.
  if (held) return [`Absent in ${en} (result pending)`, `${hi} में अनुपस्थित (परिणाम लंबित)`].join(" · ");
  return `Absent in ${en} (counted as 0) · ${hi} में अनुपस्थित (0 गिना गया)`;
}

/**
 * The lines under the card's table, each in both languages: what the * beside
 * a subject's marks means, and why a subject set in fewer exams is out of a
 * smaller total (ELGA is set only in SA1, so it is out of 80 where the others
 * are out of 100 — the paper plan, not a slip in the sums).
 */
export function cardNotes(rows: readonly Pick<ReportRow, "subjectCode" | "marks">[], held = false): { en: string; hi: string }[] {
  const notes: { en: string; hi: string }[] = [];
  if (rows.some((row) => absentExams(row).length > 0)) {
    notes.push(
      held
        ? {
            en: "* Absent from a paper: the result is pending until the child sits it, as on the school's register. The total shows the marks so far.",
            hi: "पेपर में अनुपस्थित: बच्चा पेपर देगा तब तक परिणाम लंबित है, जैसा विद्यालय के रजिस्टर में होता है। कुल में अब तक के अंक हैं।",
          }
        : { en: "* Absent from a paper: it counts as 0 out of that paper's marks.", hi: "पेपर में अनुपस्थित: उस पेपर के अंक 0 गिने गए।" },
    );
  }
  for (const s of partialSubjects([...rows])) {
    const name = subjectPair(s.subjectCode);
    const en = s.sat.map((e) => e.en || e.code).join(" and ");
    const hi = s.sat.map((e) => e.hi || e.en || e.code).join(" और ");
    notes.push({
      en: `${name.en} is examined in ${en} only, so it is out of ${s.outOf}.`,
      hi: `${name.hi ?? name.en} की परीक्षा केवल ${hi} में है, इसलिए पूर्णांक ${s.outOf} है।`,
    });
  }
  return notes;
}
