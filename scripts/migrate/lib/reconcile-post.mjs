/**
 * The daily money check after T0 (plan §12.1; review of PR #149): "frozen
 * baseline + One's postings + tail imports = One's totals", real sessions
 * only. Pure: aggregated rows in, verdicts out — counts and sums, never a
 * name or phone (I-5). reconcile-post.mjs reads the rows; tests pin the
 * arithmetic (tests/migrate-reconcile-post.test.ts).
 *
 * After the cutover row One takes the desk and the fees app takes only the
 * tail, so the two databases diverge by design and reconcile.mjs (One equal
 * to fees) no longer applies. What must hold instead, per real session:
 *
 *   1. FROZEN — everything One held at the cutover line is unchanged: receipts
 *      created at or before it, per mode (count and sum); their allocations
 *      (`payments`); EMI late-fee installments. Equal to the baseline frozen
 *      at C3 (`--baseline`). A difference is a pre-cutover receipt edited,
 *      deleted or back-dated.
 *   2. THE SUM — baseline + One's desk postings + tail postings = One's
 *      receipts now (count and sum, per mode). Postings are receipts created
 *      after the line; a tail posting is one a `vppsone.tail_receipts_review`
 *      row names as `posted_receipt_id`.
 *   3. POSTINGS ARE SOUND — no receipt number repeated, none after the line at
 *      or under `receipt_suffix_floor` (the fees app's range: a collision);
 *      every posted tail row's receipt exists, was posted after the line and
 *      carries the tail row's amount.
 * Reported, not failed (the Accountant explains each): postings whose
 * allocations differ from the receipt total, tail rows still pending, EMI
 * late fees charged after the line (their own line, critique1 A8), the
 * session money summary's change since the baseline (v_workbook_student_
 * financials caps money at each installment's base, so it is not a sum of
 * receipts), and TEST sessions, apart.
 */

import { isTestSessionLabel } from "./import-rules.mjs";

const ZERO = () => ({ count: 0, sum: 0 });

function add(into, key, count, sum) {
  into[key] ??= ZERO();
  into[key].count += Number(count ?? 0);
  into[key].sum += Number(sum ?? 0);
}

/**
 * One's ledger at the line, from aggregated rows:
 *   receipts:    { session_label, mode, frozen, count, sum }
 *   allocations: { session_label, frozen, count, sum }
 *   emi:         { session_label, frozen, count, sum }
 *   tailPosted:  [receipt ids] (posted_receipt_id of posted tail rows)
 *   postings:    { session_label, mode, tail, count, sum } — receipts after the line
 * Split into real and TEST sessions.
 *
 * @param {{ receipts?: any[], allocations?: any[], emi?: any[], postings?: any[] }} rows
 */
export function ledgerFromRows({ receipts = [], allocations = [], emi = [], postings = [] }) {
  const out = { real: emptySide(), test: emptySide() };
  for (const r of receipts) {
    const side = out[isTestSessionLabel(r.session_label) ? "test" : "real"];
    add(r.frozen ? side.frozenReceipts : side.receiptsNow, `${r.session_label}|${r.mode}`, r.count, r.sum);
    if (r.frozen) add(side.receiptsNow, `${r.session_label}|${r.mode}`, r.count, r.sum);
  }
  for (const a of allocations) {
    if (!a.frozen) continue;
    add(out[isTestSessionLabel(a.session_label) ? "test" : "real"].frozenAllocations, a.session_label, a.count, a.sum);
  }
  for (const e of emi) {
    const side = out[isTestSessionLabel(e.session_label) ? "test" : "real"];
    add(e.frozen ? side.frozenEmi : side.emiAfter, e.session_label, e.count, e.sum);
  }
  for (const p of postings) {
    const side = out[isTestSessionLabel(p.session_label) ? "test" : "real"];
    add(p.tail ? side.tailPostings : side.deskPostings, `${p.session_label}|${p.mode}`, p.count, p.sum);
  }
  return out;
}

function emptySide() {
  return {
    frozenReceipts: {},
    receiptsNow: {},
    frozenAllocations: {},
    frozenEmi: {},
    emiAfter: {},
    deskPostings: {},
    tailPostings: {},
  };
}

/** What the baseline row stores: the frozen parts of the real side, and TEST apart. */
export function baselineOf(ledger) {
  return {
    receipts: ledger.real.frozenReceipts,
    allocations: ledger.real.frozenAllocations,
    emi: ledger.real.frozenEmi,
    test: { receipts: ledger.test.frozenReceipts },
  };
}

