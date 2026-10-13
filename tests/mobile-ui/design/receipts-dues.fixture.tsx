import type { ReactNode } from "react";

import type { DesignView } from "../design.fixture";

import {
  groupFamilies,
  isCallable,
  sortForCalling,
  type ContactSummary,
  type DuesFamily,
  type DuesStudent,
} from "@/modules/defaulters/vx/domain/families";
import { DuesScreen } from "@/vx/screens/dues/screen";
import type { DuesProps, KidInstallment, KidMeta, LeftView, PromiseView } from "@/vx/screens/dues/types";
import { ReceiptsDesk } from "@/vx/screens/receipts/desk";
import type { DeskProps, DeskRow, SelectedReceipt } from "@/vx/screens/receipts/types";

/*
 * Receipts & day close (design `Fees`) and Dues & calls (design `Dues`), with
 * the frames' own synthetic records. Every name and amount is the design's
 * made-up sample data; nothing here reaches a database.
 */

/*
 * Sheets and toasts portal into `#vx-layer`, which the app's shell mounts
 * beside the page. The design fixture's shell does not, so each view brings
 * its own and the reverse / write-off / call sheets draw as they do in the app.
 */
function Layered({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <div id="vx-layer" className="vxt vx-layer" />
    </>
  );
}

// ---------------------------------------------------------------- Receipts

const TODAY = "2026-10-08";
const DAY: Record<string, string> = { today: "2026-10-08", yesterday: "2026-10-07", tue: "2026-10-06" };

type R = [no: string, day: string, time: string, name: string, cls: string, sr: string, father: string, mode: string, amt: number, by: string, extra?: { reversed?: boolean; ref?: string }];

const RECEIPTS: R[] = [
  ["R-0417", "today", "10:38", "Pooja Mehta", "11 Commerce", "0933", "Dinesh Mehta", "upi", 4350, "Janmejay"],
  ["R-0416", "today", "10:21", "Kunal Verma", "Class 4", "1187", "Sanjay Verma", "cash", 2850, "Office desk"],
  ["R-0415", "today", "10:05", "Tanvi Paliwal", "LKG", "1420", "Gopal Paliwal", "upi", 2175, "Office desk"],
  ["R-0414", "today", "09:58", "Harsh Vyas", "Class 8", "1046", "Naresh Vyas", "upi", 3900, "Janmejay"],
  ["R-0413", "today", "09:44", "Meera Choudhary", "Class 2", "1361", "Ramesh Choudhary", "cash", 1500, "Office desk"],
  ["R-0412", "today", "09:31", "Kabir Solanki", "Class 6", "1219", "Suresh Solanki", "upi", 6000, "Janmejay"],
  ["R-0411", "today", "09:20", "Anaya Dave", "UKG", "1398", "Hitesh Dave", "upi", 1200, "Office desk"],
  ["R-0410", "today", "09:12", "Vivaan Trivedi", "12 Science", "0861", "Alok Trivedi", "upi", 4800, "Janmejay"],
  ["R-0409", "today", "08:58", "Sneha Bhati", "Class 9", "1030", "Manoj Bhati", "cash", 1175, "Office desk"],
  ["R-0408", "today", "08:47", "Ritika Purohit", "Class 5", "1377", "Deepak Purohit", "upi", 2500, "Office desk"],
  ["R-0407", "today", "08:39", "Arjun Rawal", "Class 3", "1314", "Bharat Rawal", "cash", 700, "Office desk"],
  ["R-0406", "today", "08:30", "Ishaan Kothari", "Class 1", "1385", "Vivek Kothari", "upi", 3150, "Janmejay"],
  ["R-0405", "today", "08:18", "Nidhi Chouhan", "Class 7", "1241", "Prem Chouhan", "cash", 1000, "Office desk"],
  ["R-0404", "today", "08:05", "Aditi Jain", "Class 10", "0975", "Rajesh Jain", "upi", 3100, "Janmejay"],
  ["R-0403", "yesterday", "16:40", "Yash Mehta", "Class 9", "1028", "Kamal Mehta", "upi", 6000, "Janmejay"],
  ["R-0402", "yesterday", "13:15", "Khushi Sharma", "Class 6", "1222", "Lokesh Sharma", "cash", 4600, "Office desk"],
  ["R-0401", "yesterday", "11:20", "Dev Rathore", "11 Science", "0912", "Ajay Rathore", "cheque", 7000, "Office desk", { ref: "Cheque 004512 · SBI Amet" }],
  ["R-0400", "yesterday", "10:05", "Manvi Joshi", "Class 4", "1190", "Sunil Joshi", "upi", 5000, "Janmejay"],
  ["R-0399", "yesterday", "09:30", "Rudra Singh", "Class 3", "1309", "Vikram Singh", "cash", 3000, "Office desk", { reversed: true }],
];

