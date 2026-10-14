import { useEffect, type ReactNode } from "react";

import type { DeskLedgerRow } from "@/modules/payments/vx/domain/desk";
import type { GridRow } from "@/modules/payments/vx/domain/bulk-grid";
import type { BulkBoot, DeskBoot, DeskClass, DeskListStudent, DeskReceipt, DeskSaveResult, DeskStudent } from "@/modules/payments/vx/types";
import { BulkEntry } from "@/vx/screens/payments/bulk";
import { PaymentDesk, type DeskActions } from "@/vx/screens/payments/desk";

import type { DesignView } from "../design.fixture";

/*
 * Payment Desk (docs/design-handoff PayDesk.dc.html and the admin
 * prototype's F09/F10/D05/D06): the production desk with the design's own
 * synthetic sample — Class 7 on Thu 8 Oct 2026, Aarav Sharma's ₹7,000 by UPI,
 * Kunal Verma's repeated ₹3,000. States the desk reaches by typing (amount,
 * review, saved, duplicate) are reached the same way: the driver types and
 * presses, and the server actions answer with synthetic results.
 */

// The production shell mounts `#vx-layer` beside the page for sheets and
// toasts (src/vx/shell/shell.tsx); the fixture's shell does not, so the
// desk's review, duplicate and remove sheets would have nowhere to open.
if (typeof document !== "undefined" && !document.getElementById("vx-layer")) {
  const layer = document.createElement("div");
  layer.id = "vx-layer";
  layer.className = "vxt vx-layer";
  document.body.append(layer);
}

const TODAY = "2026-10-08";
const SESSION = "2026-27";
const LABELS = ["Nursery", "JKG", "SKG", ...Array.from({ length: 10 }, (_, i) => `Class ${i + 1}`), "11 Arts", "11 Commerce", "11 Science", "12 Arts", "12 Commerce", "12 Science"];
const short = (l: string) => l.replace("Nursery", "Nur").replace("Class ", "").replace(/ ([ACS])\w+$/, " $1");
const CLASSES: DeskClass[] = LABELS.map((label) => ({ id: `c-${label}`, label, short: short(label) }));
const cid = (label: string) => `c-${label}`;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const AARAV = uid(1234);
const KUNAL = uid(1187);
const DIYA = uid(1311);

const row = (over: Partial<DeskLedgerRow> & Pick<DeskLedgerRow, "id" | "installmentNo" | "label" | "dueDate" | "charge">): DeskLedgerRow => ({
  isCarryForward: false,
  feesPaid: 0,
  feesPending: over.charge - (over.feesPaid ?? 0),
  lateFeePending: 0,
  lateFeeRaw: 0,
  lateFeeWaived: 0,
  lateFeeStatus: "none",
  planPriority: 1,
  ...over,
});

const listed = (id: string, name: string, sr: string, cls: string, father: string, pendingToday: number, lateFee: number, phone = "98290 00000"): DeskListStudent => ({
  id, name, sr, classId: cid(cls), classLabel: cls, father, phone, pendingToday, lateFee,
});

const CLASS7: DeskListStudent[] = [
  listed(AARAV, "Aarav Sharma", "1234", "Class 7", "Rakesh Sharma", 6450, 1000, "9829000512"),
  listed(uid(1601), "Ananya Dave", "1601", "Class 7", "Dinesh Dave", 800, 0),
  listed(uid(1604), "Dev Kothari", "1604", "Class 7", "Lokesh Kothari", 12500, 2000),
  listed(uid(1592), "Harsh Mehta", "1592", "Class 7", "Mahesh Mehta", 2500, 1000),
  listed(uid(1607), "Nidhi Joshi", "1607", "Class 7", "Manoj Joshi", 0, 0),
  listed(uid(1589), "Prisha Regar", "1589", "Class 7", "Kamal Regar", 0, 0),
  listed(uid(1598), "Rudra Purohit", "1598", "Class 7", "Gopal Purohit", 0, 0),
  listed(uid(1595), "Saanvi Rathore", "1595", "Class 7", "Vivek Rathore", 7600, 1000),
];
const KUNAL_LISTED = listed(KUNAL, "Kunal Verma", "1187", "Class 4", "Sanjay Verma", 3350, 1000, "9829000641");

