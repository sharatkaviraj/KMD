import type { StaffRole } from "@/platform/auth/permissions";
import { p, type Pair } from "@/vx/text";

/*
 * The staff directory (design `Staff`, state `list`). Pure.
 */

export type LoginState = "active" | "never" | "none" | "disabled";

export type StaffRow = {
  id: string;
  name: string;
  photoUrl?: string | null;
  shortName: string;
  role: StaffRole;
  phone: string | null;
  isTeaching: boolean;
  isActive: boolean;
  hasLogin: boolean;
  email: string | null;
  lastSignInAt: string | null;
  joinedAt: string;
  /** "Class teacher of Class 9". */
  classTeacherOf: string[];
  /** "Class 9 · Science". */
  teaches: string[];
  periodsPerWeek: number;
  /** Where their class-teacher class sits in the school's class order, for sorting. */
  classRank?: number | null;
};

export function loginState(row: Pick<StaffRow, "isActive" | "hasLogin" | "lastSignInAt">): LoginState {
  if (!row.isActive) return "disabled";
  if (!row.hasLogin) return "none";
  return row.lastSignInAt ? "active" : "never";
}

export const LOGIN_LABELS: Record<LoginState, Pair> = {
  active: p("Active", "चालू"),
  never: p("Never signed in", "कभी लॉगिन नहीं"),
  none: p("No login", "लॉगिन नहीं"),
  disabled: p("Disabled", "बंद"),
};

/** "98290 ••305" — enough to recognise a number, not enough to copy it. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length < 6) return digits ? "••" + digits.slice(-2) : "—";
  return `${digits.slice(0, 5)} ••${digits.slice(-3)}`;
}

/*
 * Two filters side by side, as the design draws them: who someone is (a role
 * chip) and where their login stands (a login chip or KPI tile).
 */
export type RoleFilter = "all" | "office" | "class_teachers" | "subject_teachers" | "coordinators";
export type LoginFilter = "all" | "with_login" | "never" | "disabled" | "no_login";

export const ROLE_FILTER_LABELS: Record<RoleFilter, Pair> = {
  all: p("Everyone", "सभी"),
  office: p("Office", "कार्यालय"),
  class_teachers: p("Class teachers", "कक्षा अध्यापक"),
  subject_teachers: p("Subject teachers", "विषय अध्यापक"),
  coordinators: p("Coordinators", "संयोजक"),
};

export const LOGIN_FILTER_LABELS: Record<LoginFilter, Pair> = {
  all: p("Any login", "कोई भी लॉगिन"),
  with_login: p("With login", "लॉगिन वाले"),
  never: p("Never signed in", "कभी लॉगिन नहीं"),
  disabled: p("Disabled", "बंद"),
  no_login: p("No login", "लॉगिन नहीं"),
};

/** The office side of the school: admin, accounts, the fee counter, viewers. */
export const OFFICE_ROLES: readonly StaffRole[] = ["admin", "office", "accountant", "fee_collector", "view_only"];

export function matchesRole(row: StaffRow, filter: RoleFilter): boolean {
  switch (filter) {
    case "office":
      return OFFICE_ROLES.includes(row.role);
    case "class_teachers":
      return row.classTeacherOf.length > 0;
    case "subject_teachers":
      return row.teaches.length > 0;
    case "coordinators":
      return row.role === "academic_coordinator" || row.role === "exam_coordinator";
    default:
      return true;
  }
}

export function matchesLogin(row: StaffRow, filter: LoginFilter): boolean {
  const state = loginState(row);
  switch (filter) {
    case "with_login":
      return row.hasLogin;
    case "never":
      return state === "never";
    case "disabled":
      return state === "disabled";
    case "no_login":
      return state === "none";
    default:
      return true;
  }
}

