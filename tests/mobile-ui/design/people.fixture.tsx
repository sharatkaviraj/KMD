import { useEffect, type ReactNode } from "react";

import type { StaffRole } from "@/platform/auth/permissions";
import { CreatedSheet, StaffScreen } from "@/vx/screens/staff/staff-screen";
import { matrixFromRows, type Matrix } from "@/vx/screens/staff/domain/matrix";
import type { StaffRow } from "@/vx/screens/staff/domain/people";
import type { StaffEvent } from "@/vx/screens/staff/data";
import type { DuplicateHit } from "@/app/(app)/admissions/actions";
import { AdmissionsListScreen, type AdmittedCard, type BoardCard, type Kpis, type RecentRow } from "@/vx/screens/admissions/board";
import { AdmissionDone } from "@/vx/screens/admissions/done";
import type { FamilyCard, Stage } from "@/vx/screens/admissions/logic";
import { StudentRecord, type RecordProps } from "@/vx/screens/admissions/record";
import { AdmissionWizard, DuplicateSheet, SiblingSheet, type WizardContext, type WizardPrefill } from "@/vx/screens/admissions/wizard";
import { VxPage } from "@/vx/ui/page";

import type { DesignView } from "../design.fixture";

/*
 * People: Admissions, Promote & import (StudentTools), Staff & roles.
 * One view per design frame (docs/design-handoff/SCREENS.md → People), with
 * the frame's own synthetic names and numbers. Nothing here reaches a
 * database: server actions are stubbed by the fixture's Vite plugin.
 */

// Sheets and toasts portal into #vx-layer, which the app's shell mounts and
// the fixture's shell does not.
if (typeof document !== "undefined" && !document.getElementById("vx-layer")) {
  const layer = document.createElement("div");
  layer.id = "vx-layer";
  layer.className = "vxt vx-layer";
  document.body.appendChild(layer);
}

/** Click through to a state the frame draws, after the screen has mounted. */
function Steps({ children, clicks }: { children: ReactNode; clicks: string[] }) {
  useEffect(() => {
    let i = 0;
    const timer = window.setInterval(() => {
      const selector = clicks[i];
      if (!selector) {
        window.clearInterval(timer);
        return;
      }
      // "text=Change class" finds the first button whose text is exactly that.
      const el = selector.startsWith("text=")
        ? [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.trim() === selector.slice(5))
        : document.querySelector<HTMLElement>(selector);
      if (el) {
        el.click();
        i += 1;
      }
    }, 60);
    return () => window.clearInterval(timer);
  }, [clicks]);
  return <>{children}</>;
}

/* ================================================================ Staff */

