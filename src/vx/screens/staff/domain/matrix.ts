import { staffPermissions, staffRoles, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import { p, type Pair } from "@/vx/text";

/*
 * The roles × permissions matrix on Staff → Roles (design `Staff`, states
 * `roles` and `changes`). Pure: the screen and the server action share it,
 * and `tests/vx-staff.test.ts` covers it.
 *
 * Two cells are never editable, whatever the database says:
 *  - the Admin column — admin has everything by construction (can());
 *  - money for teachers — "Teachers never see fee amounts" (RULES F).
 * `vppsone.set_role_permissions` refuses both again, so a crafted request
 * cannot do what the switches do not offer.
 */

export const ROLE_LABELS: Record<StaffRole, Pair> = {
  admin: p("Admin", "प्रशासक"),
  office: p("Office", "कार्यालय"),
  accountant: p("Accountant", "लेखाकार"),
  fee_collector: p("Fee collector", "वसूली कर्मी"),
  academic_coordinator: p("Academic coordinator", "शैक्षणिक संयोजक"),
  exam_coordinator: p("Exam coordinator", "परीक्षा संयोजक"),
  teacher: p("Teacher", "अध्यापक"),
  view_only: p("Viewer", "केवल देखें"),
};

/** Matrix column order: as the design draws it, then the roles it does not. */
export const MATRIX_ROLES: readonly StaffRole[] = [
  "admin",
  "accountant",
  "teacher",
  "exam_coordinator",
  "academic_coordinator",
  "office",
  "fee_collector",
  "view_only",
];

export type PermissionInfo = { key: StaffPermission; label: Pair; help: Pair };
export type PermissionGroup = { key: string; title: Pair; note?: Pair; items: PermissionInfo[] };

const I = (key: StaffPermission, en: string, hi: string, help: string, helpHi: string): PermissionInfo => ({
  key,
  label: p(en, hi),
  help: p(help, helpHi),
});

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    key: "money",
    title: p("Money", "फीस"),
    note: p("Teachers never see fee amounts", "अध्यापक फीस की रक़म कभी नहीं देखते"),
    items: [
      I("fees:view", "See fees & receipts", "फीस व रसीदें देखें", "Open the fee screens: dues, receipts, reports.", "फीस की स्क्रीन खोलें: बकाया, रसीदें, रिपोर्ट।"),
      I("fees:collect", "Collect fee", "फीस जमा करें", "Take money at the Payment Desk and print the receipt.", "पेमेंट डेस्क पर फीस लें और रसीद छापें।"),
      I("fees:manage", "Fee setup & corrections", "फीस ढाँचा व सुधार", "Change fee setup, admit children, approve reversals.", "फीस ढाँचा बदलें, दाख़िला करें, रसीद रद्द मंज़ूर करें।"),
    ],
  },
  {
    key: "students",
    title: p("Students", "विद्यार्थी"),
    items: [
      I("students:view", "View students", "विद्यार्थी देखें", "Search the whole school's student list.", "पूरे स्कूल की सूची में खोजें।"),
      I("notes:view", "Read notes on children", "नोट्स पढ़ें", "See notes teachers wrote about a child.", "बच्चे पर लिखे नोट्स देखें।"),
      I("notes:write", "Write notes", "नोट्स लिखें", "Write or speak a note about a child.", "बच्चे पर नोट लिखें या बोलें।"),
      I("collection:view", "See details asked from parents", "माँगी जानकारी देखें", "Open what parents sent back on a link.", "अभिभावकों द्वारा भेजी जानकारी देखें।"),
      I("collection:manage", "Ask parents for details", "जानकारी माँगें", "Send links that ask parents for details or documents.", "अभिभावकों से जानकारी या दस्तावेज़ माँगें।"),
      I("documents:view", "See documents", "दस्तावेज़ देखें", "Open a child's stored documents.", "बच्चे के दस्तावेज़ खोलें।"),
      I("documents:manage", "Add documents", "दस्तावेज़ जोड़ें", "Upload or replace a child's documents.", "दस्तावेज़ अपलोड करें या बदलें।"),
    ],
  },
  {
    key: "academics",
    title: p("Academics", "पढ़ाई"),
    items: [
      I("attendance:view", "See attendance", "हाज़िरी देखें", "Open registers and attendance figures.", "हाज़िरी रजिस्टर देखें।"),
      I("attendance:mark", "Mark attendance", "हाज़िरी लगाएँ", "Mark their own class's attendance.", "अपनी कक्षा की हाज़िरी लगाएँ।"),
      I("attendance:mark_on_behalf", "Mark for a teacher", "अध्यापक की जगह हाज़िरी", "Mark a register for a teacher who could not.", "जो अध्यापक नहीं लगा सके उनकी जगह हाज़िरी।"),
      I("attendance:correct", "Change past attendance", "पुरानी हाज़िरी बदलें", "Approve a correction to a saved register.", "सहेजी हाज़िरी में सुधार मंज़ूर करें।"),
      I("marks:view", "See marks", "अंक देखें", "Open mark sheets.", "अंक तालिका देखें।"),
      I("marks:write", "Enter marks", "अंक भरें", "Enter marks for their own class-subjects.", "अपने विषयों के अंक भरें।"),
      I("assessments:view", "See exams", "परीक्षाएँ देखें", "Open the exam list and report cards.", "परीक्षा सूची व रिपोर्ट कार्ड देखें।"),
      I("assessments:manage", "Run exams & results", "परीक्षा व परिणाम चलाएँ", "Plan exams, lock marks, publish results.", "परीक्षा योजना, अंक लॉक, परिणाम जारी।"),
      I("timetable:view", "See timetable", "समय सारणी देखें", "Open the class and teacher timetables.", "कक्षा व अध्यापक की समय सारणी देखें।"),
      I("timetable:manage", "Change timetable", "समय सारणी बदलें", "Change periods and publish the timetable.", "पीरियड बदलें और सारणी जारी करें।"),
      I("substitutions:view", "See substitutions", "सब्स्टिट्यूशन देखें", "See who covers whom today.", "आज कौन किसकी जगह है देखें।"),
      I("substitutions:manage", "Arrange substitutes", "सब्स्टिट्यूट लगाएँ", "Record leave and assign cover.", "छुट्टी दर्ज करें और सब्स्टिट्यूट लगाएँ।"),
      I("academics:view", "See classes & subjects", "कक्षाएँ व विषय देखें", "Open master data: classes, subjects, calendar.", "मास्टर डेटा देखें।"),
      I("academics:manage", "Change classes & subjects", "कक्षाएँ व विषय बदलें", "Edit master data and the calendar.", "मास्टर डेटा और कैलेंडर बदलें।"),
      I("reports:view", "See academic reports", "रिपोर्ट देखें", "Open academic reports and exports.", "शैक्षणिक रिपोर्ट देखें।"),
    ],
  },
  {
    key: "people",
    title: p("People & system", "लोग व सिस्टम"),
    items: [
      I("dashboard:view", "Open Today", "आज देखें", "The home screen with the day at a glance.", "दिन का सार देखें।"),
      I("staff:view", "See staff", "स्टाफ़ देखें", "Open the staff list with phone numbers.", "फ़ोन नंबर सहित स्टाफ़ सूची।"),
      I("staff:manage", "Add & edit staff", "स्टाफ़ जोड़ें", "Add staff and correct their details.", "स्टाफ़ जोड़ें और विवरण सुधारें।"),
      I("messages:send", "Send messages", "संदेश भेजें", "Send notices to staff, classes and families.", "स्टाफ़, कक्षाओं व परिवारों को सूचना भेजें।"),
      I("settings:manage", "Settings & roles", "सेटिंग्स व भूमिकाएँ", "School profile, backups and this matrix.", "स्कूल प्रोफ़ाइल, बैकअप और यह तालिका।"),
      I("apps:view", "Other school apps", "अन्य ऐप", "Links to SamPark and the fee app.", "सम्पर्क और फीस ऐप के लिंक।"),
      I("jobs:view", "See background jobs", "जॉब देखें", "Nightly jobs and their results.", "रात के जॉब और नतीजे।"),
      I("jobs:run", "Run jobs & backups", "जॉब व बैकअप चलाएँ", "Run a job or a backup now.", "जॉब या बैकअप अभी चलाएँ।"),
      I("audit:view", "See the activity log", "गतिविधि देखें", "Who changed what, and when.", "किसने क्या कब बदला।"),
    ],
  },
];