export function matchesQuery(row: StaffRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  return (
    row.name.toLowerCase().includes(q) ||
    row.shortName.toLowerCase().includes(q) ||
    row.classTeacherOf.some((c) => c.toLowerCase().includes(q)) ||
    row.teaches.some((c) => c.toLowerCase().includes(q)) ||
    (digits.length >= 3 && String(row.phone ?? "").replace(/\D/g, "").includes(digits))
  );
}

const ROLE_ORDER: readonly StaffRole[] = ["admin", "accountant", "fee_collector", "office", "view_only", "academic_coordinator", "exam_coordinator", "teacher"];

/**
 * The design's order: the office first, then class teachers in the school's
 * class order, then everyone else by name.
 */
export function sortRows(rows: StaffRow[]): StaffRow[] {
  const group = (r: StaffRow) => (OFFICE_ROLES.includes(r.role) ? ROLE_ORDER.indexOf(r.role) : r.classTeacherOf.length ? 10 : 20);
  return [...rows].sort(
    (a, b) =>
      group(a) - group(b) ||
      (a.classRank ?? 999) - (b.classRank ?? 999) ||
      a.name.localeCompare(b.name, "en"),
  );
}

/** The subjects someone teaches, without the classes: "Science", "English, Maths". */
function subjectsOf(teaches: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of teaches) {
    const subjects = line.includes(" · ") ? line.slice(line.indexOf(" · ") + 3) : line;
    for (const s of subjects.split(",").map((x) => x.trim()).filter(Boolean)) if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** "Class 6 · Science" — what someone works on, in one line. */
export function worksOn(row: Pick<StaffRow, "role" | "classTeacherOf" | "teaches">): Pair {
  if (row.classTeacherOf.length) {
    const subjects = subjectsOf(row.teaches);
    return p([row.classTeacherOf.join(", "), subjects.slice(0, 3).join(", ")].filter(Boolean).join(" · "));
  }
  if (row.teaches.length) {
    return p(row.teaches.slice(0, 2).join(", ") + (row.teaches.length > 2 ? ` +${row.teaches.length - 2}` : ""));
  }
  switch (row.role) {
    case "admin":
      return p("Whole school", "पूरा स्कूल");
    case "accountant":
      return p("Fees and accounts", "फीस व खाते");
    case "fee_collector":
      return p("Fee counter", "फीस काउंटर");
    case "office":
      return p("Front office", "कार्यालय");
    case "academic_coordinator":
      return p("Academics across classes", "सभी कक्षाओं की पढ़ाई");
    case "exam_coordinator":
      return p("Exams office", "परीक्षा कार्यालय");
    case "view_only":
      return p("Today and timetable only", "केवल आज और समय सारणी");
    default:
      return p("—");
  }
}

export type StaffCounts = { total: number; teachers: number; office: number; withLogin: number; active: number; never: number; disabled: number };

/** The KPI tiles. "Staff" is everyone on the list, disabled included, as the design counts. */
export function countStaff(rows: StaffRow[]): StaffCounts {
  let teachers = 0;
  let office = 0;
  let withLogin = 0;
  let active = 0;
  let never = 0;
  let disabled = 0;
  for (const row of rows) {
    const state = loginState(row);
    if (row.isTeaching) teachers += 1;
    else if (OFFICE_ROLES.includes(row.role)) office += 1;
    if (row.hasLogin) withLogin += 1;
    if (state === "active") active += 1;
    if (state === "never") never += 1;
    if (state === "disabled") disabled += 1;
  }
  return { total: rows.length, teachers, office, withLogin, active, never, disabled };
}

export type RolePill = { key: string; label: Pair; bg: string; fg: string };

const ROLE_PILL: Record<StaffRole, { label: Pair; bg: string; fg: string }> = {
  admin: { label: p("Admin", "प्रशासक"), bg: "var(--accs)", fg: "var(--accfg)" },
  accountant: { label: p("Accountant", "लेखाकार"), bg: "var(--infos)", fg: "var(--info)" },
  fee_collector: { label: p("Fee collector", "वसूली कर्मी"), bg: "var(--infos)", fg: "var(--info)" },
  office: { label: p("Office", "कार्यालय"), bg: "var(--infos)", fg: "var(--info)" },
  view_only: { label: p("Viewer", "केवल देखें"), bg: "var(--s3)", fg: "var(--mut)" },
  exam_coordinator: { label: p("Exam coordinator", "परीक्षा संयोजक"), bg: "var(--warns)", fg: "var(--warnfg)" },
  academic_coordinator: { label: p("Academic coordinator", "शैक्षणिक संयोजक"), bg: "var(--warns)", fg: "var(--warnfg)" },
  teacher: { label: p("Teacher", "अध्यापक"), bg: "var(--s3)", fg: "var(--fg)" },
};

/**
 * The role pills on a row, as the design draws them: "Class teacher" and
 * "Subject teacher" come from what someone actually does (class-teacher rows
 * and the timetable); the stored role adds its own pill unless it is plain
 * "teacher", which those two already say.
 */
export function rolePills(row: Pick<StaffRow, "role" | "classTeacherOf" | "teaches">): RolePill[] {
  const out: RolePill[] = [];
  if (row.classTeacherOf.length) out.push({ key: "ct", label: p("Class teacher", "कक्षा अध्यापक"), bg: "var(--oks)", fg: "var(--ok)" });
  if (row.teaches.length) out.push({ key: "st", label: p("Subject teacher", "विषय अध्यापक"), bg: "var(--s3)", fg: "var(--fg)" });
  if (row.role !== "teacher" || out.length === 0) {
    const pill = { key: row.role, ...ROLE_PILL[row.role] };
    if (OFFICE_ROLES.includes(row.role)) out.unshift(pill);
    else out.push(pill);
  }
  return out;
}

/** "Class teacher · Class 6", "Subject teacher", "Accountant". */
export function titleLine(row: Pick<StaffRow, "role" | "classTeacherOf" | "teaches">): Pair {
  if (row.classTeacherOf.length) return p(`Class teacher · ${row.classTeacherOf.join(", ")}`, `कक्षा अध्यापक · ${row.classTeacherOf.join(", ")}`);
  if (row.role === "teacher") return row.teaches.length ? p("Subject teacher", "विषय अध्यापक") : p("Teacher", "अध्यापक");
  return ROLE_PILL[row.role].label;
}

/** "Ms. Dave" for "Ms. Nisha Dave"; a name without a title stays whole. */
export function shortName(name: string): string {
  const m = /^(Mr|Ms|Mrs|Dr)\.?\s+(.+)$/i.exec(name.trim());
  if (!m) return name.trim();
  const words = m[2].split(/\s+/);
  return `${m[1]}. ${words[words.length - 1]}`;
}

/** He / she / they from the title the school writes, for one sentence of help text. */
export function pronouns(name: string): { they: string; their: string } {
  if (/^(Ms|Mrs|Miss|Smt)\.?\s/i.test(name)) return { they: "She", their: "her" };
  if (/^(Mr|Shri)\.?\s/i.test(name)) return { they: "He", their: "his" };
  return { they: "They", their: "their" };
}

/**
 * A temporary password from random bytes: "4821-KQ7M" style, no look-alikes
 * (0/O, 1/I/L). The caller supplies the randomness, so this stays pure.
 */
export function tempPasswordFrom(bytes: Uint8Array): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const chars: string[] = [];
  for (let i = 0; i < 10; i += 1) chars.push(alphabet[(bytes[i % bytes.length] ?? 0) % alphabet.length]);
  return `${chars.slice(0, 5).join("")}-${chars.slice(5, 10).join("")}`;
}

export const DISABLE_REASONS: { key: string; label: Pair }[] = [
  { key: "left", label: p("Left the school", "स्कूल छोड़ दिया") },
  { key: "long_leave", label: p("On long leave", "लंबी छुट्टी पर") },
  { key: "lost_phone", label: p("Lost phone", "फ़ोन खो गया") },
  { key: "other", label: p("Something else", "कुछ और") },
];