const NOW = Date.now();
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type S = [key: string, name: string, role: StaffRole, ct: string | null, teaches: string[], login: "A" | "N" | "D" | "X", seen: number | null];
const STAFF: S[] = [
  ["js", "Janmejay Singh", "admin", null, [], "A", 0.5],
  ["neelam", "Ms. Neelam Sharma", "accountant", null, [], "A", 10],
  ["desk", "Office desk", "fee_collector", null, [], "A", 2],
  ["pratap", "Mr. Pratap Singh", "view_only", null, [], "A", 26 * 60],
  ["kanwar", "Ms. Sunita Kanwar", "teacher", "Nursery", ["Nursery · All subjects"], "N", null],
  ["rathore", "Ms. Rekha Rathore", "teacher", "LKG", ["LKG · All subjects"], "A", 60],
  ["mehta", "Ms. Anjali Mehta", "teacher", "UKG", ["UKG · All subjects"], "A", 140],
  ["jain", "Ms. Priya Jain", "teacher", "Class 1", ["Class 1 · English, EVS"], "A", 27 * 60],
  ["vyas", "Ms. Seema Vyas", "teacher", "Class 2", ["Class 2 · Hindi, Maths"], "A", 150],
  ["msharma", "Ms. Meenakshi Sharma", "teacher", "Class 3", ["Class 3 · English, Maths"], "A", 49 * 60],
  ["verma", "Mr. Anil Verma", "teacher", "Class 4", ["Class 4 · Maths", "Class 5 · Maths"], "A", 130],
  ["paliwal", "Ms. Usha Paliwal", "teacher", "Class 5", ["Class 5 · EVS, Hindi"], "A", 170],
  ["bhati", "Ms. Kavita Bhati", "teacher", "Class 6", ["Class 6 · Science", "Class 7 · Science", "Class 8 · Science"], "A", 10],
  ["choudhary", "Mr. Vinod Choudhary", "teacher", "Class 7", ["Class 7 · Social Science"], "A", 25],
  ["solanki", "Mr. Hemant Solanki", "teacher", "Class 8", ["Class 8 · English"], "A", 110],
  ["meena", "Mr. Rajendra Meena", "teacher", "Class 9", ["Class 9 · Physics", "Class 10 · Physics"], "A", 27 * 60],
  ["dave", "Ms. Nisha Dave", "teacher", "Class 10", ["Class 10 · English"], "A", 60],
  ["trivedi", "Mr. Ashok Trivedi", "exam_coordinator", "11 Science", ["11 Science · Chemistry"], "A", 5],
  ["purohit", "Mr. Girish Purohit", "teacher", "11 Commerce", ["11 Commerce · Accountancy"], "A", 90],
  ["chouhan", "Ms. Lata Chouhan", "teacher", "11 Arts", ["11 Arts · History"], "A", 73 * 60],
  ["bhatt", "Mr. Naveen Bhatt", "teacher", "12 Science", ["12 Science · Biology"], "A", 120],
  ["kothari", "Ms. Shalini Kothari", "teacher", "12 Commerce", ["12 Commerce · Business Studies"], "A", 26 * 60],
  ["rawal", "Mr. Bhanu Rawal", "teacher", "12 Arts", ["12 Arts · Political Science"], "N", null],
  ["sen", "Mr. Tarun Sen", "teacher", null, ["Class 6 · Maths", "Class 9 · Maths", "11 Science · Maths"], "A", 20],
  ["regar", "Ms. Kiran Regar", "teacher", null, ["Class 3 · Computer", "Class 8 · Computer"], "X", null],
  ["gurjar", "Mr. Bhupendra Gurjar", "teacher", null, ["All classes · PT"], "D", 11 * 1440],
  ["joshi", "Ms. Hema Joshi", "teacher", null, ["Class 6 · Hindi", "Class 10 · Hindi"], "N", null],
  ["agarwal", "Ms. Kanchan Agarwal", "teacher", null, ["Class 1 · Art, Music"], "D", 22 * 1440],
];

const staffRows: StaffRow[] = STAFF.map(([key, name, role, ct, teaches, login, seen], i) => ({
  id: uuid(100 + i),
  name,
  shortName: key.toUpperCase().slice(0, 8),
  role,
  phone: `98290${String(10000 + ((i * 67 + 305) % 1000)).slice(-5)}`,
  isTeaching: role === "teacher" || Boolean(ct) || teaches.length > 0,
  isActive: login !== "D",
  hasLogin: login !== "X",
  email: login === "X" ? null : `${key}@vpps.test`,
  lastSignInAt: login === "A" && seen !== null ? minsAgo(seen) : login === "D" && seen !== null ? minsAgo(seen) : null,
  joinedAt: key === "regar" ? "2026-10-05" : `${2008 + (i % 17)}-07-01`,
  classTeacherOf: ct ? [ct] : [],
  teaches,
  periodsPerWeek: teaches.length ? 22 + ((i * 7) % 11) : 0,
  classRank: ct ? i : null,
}));
const staffId = (key: string) => staffRows[STAFF.findIndex((s) => s[0] === key)].id;

const staffLoad: Record<string, number[]> = Object.fromEntries(
  staffRows.map((r, i) => [r.id, r.isTeaching ? [0, 1, 2, 3, 4, 5].map((j) => (j === 5 ? 3 + (i % 2) : 4 + ((i + j * 3) % 4))) : [0, 0, 0, 0, 0, 0]]),
);

