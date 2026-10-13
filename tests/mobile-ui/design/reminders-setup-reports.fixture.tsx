import type { FeeSetupDraft } from "@/modules/fees/vx/domain/fee-setup";
import type { FeeSetupVxData } from "@/modules/fees/vx/fee-setup-data";
import type { AudienceFamily } from "@/modules/whatsapp/vx/domain/reminders";
import { FeeSetup, type FeeSetupView } from "@/vx/screens/fee-setup/fee-setup";
import type { ReportsPageData, ReportsSheet, ReportsView } from "@/modules/reports/vx/types";
import { RemindersScreen } from "@/vx/screens/reminders/screen";
import { Reports } from "@/vx/screens/reports/reports";
import type { BatchRow, RemindersProps, RuleRow, RunView } from "@/vx/screens/reminders/types";

import type { DesignView } from "../design.fixture";

/*
 * Fee reminders, Fee setup and Reports beside their design frames
 * (docs/design-handoff/screenshots/money). Every name and amount is the
 * design's own synthetic sample; nothing here reaches a database.
 */

// Sheets and toasts portal into #vx-layer, which the production shell mounts.
if (typeof document !== "undefined" && !document.getElementById("vx-layer")) {
  const layer = document.createElement("div");
  layer.id = "vx-layer";
  layer.className = "vxt vx-layer";
  document.body.appendChild(layer);
}

/* ---------------------------------------------------------------- Reminders */

const TODAY = "2026-10-08";

const run = (runId: string, name: string, day: string, messaged: number, delivered: number, read: number, familiesPaid: number, moneyCollected: number, auto = false): RunView => ({
  runId, name, startedAt: `${day}T10:00:00+05:30`, messaged, delivered, read, failed: messaged - delivered, familiesPaid, moneyCollected, moneyQuoted: moneyCollected * 2, source: auto ? "cron" : "manual",
});

const RUNS: RunView[] = [
  run("c1", "Inst 2 · last reminder before calls", "2026-10-05", 124, 121, 97, 22, 89450),
  run("c0", "Every Monday · 90+ days overdue", "2026-10-05", 8, 8, 6, 0, 0, true),
  run("c2", "Inst 2 · one week late", "2026-09-22", 212, 204, 171, 38, 210600),
  run("c3", "Inst 2 is due today", "2026-09-15", 268, 259, 222, 11, 39950, true),
  run("c4", "Bus fee · Routes 3 and 4", "2026-09-01", 46, 45, 39, 17, 31200),
];

const rule = (ruleKey: string, titleEn: string, icon: string, timingOptions: string[], timingChoice: string, template: RuleRow["template"], enabled: boolean): RuleRow => ({
  ruleKey, titleEn, titleHi: null, icon, timingOptions, timingChoice, sendTime: "10", audience: "all", template, quietHours: true, enabled, updatedAt: "2026-10-01T10:00:00+05:30",
});

const RULES: RuleRow[] = [
  rule("before_due", "3 days before a due date", "calendar", ["1", "3", "7"], "3", "upcoming", true),
  rule("on_due", "On the due date", "bell", ["0"], "0", "gentle", true),
  rule("after_due", "7 days after a due date", "alert", ["3", "7", "15"], "7", "gentle", false),
  rule("weekly_90", "Every Monday for 90+ days overdue", "refresh", ["mon", "thu"], "mon", "final", true),
];