/** Keys of two { key: {count,sum} } maps whose figures differ. */
export function differing(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys]
    .filter((k) => (left[k]?.count ?? 0) !== (right[k]?.count ?? 0) || (left[k]?.sum ?? 0) !== (right[k]?.sum ?? 0))
    .sort()
    .map((k) => ({ key: k, baseline: left[k] ?? ZERO(), now: right[k] ?? ZERO() }));
}

function total(map, filter = () => true) {
  const out = ZERO();
  for (const [key, v] of Object.entries(map)) {
    if (!filter(key)) continue;
    out.count += v.count;
    out.sum += v.sum;
  }
  return out;
}

/**
 * The verdict. `integrity`: { floor, duplicateNumbers, atOrUnderFloor, tailMissing,
 * tailAmountDiffers, tailBeforeLine, allocationDiffers, tailPending }.
 * Returns { ok, checks: [{ name, ok, detail }], sessions: [...], notes: [...] }.
 *
 * @param {{ baseline: any, ledger: any, integrity?: Record<string, any> }} input
 */
export function comparePostCutover({ baseline, ledger, integrity = {} }) {
  const real = ledger.real;
  const checks = [];

  const frozenReceipts = differing(baseline.receipts, real.frozenReceipts);
  checks.push({ name: "frozen receipts (per session and mode)", ok: frozenReceipts.length === 0, detail: frozenReceipts });
  const frozenAllocations = differing(baseline.allocations, real.frozenAllocations);
  checks.push({ name: "frozen allocations (per session)", ok: frozenAllocations.length === 0, detail: frozenAllocations });
  const frozenEmi = differing(baseline.emi, real.frozenEmi);
  checks.push({ name: "frozen EMI late fees (per session)", ok: frozenEmi.length === 0, detail: frozenEmi });

  // baseline + desk + tail = now, per session and mode.
  const expected = {};
  for (const map of [baseline.receipts, real.deskPostings, real.tailPostings]) {
    for (const [key, v] of Object.entries(map)) add(expected, key, v.count, v.sum);
  }
  const sum = differing(expected, real.receiptsNow);
  checks.push({ name: "baseline + desk postings + tail postings = One's receipts now", ok: sum.length === 0, detail: sum });

  checks.push({ name: "no receipt number used twice", ok: (integrity.duplicateNumbers ?? 0) === 0, detail: integrity.duplicateNumbers ?? 0 });
  // C3 sets the floor before the line; without it the check cannot be made.
  const floorSet = typeof integrity.floor === "number";
  checks.push({
    name: "no posting at or under receipt_suffix_floor",
    ok: floorSet && (integrity.atOrUnderFloor ?? 0) === 0,
    detail: floorSet ? integrity.atOrUnderFloor ?? 0 : "receipt_suffix_floor is not set (C3 sets it to 5000)",
  });
  const tailBad = (integrity.tailMissing ?? 0) + (integrity.tailAmountDiffers ?? 0) + (integrity.tailBeforeLine ?? 0);
  checks.push({
    name: "every posted tail row has its receipt, after the line, for its amount",
    ok: tailBad === 0,
    detail: { missing: integrity.tailMissing ?? 0, amountDiffers: integrity.tailAmountDiffers ?? 0, beforeLine: integrity.tailBeforeLine ?? 0 },
  });

  const labels = [...new Set([...Object.keys(baseline.receipts), ...Object.keys(real.receiptsNow)].map((k) => k.split("|")[0]))].sort();
  const sessions = labels.map((label) => {
    const inSession = (key) => key.startsWith(`${label}|`);
    return {
      session: label,
      baseline: total(baseline.receipts, inSession),
      desk: total(real.deskPostings, inSession),
      tail: total(real.tailPostings, inSession),
      now: total(real.receiptsNow, inSession),
      emiAfter: real.emiAfter[label] ?? ZERO(),
    };
  });

  const notes = [];
  if (integrity.allocationDiffers) notes.push(`${integrity.allocationDiffers} posting(s) whose allocations differ from the receipt total — the Accountant explains each`);
  if (integrity.tailPending) notes.push(`${integrity.tailPending} tail row(s) still pending (PARALLEL-RUN check 4)`);
  return { ok: checks.every((c) => c.ok), checks, sessions, notes };
}