const ROLE_PERMS: Record<string, string[]> = {
  accountant: ["fees:view", "fees:collect", "fees:accounts", "students:view", "dashboard:view", "reports:view", "messages:send"],
  fee_collector: ["fees:view", "fees:collect", "fees:accounts", "students:view"],
  teacher: ["students:view", "notes:view", "notes:write", "attendance:view", "attendance:mark", "marks:view", "marks:write", "timetable:view"],
  exam_coordinator: ["students:view", "marks:view", "marks:write", "assessments:view", "assessments:manage", "timetable:view"],
  academic_coordinator: ["students:view", "notes:view", "attendance:view", "attendance:correct", "marks:view", "assessments:view", "reports:view"],
  office: ["students:view", "fees:view", "attendance:view", "staff:view", "dashboard:view"],
  view_only: ["students:view", "fees:view", "reports:view", "dashboard:view"],
};
const staffMatrix: Matrix = matrixFromRows(Object.entries(ROLE_PERMS).flatMap(([role, perms]) => perms.map((permission) => ({ role, permission }))));
const roleCounts = { admin: 1, office: 0, accountant: 1, fee_collector: 1, academic_coordinator: 0, exam_coordinator: 1, teacher: 22, view_only: 1 } as Record<StaffRole, number>;

const staffEvents: StaffEvent[] = [
  { id: "e2", staffId: staffId("gurjar"), at: "2026-10-02T10:00:00+05:30", kind: "disabled", text: { en: "Login disabled · Lost phone" }, actor: "Janmejay Singh" },
  { id: "e3", staffId: staffId("agarwal"), at: "2026-09-21T10:00:00+05:30", kind: "disabled", text: { en: "Login disabled · On long leave" }, actor: "Janmejay Singh" },
  { id: "e1", staffId: staffId("trivedi"), at: "2026-07-01T10:00:00+05:30", kind: "role", text: { en: "Role changed: teacher → exam coordinator" }, actor: "Janmejay Singh" },
  { id: "e4", staffId: staffId("bhati"), at: "2026-06-15T10:00:00+05:30", kind: "role", text: { en: "Role changed: view only → teacher" }, actor: "Janmejay Singh" },
];

function staff(extra: Partial<Parameters<typeof StaffScreen>[0]> = {}) {
  return (
    <StaffScreen
      rows={staffRows}
      load={staffLoad}
      matrix={staffMatrix}
      roleCounts={roleCounts}
      events={staffEvents}
      sessionLabel="2026–27"
      mayManage
      isAdmin
      mayEditMatrix
      meId={staffId("js")}
      initialView="people"
      initialId={null}
      initialSheet={null}
      {...extra}
    />
  );
}

const ROLE_CHANGES = [
  'button[role="switch"][aria-label="Accounts back office for Fee collector"]',
  'button[role="switch"][aria-label="Change past attendance for Exam coordinator"]',
  'button[role="switch"][aria-label="Send messages for Teacher"]',
];


const staffViews: Record<string, DesignView> = {
  Staff: { path: "/staff", render: () => staff() },
  "DX-Staff-Profile": { path: "/staff", render: () => staff({ initialId: staffId("bhati") }) },
  "DX-Staff-Roles": { path: "/staff", render: () => <Steps clicks={ROLE_CHANGES}>{staff({ initialView: "roles" })}</Steps> },
  "DX-Staff-Disable": { path: "/staff", render: () => staff({ initialId: staffId("dave"), initialSheet: "deactivate" }) },
  "M-Staff": { path: "/staff", render: () => staff() },
  "M-Staff-Roles": { path: "/staff", render: () => <Steps clicks={ROLE_CHANGES}>{staff({ initialView: "roles" })}</Steps> },
  "M-Staff-Invite": { path: "/staff", render: () => staff({ initialSheet: "invite" }) },
  "M-Staff-Created": {
    path: "/staff",
    render: () => (
      <>
        {staff()}
        <CreatedSheet open onClose={() => undefined} onOpen={() => undefined} created={{ kind: "login", name: "Ms. Kiran Regar", username: "regar@vpps.test", password: "K7M2Q-9XRTB", role: "teacher" }} />
      </>
    ),
  },
  "M-Staff-Reset": { path: "/staff", render: () => staff({ initialId: staffId("solanki"), initialSheet: "reset" }) },
};

/* =========================================================== Admissions */

