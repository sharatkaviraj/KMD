import "server-only";

import {
  archiveStudentAction,
  createStudentAction,
  reinstateStudentAction,
  updateStudentAction,
} from "@/app/(app)/fees/students/actions";
import { linkSiblingsAction } from "@/app/(app)/fees/students/sibling-actions";
import { getFeePolicySummary } from "@/modules/fees/data/policy";
import { getWorkbookInstallmentRows } from "@/modules/fees/data/queries";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { drainFinancialViewRefresh } from "@/modules/system-sync/data/financial-view-refresh";
import { newAdmissionSplit } from "@/modules/students-fees/domain/admission-dues";
import { getStudentDetail, getStudentFormOptions } from "@/modules/students-fees/data/queries";
import { toStudentInfoFormValues } from "@/modules/students-fees/domain/info-fields";
import type { StudentFormActionState } from "@/modules/students-fees/domain/types";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";

/*
 * Fee-side reads and writes behind the redesigned Admissions screens
 * (src/vx/screens/admissions). It lives in a ported tree because only ported
 * trees may reach the fee clients (tests/architecture.test.ts).
 *
 * Nothing here invents a new way to write a student. Creating, editing,
 * withdrawing and linking siblings all call the School Fees server actions
 * the old screens call — validation, the third-child rule, dues preparation
 * and the office sync event come with them. What this file adds is reads
 * shaped for the new screens, and FormData built from typed input.
 *
 * Every export checks `students:write` (the fee app's own guard for these
 * screens) before it touches anything; the route actions check `fees:manage`
 * and `assertNotPreviewing()` on top.
 */

type ClassRow = { id: string; class_name: string; section: string | null; stream_name: string | null; sort_order: number | null };

function classLabel(row: Pick<ClassRow, "class_name" | "section" | "stream_name">) {
  const parts = [row.class_name];
  if (row.section?.trim()) parts.push(`Section ${row.section.trim()}`);
  if (row.stream_name?.trim()) parts.push(`(${row.stream_name.trim()})`);
  return parts.join(" ");
}