/** The design's pool: 336 families on the roll and 7 who left, made the same way each time. */
function audience(): AudienceFamily[] {
  const PER = [4350, 5100, 6450, 7800, 8700];
  const CLASS = ["UKG", "Class 3", "Class 7", "Class 9", "Class 11 Science"];
  const named: [string, string, number, number][] = [
    ["Rakesh Sharma", "Aarav · Class 7, Diya · Class 3", 2, 12840],
    ["Prakash Joshi", "Neha · Class 8, Rohit · Class 5", 2, 22080],
    ["Mohan Kumawat", "Aarti · Class 10", 3, 15600],
    ["Anil Agarwal", "Mohit · Class 9", 3, 9375],
    ["Suresh Meena", "Pihu · UKG", 0, 4350],
    ["Dinesh Sen", "Ayaan · Class 1", 1, 7125],
    ["Gopal Purohit", "Tanya · 11 Commerce", 4, 17400],
  ];
  const pool: AudienceFamily[] = [];
  for (let i = 0; i < 336; i += 1) {
    const r = (i * 53) % 336;
    const b = (i * 97) % 336;
    const band = b < 47 ? 0 : b < 145 ? 1 : b < 212 ? 2 : b < 257 ? 3 : 4;
    const bus = (i * 31) % 336 < 118;
    const pend = r < 112;
    pool.push({
      key: `f${i}`, studentIds: [`s${i}`], fatherName: `Test Parent ${i + 1}`, kidsLine: `Child ${i + 1} · ${CLASS[band]}`, classLabels: [CLASS[band]],
      pendingToday: pend ? PER[band] * (r < 40 ? 2 : 1) + (bus ? 1575 : 0) : 0, notDueYet: PER[band], usesBus: bus,
      overdueInstallments: r < 104 ? [1, 2] : pend ? [1] : [], promised: pend && r % 8 === 3, paidLast3Days: pend && r % 19 === 6, left: false,
    });
  }
  for (let i = 0; i < 7; i += 1) {
    pool.push({ key: `l${i}`, studentIds: [`l${i}`], fatherName: `Left Parent ${i + 1}`, kidsLine: `Left child · ${CLASS[i % 5]}`, classLabels: [CLASS[i % 5]], pendingToday: 6000 + i * 500, notDueYet: 0, usesBus: false, overdueInstallments: [1, 2], promised: false, paidLast3Days: false, left: true });
  }
  // The design's named families stand in for the first plain matches, so the sample list reads as drawn.
  let n = 0;
  const plain = pool.filter((f) => f.pendingToday > 0 && !f.promised && !f.paidLast3Days && !f.left);
  for (const f of plain.slice(0, named.length)) {
    const [father, kids, band, amt] = named[n++];
    Object.assign(f, { fatherName: father, kidsLine: kids, classLabels: [CLASS[band]], pendingToday: amt });
  }
  const first = new Set(plain.slice(0, named.length).map((f) => f.key));
  return [...pool.filter((f) => first.has(f.key)), ...pool.filter((f) => !first.has(f.key))];
}

const BATCH: BatchRow = {
  id: "b1", name: "Pending today · all classes · gentle", template: "gentle", language: "both",
  audience: { pendingToday: true, inst2: false, big: false, bus: false, bands: [], excludePromised: true, excludePaidRecently: true, excludeLeft: true },
  audienceLine: "Pending today · all classes", studentIds: [], familyCount: 92, moneyQuoted: 612300, costEstimate: 81, status: "queued", scheduledFor: null, createdByName: "Janmejay", createdAt: `${TODAY}T09:40:00+05:30`,
};

const base: RemindersProps = {
  today: TODAY, sessionLabel: "2026-27", view: "list", step: 1, runs: RUNS, batches: [], rules: RULES, audience: [], batch: null, result: null, ruleOpen: null, perms: { queue: true, rules: true },
};

const FAILED: [string, string, string][] = [
  ["Tisha Rawal", "Class 4", "Invalid number"], ["Lakshya Gurjar", "Class 6", "Invalid number"], ["Riddhi Jain", "UKG", "Not on WhatsApp"], ["Aryan Regar", "Class 9", "Not on WhatsApp"],
  ["Dhruvi Vyas", "Class 2", "Invalid number"], ["Kavya Kanwar", "11 Arts", "Not on WhatsApp"], ["Ishaan Sen", "Class 5", "Not on WhatsApp"], ["Pari Bhati", "LKG", "Invalid number"],
];

const reminders = (patch: Partial<RemindersProps>) =>
  function RemindersView() {
    return <RemindersScreen {...base} {...patch} />;
  };