/**
 * The groups the screen draws: the named ones, then "Other" for any
 * permission added to `permissions.ts` after this list was written, so a new
 * permission is editable from the day it exists. Every permission appears in
 * exactly one group (checked in the tests).
 */
export function matrixGroups(): PermissionGroup[] {
  const listed = new Set<string>(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key)));
  const rest = staffPermissions.filter((key) => !listed.has(key));
  const groups = PERMISSION_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => (staffPermissions as readonly string[]).includes(i.key)) }));
  if (rest.length === 0) return groups;
  return [
    ...groups,
    { key: "other", title: p("Other", "अन्य"), items: rest.map((key) => ({ key, label: p(key), help: p(key) })) },
  ];
}

export const MATRIX_PERMISSIONS: readonly StaffPermission[] = matrixGroups().flatMap((g) => g.items.map((i) => i.key));

export function permissionInfo(key: string): PermissionInfo | null {
  for (const group of matrixGroups()) {
    const found = group.items.find((item) => item.key === key);
    if (found) return found;
  }
  return null;
}

export type CellLock = "admin" | "teacher_money" | null;

export function cellLock(role: StaffRole, permission: StaffPermission): CellLock {
  if (role === "admin") return "admin";
  if (role === "teacher" && permission.startsWith("fees:")) return "teacher_money";
  return null;
}

