import type { DesignView } from "../design.fixture";

import type { AccRequestRow, AccountsHomeData, BooksData, ChequeRow, UpiLineRow } from "@/modules/finance-controls/vx/types";
import { AccountsHome } from "@/vx/screens/accounts/accounts-home";
import { Books, type BooksSheet, type BooksView } from "@/vx/screens/accounts/books";

/*
 * The accountant's own screens (AccHome, AccBooks) beside their frames. The
 * records copy the design's sample data (AccHome.dc.html, AccBooks.dc.html):
 * synthetic names and amounts, no database. The school clock is moved to the
 * frame's moment (Thu 8 Oct, 10:42 am; 5:30 pm for the evening) so "waiting
 * since" and "asked at" read as they do in the pictures.
 */

const VIEW = new URLSearchParams(location.search).get("view") ?? "";
const MINE = /^(DX-|M-)?Acc(Home|Books)/.test(VIEW);

function shiftClock(iso: string) {
  const Real = Date;
  const shift = Real.parse(iso) - Real.now();
  class Shifted extends Real {
    constructor(...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      super(...((args.length ? args : [Real.now() + shift]) as [any]));
    }
    static now() {
      return Real.now() + shift;
    }
  }
  globalThis.Date = Shifted as DateConstructor;
}
if (MINE) shiftClock(VIEW.includes("Evening") ? "2026-10-08T17:30:00+05:30" : "2026-10-08T10:42:00+05:30");
// The app shell gives sheets a layer beside the page (`#vx-layer`, shell.tsx); the design fixture's shell does not.
if (MINE && !document.getElementById("vx-layer")) {
  const layer = document.createElement("div");
  layer.id = "vx-layer";
  layer.className = "vxt vx-layer";
  document.body.appendChild(layer);
}
// Next inlines NEXT_PUBLIC_* at build time; the fixture has no `process`, so give the slip its school name.
if (MINE && typeof (globalThis as { process?: unknown }).process === "undefined") {
  (globalThis as unknown as { process: { env: Record<string, string> } }).process = { env: { NEXT_PUBLIC_SCHOOL_NAME: "Shri Veer Patta Sr. Sec. School" } };
}

const at = (hm: string, day = "2026-10-08") => `${day}T${hm}:00+05:30`;

// ---------------------------------------------------------------- AccHome

/** The design's spark: receipts at minutes after 8:00, running total against 8:00 → now. */
const REC: [number, number][] = [[5, 3100], [18, 1000], [30, 3150], [39, 700], [47, 2500], [58, 1175], [72, 4800], [80, 1200], [91, 6000], [104, 1500], [118, 3900], [125, 2175], [141, 2850], [158, 4350]];
const spark = (() => {
  let cum = 0;
  const pts: [number, number][] = [[0, 58], ...REC.map(([m, a]): [number, number] => {
    cum += a;
    return [Math.round((m / 165) * 2000) / 10, Math.round((58 - (cum / 38400) * 52) * 10) / 10];
  })];
  const line = pts.map((pt) => pt.join(",")).join(" ");
  const last = pts[pts.length - 1];
  return { line, area: `0,58 ${line} ${last[0]},58`, endY: last[1] };
})();

const req = (r: Partial<AccRequestRow> & Pick<AccRequestRow, "id" | "kind" | "title" | "reason" | "requestedAt" | "status">): AccRequestRow => ({
  amount: null,
  studentId: null,
  studentName: null,
  receiptId: null,
  requestedByName: "Neelam Sharma",
  mine: true,
  remindedAt: null,
  decidedAt: null,
  decidedByName: null,
  decisionNote: null,
  withdrawnAt: null,
  canRemind: r.status === "waiting",
  ...r,
});

const cheque = (c: Partial<ChequeRow> & Pick<ChequeRow, "receiptId" | "receiptNumber" | "paymentDate" | "amount" | "studentName" | "classLabel" | "status">): ChequeRow => ({
  studentId: `s-${c.receiptId}`,
  chequeNo: null,
  bank: null,
  chequeDate: c.paymentDate,
  reference: null,
  receiptNotes: null,
  statusAt: null,
  slipNo: null,
  bounceReason: null,
  reversed: false,
  fatherName: null,
  ...c,
});

