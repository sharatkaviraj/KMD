import type { DesignView } from "../design.fixture";
import { monthGrid, recentWeeks, type MarkStatus } from "@/vx/screens/admin/logic";
import { Student360, Student360Backdrop, type Student360Props } from "@/vx/screens/admin/student360";

/*
 * The admin core's frames (App.dc.html F01–F14, Desktop.dc.html D01–D10),
 * drawn with the design's own sample records. Every name and amount below is
 * the design's synthetic data, not a real child.
 */

const TODAY = "2026-10-08";

/** The design's heat strip for Aarav: 14 Sep – 10 Oct, P/A/H/X(holiday). */
const HEAT: [string, MarkStatus | "closed"][] = [
  ["2026-09-14", "present"], ["2026-09-15", "present"], ["2026-09-16", "present"], ["2026-09-17", "present"], ["2026-09-18", "present"], ["2026-09-19", "present"],
  ["2026-09-21", "present"], ["2026-09-22", "present"], ["2026-09-23", "absent"], ["2026-09-24", "present"], ["2026-09-25", "present"], ["2026-09-26", "present"],
  ["2026-09-28", "present"], ["2026-09-29", "present"], ["2026-09-30", "half_day"], ["2026-10-01", "present"], ["2026-10-02", "closed"], ["2026-10-03", "present"],
  ["2026-10-05", "present"], ["2026-10-06", "absent"], ["2026-10-07", "present"], ["2026-10-08", "present"],
];
const marks = HEAT.filter(([, s]) => s !== "closed").map(([day, status]) => ({ day, status: status as MarkStatus }));
const closed = new Set(HEAT.filter(([, s]) => s === "closed").map(([d]) => d).concat(["2026-10-04", "2026-10-11"]));
const isClosed = (day: string) => closed.has(day) || new Date(`${day}T12:00:00Z`).getUTCDay() === 0;

const subjects = (rows: [string, string, number][]) =>
  rows.map(([en, hi, percent], i) => ({ subjectId: `s${i}`, en, hi, percent, state: "value" as const }));

const inst = (id: string, label: string, dueDate: string, state: "paid" | "overdue" | "upcoming", settled: number) => ({
  id,
  label,
  dueDate,
  state: state === "upcoming" ? ("upcoming" as const) : state === "paid" ? ("paid" as const) : ("overdue" as const),
  status: state === "paid" ? ("paid" as const) : state === "overdue" ? ("partial" as const) : ("pending" as const),
  pending: 6600 - settled,
  settled,
  paid: settled,
  receiptedHere: settled,
  adjusted: 0,
  base: 6600,
  lateFee: 0,
  lateFeeWaived: 0,
  lateFeePending: 0,
  carry: false,
});

