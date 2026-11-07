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
import { QUICK_ACTIONS } from "@/vx/nav";
import { LedgerNotice } from "@/vx/shell/ledger-notice";
import "@/vx/shell/session-controls.css";
import { moneyFromLedger, type TodayGlance } from "@/vx/screens/admin/today-logic";

const pair = (en: string, hi?: string) => (hi ? { en, hi } : { en });

/** The design's day (F01, Desktop): its own day totals (Desktop.dc.html DAILY), 9 Sep – 8 Oct. */
const DAILY = [24600, 31200, 27800, 41500, 0, 64200, 58900, 33400, 29700, 22100, 36800, 0, 38600, 26300, 19800, 24500, 21900, 33700, 0, 35200, 27600, 18400, 29300, 0, 31900, 0, 40700, 25800, 22600, 38400];
const days = DAILY.map((amount, i) => ({ date: new Date(Date.UTC(2026, 8, 9 + i)).toISOString().slice(0, 10), amount }));

/** The design's heat table (MATRIX): old balance, July and September, by class band. */
const MATRIX: [string, number, number, number][] = [
  ["Pre-primary", 0, 2400, 18600], ["Class 1–2", 4200, 3100, 22400], ["Class 3–5", 9800, 6300, 38500], ["Class 6–8", 12300, 8150, 46200],
  ["Class 9–10", 7400, 6900, 52800], ["Class 11", 3000, 2900, 21600], ["Class 12", 6200, 0, 31500],
];

const inbox: InboxItem[] = [
  { id: "nm", type: "attendance", kind: "not_marked", at: "2026-10-08T03:50:00Z", urgent: true, badge: pair("Attendance", "हाज़िरी"), title: pair("5 classes haven't marked attendance"), sub: pair("Period 1 ended 9:20", "पीरियड 1 9:20 पर ख़त्म"), facts: [], classIds: ["c3", "c5", "c7", "c9", "c11"], remindable: 5 },
  { id: "cv", type: "timetable", kind: "cover", at: "2026-10-08T02:35:00Z", urgent: true, badge: pair("Timetable", "समय सारणी"), title: pair("Cover Period 3 · Class 9"), sub: pair("Mr. Meena on leave · 2 teachers free"), facts: [], candidates: [] },
  { id: "sb", type: "students", kind: "submission", at: "2026-10-06T05:00:00Z", urgent: false, badge: pair("Correction"), title: pair("Correction · Riya Singh"), sub: pair("Class 6 · absent → present on 6 Oct"), facts: [], submissionIds: ["s1"] },
  { id: "rf", type: "money", kind: "refund", at: "2026-10-07T05:00:00Z", urgent: false, badge: pair("Refund"), title: pair("Refund ₹2,500"), sub: pair("Transport fee · by the accountant"), facts: [] },
  { id: "wo", type: "money", kind: "refund", at: "2026-10-07T04:00:00Z", urgent: false, badge: pair("Write-off"), title: pair("Write off ₹1,200 · Joshi family"), sub: pair("Old balance · hardship"), facts: [] },
  { id: "jb", type: "system", kind: "job", at: "2026-10-08T01:00:00Z", urgent: false, badge: pair("System"), title: pair("Daily summary did not finish"), sub: pair("Timed out"), facts: [] },
];

/* Test data only: the children and the calendar's names are invented. */
const glance: TodayGlance = {
  closed: null,
  coming: [
    { from: "2026-10-15", to: "2026-10-15", kind: "event", en: "PTM · Classes 9–12", hi: "अभिभावक बैठक · कक्षा 9–12", inDays: 7 },
    { from: "2026-10-20", to: "2026-10-20", kind: "holiday", en: "Dussehra", hi: "दशहरा", inDays: 12 },
    { from: "2026-10-26", to: "2026-10-31", kind: "exam", en: "Unit Test 2", hi: "यूनिट टेस्ट 2", inDays: 18 },
  ],
  birthdays: [
    { id: "00000000-0000-4000-8000-000000000b01", name: "Test Anaya", classLabel: "3" },
    { id: "00000000-0000-4000-8000-000000000b02", name: "Test Kabir", classLabel: "6A" },
    { id: "00000000-0000-4000-8000-000000000b03", name: "Test Ishita", classLabel: "9B" },
    { id: "00000000-0000-4000-8000-000000000b04", name: "Test Vihaan", classLabel: "11 Sci" },
    { id: "00000000-0000-4000-8000-000000000b05", name: "Test Diya", classLabel: "12 Arts" },
  ],
};

