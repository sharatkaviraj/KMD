/*
 * Pure logic for Student tools: promotion class mapping, the data-quality
 * checks, and family suggestions. No database import — unit-tested in
 * tests/vx-student-tools-logic.test.ts.
 */

import { ageOn, normalizeMobile, normalizeName, sessionAgeDay, usualAgeFor } from "@/vx/screens/admissions/logic";

/* -------------------------------------------------------------- promotion */

export type ClassOption = { id: string; label: string };

/** "Class 7" → 7, "11 Arts" → 11, "Nursery" → -2, "JKG"/"LKG" → -1, "SKG"/"UKG" → 0. */
export function classRank(label: string): number | null {
  const l = label.trim().toLowerCase();
  if (/pre[-\s]?nursery|playgroup/.test(l)) return -3;
  if (/nursery/.test(l)) return -2;
  if (/\b(jkg|lkg|kg ?1)\b/.test(l)) return -1;
  if (/\b(skg|ukg|kg ?2|prep)\b/.test(l)) return 0;
  const n = l.match(/(\d{1,2})/);
  return n ? Number(n[1]) : null;
}

/** The stream word of a senior class ("11 Science" → "science"), or "". */
export function classStream(label: string): string {
  const m = label.toLowerCase().match(/(arts|commerce|science|maths|biology|humanities|agriculture)/);
  return m ? m[1] : "";
}

/**
 * The class a child in `fromLabel` moves to next session, picked from the
 * target session's classes. "graduate" for the last class; null when the
 * school has to choose (Class 10 → which stream of 11).
 */
export function suggestNextClass(fromLabel: string, targets: readonly ClassOption[]): string | "graduate" | null {
  const rank = classRank(fromLabel);
  if (rank === null) return null;
  if (rank >= 12) return "graduate";
  const nextRank = rank + 1;
  const stream = classStream(fromLabel);
  const candidates = targets.filter((t) => classRank(t.label) === nextRank);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;
  if (stream) {
    const same = candidates.filter((t) => classStream(t.label) === stream);
    if (same.length === 1) return same[0].id;
  }
  return null;
}

export type PromoEntry = { id: string; studentId: string; fromClassId: string | null; decision: string; newClassId: string | null };
export type PromoMark = "held" | "leaving";
export type PromoPlanRow = { entryId: string; decision: "promote" | "graduate" | "skip" | "manual"; newClassId: string | null };

/**
 * What each entry becomes, from the class map and the per-child marks.
 * Held back and leaving both skip (the child is not moved); a class with no
 * target stays manual and is listed as "needs a class".
 */
export function planPromotion(entries: readonly PromoEntry[], classMap: Readonly<Record<string, string>>, marks: Readonly<Record<string, PromoMark>>): PromoPlanRow[] {
  return entries.map((e) => {
    if (marks[e.studentId]) return { entryId: e.id, decision: "skip", newClassId: null };
    const target = e.fromClassId ? classMap[e.fromClassId] : undefined;
    if (target === "graduate") return { entryId: e.id, decision: "graduate", newClassId: null };
    if (target) return { entryId: e.id, decision: "promote", newClassId: target };
    return { entryId: e.id, decision: "manual", newClassId: null };
  });
}

