import "server-only";

/*
 * Reads for the redesigned Reports screen. The page has already checked
 * `fees:view`; nothing here writes.
 */

import { createClient as createFeeClient } from "@/modules/fees/platform/supabase/server";
import { getReceiptReversalTotals, isReceiptReversed } from "@/modules/receipts/data/reversals";
import { fetchAllPages, fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createVppsoneReader as createAppClient } from "@/modules/finance-controls/vx/app-db";

import type { CollectionReceipt, InstallmentBalance } from "@/modules/reports/vx/domain/reports";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (v == null ? null : String(v));

export type ClassInfo = { id: string; label: string; sortOrder: number; teacher: string | null; teacherPhone: string | null };

export type ReportSchedule = {
  id: string;
  reportKey: "collection" | "defaulters" | "classwise" | "daybook";
  title: string;
  recipients: string[];
  frequency: "daily" | "weekly" | "monthly";
  weekday: number | null;
  sendTime: string;
  format: "pdf" | "excel";
  active: boolean;
  lastSentAt: string | null;
};

/** Every installment balance of the session, with each student's enrolment status. */
export async function getInstallmentBalances(sessionLabel: string): Promise<InstallmentBalance[]> {
  const fee = await createFeeClient();
  const [balances, gone] = await Promise.all([
    fetchAllPages<Row>((a, b) =>
      fee
        .from("v_workbook_installment_balances")
        .select("student_id, student_name, admission_no, father_name, father_phone, class_id, class_label, installment_no, due_date, pending_amount, late_fee_pending, is_carry_forward")
        .eq("session_label", sessionLabel)
        .order("installment_id")
        .range(a, b),
    ),
    fetchAllPages<Row>((a, b) => fee.from("students").select("id, status").neq("status", "active").order("id").range(a, b)),
  ]);
  const statusBy = new Map(gone.data.map((r) => [String(r.id), String(r.status)]));
  return balances.data.map((r) => ({
    studentId: String(r.student_id),
    studentName: String(r.student_name ?? ""),
    admissionNo: str(r.admission_no),
    fatherName: str(r.father_name),
    fatherPhone: str(r.father_phone),
    classId: str(r.class_id),
    classLabel: String(r.class_label ?? ""),
    installmentNo: num(r.installment_no),
    dueDate: String(r.due_date),
    pendingAmount: num(r.pending_amount),
    lateFeePending: num(r.late_fee_pending),
    studentStatus: statusBy.get(String(r.student_id)) ?? "active",
    isCarryForward: r.is_carry_forward === true,
  }));
}

/** Classes of the session in the school's order, with the class teacher. */
export async function getClasses(sessionLabel: string): Promise<ClassInfo[]> {
  const fee = await createFeeClient();
  const { data: classRows } = await fee.from("classes").select("id, class_name, section, stream_name, sort_order").eq("session_label", sessionLabel).order("sort_order");
  return withClassTeachers(((classRows ?? []) as Row[]).map((c) => ({
    id: String(c.id), className: String(c.class_name ?? ""), section: str(c.section), streamName: str(c.stream_name), sortOrder: num(c.sort_order),
  })), sessionLabel);
}

/**
 * Names each class and adds its class teacher from One's own records. The
 * classes may be Fees' own (read through the bridge); a class One does not
 * know by that id simply has no teacher listed.
 */
export async function withClassTeachers(
  classes: { id: string; className: string; section: string | null; streamName: string | null; sortOrder: number }[],
  sessionLabel: string,
): Promise<ClassInfo[]> {
  const app = await createAppClient();
  const { data: teacherRows } = await app.from("class_teachers").select("class_id, staff_profile_id, role").eq("session_label", sessionLabel).is("effective_to", null);
  const teachers = ((teacherRows ?? []) as Row[]).filter((t) => t.role === "class_teacher" || !t.role);
  const staffIds = [...new Set(teachers.map((t) => String(t.staff_profile_id)))];
  const { data: staffRows } = await fetchInChunks<Row>(staffIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    app.from("staff_profiles").select("id, display_name, whatsapp_phone, phone").in("id", chunk),
  );
  const staffBy = new Map(staffRows.map((s) => [String(s.id), s]));
  const teacherBy = new Map(teachers.map((t) => [String(t.class_id), staffBy.get(String(t.staff_profile_id))]));
  return [...classes].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => {
    const t = teacherBy.get(c.id);
    return {
      id: c.id,
      label: [c.className, c.streamName, c.section].filter(Boolean).join(" "),
      sortOrder: c.sortOrder,
      teacher: t ? String(t.display_name ?? "") : null,
      teacherPhone: t ? str(t.whatsapp_phone ?? t.phone) : null,
    };
  });
}

/** Receipts between two dates (discounts excluded), each marked reversed or not. */
export async function getCollectionReceipts(from: string, to: string): Promise<CollectionReceipt[]> {
  const fee = await createFeeClient();
  const { data } = await fetchAllPages<Row>((a, b) =>
    fee
      .from("receipts")
      .select("id, payment_date, payment_mode, total_amount, student_ref:students(class_id)")
      .neq("payment_mode", "discount")
      .gte("payment_date", from)
      .lte("payment_date", to)
      .order("payment_date")
      .order("id")
      .range(a, b),
  );
  const reversals = await getReceiptReversalTotals(data.map((r) => String(r.id)), fee);
  return data.map((r) => ({
    paymentDate: String(r.payment_date),
    paymentMode: String(r.payment_mode),
    amount: num(r.total_amount),
    classId: str(((r.student_ref ?? {}) as Row).class_id),
    reversed: isReceiptReversed(reversals, String(r.id), num(r.total_amount)),
  }));
}

export async function getReportSchedules(): Promise<ReportSchedule[]> {
  const app = await createAppClient();
  const { data } = await app
    .from("acc_report_schedules")
    .select("id, report_key, title, recipients, frequency, weekday, send_time, format, active, last_sent_at")
    .order("created_at");
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    reportKey: r.report_key as ReportSchedule["reportKey"],
    title: String(r.title),
    recipients: (r.recipients as string[] | null) ?? [],
    frequency: r.frequency as ReportSchedule["frequency"],
    weekday: r.weekday == null ? null : num(r.weekday),
    sendTime: String(r.send_time).slice(0, 5),
    format: (r.format as ReportSchedule["format"]) ?? "pdf",
    active: Boolean(r.active),
    lastSentAt: str(r.last_sent_at),
  }));
}