const home: AccountsHomeData = {
  today: "2026-10-08",
  tomorrow: "2026-10-09",
  sessionLabel: "2026-27",
  collected: {
    total: 38400,
    count: 14,
    lastAt: at("10:38"),
    modes: [{ mode: "upi", total: 31175, count: 9 }, { mode: "cash", total: 7225, count: 5 }],
    spark,
    usual: 32600,
    vsUsual: 18,
    reversedCount: 0,
  },
  closure: null,
  queue: [
    { id: "q1", studentId: "s1", familyLabel: "Rakesh Sharma · Aarav Sharma", classLabel: "Class 7", note: null, arrivedAt: at("10:39"), pendingToday: 12640 },
    { id: "q2", studentId: "s2", familyLabel: "Kishan Jain · Aryan Jain", classLabel: "Class 9", note: "Promised to pay today", arrivedAt: at("10:41"), pendingToday: 7800 },
    { id: "q3", studentId: "s3", familyLabel: "Sunil Mehta · Jiya Mehta", classLabel: "Class 4", note: "Promised to pay today", arrivedAt: at("10:42"), pendingToday: 5700 },
  ],
  followUpsToday: { count: 9, next: "Vinod Paliwal", kept: 2, pending: 59700 },
  chequesToDeposit: { count: 3, total: 21600 },
  upiOpen: { count: 2, total: 3375 },
  requests: [
    req({ id: "r1", kind: "late_fee_waiver", title: "Waive late fee ₹230", studentName: "Riya Singh", reason: "father lost his job in August", requestedAt: at("09:40"), status: "waiting", amount: 230 }),
    req({ id: "r2", kind: "late_fee_waiver", title: "Waive late fee ₹300", studentName: "Mohit Agarwal", reason: "first time late", requestedAt: at("16:05", "2026-10-07"), status: "approved", decidedAt: at("10:12"), decidedByName: "Janmejay", amount: 300 }),
    req({ id: "r3", kind: "reversal", title: "Reverse R-0409", studentName: "Sneha Bhati", reason: "typed ₹1,175, parent paid ₹1,275", requestedAt: at("10:20"), status: "waiting", amount: 1175 }),
  ],
  reminders: { paused: false, familiesPendingToday: 46, nextInstallment: "Installment 3 · 2026-10-20" },
  cashExpected: { total: 7225, count: 5 },
  tomorrowFollowUps: [],
  chequesForBank: [],
};

const evening: AccountsHomeData = {
  ...home,
  collected: { ...home.collected, total: 61240, count: 23, lastAt: at("17:05"), modes: [{ mode: "upi", total: 38190, count: 13 }, { mode: "cash", total: 18650, count: 9 }, { mode: "cheque", total: 4400, count: 1 }] },
  closure: { status: "closed", closedAt: at("17:22"), closedByName: "Neelam" },
  queue: [],
  upiOpen: { count: 0, total: 0 },
  tomorrowFollowUps: [
    { studentId: "t1", studentName: "Mahendra Singh", classLabel: "Riya · Class 6", pendingToday: 7800, note: "Visit · 11 am" },
    { studentId: "t2", studentName: "Lalit Regar", classLabel: "Nikhil · Class 9, Sonu · Class 6", pendingToday: 12400, note: "UPI · morning" },
    { studentId: "t3", studentName: "Dinesh Sen", classLabel: "Ayaan · Class 1", pendingToday: 6900, note: "Visit · after school" },
    { studentId: "t4", studentName: "Suresh Meena", classLabel: "Pihu · UKG", pendingToday: 4350, note: "Half now" },
  ],
  chequesForBank: [
    cheque({ receiptId: "e1", receiptNumber: "R-0412", paymentDate: "2026-10-07", amount: 7000, studentName: "Dev Rathore", classLabel: "11 Science", chequeNo: "004512", bank: "SBI Amet", status: "to_deposit" }),
    cheque({ receiptId: "e2", receiptNumber: "R-0398", paymentDate: "2026-10-06", amount: 8200, studentName: "Ritu Solanki", classLabel: "Class 5", chequeNo: "553019", bank: "HDFC Rajsamand", status: "to_deposit" }),
    cheque({ receiptId: "e3", receiptNumber: "R-0397", paymentDate: "2026-10-06", amount: 6400, studentName: "Naman Kothari", classLabel: "Class 2", chequeNo: "220871", bank: "PNB Amet", status: "to_deposit" }),
    cheque({ receiptId: "e4", receiptNumber: "R-0431", paymentDate: "2026-10-08", amount: 4400, studentName: "Vansh Chouhan", classLabel: "Class 8", chequeNo: "330145", bank: "SBI Amet", status: "to_deposit" }),
  ],
};