const CL: [string, number, number, number][] = [
  ["Nursery", 18, 25, 17400], ["LKG", 20, 25, 17400], ["UKG", 22, 25, 17400], ["Class 1", 23, 30, 20400], ["Class 2", 25, 30, 20400],
  ["Class 3", 24, 30, 20400], ["Class 4", 29, 30, 20400], ["Class 5", 26, 30, 20400], ["Class 6", 31, 31, 25800], ["Class 7", 27, 35, 25800],
  ["Class 8", 28, 35, 25800], ["Class 9", 28, 35, 31200], ["Class 10", 30, 35, 31200], ["11 Science", 22, 30, 38400], ["11 Commerce", 18, 25, 34800],
  ["11 Arts", 14, 20, 34800], ["12 Science", 20, 25, 38400], ["12 Commerce", 17, 20, 34800], ["12 Arts", 12, 15, 34800],
];
const classId = (label: string) => `cls-${label.toLowerCase().replace(/\s+/g, "-")}`;
const wizardCtx: WizardContext = {
  sessionLabel: "2026-27",
  classes: CL.map(([label, onRoll, seats, tuition]) => ({ id: classId(label), label, onRoll, seats, tuition })),
  routes: [["r1", "Route 1", 7200], ["r2", "Route 2", 8400], ["r3", "Route 3", 9600], ["r4", "Route 4", 10800]].map(([id, label, annual]) => ({ id: id as string, label: label as string, annual: annual as number })),
  policies: [
    { id: "pol-staff", code: "staff_child", label: "Staff child", calculationType: "tuition_percentage", percentage: 50, fixedTuitionAmount: null },
    { id: "pol-rte", code: "rte", label: "RTE seat", calculationType: "tuition_zero", percentage: null, fixedTuitionAmount: null },
    { id: "pol-third", code: "third_child", label: "Third child", calculationType: "tuition_percentage", percentage: 50, fixedTuitionAmount: null },
  ],
  schedule: [["Installment 1", "2026-07-15"], ["Installment 2", "2026-09-15"], ["Installment 3", "2026-11-15"], ["Installment 4", "2027-01-15"]].map(([label, dueDate]) => ({ label, dueDate })),
  distribution: "equal",
  newAcademicFee: 1200,
  oldAcademicFee: 600,
  lateFee: 1000,
  today: "2026-10-08",
  nextSr: "1433",
};

const regar: FamilyCard = { key: "regar", father: "Mukesh Regar", mother: "Sunita Regar", phone: "9829041733", village: "Amet", address: "Near bus stand, Ward 4", kids: [{ id: "kid-priya", name: "Priya Regar", classLabel: "Class 5" }] };
const regar2: FamilyCard = { key: "regar2", father: "Kailash Regar", mother: "Geeta Regar", phone: "9829046120", village: "Kelwa", address: "Regar Mohalla", kids: [{ id: "kid-mohit", name: "Mohit Regar", classLabel: "Class 8" }] };

const ishaan: WizardPrefill = {
  enquiryId: "enq-ishaan",
  fullName: "Ishaan Regar",
  classId: classId("Class 2"),
  fatherName: "Mukesh Regar",
  phone: "9829041733",
  nameHi: "ईशान रेगर",
  dob: "21-08-2019",
  gender: "Male",
  previousSchool: "Bal Vidya Mandir, Rajsamand",
  motherName: "Sunita Regar",
  address: "Near bus stand, Ward 4",
  village: "Amet",
};
const kavya: WizardPrefill = { enquiryId: "enq-kavya", fullName: "Kavya Sen", classId: classId("Class 2"), fatherName: "Manish Sen", phone: "9829047730", dob: "14-03-2019", gender: "Female", motherName: "Rekha Sen", address: "Sen Mohalla", village: "Amet" };

const wizard = (prefill: WizardPrefill, step: number) => (
  <VxPage>
    <AdmissionWizard ctx={wizardCtx} prefill={prefill} initialStep={step} />
  </VxPage>
);