const at = (day: string, time: string) => `${DAY[day]}T${time}:00+05:30`;

const rowOf = (r: R): DeskRow => ({
  id: `synthetic-${r[0]}`,
  receiptNumber: r[0],
  paymentDate: DAY[r[1]],
  createdAt: at(r[1], r[2]),
  paymentMode: r[7],
  totalAmount: r[8],
  isReversed: Boolean(r[10]?.reversed),
  receivedBy: r[9],
  studentFullName: r[3],
  admissionNo: `SR ${r[5]}`,
  classLabel: r[4],
});

function selectedOf(no: string): SelectedReceipt {
  const r = RECEIPTS.find((x) => x[0] === no)!;
  const row = rowOf(r);
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    studentFullName: row.studentFullName,
    admissionNo: row.admissionNo,
    classLabel: row.classLabel,
    fatherName: r[6],
    fatherPhone: null,
    paymentDate: row.paymentDate,
    createdAt: row.createdAt,
    paymentMode: row.paymentMode,
    referenceNumber: r[10]?.ref ?? (r[7] === "upi" ? `4271••••${r[5]}` : null),
    totalAmount: row.totalAmount,
    reversedAmount: row.isReversed ? row.totalAmount : 0,
    isReversed: row.isReversed,
    receivedBy: row.receivedBy,
    sessionLabel: "2026-27",
    heads: [{ label: "Tuition · Installment 2", amount: row.totalAmount }],
    share: r[1] === "today" ? { status: "not_sent", at: null } : { status: "read", at: at(r[1], r[2]) },
    history: [{ at: row.createdAt, kind: "posted" }],
    pendingRequest: null,
  };
}

const todayRows = RECEIPTS.filter((r) => r[1] === "today").map(rowOf);

function desk(over: Partial<DeskProps> = {}): DeskProps {
  return {
    today: TODAY,
    anchor: TODAY,
    span: "today",
    from: TODAY,
    to: TODAY,
    view: "list",
    sessionLabel: "2026-27",
    rows: todayRows,
    truncated: false,
    lastDate: null,
    closeEvent: null,
    lastReopen: null,
    selected: null,
    sheet: null,
    initial: { mode: "", staff: "", query: "" },
    perms: { collect: true, accounts: true, reverse: true, reopen: true, print: true, dayBook: true },
    ...over,
  };
}

