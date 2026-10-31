import { isTestAcademicSessionLabel } from "@/platform/config/fee-rules";
import { formatInr } from "@/platform/helpers/currency";
import { formatDdMmYyyy, formatTimeIst, istTodayIso } from "@/platform/helpers/date";

/**
 * What the office is told when an online payment becomes a receipt.
 *
 * Pure: the same facts make the phone notification and the five values of the
 * AiSensy template `vpps_staff_online_payment_en_v1`, whose approved body is
 *
 *   *Online fee received*
 *   Shri Veer Patta Sr. Sec. School
 *
 *   Student: {{1}}
 *   Class: {{2}}
 *   Amount: {{3}}
 *   Receipt: {{4}}
 *   Paid on: {{5}}
 *
 *   This payment came in through Razorpay, and its receipt has been posted to
 *   the fee ledger automatically. Nothing needs to be entered at the counter.
 *
 * A payment in a test session says so in the class line and the title, so a
 * pilot payment is never mistaken for real money.
 *
 * One (go-live Phase F, plan §8.4): ported from fees origin/main 78e27e4f with
 * the receipt link moved to `/fees/receipts/`. One does not send this
 * template to a list of numbers: the WhatsApp half goes through the staff
 * outbox as the `online_payment` kind (`vx_staff_online_payment_v1`, consent
 * and limits asked there, a child named only if the school allows it), so
 * `staffAlertTemplateParams` and `parseStaffAlertNumbers` are kept for parity
 * and the push text, not called by One's sender.
 */

export const STAFF_ALERT_CAMPAIGN = "vpps_staff_online_payment_en_v1";

export type StaffAlertFacts = {
  receiptId: string;
  receiptNumber: string;
  amountRupees: number;
  studentName: string;
  classLabel: string;
  sessionLabel: string | null;
  /** When the receipt was written (ISO timestamp). */
  postedAt: string;
};

export type StaffAlertPush = { title: string; body: string; url: string; tag: string };

function isTest(facts: StaffAlertFacts) {
  return Boolean(facts.sessionLabel && isTestAcademicSessionLabel(facts.sessionLabel));
}

function classLine(facts: StaffAlertFacts) {
  const label = facts.classLabel.trim() || "—";
  return isTest(facts) ? `${label} · ${facts.sessionLabel}` : label;
}

/** `30-10-2026, 11:42 am`, in India time. */
export function formatPaidOn(postedAt: string): string {
  const instant = new Date(postedAt);
  if (Number.isNaN(instant.getTime())) return "—";
  return `${formatDdMmYyyy(istTodayIso(instant))}, ${formatTimeIst(instant)}`;
}

export function staffAlertPush(facts: StaffAlertFacts): StaffAlertPush {
  const amount = formatInr(facts.amountRupees);
  return {
    title: `${isTest(facts) ? "TEST · " : ""}${amount} received online`,
    body: `${facts.studentName.trim() || "A student"} · ${classLine(facts)} · ${facts.receiptNumber}`,
    url: `/fees/receipts/${facts.receiptId}`,
    // One notification per receipt, even if a retry delivers it twice.
    tag: `online-payment-${facts.receiptId}`,
  };
}

/** The template's {{1}}…{{5}}, in order. */
export function staffAlertTemplateParams(facts: StaffAlertFacts): string[] {
  return [
    facts.studentName.trim() || "—",
    classLine(facts),
    formatInr(facts.amountRupees),
    facts.receiptNumber || "—",
    formatPaidOn(facts.postedAt),
  ];
}

/** Turns "+919413748575, 9352205884" into what AiSensy accepts, dropping what it would not. */
export function parseStaffAlertNumbers(
  raw: string | null | undefined,
  toDestination: (value: string) => string | null,
): string[] {
  const seen = new Set<string>();
  for (const part of String(raw ?? "").split(/[,\n;]+/)) {
    const destination = toDestination(part.trim());
    if (destination) seen.add(destination);
  }
  return [...seen];
}