// The evening checklist ticks live on the device; the frame has three of four in the bag.
if (MINE && VIEW.includes("Evening")) {
  try {
    window.localStorage.setItem("vx:acc-bag:2026-10-08", "e1,e2,e3");
  } catch {
    /* private window */
  }
}

const homeView = (view: "home" | "menu" | "evening", data = home) =>
  function AccHomeView() {
    return <AccountsHome data={data} view={view} greet={view === "evening" ? "Good evening" : "Good morning"} staffName="Ms. Neelam Sharma" canCollect canAccounts canManage={false} readOnly={false} />;
  };

// ---------------------------------------------------------------- AccBooks

const books: BooksData = {
  today: "2026-10-08",
  sessionLabel: "2026-27",
  canDecide: false,
  canWrite: true,
  cheques: [
    cheque({ receiptId: "c1", receiptNumber: "R-0401", paymentDate: "2026-10-07", amount: 7000, studentName: "Dev Rathore", fatherName: "Ajay Rathore", classLabel: "11 Science", chequeNo: "004512", bank: "SBI · Amet", status: "to_deposit" }),
    cheque({ receiptId: "c2", receiptNumber: "R-0392", paymentDate: "2026-10-06", amount: 8400, studentName: "Yashvi Mehta", fatherName: "Dilip Mehta", classLabel: "Class 8", chequeNo: "551203", bank: "Bank of Baroda · Amet", status: "to_deposit" }),
    cheque({ receiptId: "c3", receiptNumber: "R-0384", paymentDate: "2026-10-05", amount: 6200, studentName: "Lakshya Gurjar", fatherName: "Ramesh Gurjar", classLabel: "Class 4", chequeNo: "087745", bank: "PNB · Kelwa", status: "to_deposit" }),
    cheque({ receiptId: "c4", receiptNumber: "R-0386", paymentDate: "2026-10-05", chequeDate: "2026-10-15", amount: 10200, studentName: "Ruhi Solanki", fatherName: "Gajendra Solanki", classLabel: "Class 2", chequeNo: "340961", bank: "ICICI · Rajsamand", status: "to_deposit" }),
    cheque({ receiptId: "c5", receiptNumber: "R-0371", paymentDate: "2026-10-03", amount: 4350, studentName: "Gungun Paliwal", fatherName: "Bharat Paliwal", classLabel: "UKG", chequeNo: "771420", bank: "SBI · Amet", status: "deposited", slipNo: "DS-0021", statusAt: at("11:30", "2026-10-06") }),
    cheque({ receiptId: "c6", receiptNumber: "R-0368", paymentDate: "2026-10-02", amount: 5100, studentName: "Kavya Vyas", fatherName: "Prem Vyas", classLabel: "Class 3", chequeNo: "102938", bank: "HDFC · Rajsamand", status: "deposited", slipNo: "DS-0021", statusAt: at("11:30", "2026-10-06") }),
    cheque({ receiptId: "c7", receiptNumber: "R-0366", paymentDate: "2026-10-02", amount: 7800, studentName: "Ankit Regar", fatherName: "Sohan Regar", classLabel: "Class 9", chequeNo: "665012", bank: "Bank of Baroda · Amet", status: "deposited", slipNo: "DS-0021", statusAt: at("11:30", "2026-10-06") }),
    cheque({ receiptId: "c8", receiptNumber: "R-0347", paymentDate: "2026-09-29", amount: 6300, studentName: "Aanya Jain", fatherName: "Naveen Jain", classLabel: "Class 5", chequeNo: "448120", bank: "SBI · Amet", status: "cleared", statusAt: at("12:00", "2026-10-02") }),
    cheque({ receiptId: "c9", receiptNumber: "R-0341", paymentDate: "2026-09-28", amount: 7800, studentName: "Reyansh Kothari", fatherName: "Mukesh Kothari", classLabel: "Class 10", chequeNo: "219004", bank: "Axis · Rajsamand", status: "cleared", statusAt: at("12:00", "2026-10-01") }),
    cheque({ receiptId: "c10", receiptNumber: "R-0336", paymentDate: "2026-09-26", amount: 12150, studentName: "Priya Chouhan", fatherName: "Sanjay Chouhan", classLabel: "Class 7", chequeNo: "730055", bank: "SBI · Amet", status: "cleared", statusAt: at("12:00", "2026-09-30") }),
    cheque({ receiptId: "c11", receiptNumber: "R-0329", paymentDate: "2026-09-24", amount: 4350, studentName: "Kiara Rawal", fatherName: "Hitesh Rawal", classLabel: "LKG", chequeNo: "560782", bank: "PNB · Amet", status: "cleared", statusAt: at("12:00", "2026-09-29") }),
    cheque({ receiptId: "c12", receiptNumber: "R-0352", paymentDate: "2026-09-25", amount: 5100, studentName: "Tanu Bhati", fatherName: "Kishore Bhati", classLabel: "Class 5", chequeNo: "412207", bank: "Axis · Rajsamand", status: "bounced", bounceReason: "Not enough money", reversed: true }),
  ],
  slips: [{ id: "slip21", slipNo: "DS-0021", bankLabel: "State Bank of India · Amet branch", depositedOn: "2026-10-06", total: 17250, count: 3 }],
  upiLines: [
    { id: "u1", txnAt: at("10:04"), amount: 2175, payer: "SUNITA DEVI", utr: "427815097310", state: "open", receipt: null, suggestions: [{ id: "r415", receiptNumber: "R-0415", paymentDate: "2026-10-08", amount: 2175, referenceNumber: null, studentName: "Tanvi Paliwal", classLabel: "LKG", score: 2, why: "amount_day" }] },
    { id: "u2", txnAt: at("19:58", "2026-10-07"), amount: 5000, payer: "D K SEN", utr: "427815090476", state: "open", receipt: null, suggestions: [] },
    ...([["10:38", "DINESH MEHTA", "4417", 4350, "R-0417", "Pooja Mehta", "11 Commerce"], ["09:58", "NARESH VYAS", "0932", 3900, "R-0414", "Harsh Vyas", "Class 8"], ["09:31", "SURESH SOLANKI", "7781", 6000, "R-0412", "Kabir Solanki", "Class 6"], ["09:20", "HITESH DAVE", "2290", 1200, "R-0411", "Anaya Dave", "UKG"], ["09:12", "ALOK TRIVEDI", "5126", 4800, "R-0410", "Vivaan Trivedi", "12 Science"], ["08:47", "DEEPAK PUROHIT", "6603", 2500, "R-0408", "Ritika Purohit", "Class 5"], ["08:30", "VIVEK KOTHARI", "3318", 3150, "R-0406", "Ishaan Kothari", "Class 1"], ["08:05", "RAJESH JAIN", "8854", 3100, "R-0404", "Aditi Jain", "Class 10"]] as const).map(
      ([time, payer, ref, amount, rec, name, cls], i): UpiLineRow => ({
        id: `m${i}`,
        txnAt: at(time),
        amount,
        payer,
        utr: `42781509${ref}`,
        state: "matched",
        receipt: { id: `rm${i}`, receiptNumber: rec, studentName: name, classLabel: cls, amount, paymentDate: "2026-10-08" },
        suggestions: [],
      }),
    ),
  ],
  upiReceiptsUnmatched: 1,
  advances: [
    { studentId: "a1", studentName: "Ishita Rathore", classLabel: "12 Science", fatherName: "Bhupendra Rathore", credit: 1200, refundable: 1200 },
    { studentId: "a2", studentName: "Saanvi Mehta", classLabel: "Class 2", fatherName: "Pankaj Mehta", credit: 450, refundable: 450 },
    { studentId: "a3", studentName: "Vivaan Trivedi", classLabel: "12 Science", fatherName: "Alok Trivedi", credit: 3000, refundable: 0 },
  ],
  feeRefunds: [{ id: "f1", studentName: "Bhavya Jain · LKG", amount: 1200, status: "approved", reason: "Admission fee, cancelled before school began", refundDate: "2026-10-03" }],
  requests: [
    req({ id: "q3", kind: "late_fee_waiver", title: "Waive late fee ₹530", studentName: "Riya Singh", reason: "Will pay the full fee on Saturday", requestedAt: at("09:40"), status: "waiting", amount: 530 }),
    req({ id: "q2", kind: "refund", title: "Refund ₹2,100 from advance", studentName: "Siddharth Kothari", reason: "Bus fee for Nov–Jan, not used", requestedAt: at("12:40", "2026-10-05"), remindedAt: at("16:15", "2026-10-05"), status: "waiting", amount: 2100, canRemind: false }),
    req({ id: "q1", kind: "late_fee_waiver", title: "Waive late fee ₹460", studentName: "Neha Joshi", reason: "Father was in hospital in September", requestedAt: at("11:20", "2026-10-06"), status: "approved", decidedAt: at("09:10", "2026-10-07"), decidedByName: "Janmejay", decisionNote: "Late fee ₹460 removed; the fee itself is still pending.", amount: 460 }),
    req({ id: "q4", kind: "late_fee_waiver", title: "Waive late fee ₹300", studentName: "Kavya Gurjar", reason: "Joined late in August", requestedAt: at("10:05", "2026-10-07"), status: "declined", decidedAt: at("12:32", "2026-10-07"), decidedByName: "Janmejay", decisionNote: "The promise was broken twice. Please collect the late fee.", amount: 300 }),
    req({ id: "q5", kind: "reversal", title: "Reverse R-0352 · cheque bounced", studentName: "Tanu Bhati", reason: "Cheque 412207 bounced · not enough money", requestedAt: at("15:10", "2026-10-01"), status: "approved", decidedAt: at("09:00", "2026-10-02"), decidedByName: "Janmejay", decisionNote: "R-0352 reversed. ₹5,100 is pending again for the Bhati family.", amount: 5100 }),
  ],
};