const receiptViews: Record<string, DesignView> = {
  Fees: { render: () => <ReceiptsDesk {...desk()} />, path: "/receipts" },
  "AC-Fees": { render: () => <ReceiptsDesk {...desk({ perms: { collect: true, accounts: true, reverse: false, reopen: false, print: true, dayBook: true } })} />, path: "/receipts", menu: "accountant" },
  "DX-Fees-Receipt": { render: () => <ReceiptsDesk {...desk({ selected: selectedOf("R-0417") })} />, path: "/receipts" },
  "DX-Fees-Close": { render: () => <ReceiptsDesk {...desk({ view: "close" })} />, path: "/receipts" },
  "M-Fees": { render: () => <ReceiptsDesk {...desk()} />, path: "/receipts" },
  "MAC-Fees": { render: () => <ReceiptsDesk {...desk({ perms: { collect: true, accounts: true, reverse: false, reopen: false, print: true, dayBook: true } })} />, path: "/receipts", menu: "accountant" },
  "M-Fees-Receipt": { render: () => <ReceiptsDesk {...desk({ selected: selectedOf("R-0417") })} />, path: "/receipts" },
  "M-Fees-Reverse": { render: () => <ReceiptsDesk {...desk({ selected: selectedOf("R-0416"), sheet: "reverse" })} />, path: "/receipts" },
  "M-Fees-Close": { render: () => <ReceiptsDesk {...desk({ view: "close" })} />, path: "/receipts" },
  // Not drawn as a frame, but the design's `reversed` and `closed` start states.
  "Fees-Reversed": { render: () => <ReceiptsDesk {...desk({ span: "yesterday", anchor: TODAY, rows: RECEIPTS.filter((r) => r[1] === "yesterday").map(rowOf), selected: selectedOf("R-0399") })} />, path: "/receipts" },
  "Fees-Closed": {
    render: () => (
      <ReceiptsDesk
        {...desk({
          view: "close",
          closeEvent: { id: "synthetic-close", paymentDate: TODAY, action: "close", cashExpected: 7225, cashCounted: 7125, upiChecked: true, receiptCount: 14, reversedCount: 0, expected: { total: 38400, cash: 7225, upi: 31175, cheque: 0, bank: 0 }, note: "₹100 given back as change", actorName: "Janmejay", createdAt: `${TODAY}T17:10:00+05:30` },
        })}
      />
    ),
    path: "/receipts",
  },
};

// ---------------------------------------------------------------- Dues

/*
 * The design's families (Dues.dc.html `data()`), with its own arithmetic for
 * pending today, not due yet and the late fee, so the amounts match the frames.
 */
type Kid = { n: string; c: string; due: string; route: number; o?: { sr?: string; y?: 1; adm?: number; join?: 1; paid?: number; prev?: number } };
type Fam = { id: string; father: string; ph: string; kids: Kid[]; last: [string, string]; call: boolean };
const K = (n: string, c: string, due: string, route: number, o?: Kid["o"]): Kid => ({ n, c, due, route, o });
const F = (id: string, father: string, ph: string, kids: Kid[], last: [string, string], call = true): Fam => ({ id, father, ph, kids, last, call });

/** The design's last contact, as the fee app's contact log would hold it: [channel, outcome, date]. */
const LAST: Record<string, [string, string] | null> = {
  "WhatsApp read": ["whatsapp", "other"],
  "Not reachable": ["call", "no_answer"],
  "Said he would visit": ["call", "reached"],
  "Asked for time": ["call", "dispute"],
  "No answer": ["call", "no_answer"],
  "Wrong number": ["call", "other"],
  "WhatsApp not read": ["whatsapp", "other"],
  "Paid": ["call", "reached"],
  "Letter sent": ["in_person", "other"],
  "Will visit after Navratri": ["call", "reached"],
  "Promise broken": null,
  "Did not come": null,
  "Not called yet": null,
};

