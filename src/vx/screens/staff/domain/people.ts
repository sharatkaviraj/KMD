import type { StaffRole } from "@/platform/auth/permissions";
import { p, type Pair } from "@/vx/text";

/*
 * The staff directory (design `Staff`, state `list`). Pure.
 */

export type LoginState = "active" | "never" | "none" | "disabled";

export type StaffRow = {
  id: string;
  name: string;
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

export type StaffFilter =
  | "all"
  | "office"
  | "class_teachers"
  | "subject_teachers"
  | "coordinators"
  | "fee_desk"
  | "never"
  | "no_login"
  | "disabled";

export const FILTER_LABELS: Record<StaffFilter, Pair> = {
  all: p("Everyone", "सभी"),
  office: p("Office", "कार्यालय"),
  class_teachers: p("Class teachers", "कक्षा अध्यापक"),
  subject_teachers: p("Subject teachers", "विषय अध्यापक"),
  coordinators: p("Coordinators", "संयोजक"),
  fee_desk: p("Fee desk", "फीस डेस्क"),
  never: p("Never signed in", "कभी लॉगिन नहीं"),
  no_login: p("No login", "लॉगिन नहीं"),
  disabled: p("Disabled", "बंद"),
};

export function matchesFilter(row: StaffRow, filter: StaffFilter): boolean {
  const state = loginState(row);
  switch (filter) {
    case "all":
      return true;
    case "office":
      return row.role === "office" || row.role === "admin" || row.role === "view_only";
    case "class_teachers":
      return row.classTeacherOf.length > 0;
    case "subject_teachers":
      return row.teaches.length > 0;
    case "coordinators":
      return row.role === "academic_coordinator" || row.role === "exam_coordinator";
    case "fee_desk":
      return row.role === "accountant" || row.role === "fee_collector";
    case "never":
      return state === "never";
    case "no_login":
      return state === "none";
    case "disabled":
      return state === "disabled";
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

/** Active first, then by name. */
export function sortRows(rows: StaffRow[]): StaffRow[] {
  return [...rows].sort((a, b) => (a.isActive === b.isActive ? a.name.localeCompare(b.name, "en") : a.isActive ? -1 : 1));
}

/** "Class 9 · English, Science" — what someone works on, in one line. */
export function worksOn(row: Pick<StaffRow, "role" | "classTeacherOf" | "teaches">): Pair {
  if (row.classTeacherOf.length || row.teaches.length) {
    const ct = row.classTeacherOf.length ? `${row.classTeacherOf.join(", ")} (class teacher)` : "";
    const subjects = row.teaches.slice(0, 3).join(", ") + (row.teaches.length > 3 ? ` +${row.teaches.length - 3}` : "");
    return p([ct, subjects].filter(Boolean).join(" · "));
  }
  switch (row.role) {
    case "admin":
      return p("Whole school", "पूरा स्कूल");
    case "accountant":
      return p("Fees and accounts", "फीस व खाते");
    case "fee_collector":
      return p("Fee follow-up", "फीस वसूली");
    case "office":
      return p("Front office", "कार्यालय");
    case "academic_coordinator":
      return p("Academics across classes", "सभी कक्षाओं की पढ़ाई");
    case "exam_coordinator":
      return p("Exams office", "परीक्षा कार्यालय");
    case "view_only":
      return p("Reports only", "केवल रिपोर्ट");
    default:
      return p("—");
  }
}

export type StaffCounts = { total: number; teachers: number; withLogin: number; active: number; never: number; disabled: number };

export function countStaff(rows: StaffRow[]): StaffCounts {
  let teachers = 0;
  let withLogin = 0;
  let active = 0;
  let never = 0;
  let disabled = 0;
  for (const row of rows) {
    const state = loginState(row);
    if (row.isActive && row.isTeaching) teachers += 1;
    if (row.hasLogin) withLogin += 1;
    if (state === "active") active += 1;
    if (state === "never") never += 1;
    if (state === "disabled") disabled += 1;
  }
  return { total: rows.filter((r) => r.isActive).length, teachers, withLogin, active, never, disabled };
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
