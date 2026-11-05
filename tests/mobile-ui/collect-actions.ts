/*
 * Collect's bridge actions for the browser fixture (`collect.html`): an
 * in-memory synthetic ledger. Invented children only; nothing reaches a
 * server. `?lost=1` loses the first payment's answer (it is still "saved"),
 * so the screen must check the same command id instead of posting again.
 */
import type { DeskLedgerRow } from "@/modules/payments/vx/domain/desk";
import type { CollectDues, CollectPost, CollectReceiptRow, CollectStudentRow, PostOutcome, Prepared, SavedReceipt, StatusOutcome } from "@/modules/collect/domain/types";
import type { DuesAnswer, SearchAnswer } from "@/modules/collect/data/money-port";

const TODAY = "2026-11-05";
const DUES = ["2026-07-10", "2026-09-10", "2026-11-10", "2027-01-10"];
const LATE = 200;

type Kid = { id: string; name: string; sr: string; cls: string; father: string; phone: string; fee: number; paid: number[]; home: string; receipts: CollectReceiptRow[]; plan?: boolean };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const r = (n: number, date: string, amount: number, mode = "Cash"): CollectReceiptRow => ({ id: id(900 + n), number: `SVP${date.replace(/-/g, "")}-${String(n).padStart(4, "0")}`, date, amount, mode, createdAt: `${date}T05:00:00Z`, reversed: false });

const KIDS: Kid[] = [
  { id: id(1), name: "Aarav Sample", sr: "1043", cls: "7B", father: "Sunil Sample", phone: "9000000012", fee: 3000, paid: [3000, 0, 0, 0], home: "h1", receipts: [r(4, "2026-07-12", 3000)] },
  { id: id(2), name: "Diya Sample", sr: "1188", cls: "3A", father: "Sunil Sample", phone: "9000000012", fee: 2400, paid: [2400, 1200, 0, 0], home: "h1", receipts: [r(5, "2026-07-12", 2400), r(11, "2026-09-18", 1200, "UPI")] },
  { id: id(3), name: "Kabir Fixture", sr: "0871", cls: "10A", father: "Mahendra Fixture", phone: "9000000027", fee: 4500, paid: [4500, 4500, 0, 0], home: "h2", receipts: [r(1, "2026-07-10", 4500), r(3, "2026-09-09", 4500, "Cheque")] },
  { id: id(4), name: "Vihaan Demo", sr: "0955", cls: "9C", father: "Anil Demo", phone: "9000000045", fee: 3800, paid: [3800, 2000, 0, 0], home: "h3", receipts: [r(2, "2026-07-10", 3800), r(6, TODAY, 2000)] },
  { id: id(5), name: "Reyansh Testcase", sr: "1012", cls: "8A", father: "Bhanwar Lal Testcase", phone: "9000000063", fee: 3200, paid: [3200, 0, 0, 0], home: "h4", receipts: [r(9, "2026-07-16", 3200, "UPI")] },
  { id: id(6), name: "Prisha Testcase", sr: "1265", cls: "5A", father: "Bhanwar Lal Testcase", phone: "9000000063", fee: 2800, paid: [2800, 0, 0, 0], home: "h4", receipts: [r(10, "2026-07-16", 2800, "UPI")] },
  { id: id(7), name: "Rudra Testcase", sr: "1388", cls: "1B", father: "Bhanwar Lal Testcase", phone: "9000000063", fee: 2200, paid: [2200, 2200, 0, 0], home: "h4", receipts: [r(12, "2026-07-16", 2200, "UPI"), r(7, "2026-09-12", 2200)] },
  { id: id(8), name: "Aditya Narayan Singh Sample-Longname", sr: "0690", cls: "12 Arts", father: "Bhupendra Singh Sample-Longname", phone: "9000000129", fee: 5200, paid: [5200, 0, 0, 0], home: "h5",
    receipts: [r(20, "2026-04-15", 1000), r(21, "2026-05-15", 1000), r(22, "2026-06-15", 1000), r(23, "2026-07-01", 1100), r(24, "2026-07-08", 1100), r(25, "2026-08-02", 0)] },
  { id: id(9), name: "Navya Plan", sr: "1401", cls: "LKG", father: "Sanjay Plan", phone: "9000000134", fee: 1800, paid: [1800, 0, 0, 0], home: "h6", receipts: [], plan: true },
];
const posted = new Map<string, { post: CollectPost; receipt: SavedReceipt }>();
let seq = 30;