// A fresh collector id per page load: the desk keeps an unfinished save per
// collector in the browser, and one view must not find another's.
const runId = Math.random().toString(36).slice(2);
function boot(role: "accountant" | "admin", students: DeskListStudent[], today = { count: 14, amount: 38400 }): DeskBoot {
  const admin = role === "admin";
  return {
    sessionLabel: SESSION,
    today: TODAY,
    sessionStart: "2026-04-01",
    canPost: true,
    blocking: null,
    modes: ["cash", "upi", "bank_transfer", "cheque"],
    classes: CLASSES,
    students,
    todayCollection: today,
    lateFeeFlat: 1000,
    me: { id: `fixture-${role}-${runId}`, name: admin ? "Janmejay Singh" : "Ms. Neelam Sharma", isAdmin: admin, canWaive: admin, canRemove: admin, canBulk: admin },
  };
}

const aaravRows: DeskLedgerRow[] = [
  row({ id: uid(9000), installmentNo: 0, label: "Previous session balance", isCarryForward: true, dueDate: "2026-04-01", charge: 1200 }),
  row({ id: uid(9001), installmentNo: 1, label: "Installment 1", dueDate: "2026-04-20", charge: 7750, feesPaid: 7750, lateFeeRaw: 1000, lateFeeWaived: 1000, lateFeeStatus: "waived" }),
  row({ id: uid(9002), installmentNo: 2, label: "Installment 2", dueDate: "2026-07-20", charge: 7250, feesPaid: 2000, lateFeePending: 1000, lateFeeRaw: 1000, lateFeeStatus: "pending" }),
  row({ id: uid(9003), installmentNo: 3, label: "Installment 3", dueDate: "2026-10-20", charge: 7250 }),
  row({ id: uid(9004), installmentNo: 4, label: "Installment 4", dueDate: "2027-01-20", charge: 7250 }),
];
const aarav: DeskStudent = {
  id: AARAV,
  name: "Aarav Sharma",
  sr: "1234",
  classLabel: "Class 7",
  father: "Rakesh Sharma",
  phone: "9829000512",
  route: "Amet City",
  isNew: false,
  onPlan: false,
  repaymentPlan: null,
  rows: aaravRows,
  receipts: [
    { id: uid(8001), receiptNumber: "SVP20260802-0007", amount: 2000, mode: "upi", paymentDate: "2026-08-02", createdAt: "2026-08-02T05:00:00Z", isReversed: false },
    { id: uid(8000), receiptNumber: "SVP20260422-0031", amount: 7750, mode: "upi", paymentDate: "2026-04-22", createdAt: "2026-04-22T05:00:00Z", isReversed: false },
  ],
  siblings: [{ id: DIYA, name: "Diya Sharma", classLabel: "Class 3" }],
  plan: { tuition: 22000, transport: 7000, academic: 500, installments: 4 },
  readAt: "2026-10-08T05:10:00Z",
};

const kunal: DeskStudent = {
  ...aarav,
  id: KUNAL,
  name: "Kunal Verma",
  sr: "1187",
  classLabel: "Class 4",
  father: "Sanjay Verma",
  phone: "9829000641",
  rows: [
    row({ id: uid(9101), installmentNo: 1, label: "Installment 1", dueDate: "2026-04-20", charge: 6850, feesPaid: 6850 }),
    row({ id: uid(9102), installmentNo: 2, label: "Installment 2", dueDate: "2026-07-20", charge: 6350, feesPaid: 3000, lateFeePending: 1000, lateFeeRaw: 1000, lateFeeStatus: "pending" }),
    row({ id: uid(9103), installmentNo: 3, label: "Installment 3", dueDate: "2026-10-20", charge: 6350 }),
    row({ id: uid(9104), installmentNo: 4, label: "Installment 4", dueDate: "2027-01-20", charge: 6350 }),
  ],
  receipts: [
    { id: uid(8014), receiptNumber: "SVP20261008-0014", amount: 3000, mode: "cash", paymentDate: TODAY, createdAt: "2026-10-08T05:08:00Z", isReversed: false },
    { id: uid(8009), receiptNumber: "SVP20260416-0009", amount: 6850, mode: "cash", paymentDate: "2026-04-16", createdAt: "2026-04-16T05:00:00Z", isReversed: false },
  ],
  siblings: [],
  plan: { tuition: 18400, transport: 7000, academic: 500, installments: 4 },
};