/** The matrix as the screen holds it: `role → permissions`. */
export type Matrix = Record<StaffRole, readonly StaffPermission[]>;

export function matrixFromRows(rows: readonly { role: string; permission: string }[]): Matrix {
  const known = new Set<string>(staffPermissions);
  const out = Object.fromEntries(staffRoles.map((role) => [role, [] as StaffPermission[]])) as Record<StaffRole, StaffPermission[]>;
  for (const row of rows) {
    if (!(staffRoles as readonly string[]).includes(row.role) || !known.has(row.permission)) continue;
    const list = out[row.role as StaffRole];
    if (!list.includes(row.permission as StaffPermission)) list.push(row.permission as StaffPermission);
  }
  // Admin is everything by construction.
  out.admin = [...staffPermissions];
  return out;
}

export type MatrixChange = { role: StaffRole; permission: StaffPermission; granted: boolean };

export function has(matrix: Matrix, role: StaffRole, permission: StaffPermission): boolean {
  return matrix[role]?.includes(permission) ?? false;
}

/** Flip one cell; a locked cell is returned unchanged. */
export function toggle(matrix: Matrix, role: StaffRole, permission: StaffPermission): Matrix {
  if (cellLock(role, permission)) return matrix;
  const current = matrix[role] ?? [];
  const next = current.includes(permission) ? current.filter((x) => x !== permission) : [...current, permission];
  return { ...matrix, [role]: next };
}

/** What changed between the saved matrix and the edited one, in matrix order. */
export function diffMatrix(saved: Matrix, edited: Matrix): MatrixChange[] {
  const out: MatrixChange[] = [];
  for (const permission of MATRIX_PERMISSIONS) {
    for (const role of MATRIX_ROLES) {
      if (cellLock(role, permission)) continue;
      const before = has(saved, role, permission);
      const after = has(edited, role, permission);
      if (before !== after) out.push({ role, permission, granted: after });
    }
  }
  return out;
}

/** "Off: Collect fee for Fee collector". */
export function describeChange(change: MatrixChange): Pair {
  const info = permissionInfo(change.permission);
  const role = ROLE_LABELS[change.role];
  const label = info?.label ?? p(change.permission);
  return p(
    `${change.granted ? "On" : "Off"}: ${label.en} for ${role.en}`,
    `${change.granted ? "चालू" : "बंद"}: ${role.hi ?? role.en} के लिए ${label.hi ?? label.en}`,
  );
}

/** Validate changes coming from the browser before they reach the database. */
export function cleanChanges(input: unknown): MatrixChange[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 400) return null;
  const out: MatrixChange[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const { role, permission, granted } = raw as Record<string, unknown>;
    if (!(staffRoles as readonly string[]).includes(String(role))) return null;
    if (!(staffPermissions as readonly string[]).includes(String(permission))) return null;
    if (typeof granted !== "boolean") return null;
    if (cellLock(role as StaffRole, permission as StaffPermission)) return null;
    out.push({ role: role as StaffRole, permission: permission as StaffPermission, granted });
  }
  return out;
}

export const MATRIX_REFUSALS: Record<string, Pair> = {
  not_admin: p("Only an administrator can change roles.", "भूमिकाएँ केवल प्रशासक बदल सकते हैं।"),
  admin_locked: p("Admin always has everything.", "प्रशासक के पास हमेशा सब कुछ रहता है।"),
  teacher_money: p("Teachers never see fee amounts.", "अध्यापक फीस की रक़म नहीं देखते।"),
  unknown_permission: p("That permission is not known.", "यह अनुमति मान्य नहीं है।"),
  empty: p("Nothing to save.", "सहेजने को कुछ नहीं।"),
  bad_role: p("That role is not known.", "यह भूमिका मान्य नहीं है।"),
  bad_request: p("Something in the change was not right.", "बदलाव में कुछ ठीक नहीं था।"),
};