const wizard = (step: 1 | 2 | 3) => reminders({ view: "wizard", step, audience: audience() });
const results = reminders({
  view: "results",
  result: {
    run: RUNS[2],
    notDelivered: FAILED.map(([studentName, classLabel, error], i) => ({ studentId: `x${i}`, studentName, classLabel, error })),
    byClass: [["Nursery–UKG", 28, 52200], ["Class 1–5", 61, 113400], ["Class 6–8", 47, 104400], ["Class 9–10", 34, 85800], ["Class 11–12", 42, 65400]].map(([classLabel, messaged, quoted]) => ({ classLabel: String(classLabel), messaged: Number(messaged), quoted: Number(quoted) })),
  },
});

/* ---------------------------------------------------------------- Fee setup */

// The design's bands as this app's classes: tuition per class, one academic fee for every class.
const CLASSES: [string, number, number][] = [
  ["Nursery", 16800, 20], ["LKG", 16800, 20], ["UKG", 16800, 20],
  ["Class 1", 20000, 26], ["Class 2", 20000, 25], ["Class 3", 20000, 25], ["Class 4", 20000, 26], ["Class 5", 20000, 25],
  ["Class 6", 25600, 29], ["Class 7", 25600, 28], ["Class 8", 25600, 29],
  ["Class 9", 31200, 30], ["Class 10", 31200, 28],
  ["11 Science", 38600, 22], ["12 Science", 38600, 20], ["11 Commerce", 35000, 18], ["12 Commerce", 35000, 17], ["11 Arts", 35000, 13], ["12 Arts", 35000, 13],
];
const ROUTES: [string, number, number][] = [["Amet town", 5400, 64], ["Kelwa", 6300, 41], ["Railmagra", 7200, 38], ["Kunwariya", 8100, 22]];
const DRAFT: FeeSetupDraft = {
  academicSessionLabel: "2026-27",
  installmentDates: ["2026-07-15", "2026-09-15", "2026-11-15", "2027-01-15"],
  lateFeeFlatAmount: 100,
  newStudentAcademicFeeAmount: 1200,
  oldStudentAcademicFeeAmount: 1000,
  academicFeeDistribution: "equal",
  customFeeHeads: [],
  discounts: [
    { key: "d1", id: "d1", code: "sibling", displayName: "Sibling discount", calculationType: "tuition_percentage", percentage: 10, fixedTuitionAmount: null, isActive: true, isBuiltin: false },
    { key: "d2", id: "d2", code: "staff_child", displayName: "Staff child", calculationType: "tuition_percentage", percentage: 50, fixedTuitionAmount: null, isActive: true, isBuiltin: true },
    { key: "d3", id: "d3", code: "rte", displayName: "RTE seat", calculationType: "tuition_zero", percentage: null, fixedTuitionAmount: null, isActive: true, isBuiltin: true },
  ],
  classRows: CLASSES.map(([label, annualTuition]) => ({ label, annualTuition })),
  routeRows: ROUTES.map(([routeName, annualFee]) => ({ routeName, annualFee })),
};
const FEE_DATA: FeeSetupVxData = {
  sessionLabel: "2026-27",
  draft: DRAFT,
  studentsByClass: Object.fromEntries(CLASSES.map(([l, , n]) => [l, n])),
  studentsByRoute: Object.fromEntries(ROUTES.map(([r, , n]) => [r, n])),
  activeStudents: 434,
  paidInstallments: [1, 2],
  ruleStudents: { d1: 46, d2: 9, d3: 12 },
  ruleStudentNames: { d1: ["Diya Sharma · Class 3", "Rohit Joshi · Class 5"], d2: [], d3: [] },
  history: [],
  updatedAt: "2026-10-06T16:20:00+05:30",
};
const REVIEW_DRAFT: FeeSetupDraft = {
  ...DRAFT,
  lateFeeFlatAmount: 150,
  classRows: DRAFT.classRows.map((c) => (["Class 6", "Class 7", "Class 8"].includes(c.label) ? { ...c, annualTuition: 26800 } : c)),
  routeRows: DRAFT.routeRows.map((r) => (r.routeName === "Amet town" ? { ...r, annualFee: 5850 } : r)),
};
const feeSetup = (initialView: FeeSetupView, extra: { initialClass?: string; initialRoute?: string; canEdit?: boolean; draftStart?: FeeSetupDraft } = {}) =>
  function FeeSetupView() {
    return <FeeSetup data={FEE_DATA} today={TODAY} initialView={initialView} initialClass={extra.initialClass ?? null} initialRoute={extra.initialRoute ?? null} canEdit={extra.canEdit ?? true} readOnly={false} draftStart={extra.draftStart} />;
  };