const FAM: Fam[] = [
  F("f1", "Rakesh Sharma", "512", [K("Aarav Sharma", "Class 7", "2", 3, { sr: "1234" }), K("Diya Sharma", "Class 3", "2", 0, { y: 1, sr: "1017" })], ["WhatsApp read", "2026-10-05"]),
  F("f2", "Prakash Joshi", "274", [K("Neha Joshi", "Class 8", "12", 0), K("Rohit Joshi", "Class 5", "12", 0, { y: 1 })], ["Promise broken", "2026-09-28"]),
  F("f3", "Mohan Kumawat", "139", [K("Aarti Kumawat", "Class 10", "12", 0)], ["Not reachable", "2026-10-06"]),
  F("f4", "Anil Agarwal", "806", [K("Mohit Agarwal", "Class 9", "2", 2)], ["Said he would visit", "2026-10-03"]),
  F("f5", "Mahendra Singh", "351", [K("Riya Singh", "Class 6", "12", 1)], ["Promise broken", "2026-10-02"]),
  F("f6", "Bhupendra Rathore", "927", [K("Ishita Rathore", "12 Science", "2", 0)], ["Asked for time", "2026-10-03"], false),
  F("f7", "Hemraj Gurjar", "645", [K("Kavya Gurjar", "Class 2", "12", 0, { adm: 1200, join: 1 })], ["No answer", "2026-10-05"]),
  F("f8", "Lalit Regar", "083", [K("Nikhil Regar", "Class 9", "12", 0), K("Sonu Regar", "Class 6", "2", 0, { y: 1 })], ["Wrong number", "2026-10-02"]),
  F("f9", "Suresh Meena", "418", [K("Pihu Meena", "UKG", "2", 0)], ["Not called yet", ""]),
  F("f10", "Dinesh Sen", "762", [K("Ayaan Sen", "Class 1", "2", 4)], ["WhatsApp not read", "2026-10-05"]),
  F("f11", "Gopal Purohit", "590", [K("Tanya Purohit", "11 Commerce", "12", 0)], ["Did not come", "2026-10-05"]),
  F("f12", "Harish Chouhan", "216", [K("Vansh Chouhan", "Class 8", "2", 2, { paid: 3000 })], ["Paid", "2026-10-05"]),
  F("f13", "Rajendra Dave", "304", [K("Krish Dave", "12 Arts", "2", 0, { prev: 6200 })], ["Letter sent", "2026-09-28"]),
  F("f14", "Mukesh Bhati", "871", [K("Aditya Bhati", "LKG", "2", 0)], ["Not called yet", ""]),
  F("f15", "Kailash Kanwar", "158", [K("Mahi Kanwar", "Class 5", "12", 3, { adm: 1200, join: 1 })], ["Will visit after Navratri", "2026-10-06"]),
  F("f16", "Suresh Solanki", "447", [K("Kabir Solanki", "Class 6", "2", 3, { paid: 6000 })], ["Paid", "2026-10-08"], false),
  F("f17", "Naresh Vyas", "655", [K("Harsh Vyas", "Class 8", "2", 2, { paid: 3900 })], ["Paid", "2026-10-08"], false),
  F("f18", "Vinod Paliwal", "309", [K("Ritu Paliwal", "Class 3", "2", 0)], ["Said he would visit", "2026-10-05"], false),
  F("f19", "Kishan Jain", "724", [K("Aryan Jain", "Class 9", "2", 0)], ["Said he would visit", "2026-10-06"], false),
  F("f20", "Ramesh Trivedi", "186", [K("Saanvi Trivedi", "11 Science", "2", 0)], ["Said he would visit", "2026-10-07"], false),
  F("f21", "Sunil Mehta", "533", [K("Jiya Mehta", "Class 4", "2", 1)], ["Said he would visit", "2026-10-05"], false),
  F("f22", "Deepak Rawal", "470", [K("Kartik Rawal", "Class 10", "2", 0)], ["Said he would visit", "2026-10-03"], false),
  F("f23", "Manoj Choudhary", "812", [K("Anvi Choudhary", "Nursery", "2", 0)], ["Said he would visit", "2026-10-06"], false),
  F("f24", "Pawan Bhati", "268", [K("Yash Bhati", "12 Commerce", "2", 0)], ["Said he would visit", "2026-10-07"], false),
  F("f25", "Ravi Sen", "941", [K("Myra Sen", "Class 7", "2", 0)], ["Said he would visit", "2026-10-07"], false),
];

const ROUTE = [0, 1350, 1575, 1800, 2025];
const acad = (c: string) => (/Nursery|LKG|UKG/.test(c) ? 17400 : /^Class [1-5]$/.test(c) ? 20400 : /^Class [6-8]$/.test(c) ? 25800 : /^Class (9|10)$/.test(c) ? 31200 : 34800 + (/Science/.test(c) ? 3600 : 0));
const phoneOf = (ph: string) => `98290${ph.padStart(5, "0")}`;
const sid = (famId: string, i: number) => `00000000-0000-4000-8000-${String(Number(famId.slice(1)) * 10 + i).padStart(12, "0")}`;

