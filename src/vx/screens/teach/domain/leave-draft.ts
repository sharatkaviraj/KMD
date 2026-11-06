/**
 * The leave sheet's half-filled request, kept for the tab so a refresh does
 * not lose the day and the reason (20-teacher school day, 6 Nov 2026: a slow
 * "Send to office", a refresh, and the form came back empty).
 *
 * Pure: the sheet reads and writes `sessionStorage` and hands the text here.
 * A draft is only good for the day it was made on: "today" and "tomorrow"
 * mean other days after midnight, and a picked day may have passed.
 */

import type { LeaveSpan, LeaveSubmission } from "./teach";

export type LeaveDraft = {
  savedOn: string;
  when: "today" | "tomorrow" | "pick" | null;
  picked: string[];
  span: LeaveSpan;
  reason: string | null;
  note: string;
  /** The id of a send whose answer was lost, so a resend after the refresh files once. */
  submission: LeaveSubmission | null;
};

export const LEAVE_DRAFT_STORAGE_KEY = "vx-leave-draft";

const WHENS = new Set(["today", "tomorrow", "pick"]);
const SPANS = new Set(["full", "first_half", "second_half"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** True when there is nothing worth keeping: no day, no reason, no note. */
export function isEmptyLeaveDraft(d: Pick<LeaveDraft, "when" | "reason" | "note">): boolean {
  return d.when === null && d.reason === null && d.note.trim() === "";
}

/** The stored draft, or null when it is missing, malformed or from another day. */
export function parseLeaveDraft(raw: string | null, today: string, reasonKeys: readonly string[]): LeaveDraft | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.savedOn !== today) return null;
  const when = typeof o.when === "string" && WHENS.has(o.when) ? (o.when as LeaveDraft["when"]) : null;
  const picked = Array.isArray(o.picked) ? o.picked.filter((d): d is string => typeof d === "string" && DAY.test(d) && d >= today) : [];
  const span = typeof o.span === "string" && SPANS.has(o.span) ? (o.span as LeaveSpan) : "full";
  const reason = typeof o.reason === "string" && reasonKeys.includes(o.reason) ? o.reason : null;
  const note = typeof o.note === "string" ? o.note.slice(0, 300) : "";
  const s = o.submission as Record<string, unknown> | null | undefined;
  const submission = s && typeof s.id === "string" && typeof s.request === "string" ? { id: s.id, request: s.request } : null;
  const draft: LeaveDraft = { savedOn: today, when: when === "pick" && picked.length === 0 ? null : when, picked, span, reason, note, submission };
  return isEmptyLeaveDraft(draft) ? null : draft;
}