/* ---------------------------------------------------------------- Reports */

const CLS: [string, string, string][] = [
  ["nur", "Nursery", "Ms. Kanwar"], ["lkg", "LKG", "Ms. Rathore"], ["ukg", "UKG", "Ms. Mehta"], ["c1", "Class 1", "Ms. Jain"], ["c2", "Class 2", "Ms. Vyas"], ["c3", "Class 3", "Ms. Sharma"],
  ["c4", "Class 4", "Mr. Verma"], ["c5", "Class 5", "Ms. Paliwal"], ["c6", "Class 6", "Ms. Bhati"], ["c7", "Class 7", "Mr. Choudhary"], ["c8", "Class 8", "Mr. Solanki"], ["c9", "Class 9", "Ms. Dave"], ["c10", "Class 10", "Mr. Purohit"], ["c11", "Class 11–12", "Ms. Joshi"],
];
// Daily collection, 1–8 October: [day, upi, cash, cheque, receipts]
const DAYS: [number, number, number, number, number][] = [[1, 28050, 8700, 4500, 14], [3, 15200, 9500, 0, 9], [5, 22400, 9500, 0, 11], [6, 18100, 7500, 0, 4], [7, 16300, 6500, 0, 4], [8, 30200, 8200, 0, 14]];
type Receipt = { date: string; mode: string; amount: number; classId: string | null; reversed: boolean };
const RECEIPTS: Receipt[] = DAYS.flatMap(([d, upi, cash, cheque, n]) => {
  const date = `2026-10-${String(d).padStart(2, "0")}`;
  const parts = ([["upi", upi], ["cash", cash], ["cheque", cheque]] as [string, number][]).filter((x) => x[1] > 0);
  const rows: Receipt[] = Array.from({ length: n }, (_, i) => ({ date, mode: parts[i % parts.length][0], amount: 0, classId: CLS[i % CLS.length][0], reversed: false }));
  // Each day's modes add up exactly to the design's figures.
  for (const [mode, total] of parts) {
    const mine = rows.filter((r) => r.mode === mode);
    const each = Math.floor(total / mine.length / 50) * 50;
    mine.forEach((r, i) => (r.amount = i === mine.length - 1 ? total - each * (mine.length - 1) : each));
  }
  return rows;
});
const DEFAULTERS: ReportsPageData["defaulters"] = (
  [
    ["c3", "Class 3", "Diya Sharma", "Rakesh Sharma", 5250, 230], ["c3", "Class 3", "Arjun Rawal", "Bharat Rawal", 4550, 230],
    ["c6", "Class 6", "Riya Singh", "Mahendra Singh", 6650, 230], ["c6", "Class 6", "Karan Regar", "Mukesh Regar", 13300, 530],
    ["c7", "Class 7", "Aarav Sharma", "Rakesh Sharma", 6650, 230], ["c7", "Class 7", "Ishaan Trivedi", "Suresh Trivedi", 3250, 230],
    ["c8", "Class 8", "Neha Joshi", "Prakash Joshi", 6650, 230], ["c9", "Class 9", "Mohit Agarwal", "Anil Agarwal", 9375, 230], ["c10", "Class 10", "Aarti Kumawat", "Mohan Kumawat", 8050, 230],
  ] as [string, string, string, string, number, number][]
).map(([classId, classLabel, studentName, fatherName, pending, lateFee], i) => ({
  studentId: `d${i}`, studentName, admissionNo: null, fatherName, classId, classLabel, pending, lateFee, installmentsDue: [1, 2], left: false, phone: `98290 ••${String(512 + i * 37).slice(-3)}`,
}));
// class, inst 1 amount and students, inst 2, inst 3, inst 4
const HEAT: [string, number, number, number, number, number, number, number, number][] = [
  ["nur", 2300, 1, 8650, 4, 8350, 8, 7700, 7], ["lkg", 4600, 2, 10850, 5, 9300, 8, 8600, 8], ["ukg", 4600, 2, 13000, 6, 10250, 9, 9450, 9], ["c1", 5400, 2, 12750, 5, 12600, 10, 11650, 9],
  ["c2", 5400, 2, 17900, 7, 13700, 11, 12650, 10], ["c3", 8100, 3, 20450, 8, 13150, 10, 12150, 10], ["c4", 8100, 3, 23000, 9, 15900, 12, 14700, 12], ["c5", 5400, 2, 17900, 7, 14250, 11, 13150, 10],
  ["c6", 13700, 4, 32350, 10, 21550, 13, 19900, 12], ["c7", 10300, 3, 29150, 9, 18750, 11, 17300, 11], ["c8", 10300, 3, 25900, 8, 19450, 12, 17950, 11],
];
const CLASSWISE: NonNullable<ReportsPageData["classwise"]> = {
  installmentNos: [1, 2, 3, 4],
  dueDates: { 1: "2026-07-15", 2: "2026-09-15", 3: "2026-11-15", 4: "2027-01-15" },
  rows: HEAT.map(([id, a1, n1, a2, n2, a3, n3, a4, n4]) => ({
    classId: id,
    classLabel: CLS.find((c) => c[0] === id)![1],
    cells: { 1: { due: { amount: a1, students: n1 }, notDue: null }, 2: { due: { amount: a2, students: n2 }, notDue: null }, 3: { due: null, notDue: { amount: a3, students: n3 } }, 4: { due: null, notDue: { amount: a4, students: n4 } } },
    pendingToday: a1 + a2,
    notDueYet: a3 + a4,
    lateFee: 230 * n2,
  })),
};
const CELL: NonNullable<ReportsPageData["cell"]> = {
  classLabel: "Class 7",
  installmentNo: 2,
  dueDate: "2026-09-15",
  students: (
    [["Aarav Sharma", "Rakesh Sharma", 6650], ["Ishaan Trivedi", "Suresh Trivedi", 3250], ["Saanvi Singh", "Mahesh Singh", 3250], ["Om Choudhary", "Dinesh Choudhary", 3250], ["Tanvi Chouhan", "Prakash Chouhan", 3250], ["Mohit Sharma", "Naresh Sharma", 3250], ["Diya Vyas", "Lokesh Vyas", 3250], ["Riya Kothari", "Ramesh Kothari", 3250]] as [string, string, number][]
  ).map(([studentName, fatherName, pending], i) => ({ studentId: `cs${i}`, studentName, fatherName, phone: `98290 ••${String(751 + i * 13).slice(-3)}`, pending, lateFee: 230, due: true, left: false })),
};
const REPORTS_BASE: ReportsPageData = {
  today: TODAY,
  sessionLabel: "2026-27",
  schoolName: "Shri Veer Patta Senior Secondary School",
  view: "hub",
  sheet: "",
  classes: CLS.map(([id, label, teacher], i) => ({ id, label, sortOrder: i, teacher, teacherPhone: "9999999999" })),
  hub: { todayTotal: 38400, todayReceipts: 14, todayReversed: 0, spark: [21000, 26000, 18000, 31000, 24000, 35000, 29000, 41250, 24700, 38400], monthTotal: 184650, monthUpi: 130250, modeShare: { upi: 130250, cash: 49900, cheque: 4500, bank_transfer: 0 }, pendingToday: 640000, defaulters: 138, notDueYet: 590000, lateFeePending: 18240, leftOwing: 7, leftOwingAmount: 41000, schedules: 2 },
  collection: { preset: "month", from: "2026-10-01", to: "2026-10-31", receipts: RECEIPTS },
  defaulters: DEFAULTERS,
  classwise: CLASSWISE,
  cell: null,
  daybook: null,
  schedules: [
    { id: "s1", reportKey: "collection", title: "Daily collection", recipients: ["Principal"], frequency: "daily", weekday: null, sendTime: "18:00", format: "pdf", active: true, lastSentAt: null },
    { id: "s2", reportKey: "defaulters", title: "Defaulter list (हिंदी)", recipients: ["Class teachers"], frequency: "weekly", weekday: 1, sendTime: "08:00", format: "pdf", active: true, lastSentAt: null },
  ],
  sessionFrom: "2026-04-01",
};
const reports = (view: ReportsView, sheet: ReportsSheet = "", patch: Partial<ReportsPageData> = {}) =>
  function ReportsFixture() {
    return <Reports data={{ ...REPORTS_BASE, view, sheet, ...patch }} initialSheet={sheet} initialLeft={false} readOnly={false} />;
  };