function kidMoney(k: Kid) {
  const o = k.o ?? {};
  const per = Math.round((acad(k.c) / 4) * (o.y ? 0.9 : 1)) + ROUTE[k.route];
  const owes1 = k.due.includes("1");
  const a1 = owes1 ? per + (o.adm ?? 0) : 0;
  const a2 = Math.max(0, per - (o.paid ?? 0));
  const late = (owes1 ? 300 : 0) + (a2 ? 230 : 0) + (o.prev ? 300 : 0);
  const days = o.prev ? 266 : owes1 ? (o.join ? 49 : 85) : a2 ? 23 : 0;
  return { per, owes1, a1, a2, late, days, prev: o.prev ?? 0 };
}

function familyOf(f: Fam): DuesFamily {
  const kids: DuesStudent[] = f.kids.map((k, i) => {
    const m = kidMoney(k);
    const overdue = m.a1 + m.a2 + m.prev;
    return {
      studentId: sid(f.id, i),
      fullName: k.n,
      fatherName: f.father,
      fatherPhone: phoneOf(f.ph),
      classLabel: k.c,
      transportRouteId: k.route ? `route-${k.route}` : null,
      overdueAmount: overdue,
      totalPending: overdue + m.per * 2,
      lateFee: m.late,
      daysOverdue: m.days,
      overdueInstallments: [...(m.prev ? [0] : []), ...(m.owes1 ? [1] : []), ...(m.a2 ? [2] : [])],
    };
  });
  const map = LAST[f.last[0]];
  const contacts = new Map<string, ContactSummary>(map && f.last[1] ? [[kids[0].studentId, { lastContactedAt: `${f.last[1]}T11:00:00+05:30`, lastChannel: map[0], lastOutcome: map[1] }]] : []);
  const fam = groupFamilies(kids, contacts)[0];
  return { ...fam, key: f.id };
}

const ALL = FAM.map(familyOf);
const byId = new Map(ALL.map((x) => [x.key, x]));
const callable = sortForCalling(ALL.filter((x, i) => FAM[i].call && isCallable(x)));

type PR = [fam: string, amount: number, on: string, kind: "pay" | "visit", state: "kept" | "due" | "broken" | "upcoming", made: string, by: string, receipt?: string];
const PROMS: PR[] = [
  ["f16", 6000, TODAY, "pay", "kept", "2026-10-05", "Office desk", "R-0412"],
  ["f17", 3900, TODAY, "pay", "kept", "2026-10-06", "Office desk", "R-0414"],
  ["f18", 5100, TODAY, "pay", "due", "2026-10-05", "Office desk"],
  ["f19", 7800, TODAY, "visit", "due", "2026-10-06", "Janmejay"],
  ["f20", 9600, TODAY, "pay", "due", "2026-10-07", "Office desk"],
  ["f21", 6450, TODAY, "pay", "due", "2026-10-05", "Office desk"],
  ["f22", 7800, TODAY, "visit", "due", "2026-10-03", "Office desk"],
  ["f23", 4350, TODAY, "pay", "due", "2026-10-06", "Janmejay"],
  ["f24", 8700, TODAY, "pay", "due", "2026-10-07", "Office desk"],
  ["f2", 22080, "2026-10-01", "pay", "broken", "2026-09-28", "Office desk"],
  ["f5", 7800, "2026-10-05", "pay", "broken", "2026-10-02", "Office desk"],
  ["f11", 17400, "2026-10-07", "visit", "broken", "2026-10-05", "Janmejay"],
  ["f25", 6450, "2026-10-12", "pay", "upcoming", "2026-10-07", "Office desk"],
  ["f6", 9600, "2026-10-15", "pay", "upcoming", "2026-10-03", "Janmejay"],
];
const promises: PromiseView[] = PROMS.map(([fam, amount, on, kind, state, made, by, receipt], i) => {
  const x = byId.get(fam)!;
  return {
    id: `synthetic-promise-${i}`,
    studentId: x.kids[0].studentId,
    familyKey: fam,
    fatherName: x.fatherName,
    kidsLine: x.kids.map((k) => `${k.fullName} · ${k.classLabel}`).join(", "),
    phone: x.phone,
    kind,
    promisedOn: on,
    amount,
    note: null,
    by,
    createdAt: `${made}T10:00:00+05:30`,
    state,
    paid: state === "kept" ? amount : 0,
    receiptNumber: receipt ?? null,
  };
});