const aarav: Student360Props = {
  id: "00000000-0000-4000-8000-00000000a001",
  returnTo: "/students",
  name: "Aarav Sharma",
  classLabel: "Class 7",
  sr: "1234",
  rollNo: "12",
  status: "active",
  father: "Rakesh Sharma",
  mother: "Sunita Sharma",
  phone: "98290 41120",
  address: "Near Bus Stand, Ward 4",
  dob: "2014-05-21",
  joined: "2019-04-01",
  route: "Route 3",
  tab: "overview",
  tabs: ["overview", "fees", "attendance", "marks", "family", "info", "notes", "documents", "history"],
  money: { pendingToday: 4200, notDueYet: 13200, lateFee: 0, paid: 9000, total: 26400, percent: 34 },
  installments: [
    inst("i1", "Installment 1", "2026-07-15", "paid", 6600),
    inst("i2", "Installment 2", "2026-09-15", "overdue", 2400),
    inst("i3", "Installment 3", "2026-11-15", "upcoming", 0),
    inst("i4", "Installment 4", "2027-01-15", "upcoming", 0),
  ],
  feeSummary: { outstanding: 17400, overdue: 4200, lateFeePending: 0, lateFeeWaived: 0, paidThisSession: 9000, discountClosed: 0, sessionFee: 26400, creditBalance: 0, installmentsPaid: 1, installmentsTotal: 4, installmentsPending: 3, nextDue: { label: "Installment 3", amount: 6600, dueDate: "2026-11-15" } },
  feeBreakup: { rows: [{ id: "tuition", label: "Tuition", amount: 21600, kind: "charge" }, { id: "bus", label: "Transport · Route 3", amount: 4800, kind: "charge" }], annualTotal: 26400, discountTotal: 0, discountLabels: [], tuitionOverride: null, transportOverride: null },
  feeSession: "2026-27",
  receipts: [
    { id: "r1", number: "R-0412", date: "2026-10-02", amount: 2400, mode: "upi", reversed: false },
    { id: "r2", number: "R-0127", date: "2026-07-12", amount: 6600, mode: "cash", reversed: false },
  ],
  family: [
    { id: "00000000-0000-4000-8000-00000000a001", name: "Aarav Sharma", sr: "1234", classLabel: "Class 7", self: true, total: 26400, paid: 9000, remaining: 17400 },
    { id: "00000000-0000-4000-8000-00000000a002", name: "Diya Sharma", sr: "1311", classLabel: "Class 3", self: false, total: 22800, paid: 13200, remaining: 9600 },
  ],
  familyGroupId: "00000000-0000-4000-8000-0000000000f1",
  attendance: {
    percent: 88,
    counted: 76,
    counts: { present: 66, absent: 7, half_day: 3, late: 0, leave: 0 },
    weeks: recentWeeks(marks, TODAY, 4, isClosed),
    month: monthGrid(marks, TODAY, isClosed),
  },
  terms: [
    { term: "Unit test 1", percent: 70, grade: "B", missing: 0, papers: 5, scored: 351, outOf: 500, subjects: subjects([["English", "अंग्रेज़ी", 72], ["Hindi", "हिंदी", 80], ["Maths", "गणित", 61], ["Science", "विज्ञान", 68], ["Social Sc.", "सामाजिक विज्ञान", 70]]) },
    { term: "Half-yearly", percent: 71, grade: "B", missing: 0, papers: 5, scored: 357, outOf: 500, subjects: subjects([["English", "अंग्रेज़ी", 78], ["Hindi", "हिंदी", 85], ["Maths", "गणित", 58], ["Science", "विज्ञान", 72], ["Social Sc.", "सामाजिक विज्ञान", 64]]) },
  ],
  documents: [],
  notes: [
    { id: "n1", body: "Not submitting his Science lab notebook — will check again on Monday.", tags: ["studies"], status: "open", needsFollowUp: false, followUpOn: null, followUpOwner: null, followUpName: null, by: "Ms. Bhati", createdAt: "2026-10-07" },
    { id: "n2", body: "Father promised ₹4,200 by 15 Oct.", tags: ["family"], status: "open", needsFollowUp: false, followUpOn: null, followUpOwner: null, followUpName: null, by: "Janmejay", createdAt: "2026-10-02" },
  ],
  history: [],
  today: TODAY,
  canCollect: true,
  canManageDocuments: true,
  canManageFees: true,
  canAddNote: true,
  contacts: [],
};

const s360 = (tab: Student360Props["tab"]) =>
  function Student360Frame() {
    return (
      <>
        <Student360Backdrop />
        <Student360 key={tab} p={{ ...aarav, tab }} />
      </>
    );
  };

export const views: Record<string, DesignView> = {
  "F06-Student360": { render: s360("overview"), path: `/students/${aarav.id}` },
  "F07-Student360-Fees": { render: s360("fees"), path: `/students/${aarav.id}` },
  "F08-Student360-Family": { render: s360("family"), path: `/students/${aarav.id}` },
  "D02-Student360": { render: s360("overview"), path: `/students/${aarav.id}` },
  "s360-attendance": { render: s360("attendance"), path: `/students/${aarav.id}` },
  "s360-marks": { render: s360("marks"), path: `/students/${aarav.id}` },
  "s360-info": { render: s360("info"), path: `/students/${aarav.id}` },
};

/* ---------------------------------------------------------------- Today */

import { TodayScreen, type TodayProps } from "@/vx/screens/admin/today";
import type { InboxItem } from "@/vx/screens/admin/types";
import { VxPage } from "@/vx/ui/page";

const pair = (en: string, hi?: string) => (hi ? { en, hi } : { en });