/** Group plan rows that need the same write, so one update covers each group. */
export function groupPlanWrites(plan: readonly PromoPlanRow[], current: ReadonlyMap<string, { decision: string; newClassId: string | null }>) {
  const groups = new Map<string, { decision: PromoPlanRow["decision"]; newClassId: string | null; entryIds: string[] }>();
  for (const row of plan) {
    const now = current.get(row.entryId);
    if (now && now.decision === row.decision && (now.newClassId ?? null) === row.newClassId) continue;
    const key = `${row.decision}|${row.newClassId ?? ""}`;
    const g = groups.get(key) ?? { decision: row.decision, newClassId: row.newClassId, entryIds: [] };
    g.entryIds.push(row.entryId);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export function planCounts(plan: readonly PromoPlanRow[]) {
  const c = { promote: 0, graduate: 0, skip: 0, manual: 0 };
  for (const r of plan) c[r.decision] += 1;
  return c;
}

/* ----------------------------------------------------------- data quality */

export const QUALITY_ISSUES = ["father_phone", "dob", "mother_name", "duplicate", "age", "address"] as const;
export type QualityIssue = (typeof QUALITY_ISSUES)[number];

export type QualityChild = {
  id: string;
  fullName: string;
  fatherName: string | null;
  motherName: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  classLabel: string;
  address: string | null;
  villageCity: string | null;
};

export type QualityHit = { issue: QualityIssue; child: QualityChild; detail: string | null; otherId?: string };

/** Every data problem on the roll, minus the ones somebody chose to skip. */
export function findQualityIssues(children: readonly QualityChild[], sessionLabel: string, skipped: ReadonlySet<string> = new Set()): QualityHit[] {
  const hits: QualityHit[] = [];
  const add = (h: QualityHit) => {
    if (!skipped.has(`${h.child.id}|${h.issue}`)) hits.push(h);
  };
  const seen = new Map<string, QualityChild>();
  for (const c of children) {
    if (normalizeMobile(c.phone).length !== 10) add({ issue: "father_phone", child: c, detail: c.phone?.trim() || null });
    if (!c.dateOfBirth) add({ issue: "dob", child: c, detail: null });
    else {
      // Two years off the usual age is a typing mistake more often than a child.
      const usual = usualAgeFor(c.classLabel);
      const age = ageOn(c.dateOfBirth, sessionAgeDay(sessionLabel));
      if (usual !== null && Math.abs(age.years + age.months / 12 - usual) >= 2) add({ issue: "age", child: c, detail: `${age.years}y ${age.months}m` });
    }
    if (!c.motherName?.trim()) add({ issue: "mother_name", child: c, detail: null });
    if (!c.address?.trim() && !c.villageCity?.trim()) add({ issue: "address", child: c, detail: null });
    const key = `${normalizeName(c.fullName)}|${normalizeName(c.fatherName)}`;
    const twin = seen.get(key);
    if (twin && normalizeName(c.fullName)) add({ issue: "duplicate", child: c, detail: twin.classLabel, otherId: twin.id });
    else seen.set(key, c);
  }
  return hits;
}

export function countByIssue(hits: readonly QualityHit[]): Record<QualityIssue, number> {
  const out = Object.fromEntries(QUALITY_ISSUES.map((k) => [k, 0])) as Record<QualityIssue, number>;
  for (const h of hits) out[h.issue] += 1;
  return out;
}

/** Share of children with no open issue, 0–100. */
export function qualityScore(total: number, hits: readonly QualityHit[]): number {
  if (total <= 0) return 100;
  const withIssue = new Set(hits.map((h) => h.child.id)).size;
  return Math.round(((total - withIssue) / total) * 100);
}

/* --------------------------------------------------------------- families */

/**
 * How many families there are, and how many have two or more children. A
 * child linked into a family group counts in that group; the rest fall back
 * to the same-father-same-phone guess. Without the links the header read
 * "0 with siblings" above "3 linked as brothers or sisters" (UX review,
 * 6 Nov 2026).
 */
export function familyCounts(families: readonly { key: string; kids: { id: string }[] }[], linkedGroupOf: ReadonlyMap<string, string>): { families: number; withSiblings: number } {
  const size = new Map<string, number>();
  for (const f of families) {
    for (const k of f.kids) {
      const g = linkedGroupOf.get(k.id);
      const key = g ? `group:${g}` : `guess:${f.key}`;
      size.set(key, (size.get(key) ?? 0) + 1);
    }
  }
  return { families: size.size, withSiblings: [...size.values()].filter((n) => n >= 2).length };
}

export type SuggestedFamily = { key: string; father: string; phone: string | null; childIds: string[] };

/**
 * Families the data says are one family (same father, same phone) but that
 * are not all linked together yet. `linkedGroupOf` maps a child to its
 * family group, if any.
 */
export function suggestFamilies(families: readonly { key: string; father: string; phone: string | null; kids: { id: string }[] }[], linkedGroupOf: ReadonlyMap<string, string>): SuggestedFamily[] {
  const out: SuggestedFamily[] = [];
  for (const f of families) {
    if (f.kids.length < 2 || f.key.startsWith("solo:") || !f.key.split("|")[1]) continue;
    const groups = new Set(f.kids.map((k) => linkedGroupOf.get(k.id) ?? `none:${k.id}`));
    if (groups.size > 1) out.push({ key: f.key, father: f.father, phone: f.phone, childIds: f.kids.map((k) => k.id) });
  }
  return out;
}