const P = (id: string, stage: Stage, name: string, cls: string, parent: string, days: number): BoardCard => ({ id, stage, name, classLabel: cls, parent, phone: "9829040000", days });
const boardCards: BoardCard[] = [
  P("advik", "enquiry", "Advik Sen", "UKG", "Pankaj Sen", 2), P("myra", "enquiry", "Myra Kumawat", "Class 1", "Suresh Kumawat", 5), P("reyansh", "enquiry", "Reyansh Chouhan", "Class 7", "Dilip Chouhan", 1),
  P("kiara", "enquiry", "Kiara Rawal", "LKG", "Naveen Rawal", 9), P("laksh", "enquiry", "Laksh Gurjar", "Class 9", "Bhagwan Gurjar", 3),
  P("aadhya", "visited", "Aadhya Bhati", "Nursery", "Mahendra Bhati", 4), P("vihaan", "visited", "Vihaan Jain", "Class 3", "Sandeep Jain", 2), P("prisha", "visited", "Prisha Dave", "11 Commerce", "Hitesh Dave", 6),
  P("rudransh", "visited", "Rudransh Solanki", "Class 7", "Gajendra Solanki", 1),
  P("ishaan", "form", "Ishaan Regar", "Class 2", "Mukesh Regar", 3), P("kavya2", "form", "Kavya Sen", "Class 2", "Manish Sen", 8), P("tanishka", "form", "Tanishka Meena", "Class 8", "Ramesh Meena", 2),
];
const recentRows: RecentRow[] = (
  [
    ["dhruv", "Dhruv Meena", "Class 9", "1432", "Wed, 7 Oct", "ok", "pending", "pending"],
    ["anvi", "Anvi Kothari", "UKG", "1431", "Mon, 5 Oct", "ok", "na", "ok"],
    ["kartik", "Kartik Purohit", "Class 6", "1430", "Sat, 3 Oct", "ok", "pending", "ok"],
    ["kavya", "Kavya Sen", "Class 2", "1429", "Fri, 2 Oct", "ok", "ok", "pending"],
    ["siya", "Siya Chouhan", "Class 4", "1427", "Tue, 29 Sept", "pending", "ok", "pending"],
    ["devansh", "Devansh Trivedi", "11 Science", "1424", "Sat, 12 Sept", "ok", "pending", "ok"],
  ] as const
).map(([id, name, cls, sr, date, birth, tc, photo]) => ({ id, name, classLabel: cls, sr, date, isNew: false, docs: { birth, tc, photo } }));
const admissionKpis: Kpis = {
  newCount: 64,
  openEnquiries: 12,
  waitingWeek: 2,
  docsPending: 7,
  seatsLeft: 97,
  seatsEditable: true,
  bands: [{ short: "Pre", left: 15, cap: 75 }, { short: "1–5", left: 23, cap: 150 }, { short: "6–8", left: 15, cap: 101 }, { short: "9–10", left: 12, cap: 70 }, { short: "11–12", left: 32, cap: 135 }],
};
const admittedCards: AdmittedCard[] = [
  { id: "dhruv", name: "Dhruv Meena", classLabel: "Class 9", parent: "Ramesh Meena", sr: "1432" },
  { id: "anvi", name: "Anvi Kothari", classLabel: "UKG", parent: "Vivek Kothari", sr: "1431" },
  { id: "kartik", name: "Kartik Purohit", classLabel: "Class 6", parent: "Hemant Purohit", sr: "1430" },
];
const admissionsList = () => <AdmissionsListScreen sessionLabel="2026–27" kpis={admissionKpis} cards={boardCards} admitted={admittedCards} recent={recentRows} classLabels={CL.map((c) => c[0])} />;

const kavyaHit: DuplicateHit = { id: "stu-kavya", fullName: "Kavya Sen", fatherName: "Manish Sen", dateOfBirth: "2019-03-14", phone: "9829047730", admissionNo: "1429", classLabel: "Class 2", createdAt: "2026-10-02T10:00:00+05:30" };

