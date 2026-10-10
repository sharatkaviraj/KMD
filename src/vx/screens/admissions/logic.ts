import { buildWorkbookInstallmentCharges } from "@/modules/fees/domain/workbook";
import { calculateConventionalPolicyTuition } from "@/modules/fees/domain/conventional-discount-rules";

/*
 * Pure rules behind the admissions screens. No database, no React: the
 * wizard runs them in the browser as the office types, and the unit tests in
 * tests/vx-admissions-logic.test.ts pin them down.
 */

/* ------------------------------------------------------------------ dates */

/** "21-08-2019", "21/08/2019" or "2019-08-21" → "2019-08-21"; anything else → null. */
export function parseDob(text: string): string | null {
  const raw = text.trim();
  let y: number;
  let m: number;
  let d: number;
  let match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  } else {
    match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "2019-08-21" → "21-08-2019", the way the office writes it. */
export function dobForInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

/** Whole years and months between a birth date and a day, both ISO. */
export function ageOn(dobIso: string, onIso: string): { years: number; months: number } {
  const [by, bm, bd] = dobIso.split("-").map(Number);
  const [oy, om, od] = onIso.split("-").map(Number);
  let months = (oy - by) * 12 + (om - bm);
  if (od < bd) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}

/** The 1 July of the session's first year: the age cut-off schools use. */
export function sessionAgeDay(sessionLabel: string): string {
  const year = Number(sessionLabel.match(/(\d{4})/)?.[1] ?? new Date().getFullYear());
  return `${year}-07-01`;
}

/**
 * The usual age, on 1 July, for a class. Nursery 3, JKG/LKG 4, SKG/UKG 5,
 * Class n is n + 5, and 11/12 streams follow their number. Null when the
 * label says nothing about age.
 */
export function usualAgeFor(classLabel: string): number | null {
  const label = classLabel.trim().toLowerCase();
  if (/nursery|pre[-\s]?nursery/.test(label)) return 3;
  if (/\b(jkg|lkg|kg1)\b/.test(label)) return 4;
  if (/\b(skg|ukg|kg2|prep)\b/.test(label)) return 5;
  const n = label.match(/(\d{1,2})/);
  if (!n) return null;
  const grade = Number(n[1]);
  return grade >= 1 && grade <= 12 ? grade + 5 : null;
}

export type AgeFit = "right" | "young" | "old" | "unknown";

/** Within a year of the usual age is right; outside it the office looks twice. */
export function ageFit(dobIso: string | null, classLabel: string, sessionLabel: string): { fit: AgeFit; years: number; months: number } {
  if (!dobIso) return { fit: "unknown", years: 0, months: 0 };
  const { years, months } = ageOn(dobIso, sessionAgeDay(sessionLabel));
  const usual = usualAgeFor(classLabel);
  if (usual === null) return { fit: "unknown", years, months };
  const decimal = years + months / 12;
  if (decimal < usual - 0.5) return { fit: "young", years, months };
  if (decimal >= usual + 1.5) return { fit: "old", years, months };
  return { fit: "right", years, months };
}

/* ----------------------------------------------------------------- people */

export function digitsOnly(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** 10 digits for an Indian mobile; a leading 91 or 0 is dropped. */
export function normalizeMobile(value: string | null | undefined): string {
  let d = digitsOnly(value);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

/** "9829041733" → "98290 ••733": enough to recognise, not enough to copy. */
export function maskPhone(value: string | null | undefined): string {
  const d = normalizeMobile(value);
  if (d.length < 6) return d;
  return `${d.slice(0, 5)} ••${d.slice(-3)}`;
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-zऀ-ॿ ]/g, " ").replace(/\s+/g, " ").trim();
}

export type PersonLike = {
  fullName: string;
  fatherName: string | null;
  dateOfBirth: string | null;
  phone?: string | null;
};

/**
 * Why two records may be one child. Same name and father is a strong hint;
 * the same birth date on top of that is the design's "already in school".
 */
export function duplicateReasons(adding: PersonLike, existing: PersonLike): string[] {
  const reasons: string[] = [];
  const sameName = normalizeName(adding.fullName) !== "" && normalizeName(adding.fullName) === normalizeName(existing.fullName);
  if (!sameName) return reasons;
  reasons.push("name");
  if (normalizeName(adding.fatherName) && normalizeName(adding.fatherName) === normalizeName(existing.fatherName)) reasons.push("father");
  if (adding.dateOfBirth && adding.dateOfBirth === existing.dateOfBirth) reasons.push("dob");
  const a = normalizeMobile(adding.phone);
  if (a.length === 10 && a === normalizeMobile(existing.phone)) reasons.push("phone");
  return reasons;
}

/** A match worth stopping for: same name plus father or birth date. */
export function isLikelySameChild(adding: PersonLike, existing: PersonLike): boolean {
  const r = duplicateReasons(adding, existing);
  return r.includes("name") && (r.includes("father") || r.includes("dob"));
}

/** The next free numeric SR number above every numeric one in use. */
export function nextSrNumber(existing: readonly (string | null)[]): string {
  let max = 0;
  for (const value of existing) {
    const t = (value ?? "").trim();
    if (/^\d{1,7}$/.test(t)) max = Math.max(max, Number(t));
  }
  return String(max + 1);
}

/* ------------------------------------------------------------------- fees */

export type PlanPolicy = {
  calculationType: "tuition_zero" | "tuition_percentage" | "tuition_fixed_amount";
  percentage: number | null;
  fixedTuitionAmount: number | null;
};

export type PlanInput = {
  classTuition: number;
  /** The route's annual fee, 0 for no bus. */
  transportAnnual: number;
  academicFee: number;
  /** One concession at most (one per child). */
  policy: PlanPolicy | null;
  schedule: { label: string; dueDate: string }[];
  distribution: "first_only" | "equal";
  /** Today, ISO. Installments due on or before it are pending today. */
  today: string;
};

export type PlanRow = {
  label: string;
  dueDate: string;
  amount: number;
  /** Due on or before today: pending the moment the child is admitted. */
  due: boolean;
};

export type FeePlan = {
  tuitionBefore: number;
  tuition: number;
  concession: number;
  transport: number;
  academic: number;
  total: number;
  rows: PlanRow[];
  /** Pending today and Not due yet are two numbers, never added (RULES B). */
  pendingToday: number;
  notDueYet: number;
};

export function buildFeePlan(input: PlanInput): FeePlan {
  const tuitionBefore = Math.max(0, Math.trunc(input.classTuition));
  const tuition = input.policy ? Math.min(tuitionBefore, calculateConventionalPolicyTuition({ baseTuition: tuitionBefore, policy: input.policy })) : tuitionBefore;
  const count = Math.max(1, input.schedule.length);
  const charges = buildWorkbookInstallmentCharges({
    installmentCount: count,
    tuitionFee: tuition,
    transportFee: input.transportAnnual,
    academicFee: input.academicFee,
    otherAdjustmentAmount: 0,
    discountAmount: 0,
    academicFeeDistribution: input.distribution,
  });
  const rows: PlanRow[] = charges.installmentCharges.map((amount, i) => {
    const item = input.schedule[i];
    const dueDate = item?.dueDate ?? "";
    return { label: item?.label ?? `Installment ${i + 1}`, dueDate, amount, due: Boolean(dueDate) && dueDate <= input.today };
  });
  let pendingToday = 0;
  let notDueYet = 0;
  for (const r of rows) {
    if (r.due) pendingToday += r.amount;
    else notDueYet += r.amount;
  }
  return {
    tuitionBefore,
    tuition,
    concession: tuitionBefore - tuition,
    transport: Math.max(0, Math.trunc(input.transportAnnual)),
    academic: charges.academicCharge,
    total: charges.baseTotalDue,
    rows,
    pendingToday,
    notDueYet,
  };
}

/* ------------------------------------------------------------- pipeline */

export const STAGES = ["enquiry", "visited", "form", "admitted"] as const;
export type Stage = (typeof STAGES)[number];

export function nextStage(stage: Stage): Stage | null {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 2 ? STAGES[i + 1] : null;
}

/** Whole days since a timestamp, never negative. */
export function daysSince(iso: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** An enquiry untouched for a week needs a call back. */
export function needsCallBack(stage: Stage, days: number): boolean {
  return stage !== "admitted" && days >= 7;
}

/* --------------------------------------------------------------- withdraw */

export const WITHDRAW_REASONS = ["town", "school", "fees", "other"] as const;
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number];

/** The sentence that goes on the TC and the fee record. */
export function withdrawReasonText(reason: WithdrawReason, note: string): { en: string; hi: string } {
  switch (reason) {
    case "town":
      return { en: "Family moving to another town", hi: "परिवार दूसरे शहर जा रहा है" };
    case "school":
      return { en: "Joining another school", hi: "दूसरे विद्यालय में प्रवेश" };
    case "fees":
      return { en: "Parent's request", hi: "अभिभावक के अनुरोध पर" };
    default:
      return { en: note.trim() || "Parent's request", hi: note.trim() || "अभिभावक के अनुरोध पर" };
  }
}

/** TC/2026-27/018 — the session and a three-digit count. */
export function tcNumber(sessionLabel: string, sequence: number): string {
  return `TC/${sessionLabel}/${String(Math.max(1, sequence)).padStart(3, "0")}`;
}

/* --------------------------------------------------------------- families */

export type FamilyKid = { id: string; name: string; classLabel: string };
export type FamilyCard = {
  key: string;
  father: string;
  mother: string | null;
  phone: string | null;
  village: string | null;
  address: string | null;
  kids: FamilyKid[];
};

type ChildForFamily = {
  id: string;
  fullName: string;
  fatherName: string | null;
  motherName: string | null;
  phone: string | null;
  classLabel: string;
  villageCity: string | null;
  address: string | null;
};

/**
 * Children grouped into the families a parent would recognise: same father
 * and same phone. A child with neither stands alone rather than being guessed
 * into somebody's family.
 */
export function groupFamilies(children: readonly ChildForFamily[]): FamilyCard[] {
  const map = new Map<string, FamilyCard>();
  for (const c of children) {
    const father = normalizeName(c.fatherName);
    const phone = normalizeMobile(c.phone);
    const key = father || phone ? `${father}|${phone}` : `solo:${c.id}`;
    let fam = map.get(key);
    if (!fam) {
      fam = { key, father: c.fatherName?.trim() || "—", mother: c.motherName, phone: c.phone, village: c.villageCity, address: c.address, kids: [] };
      map.set(key, fam);
    }
    if (!fam.kids.some((k) => k.id === c.id)) fam.kids.push({ id: c.id, name: c.fullName, classLabel: c.classLabel });
    fam.mother ??= c.motherName;
    fam.village ??= c.villageCity;
    fam.address ??= c.address;
  }
  return [...map.values()];
}

/* ------------------------------------------------------------------- edit */

/** The keys whose trimmed value differs — what "3 changes" counts. */
export function changedFields<T extends Record<string, string>>(before: T, after: T): (keyof T)[] {
  return (Object.keys(after) as (keyof T)[]).filter((k) => (before[k] ?? "").trim() !== (after[k] ?? "").trim());
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Last-day chips for a withdrawal: today, yesterday, and the end of last month. */
export function lastDayChoices(todayIso: string): { value: string; kind: "today" | "yesterday" | "monthEnd" }[] {
  const monthStart = `${todayIso.slice(0, 7)}-01`;
  const monthEnd = shiftIso(monthStart, -1);
  const out: { value: string; kind: "today" | "yesterday" | "monthEnd" }[] = [
    { value: todayIso, kind: "today" },
    { value: shiftIso(todayIso, -1), kind: "yesterday" },
  ];
  if (!out.some((o) => o.value === monthEnd)) out.push({ value: monthEnd, kind: "monthEnd" });
  return out;
}

/** First name, for "Why is Yuvraj leaving?". */
export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}
