import { z } from "zod";

/**
 * Drafts the app prepares before anybody asks (D-418): what each kind holds,
 * pure. The data layer writes and reads `vppsone.assist_drafts` with these;
 * the screens show them with the same suggestion card as a draft asked for by
 * a tap, so a prepared draft and a requested one look and behave alike.
 */

export const draftKinds = ["cover_plan", "class_digest"] as const;
export type DraftKind = (typeof draftKinds)[number];

export const coverPlanPayload = z.object({
  title: z.string().max(120),
  steps: z.array(z.object({ minutes: z.number(), text: z.string().max(300) })).min(1).max(6),
  tip: z.string().max(300),
});
export type CoverPlanPayload = z.infer<typeof coverPlanPayload>;

const digestLine = z.object({ ref: z.string(), line: z.string().max(240), studentId: z.string().nullable() });

export const classDigestPayload = z.object({
  classLabel: z.string().max(80),
  themes: z.array(z.string().max(240)).max(4),
  attention: z.array(digestLine).max(6),
  praise: z.array(digestLine).max(4),
  notes: z.number().int().min(0),
});
export type ClassDigestPayload = z.infer<typeof classDigestPayload>;

export type ReadyDraft =
  | { id: string; kind: "cover_plan"; ref: string; title: { en: string; hi: string }; href: string | null; logId: string | null; createdAt: string; payload: CoverPlanPayload }
  | { id: string; kind: "class_digest"; ref: string; title: { en: string; hi: string }; href: string | null; logId: string | null; createdAt: string; payload: ClassDigestPayload };

/** A draft as the screens get it: a digest also carries the children's names back, for the class teacher it was prepared for. */
export type ReadyDraftView = ReadyDraft & { names?: Record<string, string> };

/** A stored row back into a draft the screens can trust, or null when it no longer fits its kind. */
export function readDraft(row: {
  id: string;
  kind: string;
  ref: string;
  title_en: string;
  title_hi: string;
  href: string | null;
  log_id: string | null;
  created_at: string;
  payload: unknown;
}): ReadyDraft | null {
  const base = { id: row.id, ref: row.ref, title: { en: row.title_en, hi: row.title_hi }, href: row.href, logId: row.log_id, createdAt: row.created_at };
  if (row.kind === "cover_plan") {
    const payload = coverPlanPayload.safeParse(row.payload);
    return payload.success ? { ...base, kind: "cover_plan", payload: payload.data } : null;
  }
  if (row.kind === "class_digest") {
    const payload = classDigestPayload.safeParse(row.payload);
    return payload.success ? { ...base, kind: "class_digest", payload: payload.data } : null;
  }
  return null;
}

const WEEKDAY = { en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], hi: ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"] };
const MONTH = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  hi: ["जन॰", "फ़र॰", "मार्च", "अप्रैल", "मई", "जून", "जुला॰", "अग॰", "सित॰", "अक्टू॰", "नव॰", "दिस॰"],
};

/** "2026-11-09" → "Mon 9 Nov" / "सोम 9 नव॰"; anything else → null. */
function dutyDay(day: string): { en: string; hi: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(day);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const w = d.getUTCDay();
  const mo = d.getUTCMonth();
  const n = d.getUTCDate();
  return { en: `${WEEKDAY.en[w]} ${n} ${MONTH.en[mo]}`, hi: `${WEEKDAY.hi[w]} ${n} ${MONTH.hi[mo]}` };
}

/**
 * "Class 7 B" + period 4 (+ the duty's day) → the line on the Ready-for-you
 * strip. The day is named: a plan for Monday's P8 sat on Friday's Today,
 * where P8 was a free period, and read as if it were for today (teacher day,
 * 6 Nov 2026, teacher 11).
 */
export function coverPlanTitle(classLabels: string, periodNumber: number, day?: string): { en: string; hi: string } {
  const label = classLabels.slice(0, 80);
  const when = day ? dutyDay(day) : null;
  return when
    ? { en: `Plan for ${when.en} · P${periodNumber} · ${label}`, hi: `${when.hi} · P${periodNumber} की योजना · ${label}` }
    : { en: `Plan for P${periodNumber} · ${label}`, hi: `P${periodNumber} की योजना · ${label}` };
}

export function classDigestTitle(classLabel: string): { en: string; hi: string } {
  const label = classLabel.slice(0, 80);
  return { en: `This week in ${label}`, hi: `${label} का यह हफ़्ता` };
}

/** Midnight in India at the end of `day` plus `extraDays`, as UTC: a cover plan is useless after its day. */
export function endOfSchoolDay(day: string, extraDays = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1 + extraDays) - 330 * 60_000);
}

/** Expired drafts are kept two more days (so a decision can still be counted), then purged. */
export const DRAFT_PURGE_GRACE_DAYS = 2;
