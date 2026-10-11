import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { deskTotals, walkPayment, composeReference, composeRemarks, deskProblems, findRecentDuplicate, helperChips } from "../../src/modules/payments/vx/domain/desk.ts";
const start = performance.now();
const rows = [
  { id: "ops-old", installmentNo: 0, label: "Old balance", isCarryForward: true, dueDate: "2026-04-01", charge: 200, feesPaid: 0, feesPending: 200, lateFeePending: 0, lateFeeRaw: 0, lateFeeWaived: 0, lateFeeStatus: "none", planPriority: 1 },
  { id: "ops-now", installmentNo: 1, label: "Synthetic installment 1", isCarryForward: false, dueDate: "2026-07-20", charge: 600, feesPaid: 0, feesPending: 600, lateFeePending: 100, lateFeeRaw: 100, lateFeeWaived: 0, lateFeeStatus: "pending", planPriority: 1 },
  { id: "ops-future", installmentNo: 2, label: "Synthetic installment 2", isCarryForward: false, dueDate: "2027-01-20", charge: 300, feesPaid: 0, feesPending: 300, lateFeePending: 0, lateFeeRaw: 0, lateFeeWaived: 0, lateFeeStatus: "none", planPriority: 1 },
];
const options = { today: "2026-10-11", paymentDate: "2026-10-11", waiveLate: false };
const results = [];
function check(name, expected, getActual) { const actual = getActual(); try { assert.deepEqual(actual, expected); results.push({ name, status: "passed", expected, actual }); } catch (error) { results.push({ name, status: "failed", expected, actual, error: error.message }); } }
check("overdue + future + late kept separate", { pendingToday: 800, dueToday: 0, notDueYet: 300, lateFee: 100, canTakeToday: 900, wholeYear: 1200 }, () => deskTotals(rows, options.today));
check("partial old balance settles first", [["ops-old", 111, 0], ["ops-now", 0, 0], ["ops-future", 0, 0]], () => walkPayment(rows, 111, options).lines.map(l => [l.row.id, l.feesPaid, l.lateFeePaid]));
check("full payment clears all", { pendingToday: 0, dueToday: 0, notDueYet: 0, lateFee: 0 }, () => walkPayment(rows, 1200, options).after);
check("advance after current dues pays future", 100, () => walkPayment(rows, 1000, options).lines.find(l => l.row.id === "ops-future").feesPaid);
check("overpayment is rejected without credit", { overMax: true, credit: 0, maxAmount: 1200 }, () => { const w = walkPayment(rows, 1201, options); return { overMax: w.overMax, credit: w.credit, maxAmount: w.maxAmount }; });
check("EMI priority settles planned installment first", "ops-future", () => walkPayment(rows.map(r => r.id === "ops-future" ? { ...r, planPriority: 0 } : r), 100, options).lines[0].row.id);
check("late waiver stays separate from received money", { waiver: 100, lateAfter: 0, max: 1100 }, () => { const w = walkPayment(rows, 800, { ...options, waiveLate: true }); return { waiver: w.waiverAmount, lateAfter: w.after.lateFee, max: w.maxAmount }; });
check("backdated full installment clears avoidable late", { dropped: true, lateAfter: 0, futurePaid: 100 }, () => { const w = walkPayment(rows, 900, { ...options, paymentDate: "2026-07-18" }); return { dropped: w.lines.find(l => l.row.id === "ops-now").lateFeeDropped, lateAfter: w.after.lateFee, futurePaid: w.lines.find(l => l.row.id === "ops-future").feesPaid }; });
check("backdated partial retains late", 100, () => walkPayment(rows, 400, { ...options, paymentDate: "2026-07-18" }).after.lateFee);
check("cash never carries irrelevant reference", "", () => composeReference({ mode: "cash", reference: "IGNORE", chequeNo: "" }));
check("UPI reference whitespace normalizes", "OPS 62814410", () => composeReference({ mode: "upi", reference: " OPS  62814410 ", chequeNo: "" }));
check("bank reference survives", "OPS-BANK-1", () => composeReference({ mode: "bank_transfer", reference: "OPS-BANK-1", chequeNo: "" }));
check("cheque number retains leading zero", "004518", () => composeReference({ mode: "cheque", reference: "IGNORE", chequeNo: " 004518 " }));
check("cheque bank date waiver note audit retained", "Cheque: Synthetic Bank, dated 2026-10-10; subject to clearing. Late fee waived: Synthetic approved reason (ops-fee-20261011). Synthetic note", () => composeRemarks({ mode: "cheque", chequeBank: "Synthetic Bank", chequeDate: "2026-10-10", waiveLate: true, waiveReason: "Synthetic approved reason", waiveNote: "ops-fee-20261011", notes: "Synthetic note" }));
const draft = { amount: 111, paymentDate: options.today, mode: "cash", chequeNo: "", chequeBank: "", waiveLate: false, waiveReason: "" };
const ctx = { today: options.today, sessionStart: "2026-04-01", lateFeeOwed: 100 };
check("future date blocked", ["date-future"], () => deskProblems({ ...draft, paymentDate: "2026-10-12" }, { maxAmount: 1200, overMax: false }, ctx).map(p => p.key));
check("session boundary blocked", ["date-before-session"], () => deskProblems({ ...draft, paymentDate: "2026-03-31" }, { maxAmount: 1200, overMax: false }, ctx).map(p => p.key));
check("cheque requires number and bank", ["cheque-no", "cheque-bank"], () => deskProblems({ ...draft, mode: "cheque" }, { maxAmount: 1200, overMax: false }, ctx).map(p => p.key));
check("waiver requires reason", ["waive-reason"], () => deskProblems({ ...draft, waiveLate: true }, { maxAmount: 1200, overMax: false }, ctx).map(p => p.key));
check("duplicate same amount/mode recognized", "ops-receipt", () => findRecentDuplicate([{ id: "ops-receipt", receiptNumber: "OPS-1", amount: 111, mode: "cash", paymentDate: options.today, createdAt: "2026-10-11T10:00:00Z", isReversed: false }], { amount: 111, mode: "cash" }, Date.parse("2026-10-11T10:00:30Z"))?.id);
check("reversed duplicate ignored", null, () => findRecentDuplicate([{ id: "ops-receipt", receiptNumber: "OPS-1", amount: 111, mode: "cash", paymentDate: options.today, createdAt: "2026-10-11T10:00:00Z", isReversed: true }], { amount: 111, mode: "cash" }, Date.parse("2026-10-11T10:00:30Z")));
check("waiver quick amounts lower by100", [800, 1100], () => helperChips(rows, options.today, { waiveLate: true }).map(c => c.amount));
const report = { runId: "ops-fee-20261011", route: "/payments", layer: "pure domain synthetic", databaseCalls: 0, durationMs: performance.now() - start, passed: results.filter(r => r.status === "passed").length, failed: results.filter(r => r.status === "failed").length, results };
writeFileSync(new URL("../../../evidence/fee-collector-domain.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