function savedReceipt(by: string): DeskReceipt {
  return {
    id: uid(8015),
    receiptNumber: "SVP20261008-0015",
    studentId: AARAV,
    studentName: aarav.name,
    sr: aarav.sr,
    classLabel: aarav.classLabel,
    father: aarav.father,
    phone: aarav.phone,
    paymentDate: TODAY,
    createdAt: "2026-10-08T05:14:00Z",
    mode: "upi",
    reference: "6281 4410 7735",
    notes: null,
    receivedBy: by,
    total: 7000,
    lines: [
      { label: "Old balance 2025-26", amount: 1200 },
      { label: "Installment 2", amount: 5250 },
      { label: "Installment 3 · paid ahead", amount: 550 },
    ],
    lateFeePaid: 0,
    lateFeeWaived: 0,
    isReversed: false,
    outstandingAfter: 14950,
  };
}

function savedAnswer(by: string): DeskSaveResult {
  const receipt = savedReceipt(by);
  return {
    status: "saved",
    receipt,
    receiptId: receipt.id,
    receiptNumber: receipt.receiptNumber,
    balanceAfter: { pendingToday: 0, dueToday: 0, notDueYet: 13950, lateFee: 1000 },
    todayCollection: { count: 15, amount: 45400 },
    student: {
      ...aarav,
      rows: aaravRows.map((r) =>
        r.isCarryForward ? { ...r, feesPaid: 1200, feesPending: 0 } : r.installmentNo === 2 ? { ...r, feesPaid: 7250, feesPending: 0 } : r.installmentNo === 3 ? { ...r, feesPaid: 550, feesPending: 6700 } : r,
      ),
      receipts: [{ id: receipt.id, receiptNumber: receipt.receiptNumber, amount: 7000, mode: "upi", paymentDate: TODAY, createdAt: receipt.createdAt, isReversed: false }, ...aarav.receipts],
    },
  };
}

const duplicateAnswer: DeskSaveResult = {
  status: "duplicate",
  kind: "daily-amount",
  receiptId: uid(8014),
  receiptNumber: "SVP20261008-0014",
  createdAt: "2026-10-08T05:08:00Z",
  amount: 3000,
  mode: "cash",
  message: "Same student, amount and mode within ten minutes.",
};

function answers(post: DeskSaveResult | null): Partial<DeskActions> {
  return {
    postDeskPaymentAction: async () => post ?? { status: "error", message: "Fixture: nothing is posted." },
    checkDeskPaymentAction: async () => ({ status: "not_saved" }),
    loadDeskPreviewAction: async () => ({ ok: true, rows: aaravRows }),
    loadStudentDeskAction: async () => ({ ok: true, student: aarav }),
    loadReceiptAction: async () => null,
  };
}

/* ---------- the driver: types and presses the way a cashier would ---------- */

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
async function until(test: () => boolean, ms = 1500) {
  const end = performance.now() + ms;
  while (!test() && performance.now() < end) await frame();
}
function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim().includes(text) && b.offsetParent !== null);
}
async function type(selector: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(selector);
  if (!el) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await frame();
}
async function press(text: string) {
  await until(() => Boolean(button(text) && !button(text)!.disabled));
  button(text)?.click();
  await frame();
}
type Step = "amount" | "review" | "save" | "dup";

function Driven({ steps, amount = "7000", children }: { steps: Step[]; amount?: string; children: ReactNode }) {
  useEffect(() => {
    if (!steps.length) return;
    void (async () => {
      // The desk checks this collector's unfinished saves before it lets Review run.
      await until(() => Boolean(button("Review & save") && !button("Review & save")!.disabled));
      for (const step of steps) {
        if (step === "amount" || step === "dup") {
          await type("#pd-amount", amount);
          if (step === "amount") {
            await press("UPI");
            await type('input[placeholder^="12-digit"]', "6281 4410 7735");
          }
        }
        if (step === "review") await press("Review & save");
        if (step === "save") await press("Save payment");
      }
    })();
  }, [steps, amount]);
  return <>{children}</>;
}

/* ---------- views ---------- */

type Role = "accountant" | "admin";
const STILL = <style>{"*,*::before,*::after{animation-delay:0s!important;animation-duration:1ms!important;transition-duration:1ms!important}"}</style>;