/** The design's day (F01, Desktop): ₹38,400 from 14 receipts, 14 of 19 classes marked. */
const days = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 8, 9 + i));
  const day = d.toISOString().slice(0, 10);
  const sunday = d.getUTCDay() === 0;
  return { date: day, amount: sunday ? 0 : day === TODAY ? 38400 : 18000 + ((i * 7919) % 26000) };
});

const inbox: InboxItem[] = [
  { id: "nm", type: "attendance", kind: "not_marked", at: "2026-10-08T03:50:00Z", urgent: true, badge: pair("Attendance", "हाज़िरी"), title: pair("5 classes haven't marked attendance"), sub: pair("Period 1 ended 9:20 · 3, 5, 7, 9, 11 Com"), facts: [], classIds: ["c3", "c5", "c7", "c9", "c11"], remindable: 5 },
  { id: "cv", type: "timetable", kind: "cover", at: "2026-10-08T02:35:00Z", urgent: true, badge: pair("Timetable", "समय सारणी"), title: pair("Cover Period 3 · Class 9 Physics"), sub: pair("Mr. Meena on leave · 2 teachers free"), facts: [], candidates: [] },
  { id: "sb", type: "students", kind: "submission", at: "2026-10-06T05:00:00Z", urgent: false, badge: pair("Attendance correction"), title: pair("Attendance correction · Class 6"), sub: pair("Riya S. absent → present, 6 Oct"), facts: [], submissionIds: ["s1"] },
  { id: "rf", type: "money", kind: "refund", at: "2026-10-07T05:00:00Z", urgent: false, badge: pair("Money · refund"), title: pair("Refund ₹2,500 · Transport"), sub: pair("Requested by the accountant"), facts: [] },
];

const todayProps: TodayProps = {
  firstName: "Janmejay",
  greeting: pair("Good morning", "सुप्रभात"),
  dayLine: "Thursday, 8 October",
  status: pair("Period 3 running", "पीरियड 3 चल रहा है"),
  today: TODAY,
  money: {
    today: 38400,
    receiptsToday: 14,
    days,
    modes: [
      { mode: "upi", amount: 18200, receipts: 7 },
      { mode: "cash", amount: 12600, receipts: 5 },
      { mode: "cheque", amount: 6000, receipts: 1 },
      { mode: "bank_transfer", amount: 1600, receipts: 1 },
    ],
    matrix: ["Class 1", "Class 3", "Class 5", "Class 7", "Class 9", "Class 10", "Class 11 Science", "Class 12 Commerce"].map((classLabel, i) => ({
      classLabel,
      cells: { "Installment 1": 4000 + i * 900, "Installment 2": 12000 + ((i * 3571) % 9000), "Installment 3": 0, "Installment 4": 0 },
      total: 16000 + i * 900 + ((i * 3571) % 9000),
    })),
    installments: ["Installment 1", "Installment 2", "Installment 3", "Installment 4"],
    expected: 3120000,
    collected: 1860000,
    dueSoFar: 1950000,
    followUps: 18,
  },
  moneyFailed: false,
  attendance: { marked: 14, total: 19, percent: 94, schoolOpen: true },
  staffAway: 2,
  cover: { needed: 5, arranged: 3 },
  inbox,
  timeline: [
    { time: "07:45", title: pair("First bell"), sub: pair("Period 1 starts"), state: "done" },
    { time: "09:20", title: pair("Attendance closes"), sub: pair("5 not marked yet"), state: "alert" },
    { time: "10:05", title: pair("Period 3 · Class 9 Physics"), sub: pair("Needs a substitute"), state: "now" },
    { time: "13:45", title: pair("Last bell"), state: "next" },
  ],
  schedule: null,
  scheduleFailed: false,
  exceptions: { notMarked: ["3", "5", "7", "9", "11 Com"], cover: [] },
  support: { needsAction: 2, due: 1 },
  actions: [],
  links: { collect: true, attendance: true, substitutions: true, review: true, timetable: true },
  unavailable: false,
};

function TodayFrame() {
  return (
    <VxPage label="Today">
      <TodayScreen {...todayProps} />
    </VxPage>
  );
}

Object.assign(views, {
  "F01-Today": { render: TodayFrame, path: "/" },
  "F14-TodayDark": { render: TodayFrame, path: "/" },
  Desktop: { render: TodayFrame, path: "/" },
  "D08-TodayDark": { render: TodayFrame, path: "/" },
} satisfies Record<string, DesignView>);
