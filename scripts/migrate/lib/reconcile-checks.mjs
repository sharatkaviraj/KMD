/**
 * The figures reconcile.mjs compares, computed the same way on each side.
 * Pure: every function takes rows and returns plain objects of counts, sums
 * and hashes — never a name or phone (I-5).
 */

import { classRollups, sessionMoneySummary } from "./control-totals.mjs";
import { isTestSessionLabel } from "./import-rules.mjs";
import { canonical, md5, project } from "./rows.mjs";

/** The money columns a per-student checksum covers. */
export const STUDENT_MONEY_COLUMNS = [
  "student_id", "session_label", "class_id", "record_status", "total_due", "total_paid", "outstanding_amount",
  "base_charge_total", "base_outstanding_amount", "late_fee_total", "late_fee_waiver_amount",
  "late_fee_outstanding_amount", "discount_amount", "total_discount_closeouts", "overdue_installment_count",
];

/** student_id -> md5 of the money columns, for real sessions (or test ones). */
export function studentChecksums(financialRows, { test = false, exclude = new Set() } = {}) {
  const out = new Map();
  for (const row of financialRows) {
    if (isTestSessionLabel(row.session_label) !== test) continue;
    if (exclude.has(String(row.student_id))) continue;
    out.set(String(row.student_id), md5(canonical(project(row, STUDENT_MONEY_COLUMNS))));
  }
  return out;
}

/** Ids whose checksums differ or exist on one side only, sorted. */
export function checksumMismatches(left, right) {
  const ids = new Set([...left.keys(), ...right.keys()]);
  return [...ids].filter((id) => left.get(id) !== right.get(id)).sort();
}

/** Session summaries and class rollups for every session in the view rows. */
export function moneyBySession(financialRows, { test = false } = {}) {
  const labels = [...new Set(financialRows.map((r) => r.session_label))].filter((l) => l && isTestSessionLabel(l) === test).sort();
  return Object.fromEntries(labels.map((label) => [label, { summary: sessionMoneySummary(financialRows, label), classes: classRollups(financialRows, label) }]));
}

const RECEIPT_NUMBER = /^([A-Z0-9-]*?)(\d{8})-(\d{4,})$/;

/**
 * Receipts: count and sum per (mode, date); the highest suffix per (prefix,
 * date); distinct receipt numbers against the row count.
 */
/**
 * @param {any[]} receipts
 * @returns {{ count: number, distinctNumbers: number, byModeDate: Record<string, { count: number, sum: number }>, maxSuffix: Record<string, number> }}
 */
export function receiptFigures(receipts) {
  const byModeDate = {};
  const maxSuffix = {};
  const numbers = new Set();
  for (const r of receipts) {
    const key = `${r.payment_mode}|${r.payment_date}`;
    byModeDate[key] ??= { count: 0, sum: 0 };
    byModeDate[key].count += 1;
    byModeDate[key].sum += Number(r.total_amount ?? 0);
    numbers.add(r.receipt_number);
    const match = RECEIPT_NUMBER.exec(String(r.receipt_number ?? ""));
    if (match) {
      const k = `${match[1]}|${match[2]}`;
      maxSuffix[k] = Math.max(maxSuffix[k] ?? 0, Number(match[3]));
    }
  }
  return { count: receipts.length, distinctNumbers: numbers.size, byModeDate, maxSuffix };
}

/**
 * The online invariant: captured = on receipts + in review + waiting, over
 * captures; and every applied capture names a receipt that exists.
 */
export function onlineInvariant(captures, receiptIds) {
  const sum = (rows) => rows.reduce((n, c) => n + Number(c.amount_paise ?? 0), 0);
  const applied = captures.filter((c) => c.application_status === "applied");
  const review = captures.filter((c) => c.application_status === "review_required");
  const waiting = captures.filter((c) => c.application_status === "pending");
  const captured = sum(captures);
  const appliedWithoutReceipt = applied.filter((c) => !c.receipt_id || !receiptIds.has(String(c.receipt_id))).length;
  return {
    captured,
    onReceipts: sum(applied),
    inReview: sum(review),
    waiting: sum(waiting),
    holds: captured === sum(applied) + sum(review) + sum(waiting) && appliedWithoutReceipt === 0,
    appliedWithoutReceipt,
  };
}

/** Count per value of `columns` joined with '|'. */
export function countBy(rows, columns) {
  const out = {};
  for (const row of rows) {
    const key = columns.map((c) => row[c] ?? "null").join("|");
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** EMI late fees as their own line (critique1 A8): count and sum per session. */
export function emiLateFees(installments, classSession) {
  const out = {};
  for (const i of installments) {
    if (!i.is_emi_late_fee) continue;
    const label = classSession.get(String(i.class_id)) ?? "unknown";
    out[label] ??= { count: 0, sum: 0 };
    out[label].count += 1;
    out[label].sum += Number(i.amount_due ?? i.base_amount ?? 0);
  }
  return out;
}

/** Keys whose values differ between two plain objects (deep, canonical). */
export function differingKeys(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].filter((k) => canonical(left[k]) !== canonical(right[k])).sort();
}