function desk(role: Role, state: "find" | "student" | "amount" | "confirm" | "saved" | "duplicate"): DesignView {
  const menu = role === "accountant" ? ("accountant" as const) : undefined;
  const by = role === "admin" ? "Janmejay Singh" : "Ms. Neelam Sharma";
  // Built once per view, as the server would hand them over: the desk resets
  // when its boot or its first student changes identity.
  const dupe = state === "duplicate";
  const b = boot(role, dupe ? [...CLASS7, KUNAL_LISTED] : CLASS7);
  const first = state === "find" ? null : { ok: true as const, student: dupe ? kunal : aarav };
  const api = answers(state === "find" ? null : dupe ? duplicateAnswer : savedAnswer(by));
  const steps: Step[] = dupe ? ["dup", "review", "save"] : state === "amount" ? ["amount"] : state === "confirm" ? ["amount", "review"] : state === "saved" ? ["amount", "review", "save"] : [];
  return {
    menu,
    path: "/payments",
    render: () => (
      <>
        {STILL}
        <Driven steps={steps} amount={dupe ? "3000" : "7000"}>
          <PaymentDesk boot={b} previewing={false} initialStudentId={first ? first.student.id : null} initialStudent={first} initialReceipt={null} actions={api} />
        </Driven>
      </>
    ),
  };
}

const gridStudents = [
  { id: uid(1031), name: "Mohit Agarwal", sr: "1031", classLabel: "Class 9", father: "Anil Agarwal" },
  { id: uid(933), name: "Pooja Mehta", sr: "0933", classLabel: "11 Commerce", father: "Dinesh Mehta" },
  { id: uid(1205), name: "Riya Singh", sr: "1205", classLabel: "Class 6", father: "Vikram Singh" },
  { id: DIYA, name: "Diya Sharma", sr: "1311", classLabel: "Class 3", father: "Rakesh Sharma" },
  { id: KUNAL, name: "Kunal Verma", sr: "1187", classLabel: "Class 4", father: "Sanjay Verma" },
  { id: uid(1670), name: "Harsh Paliwal", sr: "1670", classLabel: "Class 10", father: "Ramesh Paliwal" },
];
const gridRows: GridRow[] = [
  { key: "r1", sr: "1031", amount: "3000", date: "2026-10-05", mode: "upi", reference: "5521 8830 4410" },
  { key: "r2", sr: "0933", amount: "4000", date: "2026-10-05", mode: "bank_transfer", reference: "SBIN2610054471" },
  { key: "r3", sr: "1205", amount: "2000", date: "2026-10-06", mode: "cash", reference: "" },
  { key: "r4", sr: "1311", amount: "2350", date: "2026-10-06", mode: "cheque", reference: "" },
  { key: "r5", sr: "1187", amount: "3350", date: "2026-10-07", mode: "cash", reference: "" },
  { key: "r6", sr: "1670", amount: "5000", date: "2026-10-07", mode: "upi", reference: "" },
  { key: "r7", sr: "9999", amount: "1500", date: "2026-10-07", mode: "cash", reference: "" },
];
function bulk(role: Role): DesignView {
  const b: BulkBoot = {
    sessionLabel: SESSION,
    today: TODAY,
    sessionStart: "2026-04-01",
    students: gridStudents,
    modes: ["cash", "upi", "bank_transfer", "cheque"],
    canBulk: role === "admin",
    me: role === "admin" ? "Janmejay Singh" : "Ms. Neelam Sharma",
    todayCollection: { count: 14, amount: 38400 },
  };
  return { menu: role === "accountant" ? "accountant" : undefined, path: "/payments", render: () => <>{STILL}<BulkEntry boot={b} previewing={false} collectable initialRows={gridRows} /></> };
}

export const views: Record<string, DesignView> = {
  PayDesk: desk("accountant", "find"),
  "DX-PayDesk-Amount": desk("accountant", "amount"),
  "DX-PayDesk-Saved": desk("accountant", "saved"),
  "DX-PayDesk-Bulk": bulk("accountant"),
  "PX-PayDesk": desk("admin", "find"),
  "PX-PayDesk-Student": desk("admin", "student"),
  "M-PayDesk": desk("accountant", "find"),
  "M-PayDesk-Student": desk("accountant", "student"),
  "M-PayDesk-Amount": desk("accountant", "amount"),
  "M-PayDesk-Confirm": desk("accountant", "confirm"),
  "M-PayDesk-Saved": desk("accountant", "saved"),
  "M-PayDesk-Duplicate": desk("accountant", "duplicate"),
  "MPX-PayDesk": desk("admin", "find"),
  "MPX-PayDesk-Student": desk("admin", "student"),
  "F09-Collect": desk("admin", "student"),
  "F10-CollectDone": desk("admin", "saved"),
  "D05-Collect": desk("admin", "amount"),
  "D06-Receipt": desk("admin", "saved"),
};