/** The cheques frames open with the three ready cheques ticked (the design's `sel: { c1, c2, c3 }`). */
const TICKED = ["c1", "c2", "c3"];
const booksView = (initialView: BooksView, initialSheet: BooksSheet = "", initialReceipt: string | null = null, initialPick: string[] = []) =>
  function AccBooksView() {
    return <Books data={books} initialView={initialView} initialSheet={initialSheet} initialPick={initialPick} initialReceipt={initialReceipt} staffName="Neelam Sharma" readOnly={false} />;
  };

const acc = (render: () => React.ReactNode, path: string): DesignView => ({ render, path, menu: "accountant" });

export const views: Record<string, DesignView> = {
  AccHome: acc(homeView("home"), "/accounts"),
  "DX-AccHome-Menu": acc(homeView("menu"), "/accounts"),
  "DX-AccHome-Evening": acc(homeView("evening", evening), "/accounts"),
  "DX-AccHome-Dark": acc(homeView("home"), "/accounts"),
  "M-AccHome": acc(homeView("home"), "/accounts"),
  "M-AccHome-Menu": acc(homeView("menu"), "/accounts"),
  "M-AccHome-Evening": acc(homeView("evening", evening), "/accounts"),
  "M-AccHome-Dark": acc(homeView("home"), "/accounts"),
  AccBooks: acc(booksView("cheques", "", null, TICKED), "/accounts/books"),
  "DX-AccBooks-Deposit": acc(booksView("cheques", "deposit", null, TICKED), "/accounts/books"),
  "DX-AccBooks-Upi": acc(booksView("upi"), "/accounts/books"),
  "DX-AccBooks-Bounce": acc(booksView("cheques", "bounce", "c7"), "/accounts/books"),
  "DX-AccBooks-Requests": acc(booksView("requests"), "/accounts/books"),
  "M-AccBooks": acc(booksView("cheques", "", null, TICKED), "/accounts/books"),
  "M-AccBooks-Deposit": acc(booksView("cheques", "deposit", null, TICKED), "/accounts/books"),
  "M-AccBooks-Bounce": acc(booksView("cheques", "bounce", "c7"), "/accounts/books"),
  "M-AccBooks-Upi": acc(booksView("upi"), "/accounts/books"),
  "M-AccBooks-Refunds": acc(booksView("refunds"), "/accounts/books"),
  "M-AccBooks-Requests": acc(booksView("requests"), "/accounts/books"),
};