const LEFT: LeftView[] = (
  [
    ["Yuvraj Choudhary", "Class 7", 9300, "Om Prakash Choudhary", "118"],
    ["Simran Paliwal", "Class 4", 5100, "Kamlesh Paliwal", "562"],
    ["Arnav Trivedi", "11 Science", 9600, "Hemant Trivedi", "730"],
    ["Kriti Solanki", "UKG", 2850, "Bharat Solanki", "395"],
    ["Rohan Mehta", "Class 9", 7800, "Girish Mehta", "681"],
    ["Bhavna Rawal", "12 Arts", 8700, "Shankar Rawal", "247"],
    ["Dhruv Jain", "Class 2", 5100, "Pramod Jain", "904"],
  ] as const
).map(([fullName, classLabel, owed, fatherName, ph], i) => ({
  studentId: `00000000-0000-4000-8000-9${String(i).padStart(11, "0")}`,
  fullName,
  fatherName,
  phone: phoneOf(ph),
  status: "left",
  classLabel,
  owed,
  lastPaymentDate: null,
  writeOff: null,
}));

const HEAT: [string, number, number, number][] = [["Nursery", 6, 9, 0], ["LKG", 8, 10, 0], ["UKG", 9, 12, 2], ["Class 1", 11, 13, 3], ["Class 2", 10, 12, 2], ["Class 3", 12, 14, 4], ["Class 4", 18, 23, 6], ["Class 5", 14, 16, 5], ["Class 6", 26, 24, 8], ["Class 7", 19, 24, 7], ["Class 8", 20, 19, 6], ["Class 9", 28, 22, 9], ["Class 10", 21, 22, 7], ["11 Science", 20, 17, 5], ["11 Commerce", 12, 13, 3], ["11 Arts", 6, 7, 2], ["12 Science", 17, 16, 6], ["12 Commerce", 9, 12, 3], ["12 Arts", 4, 5, 2]];
const classByInst = HEAT.map(([classLabel, ...ks], i) => {
  const [inst1, inst2, lastYear] = ks.map((k, j) => (k ? k * 1000 + ((((i * 3 + j) % 5) - 2) * 100) : 0));
  return { classLabel, inst1, inst2, lastYear, total: inst1 + inst2 + lastYear };
});

/** Rakesh Sharma's installments as the family panel draws them. */
function familyDetail(f: DuesFamily): NonNullable<DuesProps["detail"]> {
  const installments: Record<string, KidInstallment[]> = {};
  const meta: Record<string, KidMeta> = {};
  const src = FAM.find((x) => x.id === f.key)!;
  f.kids.forEach((k, i) => {
    const kid = src.kids[i];
    const m = kidMoney(kid);
    meta[k.studentId] = { admissionNo: kid.o?.sr ?? null, route: kid.route ? String(kid.route) : null };
    installments[k.studentId] = [
      { no: 1, label: "Installment 1", dueDate: "2026-07-20", pending: m.a1, lateFee: 0, status: m.a1 ? "overdue" : "paid", carry: false, amount: m.per },
      { no: 2, label: "Installment 2", dueDate: "2026-09-15", pending: m.a2, lateFee: m.a2 ? 230 : 0, status: m.a2 ? "overdue" : "paid", carry: false, amount: m.per },
      { no: 3, label: "Installment 3", dueDate: "2026-11-15", pending: m.per, lateFee: 0, status: "pending", carry: false, amount: m.per },
      { no: 4, label: "Installment 4", dueDate: "2027-01-15", pending: m.per, lateFee: 0, status: "pending", carry: false, amount: m.per },
    ];
  });
  const contacts = [
    { at: "2026-10-05T11:00:00+05:30", channel: "whatsapp", outcome: "other", note: "Reminder read by parent", studentId: f.kids[0].studentId },
    { at: "2026-10-02T12:30:00+05:30", channel: "call", outcome: "reached", note: "Asked for details on WhatsApp", studentId: f.kids[0].studentId },
  ];
  return { installments, contacts, meta };
}