const recordBase: RecordProps = {
  studentId: "stu-devansh",
  sessionLabel: "2026-27",
  sr: "1424",
  classLabel: "11 Science",
  status: "active",
  leftOn: null,
  tcNumber: null,
  admittedOn: "2026-09-12",
  initial: { fullName: "Devansh Trivedi", nameHi: "देवांश त्रिवेदी", dob: "05-02-2011", gender: "Male", fatherName: "Alok Trivedi", motherName: "Meenakshi Trivedi", fatherPhone: "9829040861", motherPhone: "", address: "Station Road", villageCity: "Kelwa", previousSchool: "", classId: classId("11 Science"), transportRouteId: "r2" },
  docs: { birth: true, photo: true },
  classes: CL.map(([label]) => ({ id: classId(label), label })),
  routes: wizardCtx.routes.map((r) => ({ id: r.id, label: r.label })),
  history: [
    { at: "2026-10-06T11:20:00+05:30", action: "update", changed: ["Phone"] },
    { at: "2026-09-14T09:05:00+05:30", action: "update", changed: ["Bus"] },
    { at: "2026-09-12T12:40:00+05:30", action: "insert", changed: [] },
  ],
  dues: { pendingToday: 0, notDueYet: 19200, lateFeePending: 0 },
  today: "2026-10-08",
  schoolName: "Shri Veer Patta Senior Secondary School",
  mode: "edit",
};
const yuvraj: RecordProps = {
  ...recordBase,
  studentId: "stu-yuvraj",
  sr: "1258",
  classLabel: "Class 6",
  admittedOn: "2023-04-03",
  initial: { ...recordBase.initial, fullName: "Yuvraj Gurjar", nameHi: "युवराज गुर्जर", dob: "11-12-2014", fatherName: "Bhanwar Gurjar", motherName: "Santosh Gurjar", fatherPhone: "9829044617", villageCity: "Kunwariya", classId: classId("Class 6"), transportRouteId: "r4" },
  dues: { pendingToday: 4200, notDueYet: 17400, lateFeePending: 0 },
  mode: "withdraw",
};

const admissionViews: Record<string, DesignView> = {
  Admissions: { path: "/admissions", render: admissionsList },
  "M-Admissions": { path: "/admissions", render: admissionsList },
  "DX-Admissions-Add": { path: "/admissions/new", render: () => wizard(ishaan, 1) },
  "M-Admissions-Student": { path: "/admissions/new", render: () => wizard(ishaan, 1) },
  "DX-Admissions-Fees": { path: "/admissions/new", render: () => wizard({ ...ishaan, routeId: "r1", linked: regar }, 3) },
  "DX-Admissions-Duplicate": {
    path: "/admissions/new",
    render: () => (
      <>
        {wizard(kavya, 2)}
        <DuplicateSheet open hits={[kavyaHit]} adding={{ name: "Kavya Sen", father: "Manish Sen", dob: "2019-03-14", cls: "Class 2", phone: "9829047730" }} onClose={() => undefined} onDifferent={() => undefined} onOpen={() => undefined} />
      </>
    ),
  },
  "M-Admissions-Sibling": {
    path: "/admissions/new",
    render: () => (
      <>
        {wizard(ishaan, 2)}
        <SiblingSheet open childName="Ishaan Regar" initialQuery="Regar" initialHits={[regar, regar2]} initialSel="regar" onClose={() => undefined} onLink={() => undefined} />
      </>
    ),
  },
  "M-Admissions-Done": {
    path: "/admissions/new",
    render: () => (
      <VxPage>
        <AdmissionDone info={{ studentId: "stu-ishaan", name: "Ishaan Regar", classLabel: "Class 2", sr: "1433", fatherName: "Mukesh Regar", phone: "9829041733", savedBy: "Janmejay Singh", pendingToday: 10980, notDueYet: 11580, missingDocs: [], schoolName: "Shri Veer Patta Senior Secondary School", savedAt: "2026-10-08T11:40:00+05:30" }} />
      </VxPage>
    ),
  },
  "M-Admissions-Edit": {
    path: "/admissions",
    render: () => (
      <Steps clicks={["text=Change class", "text=11 Commerce"]}>
        <VxPage>
          <StudentRecord {...recordBase} />
        </VxPage>
      </Steps>
    ),
  },
  "DX-Admissions-Withdraw": { path: "/admissions", render: () => <VxPage><StudentRecord {...yuvraj} /></VxPage> },
};

export const views: Record<string, DesignView> = {
  ...staffViews,
  ...admissionViews,
};