function todayIst(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** 1 April of the session's first year. */
function sessionStart(sessionLabel: string) {
  const year = Number(sessionLabel.match(/(\d{4})/)?.[1] ?? new Date().getFullYear());
  return `${year}-04-01`;
}

/* ------------------------------------------------------------------ reads */

export type AdmClass = { id: string; label: string; sortOrder: number; onRoll: number; tuition: number };
export type AdmRoute = { id: string; label: string; annual: number };
export type AdmPolicy = {
  id: string;
  code: string;
  label: string;
  calculationType: "tuition_zero" | "tuition_percentage" | "tuition_fixed_amount";
  percentage: number | null;
  fixedTuitionAmount: number | null;
};

export type AdmissionsFeeContext = {
  sessionLabel: string;
  classes: AdmClass[];
  routes: AdmRoute[];
  policies: AdmPolicy[];
  schedule: { label: string; dueDate: string }[];
  distribution: "first_only" | "equal";
  newAcademicFee: number;
  oldAcademicFee: number;
  lateFee: number;
  today: string;
};

export async function loadAdmissionsFeeContext(): Promise<AdmissionsFeeContext> {
  await requireStaffPermission("students:write");
  const [options, policy] = await Promise.all([getStudentFormOptions(), getFeePolicySummary({ useAdmin: true })]);
  const sessionLabel = options.resolvedSessionLabel;
  const admin = createAdminClient();

  const { data: classRows, error: classError } = await admin
    .from("classes")
    .select("id, class_name, section, stream_name, sort_order")
    .eq("session_label", sessionLabel)
    .eq("status", "active")
    .order("sort_order", { ascending: true });
  if (classError) throw new Error(`Could not read classes: ${classError.message}`);
  const classes = (classRows ?? []) as ClassRow[];
  const classIds = classes.map((c) => c.id);

  const [settings, roll, routes] = await Promise.all([
    fetchInChunks<{ class_id: string; tuition_fee_amount: number | null; is_active: boolean }>(classIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      admin.from("fee_settings").select("class_id, tuition_fee_amount, is_active").in("class_id", chunk),
    ),
    fetchInChunks<{ class_id: string }>(classIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      admin.from("students").select("class_id").eq("status", "active").in("class_id", chunk).range(0, 4999),
    ),
    admin.from("transport_routes").select("id, route_name, route_code, annual_fee_amount, default_installment_amount, is_active").eq("is_active", true).order("route_name"),
  ]);
  if (settings.error) throw new Error("Could not read class fees.");
  if (roll.error) throw new Error("Could not count the roll.");
  if (routes.error) throw new Error(`Could not read bus routes: ${routes.error.message}`);

  const tuitionByClass = new Map<string, number>();
  for (const s of settings.data) if (s.is_active !== false) tuitionByClass.set(s.class_id, Number(s.tuition_fee_amount ?? 0));
  const onRoll = new Map<string, number>();
  for (const r of roll.data) onRoll.set(r.class_id, (onRoll.get(r.class_id) ?? 0) + 1);

  const allowedRoutes = new Set(options.routeOptions.map((r) => r.id));
  const installments = Math.max(1, policy.installmentCount);
  return {
    sessionLabel,
    classes: classes.map((c, i) => ({
      id: c.id,
      label: classLabel(c),
      sortOrder: c.sort_order ?? i,
      onRoll: onRoll.get(c.id) ?? 0,
      tuition: tuitionByClass.get(c.id) ?? 0,
    })),
    routes: ((routes.data ?? []) as Array<{ id: string; route_name: string; route_code: string | null; annual_fee_amount: number | null; default_installment_amount: number | null }>)
      .filter((r) => allowedRoutes.has(r.id))
      .map((r) => ({
        id: r.id,
        label: r.route_code ? `${r.route_name} (${r.route_code})` : r.route_name,
        annual: Number(r.annual_fee_amount ?? Number(r.default_installment_amount ?? 0) * installments),
      })),
    policies: options.conventionalDiscountPolicies
      .filter((p) => p.isActive && p.id)
      .map((p) => ({
        id: p.id as string,
        code: p.code,
        label: p.displayName,
        calculationType: p.calculationType,
        percentage: p.percentage,
        fixedTuitionAmount: p.fixedTuitionAmount,
      })),
    schedule: policy.installmentSchedule.map((s) => ({ label: s.label, dueDate: s.dueDate })),
    distribution: policy.academicFeeDistribution,
    newAcademicFee: policy.newStudentAcademicFeeAmount,
    oldAcademicFee: policy.oldStudentAcademicFeeAmount,
    lateFee: policy.lateFeeFlatAmount,
    today: todayIst(),
  };
}

export type RecentAdmission = {
  id: string;
  name: string;
  admissionNo: string;
  classLabel: string;
  fatherName: string | null;
  joinedOn: string | null;
  createdAt: string;
};

/** Children added to the roll this session, newest first, and how many. */
export async function loadRecentAdmissions(sessionLabel: string, limit = 12): Promise<{ count: number; recent: RecentAdmission[] }> {
  await requireStaffPermission("students:write");
  const admin = createAdminClient();
  const { data, error, count } = await admin
    .from("students")
    .select("id, full_name, admission_no, father_name, joined_on, created_at, class_ref:classes!inner(class_name, section, stream_name, session_label)", { count: "exact" })
    .eq("class_ref.session_label", sessionLabel)
    .gte("created_at", `${sessionStart(sessionLabel)}T00:00:00+05:30`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read recent admissions: ${error.message}`);
  type Row = { id: string; full_name: string; admission_no: string; father_name: string | null; joined_on: string | null; created_at: string; class_ref: ClassRow | ClassRow[] | null };
  return {
    count: count ?? 0,
    recent: ((data ?? []) as unknown as Row[]).map((r) => {
      const c = Array.isArray(r.class_ref) ? r.class_ref[0] : r.class_ref;
      return { id: r.id, name: r.full_name, admissionNo: r.admission_no, classLabel: c ? classLabel(c) : "", fatherName: r.father_name, joinedOn: r.joined_on, createdAt: r.created_at };
    }),
  };
}

export type ExistingChild = {
  id: string;
  fullName: string;
  fatherName: string | null;
  motherName: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  admissionNo: string;
  classLabel: string;
  status: string;
  createdAt: string;
  address: string | null;
  villageCity: string | null;
};

type StudentLookupRow = {
  id: string;
  full_name: string;
  father_name: string | null;
  mother_name: string | null;
  date_of_birth: string | null;
  primary_phone: string | null;
  admission_no: string;
  status: string;
  created_at: string;
  address: string | null;
  village_city: string | null;
  class_ref: ClassRow | ClassRow[] | null;
};

const LOOKUP_COLUMNS =
  "id, full_name, father_name, mother_name, date_of_birth, primary_phone, admission_no, status, created_at, address, village_city, class_ref:classes(class_name, section, stream_name)";

function toChild(r: StudentLookupRow): ExistingChild {
  const c = Array.isArray(r.class_ref) ? r.class_ref[0] : r.class_ref;
  return {
    id: r.id,
    fullName: r.full_name,
    fatherName: r.father_name,
    motherName: r.mother_name,
    dateOfBirth: r.date_of_birth,
    phone: r.primary_phone,
    admissionNo: r.admission_no,
    classLabel: c ? classLabel(c) : "",
    status: r.status,
    createdAt: r.created_at,
    address: r.address,
    villageCity: r.village_city,
  };
}

function likePattern(text: string) {
  return `%${text.replace(/[%_\\,()]/g, " ").trim().replace(/\s+/g, "%")}%`;
}

/** Children on the roll whose name looks like this one. The caller decides "same child". */
export async function findNameMatches(fullName: string): Promise<ExistingChild[]> {
  await requireStaffPermission("students:write");
  const name = fullName.trim();
  if (name.length < 3) return [];
  const { data, error } = await createAdminClient()
    .from("students")
    .select(LOOKUP_COLUMNS)
    .ilike("full_name", likePattern(name))
    .in("status", ["active", "inactive"])
    .limit(20);
  if (error) throw new Error(`Could not check for duplicates: ${error.message}`);
  return ((data ?? []) as unknown as StudentLookupRow[]).map(toChild);
}

/** Families to link a new child to: by father's name, child's name or phone. */
export async function searchFamilyCandidates(query: string): Promise<ExistingChild[]> {
  await requireStaffPermission("students:write");
  const q = query.trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const admin = createAdminClient();
  let request = admin.from("students").select(LOOKUP_COLUMNS).eq("status", "active").limit(40);
  if (digits.length >= 4) {
    request = request.or(`primary_phone.ilike.%${digits}%,secondary_phone.ilike.%${digits}%`);
  } else {
    const pattern = likePattern(q);
    request = request.or(`father_name.ilike.${pattern},full_name.ilike.${pattern},mother_name.ilike.${pattern}`);
  }
  const { data, error } = await request;
  if (error) throw new Error(`Could not search families: ${error.message}`);
  return ((data ?? []) as unknown as StudentLookupRow[]).map(toChild);
}

/** Every child on the roll this session — for Data quality and Families. */
export async function loadRollChildren(sessionLabel: string): Promise<ExistingChild[]> {
  await requireStaffPermission("students:write");
  const admin = createAdminClient();
  const out: ExistingChild[] = [];
  // Paged so the roll never meets the 1000-row response cap.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("students")
      .select(LOOKUP_COLUMNS.replace("class_ref:classes(", "class_ref:classes!inner(session_label, "))
      .eq("status", "active")
      .eq("class_ref.session_label", sessionLabel)
      .order("full_name")
      .range(from, from + 999);
    if (error) throw new Error(`Could not read the roll: ${error.message}`);
    const rows = (data ?? []) as unknown as StudentLookupRow[];
    out.push(...rows.map(toChild));
    if (rows.length < 1000) break;
  }
  return out;
}

/** Every SR number in use, for the "next free number" the review step shows. */
export async function nextFreeSrCandidates(): Promise<string[]> {
  await requireStaffPermission("students:write");
  const { data, error } = await createAdminClient()
    .from("students")
    .select("admission_no")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`Could not read SR numbers: ${error.message}`);
  return ((data ?? []) as Array<{ admission_no: string }>).map((r) => r.admission_no);
}

export type DuesSplit = { pendingToday: number; notDueYet: number; lateFeePending: number };

/** What the child owes, kept in the design's three separate numbers. */
export async function loadDuesSplit(studentId: string): Promise<DuesSplit> {
  await requireStaffPermission("students:write");
  const today = todayIst();
  const rows = await getWorkbookInstallmentRows({ studentId });
  let pendingToday = 0;
  let notDueYet = 0;
  let lateFeePending = 0;
  for (const r of rows) {
    if (r.pendingAmount > 0) {
      if (r.dueDate && r.dueDate <= today) pendingToday += r.pendingAmount;
      else notDueYet += r.pendingAmount;
    }
    lateFeePending += r.lateFeePending;
  }
  return { pendingToday, notDueYet, lateFeePending };
}

/**
 * The dues a child admitted a moment ago owes, for the wizard's done screen.
 *
 * The admission only queues the balance views' refresh, so the done screen
 * read them before they knew the child and said "₹0 pending today · ₹0 not
 * due yet" (school-day run, admin B4). Drain first; and if the views still have
 * no row for the child (another drain held the lock), read the installments
 * themselves, which for a child who has paid nothing are the dues.
 */
export async function loadNewAdmissionDuesSplit(studentId: string): Promise<DuesSplit> {
  await requireStaffPermission("students:write");
  await drainFinancialViewRefresh();
  const split = await loadDuesSplit(studentId);
  if (split.pendingToday + split.notDueYet > 0) return split;
  const { data, error } = await createAdminClient()
    .from("installments")
    .select("amount_due, due_date, status")
    .eq("student_id", studentId)
    .eq("status", "scheduled");
  if (error) return split;
  return newAdmissionSplit((data ?? []) as { amount_due: number | null; due_date: string | null }[], todayIst());
}

export type HistoryLine = { at: string; action: string; changed: string[]; by: string | null };

const FIELD_NAMES: Record<string, string> = {
  full_name: "Name",
  father_name: "Father",
  mother_name: "Mother",
  primary_phone: "Phone",
  secondary_phone: "Second phone",
  date_of_birth: "Date of birth",
  class_id: "Class",
  transport_route_id: "Bus",
  address: "Address",
  status: "Status",
  admission_no: "SR number",
  left_on: "Leave date",
  village_city: "Village",
};

/** The student's change history from the fee app's append-only audit log. */
export async function loadStudentHistory(studentId: string): Promise<HistoryLine[]> {
  await requireStaffPermission("students:write");
  const { data, error } = await createAdminClient()
    .from("audit_logs")
    .select("action, before_data, after_data, changed_by, created_at")
    .eq("table_name", "students")
    .eq("record_id", studentId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return [];
  type Row = { action: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; changed_by: string | null; created_at: string };
  return ((data ?? []) as Row[]).map((r) => {
    const before = r.before_data ?? {};
    const after = r.after_data ?? {};
    const changed = Object.keys(FIELD_NAMES).filter((k) => r.action !== "insert" && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).map((k) => FIELD_NAMES[k]);
    return { at: r.created_at, action: String(r.action), changed, by: r.changed_by };
  });
}

export { getStudentDetail };

/* ----------------------------------------------------------------- writes */

export type AdmitInput = {
  fullName: string;
  classId: string;
  dateOfBirth: string;
  gender: "" | "Male" | "Female" | "Other";
  studentType: "new" | "existing";
  previousSchool: string;
  fatherName: string;
  motherName: string;
  fatherPhone: string;
  motherPhone: string;
  address: string;
  villageCity: string;
  transportRouteId: string;
  conventionalPolicyId: string;
  admissionNo: string;
  siblingStudentIds: string[];
  sessionLabel: string;
};

export type AdmitResult =
  | { ok: true; studentId: string; admissionNo: string; message: string; siblingMessage: string | null; duesWarning: boolean }
  | { ok: false; message: string; fieldErrors: Record<string, string>; studentId: string | null };

const IDLE: StudentFormActionState = { status: "idle", message: null, fieldErrors: {}, studentId: null };

/** Admit a child: the School Fees create action, then sibling links if any. */
export async function admitStudent(input: AdmitInput): Promise<AdmitResult> {
  await requireStaffPermission("students:write");
  const fd = new FormData();
  fd.set("sessionLabel", input.sessionLabel);
  fd.set("fullName", input.fullName);
  fd.set("classId", input.classId);
  fd.set("admissionNo", input.admissionNo);
  fd.set("dateOfBirth", input.dateOfBirth);
  fd.set("fatherName", input.fatherName);
  fd.set("motherName", input.motherName);
  fd.set("fatherPhone", input.fatherPhone);
  fd.set("motherPhone", input.motherPhone);
  fd.set("address", input.address);
  fd.set("transportRouteId", input.transportRouteId);
  fd.set("status", "active");
  fd.set("studentTypeOverride", input.studentType);
  fd.set("tuitionOverride", "");
  fd.set("transportOverride", "");
  fd.set("discountAmount", "0");
  fd.set("otherAdjustmentHead", "");
  fd.set("otherAdjustmentAmount", "");
  fd.set("feeProfileReason", "Student fee profile");
  fd.set("feeProfileNotes", "");
  if (input.conventionalPolicyId) {
    fd.append("conventionalPolicyIds", input.conventionalPolicyId);
    fd.set("conventionalDiscountReason", "Chosen at admission");
  } else {
    fd.set("conventionalDiscountReason", "");
  }
  fd.set("conventionalDiscountNotes", "");
  fd.set("conventionalDiscountFamilyGroup", "");
  fd.set("conventionalDiscountManualOverrideReason", "");
  fd.set("notes", "");
  fd.set("photoPath", "");
  fd.set("gender", input.gender);
  fd.set("previousSchool", input.previousSchool);
  fd.set("villageCity", input.villageCity);

  const state = await createStudentAction(IDLE, fd);
  if (!state.studentId) {
    return { ok: false, message: state.message ?? "Could not save the student.", fieldErrors: (state.fieldErrors ?? {}) as Record<string, string>, studentId: null };
  }

  let siblingMessage: string | null = null;
  if (input.siblingStudentIds.length > 0) {
    const link = new FormData();
    link.set("studentId", state.studentId);
    link.set("sessionLabel", input.sessionLabel);
    for (const id of input.siblingStudentIds) link.append("siblingStudentIds", id);
    const linked = await linkSiblingsAction({ status: "idle", message: null, familyGroupId: null }, link);
    siblingMessage = linked.message;
  }

  const { data } = await createAdminClient().from("students").select("admission_no").eq("id", state.studentId).maybeSingle();
  return {
    ok: true,
    studentId: state.studentId,
    admissionNo: (data as { admission_no: string } | null)?.admission_no ?? input.admissionNo,
    message: state.message ?? "Student record created.",
    siblingMessage,
    duesWarning: state.status === "error" || state.status === "warning",
  };
}

export type EditPatch = Partial<{
  fullName: string;
  dateOfBirth: string;
  fatherName: string;
  motherName: string;
  fatherPhone: string;
  motherPhone: string;
  address: string;
  villageCity: string;
  classId: string;
  transportRouteId: string;
  gender: string;
  previousSchool: string;
}>;

/**
 * Edit through the School Fees update action. The full form is rebuilt from
 * the saved record and only the patched fields change; fee override fields
 * are left out so the action keeps what is on file (its ABSENT ≠ EMPTY rule).
 */
export async function editStudent(studentId: string, patch: EditPatch): Promise<{ ok: boolean; message: string; fieldErrors: Record<string, string> }> {
  await requireStaffPermission("students:write");
  const s = await getStudentDetail(studentId);
  if (!s) return { ok: false, message: "Student record was not found.", fieldErrors: {} };
  const fd = new FormData();
  const info = toStudentInfoFormValues(s);
  for (const [k, v] of Object.entries(info)) fd.set(k, v ?? "");
  fd.set("sessionLabel", s.classSessionLabel);
  fd.set("fullName", patch.fullName ?? s.fullName);
  fd.set("classId", patch.classId ?? s.classId);
  fd.set("admissionNo", s.admissionNo);
  fd.set("dateOfBirth", patch.dateOfBirth ?? s.dateOfBirth ?? "");
  fd.set("fatherName", patch.fatherName ?? s.fatherName ?? "");
  fd.set("motherName", patch.motherName ?? s.motherName ?? "");
  fd.set("fatherPhone", patch.fatherPhone ?? s.fatherPhone ?? "");
  fd.set("motherPhone", patch.motherPhone ?? s.motherPhone ?? "");
  fd.set("address", patch.address ?? s.address ?? "");
  fd.set("transportRouteId", patch.transportRouteId ?? s.transportRouteId ?? "");
  fd.set("status", s.status);
  fd.set("studentTypeOverride", s.studentTypeOverride ?? "existing");
  for (const id of s.conventionalDiscountPolicyIds) fd.append("conventionalPolicyIds", id);
  fd.set("conventionalDiscountReason", s.conventionalDiscountReason ?? "");
  fd.set("conventionalDiscountNotes", s.conventionalDiscountNotes ?? "");
  fd.set("conventionalDiscountFamilyGroup", s.conventionalDiscountFamilyGroupLabel ?? "");
  fd.set("conventionalDiscountManualOverrideReason", s.conventionalDiscountManualOverrideReason ?? "");
  fd.set("notes", s.notes ?? "");
  fd.set("photoPath", s.photoPath ?? "");
  if (patch.villageCity !== undefined) fd.set("villageCity", patch.villageCity);
  if (patch.gender !== undefined) fd.set("gender", patch.gender);
  if (patch.previousSchool !== undefined) fd.set("previousSchool", patch.previousSchool);

  const state = await updateStudentAction(studentId, IDLE, fd);
  const ok = state.status === "success" || state.status === "warning";
  return { ok, message: state.message ?? (ok ? "Saved." : "Could not save."), fieldErrors: (state.fieldErrors ?? {}) as Record<string, string> };
}

/** Withdraw through the School Fees archive action: leave date, reason and TC number. */
export async function withdrawStudent(input: { studentId: string; leftOn: string; reason: string; tcNumber: string }) {
  await requireStaffPermission("students:write");
  const fd = new FormData();
  fd.set("studentId", input.studentId);
  fd.set("leftOn", input.leftOn);
  fd.set("leaveStatus", "left");
  fd.set("leaveReason", input.reason);
  fd.set("tcNumber", input.tcNumber);
  const state = await archiveStudentAction({ status: "idle", message: null, deleted: false }, fd);
  return { ok: state.status === "success", message: state.message ?? "" };
}

/** Undo a withdrawal: the School Fees reinstate action. */
export async function undoWithdraw(studentId: string) {
  await requireStaffPermission("students:write");
  const fd = new FormData();
  fd.set("studentId", studentId);
  fd.set("reinstateStatus", "active");
  fd.set("reinstateReason", "Withdrawal undone from Admissions");
  const state = await reinstateStudentAction({ status: "idle", message: null, deleted: false }, fd);
  return { ok: state.status === "success", message: state.message ?? "" };
}

/** How many TCs this session already carries, for the next TC number. */
export async function countTcsIssued(sessionLabel: string): Promise<number> {
  await requireStaffPermission("students:write");
  const { count } = await createAdminClient()
    .from("students")
    .select("id", { count: "exact", head: true })
    .like("tc_number", `TC/${sessionLabel}/%`);
  return count ?? 0;
}
