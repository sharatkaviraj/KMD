import { useEffect, type ReactNode } from "react";

import type { StaffRole } from "@/platform/auth/permissions";
import { CreatedSheet, StaffScreen } from "@/vx/screens/staff/staff-screen";
import { matrixFromRows, type Matrix } from "@/vx/screens/staff/domain/matrix";
import type { StaffRow } from "@/vx/screens/staff/domain/people";
import type { StaffEvent } from "@/vx/screens/staff/data";

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
      const el = document.querySelector<HTMLElement>(selector);
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

export const views: Record<string, DesignView> = {
  ...staffViews,
};