const todayProps: TodayProps = {
  glance,
  firstName: "Janmejay",
  greeting: pair("Good morning", "सुप्रभात"),
  dayLine: "Thursday, 8 October",
  status: pair("Period 2 running", "पीरियड 2 चल रहा है"),
  today: TODAY,
  money: {
    today: 38400,
    receiptsToday: 14,
    days,
    modes: [
      { mode: "upi", amount: 24600, receipts: 9 },
      { mode: "cash", amount: 13800, receipts: 5 },
    ],
    matrix: MATRIX.map(([classLabel, old, jul, sep]) => ({
      classLabel,
      cells: { "Previous year": old, "Installment 1": jul, "Installment 2": sep, "Installment 3": 24000, "Installment 4": 24000 },
      total: old + jul + sep + 48000,
    })),
    installments: ["Previous year", "Installment 1", "Installment 2", "Installment 3", "Installment 4"],
    dueDates: { "Previous year": null, "Installment 1": "2026-07-20", "Installment 2": "2026-09-20", "Installment 3": "2026-10-20", "Installment 4": "2027-01-20" },
    carryForward: ["Previous year"],
    expected: 3120000,
    collected: 1860000,
    dueSoFar: 1934000,
    followUps: 18,
  },
  moneyFailed: false,
  attendance: { marked: 14, total: 19, percent: 96, schoolOpen: true },
  staffAway: 2,
  cover: { needed: 5, arranged: 3, missed: 0 },
  inbox,
  // What the app can put on the timeline: bells, cover, and the calendar's timed events.
  timeline: [
    { time: "08:00", title: pair("Assembly"), sub: pair("Done", "हो गया"), state: "done" },
    { time: "09:20", title: pair("Attendance closes"), sub: pair("5 classes not marked yet"), state: "alert" },
    { time: "10:40", title: pair("Period 3 · Class 9 Physics"), sub: pair("Needs a substitute"), state: "now" },
    { time: "13:30", title: pair("PTM · Class 10"), sub: pair("Parents meet subject teachers in the hall"), state: "next" },
    { time: "13:45", title: pair("Last bell"), state: "next" },
  ],
  schedule: null,
  scheduleFailed: false,
  exceptions: { notMarked: ["3", "5", "7", "9", "11 Com"], cover: [] },
  support: { needsAction: 2, due: 1 },
  actions: QUICK_ACTIONS.map((q) => ({ key: q.key, label: q.label, icon: q.icon, href: q.href, tone: q.tone })),
  links: { collect: true, reports: true, attendance: true, substitutions: true, review: true, timetable: true },
  unavailable: false,
  roleLine: pair("Admin · Session 2026–27", "प्रशासक · सत्र 2026–27"),
  me: { initials: "JS", href: "/settings" },
  week: [
    { day: "2026-10-05", percent: 92 },
    { day: "2026-10-06", percent: 95 },
    { day: "2026-10-07", percent: 91 },
  ],
  promisedToday: 6,
};

function TodayFrame() {
  return (
    <VxPage label="Today">
      <TodayScreen {...todayProps} />
    </VxPage>
  );
}

/**
 * The real session as an admin sees it under the live Fees connection: no local
 * money, Fees' own "today" total, the ledger notice, and a timetable "who teaches
 * now" (the real session has one). Synthetic figures.
 */
const ledger = {
  total: 21300,
  count: 6,
  byMode: [{ mode: "cash", label: "Cash", amount: 15300, count: 4 }, { mode: "upi", label: "UPI", amount: 6000, count: 2 }],
  asOf: "2026-10-08T05:40:00Z",
};
// Fees' latest 14 collection days (schoolfees #150), Sundays and quiet days left out as Fees leaves them.
const ledgerDays = Array.from({ length: 16 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 7 - i));
  return { date: d.toISOString().slice(0, 10), amount: d.getUTCDay() === 0 ? 0 : 12000 + ((i * 7919) % 26000) };
}).filter((d) => d.amount > 0).slice(0, 14).reverse();
const liveTodayProps: TodayProps = {
  ...todayProps,
  money: moneyFromLedger({ ...ledger, session: { expected: 3120000, collected: 1860000, dueSoFar: 1934000, followUps: 10, recentDays: ledgerDays } }, TODAY),
  ledgerToday: null,
  notice: <LedgerNotice language="en" />,
};

function TodayLiveFrame() {
  return (
    <VxPage label="Today">
      <TodayScreen {...liveTodayProps} />
    </VxPage>
  );
}

/** A Fees from before #150: only today's figures, so the plain ledger tile. */
function TodayLedgerOnlyFrame() {
  return (
    <VxPage label="Today">
      <TodayScreen {...liveTodayProps} money={null} promisedToday={null} ledgerToday={ledger} />
    </VxPage>
  );
}

/** A closed day in the real session: a named break, with the day school opens again. */
const closedTodayProps: TodayProps = {
  ...liveTodayProps,
  status: pair("Diwali break", "दीपावली अवकाश"),
  attendance: { marked: 0, total: 19, percent: null, schoolOpen: false },
  staffAway: 0,
  cover: { needed: 0, arranged: 0, missed: 0 },
  inbox: [],
  timeline: [],
  exceptions: { notMarked: null, cover: [] },
  week: [
    { day: "2026-10-05", percent: 92 },
    { day: "2026-10-06", percent: 95 },
    { day: "2026-10-07", percent: 91 },
  ],
  glance: {
    closed: { en: "Diwali break", hi: "दीपावली अवकाश", sunday: false, reopens: "2026-10-13" },
    coming: [{ from: "2026-10-20", to: "2026-10-20", kind: "holiday", en: "Dussehra", hi: "दशहरा", inDays: 12 }],
    birthdays: glance.birthdays!.slice(0, 2),
  },
};

function TodayClosedFrame() {
  return (
    <VxPage label="Today">
      <TodayScreen {...closedTodayProps} />
    </VxPage>
  );
}

// D09 is drawn with the icon sidebar: the person's own collapsed choice, set before the shell reads it.
if (new URLSearchParams(location.search).get("view") === "D09-Laptop") {
  try {
    localStorage.setItem("vx.sidebar.collapsed", "1");
  } catch {
    // A fixture without storage draws the full sidebar.
  }
}

Object.assign(views, {
  "F01-Today": { render: TodayFrame, path: "/" },
  "F01-TodayLive": { render: TodayLiveFrame, path: "/" },
  "F01-TodayLedgerOnly": { render: TodayLedgerOnlyFrame, path: "/" },
  "F01-TodayClosed": { render: TodayClosedFrame, path: "/" },
  "F14-TodayDark": { render: TodayFrame, path: "/" },
  Desktop: { render: TodayFrame, path: "/" },
  "D08-TodayDark": { render: TodayFrame, path: "/" },
  "D09-Laptop": { render: TodayFrame, path: "/" },
  "D10-Tablet": { render: TodayFrame, path: "/" },
} satisfies Record<string, DesignView>);