function dues(over: Partial<DuesProps> = {}): DuesProps {
  return {
    today: TODAY,
    sessionLabel: "2026-27",
    tab: "call",
    families: callable,
    lateFeeOnly: { count: 3, amount: 1590 },
    metrics: { pendingToday: 640000, students: 138, notDueYet: 590000, promisesToday: 9, promisesKeptToday: 2, callsToday: 14, collectedWeek: 120000 },
    promises,
    left: LEFT,
    aging: {
      buckets: [
        { key: "1-30", amount: 290000, students: 71 },
        { key: "31-60", amount: 40000, students: 8 },
        { key: "61-90", amount: 230000, students: 44 },
        { key: "90+", amount: 80000, students: 15 },
      ],
      top: [...ALL].sort((a, b) => b.pendingToday - a.pendingToday).slice(0, 10),
      classByInst,
    },
    selected: null,
    detail: null,
    sheet: null,
    writeOffFor: null,
    perms: { log: true, plan: true, planEnabled: true, collect: true, writeOff: true, callSheet: true },
    ...over,
  };
}

const rakesh = byId.get("f1")!;
const withFamily = (over: Partial<DuesProps> = {}) => dues({ selected: rakesh, detail: familyDetail(rakesh), ...over });
const accountant: DuesProps["perms"] = { log: true, plan: false, planEnabled: true, collect: true, writeOff: false, callSheet: true };

const duesViews: Record<string, DesignView> = {
  Dues: { render: () => <DuesScreen {...dues()} />, path: "/dues" },
  "AC-Dues": { render: () => <DuesScreen {...dues({ perms: accountant })} />, path: "/dues", menu: "accountant" },
  "DX-Dues-Family": { render: () => <DuesScreen {...withFamily()} />, path: "/dues" },
  "DX-Dues-Plan": { render: () => <DuesScreen {...withFamily({ sheet: "plan" })} />, path: "/dues" },
  "DX-Dues-Aging": { render: () => <DuesScreen {...dues({ tab: "aging" })} />, path: "/dues" },
  "M-Dues": { render: () => <DuesScreen {...dues()} />, path: "/dues" },
  "MAC-Dues": { render: () => <DuesScreen {...dues({ perms: accountant })} />, path: "/dues", menu: "accountant" },
  "M-Dues-Family": { render: () => <DuesScreen {...withFamily()} />, path: "/dues" },
  "M-Dues-Call": { render: () => <DuesScreen {...withFamily({ sheet: "promise", dialing: true })} />, path: "/dues" },
  "M-Dues-Promises": { render: () => <DuesScreen {...dues({ tab: "prom" })} />, path: "/dues" },
  "M-Dues-Writeoff": { render: () => <DuesScreen {...dues({ tab: "left", sheet: "wo", writeOffFor: LEFT[0], perms: accountant })} />, path: "/dues" },
  // The design's `left` start state (no frame of its own).
  "Dues-Left": { render: () => <DuesScreen {...dues({ tab: "left" })} />, path: "/dues" },
};

const layered = (all: Record<string, DesignView>): Record<string, DesignView> =>
  Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { ...v, render: () => <Layered>{v.render()}</Layered> }]));

export const views: Record<string, DesignView> = layered({
  ...receiptViews,
  ...duesViews,
});
