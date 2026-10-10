/*
 * Result analysis for one class in one exam: subject averages, who passed
 * every subject, the top of the class and who is below the pass line. A
 * child who was absent or exempt from a paper is left out of that paper's
 * average and is not counted as failing it.
 */

export type ResultMark = {
  subjectCode: string;
  value: number | null;
  absent: boolean;
  exempt: boolean;
  maxMarks: number;
  passMarks: number | null;
};

export type ChildMarks = { studentId: string; name: string; marks: ResultMark[] };

/** The pass line of a paper: its own pass mark, else 33% of its maximum. */
export function passLine(mark: Pick<ResultMark, "maxMarks" | "passMarks">): number {
  return mark.passMarks ?? Math.ceil(mark.maxMarks * 0.33);
}

/** A child's percentage over the papers they sat; null when they sat none. */
export function childPercent(marks: ResultMark[]): number | null {
  let got = 0;
  let max = 0;
  for (const m of marks) {
    if (m.exempt || m.value === null) {
      if (m.absent) max += m.maxMarks;
      continue;
    }
    got += m.value;
    max += m.maxMarks;
  }
  return max === 0 ? null : Math.round((got / max) * 1000) / 10;
}

export type ClassAnalysis = {
  subjects: { subjectCode: string; avgPct: number | null; sat: number }[];
  counted: number;
  passedAll: number;
  top: { studentId: string; name: string; percent: number }[];
  below: { studentId: string; name: string; fails: { subjectCode: string; value: number; maxMarks: number }[] }[];
};

export function classAnalysis(children: ChildMarks[], subjectOrder: string[], topN = 5): ClassAnalysis {
  const subjects = subjectOrder.map((code) => {
    let sum = 0;
    let sat = 0;
    for (const child of children) {
      const m = child.marks.find((x) => x.subjectCode === code);
      if (!m || m.absent || m.exempt || m.value === null || m.maxMarks <= 0) continue;
      sum += m.value / m.maxMarks;
      sat += 1;
    }
    return { subjectCode: code, avgPct: sat ? Math.round((sum / sat) * 1000) / 10 : null, sat };
  });

  let counted = 0;
  let passedAll = 0;
  const below: ClassAnalysis["below"] = [];
  const ranked: ClassAnalysis["top"] = [];
  for (const child of children) {
    const sat = child.marks.filter((m) => !m.exempt && (m.value !== null || m.absent));
    if (sat.length === 0) continue;
    counted += 1;
    const fails = child.marks
      .filter((m) => !m.exempt && !m.absent && m.value !== null && m.value < passLine(m))
      .map((m) => ({ subjectCode: m.subjectCode, value: m.value as number, maxMarks: m.maxMarks }));
    if (fails.length === 0 && sat.every((m) => !m.absent)) passedAll += 1;
    if (fails.length) below.push({ studentId: child.studentId, name: child.name, fails });
    const percent = childPercent(child.marks);
    if (percent !== null) ranked.push({ studentId: child.studentId, name: child.name, percent });
  }
  ranked.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
  below.sort((a, b) => b.fails.length - a.fails.length || a.name.localeCompare(b.name));
  return { subjects, counted, passedAll, top: ranked.slice(0, topN), below };
}

/**
 * How a paper's marks are spread, in `buckets` equal bands of the maximum.
 * A full mark lands in the last band.
 */
export function histogram(values: number[], maxMarks: number, buckets = 10): number[] {
  const out = new Array<number>(buckets).fill(0);
  if (maxMarks <= 0) return out;
  for (const v of values) {
    const i = Math.min(buckets - 1, Math.max(0, Math.floor((v / maxMarks) * buckets)));
    out[i] += 1;
  }
  return out;
}
