/**
 * What a reminder's Pay now link covers, as the sender wrote it down.
 *
 * Stored on `whatsapp_reminder_sends.pay_scope` from the figures that BUILT the
 * message — never parsed back out of its text. The pay page reads it to know
 * which student and which installments to re-quote from the ledger.
 */

import { isTestAcademicSessionLabel } from "@/platform/config/fee-rules";

export type PayScope = {
  studentIds: string[];
  installments: number[];
  lastYear: boolean;
  situation: string;
  /** The figure the message printed, in rupees. */
  amount: number;
};

export function readPayScope(value: unknown): PayScope | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const studentIds = Array.isArray(raw.studentIds)
    ? raw.studentIds.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))
    : [];
  const installments = Array.isArray(raw.installments)
    ? [...new Set(raw.installments.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 12))].sort((a, b) => a - b)
    : [];
  const amount = Number(raw.amount);
  if (studentIds.length === 0 || !Number.isSafeInteger(amount)) return null;
  return {
    studentIds,
    installments,
    lastYear: raw.lastYear === true,
    situation: typeof raw.situation === "string" ? raw.situation : "",
    amount,
  };
}

/**
 * Notices whose Pay now may open an online payment: the ones whose headline IS
 * the fees on the scope, so the message and the payment are one number.
 *
 * Left out on purpose: `late_fee_applied` (its headline is fees plus a late
 * fee, and a late fee is not a fee), the two waiver notices (they promise a
 * waiver only the counter can grant) and `balance` (its headline is the whole
 * balance, not the scope). Those keep today's UPI page.
 */
const ONLINE_SITUATIONS = new Set([
  "fee_due",
  "prevyear",
  "upcoming",
  "upcoming_final",
  "overdue_final",
  "exam_clearance",
  "promise_lapsed",
  "promise_due",
]);

export function isOnlineSituation(situation: string): boolean {
  return ONLINE_SITUATIONS.has(situation);
}

export type OnlineOfferRefusal =
  | "no_scope"
  | "family_message"
  | "notice_not_online"
  | "nothing_selected";

/**
 * Phase 1 is one student per payment. A message that named several children
 * keeps the UPI page it has today: a shared phone is not proof of a family,
 * and charging a family total against one child would credit the wrong ledger.
 */
export function onlineOfferRefusal(scope: PayScope | null): OnlineOfferRefusal | null {
  if (!scope) return "no_scope";
  if (scope.studentIds.length !== 1) return "family_message";
  if (!ONLINE_SITUATIONS.has(scope.situation)) return "notice_not_online";
  if (scope.installments.length === 0 && !scope.lastYear) return "nothing_selected";
  return null;
}

/**
 * The one-tap checkout page (2026-10-30) shows every child's full breakdown
 * and lets the parent choose each amount, so the message's headline no longer
 * has to BE the payment: a late fee or a whole balance is shown on its own line
 * and paid knowingly. Only the two waiver notices stay off, because they
 * promise a waiver only the counter can grant. One to four children; a shared
 * number with more than four is not treated as one family here.
 */
const CHECKOUT_EXCLUDED_SITUATIONS = new Set(["late_fee_waiver", "waiver_last_call"]);
export const CHECKOUT_MAX_CHILDREN = 4;

export type CheckoutOfferRefusal = "no_scope" | "too_many_children" | "notice_not_online";

export function checkoutOfferRefusal(scope: PayScope | null): CheckoutOfferRefusal | null {
  if (!scope) return "no_scope";
  if (scope.studentIds.length < 1 || scope.studentIds.length > CHECKOUT_MAX_CHILDREN) return "too_many_children";
  if (!scope.situation || CHECKOUT_EXCLUDED_SITUATIONS.has(scope.situation)) return "notice_not_online";
  return null;
}

/**
 * Who sees the one-tap page while it is a pilot: test sessions only (TEST-,
 * UAT-, DEMO-) until `online_payment_checkout_all_sessions` is on. Gates the
 * page and new orders only — money already paid is always received and posted.
 */
export function checkoutAudienceAllows(sessionLabel: string | null | undefined, allSessions: boolean): boolean {
  if (allSessions) return true;
  try {
    return Boolean(sessionLabel) && isTestAcademicSessionLabel(String(sessionLabel));
  } catch {
    return false;
  }
}

/** The ledger's reasons, in words a parent can act on. Never names a student. */
export function parentReasonFor(reasons: readonly string[]): string {
  if (reasons.includes("nothing_due")) return "Nothing is due on this link any more. Thank you.";
  if (reasons.includes("late_fee_pending")) {
    return "This amount includes a late fee, which the fee counter will confirm with you.";
  }
  if (reasons.includes("emi_plan_active")) {
    return "This account is on an instalment plan. Please pay at the fee counter.";
  }
  if (reasons.includes("earlier_dues_not_selected")) {
    return "An earlier balance must be cleared first. Please call the office for the current figure.";
  }
  return "Online payment is not available for this link. Please pay at the fee counter.";
}