const R = "/reminders";
const FS = "/fee-setup";
const RP = "/reports";
export const views: Record<string, DesignView> = {
  Reports: { render: reports("hub"), path: RP },
  "DX-Reports-Collection": { render: reports("collection"), path: RP },
  "DX-Reports-Defaulters": { render: reports("defaulters"), path: RP },
  "DX-Reports-Cell": { render: reports("classwise", "", { cell: CELL }), path: RP },
  "M-Reports": { render: reports("hub"), path: RP },
  "M-Reports-Collection": { render: reports("collection"), path: RP },
  "M-Reports-Send": { render: reports("defaulters", "send"), path: RP },
  "M-Reports-Export": { render: reports("collection", "export"), path: RP },
  "M-Reports-Schedule": { render: reports("schedule"), path: RP },
  "AC-Reports": { render: reports("hub"), path: RP, menu: "accountant" },
  "MAC-Reports": { render: reports("hub"), path: RP, menu: "accountant" },
  FeeSetup: { render: feeSetup("structure"), path: FS },
  "DX-FeeSetup-Edit": { render: feeSetup("edit", { initialClass: "Class 7" }), path: FS },
  "DX-FeeSetup-Installments": { render: feeSetup("installments"), path: FS },
  "DX-FeeSetup-Review": { render: feeSetup("review", { draftStart: REVIEW_DRAFT }), path: FS },
  "M-FeeSetup": { render: feeSetup("structure", { initialClass: "Class 7" }), path: FS },
  "M-FeeSetup-Edit": { render: feeSetup("edit", { initialClass: "Class 7" }), path: FS },
  "M-FeeSetup-LateFee": { render: feeSetup("latefee"), path: FS },
  "M-FeeSetup-Route": { render: feeSetup("route", { initialRoute: "Amet town" }), path: FS },
  "M-FeeSetup-Discounts": { render: feeSetup("discounts"), path: FS },
  "AC-FeeSetup": { render: feeSetup("structure", { canEdit: false }), path: FS, menu: "accountant" },
  "MAC-FeeSetup": { render: feeSetup("structure", { canEdit: false, initialClass: "Class 7" }), path: FS, menu: "accountant" },
  Reminders: { render: reminders({}), path: R },
  "AC-Reminders": { render: reminders({ perms: { queue: true, rules: false } }), path: R, menu: "accountant" },
  "MAC-Reminders": { render: reminders({ perms: { queue: true, rules: false } }), path: R, menu: "accountant" },
  "M-Reminders": { render: reminders({}), path: R },
  "DX-Reminders-Message": { render: wizard(2), path: R },
  "M-Reminders-Audience": { render: wizard(1), path: R },
  "M-Reminders-Review": { render: wizard(3), path: R },
  "DX-Reminders-Results": { render: results, path: R },
  "DX-Reminders-Sending": { render: reminders({ view: "sending", batch: BATCH }), path: R },
  "M-Reminders-Rule": { render: reminders({ ruleOpen: "before_due" }), path: R },
  "M-Reminders-Empty": { render: reminders({ view: "empty", runs: [], batches: [] }), path: R },
};