function rowsOf(k: Kid, onDate: string): DeskLedgerRow[] {
  return DUES.map((due, i) => {
    const pending = k.fee - k.paid[i];
    const late = pending > 0 && onDate > due ? LATE : 0;
    return { id: id(100 + i + Number(k.id.slice(-3)) * 10), installmentNo: i + 1, label: `Installment ${i + 1}`, isCarryForward: false, dueDate: due, charge: k.fee, feesPaid: k.paid[i], feesPending: pending, lateFeePending: late, lateFeeRaw: late, lateFeeWaived: 0, lateFeeStatus: late ? "pending" : "none", planPriority: 1 };
  });
}
function row(k: Kid): CollectStudentRow {
  const rows = rowsOf(k, TODAY);
  return { id: k.id, name: k.name, sr: k.sr, classLabel: k.cls, father: k.father, phone: k.phone, fees: rows.reduce((s, x) => s + x.feesPending, 0), late: rows.reduce((s, x) => s + x.lateFeePending, 0), siblings: KIDS.filter((o) => o.home === k.home).length - 1 };
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function collectSearchAction(_session: string, query: string): Promise<SearchAnswer> {
  await wait(60);
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  const digits = q.replace(/\D/g, "");
  const hits = KIDS.filter((k) => (digits && digits === q.replace(/\s/g, "") ? k.phone.includes(digits) || k.sr.replace(/^0+/, "").startsWith(digits.replace(/^0+/, "")) : `${k.name} ${k.father}`.toLowerCase().includes(q)));
  return { ok: true, rows: hits.map(row) };
}

export async function collectDuesAction(studentId: string): Promise<DuesAnswer> {
  await wait(80);
  const k = KIDS.find((x) => x.id === studentId);
  if (!k) return { ok: false, message: "Not found." };
  const dues: CollectDues = {
    student: { id: k.id, name: k.name, sr: k.sr, classLabel: k.cls, father: k.father, phone: k.phone },
    rows: rowsOf(k, TODAY),
    onPlan: Boolean(k.plan),
    receipts: [...k.receipts].reverse(),
    olderReceipts: 0,
    siblings: KIDS.filter((o) => o.home === k.home && o.id !== k.id).map((o) => ({ id: o.id, name: o.name, classLabel: o.cls, outstanding: row(o).fees })),
    siblingsKnown: true,
    acceptedModes: ["cash", "upi", "bank_transfer", "cheque"],
  };
  return { ok: true, dues };
}

export async function collectQuoteAction(input: { studentId: string; amount: number; paymentDate: string; waive: boolean }): Promise<Prepared> {
  await wait(60);
  const k = KIDS.find((x) => x.id === input.studentId);
  if (!k) return { ok: false, message: "Not found." };
  const rows = rowsOf(k, input.paymentDate);
  const fees = rows.reduce((s, x) => s + x.feesPending, 0);
  const late = rows.reduce((s, x) => s + x.lateFeePending, 0);
  return { ok: true, quoteHash: "a".repeat(32), lateFee: late, maxPayable: fees + (input.waive ? 0 : late), rows: null, acceptedModes: ["cash", "upi", "bank_transfer", "cheque"] };
}

export async function collectPostAction(input: CollectPost & { sessionLabel: string }): Promise<PostOutcome> {
  await wait(300);
  const k = KIDS.find((x) => x.id === input.studentId);
  if (!k) return { kind: "refused", code: "not_found", message: "Not found.", quoteChanged: false };
  if (k.receipts.some((x) => x.date === TODAY) && !input.acknowledgeDailyDuplicate) {
    return { kind: "duplicate", near: false, message: "A matching payment already exists. Confirm this is a separate collection.", receiptNumber: k.receipts.find((x) => x.date === TODAY)?.number ?? null };
  }
  const receipt: SavedReceipt = {
    receiptId: id(500 + seq), receiptNumber: `SVP20261105-${String(seq++).padStart(4, "0")}`, studentId: k.id, amount: input.amount, paymentDate: input.paymentDate,
    paymentMode: input.tenders ? "split" : (input.paymentMode ?? "cash"), tenders: input.tenders, receivedBy: "Synthetic Cashier", lateFeeWaived: input.lateFeeWaiver,
    remaining: Math.max(0, row(k).fees - input.amount), printHref: "#print", printExternal: false,
  };
  posted.set(input.commandId, { post: input, receipt });
  const flag = "collect-fixture-lost-once";
  if (new URLSearchParams(location.search).get("lost") === "1" && !sessionStorage.getItem(flag)) {
    sessionStorage.setItem(flag, "1");
    throw new Error("Synthetic lost answer");
  }
  return { kind: "saved", receipt };
}

export async function collectStatusAction(input: { commandId: string }): Promise<StatusOutcome> {
  await wait(200);
  const hit = posted.get(input.commandId);
  return hit ? { kind: "saved", receipt: hit.receipt } : { kind: "not_saved" };
}

export function postedCount() {
  return posted.size;
}
