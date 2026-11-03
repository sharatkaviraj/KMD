import "server-only";

import { assertPermission, getCurrentStaff } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import { feesBridgeEnabled, usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { getBridgeStudent } from "@/platform/fees-bridge/client";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";

/**
 * One student, assembled from both sides.
 *
 * The fee app owns who the child is and what they owe; VPPS One owns which
 * class they were in and everything written about them since. **Rule 2 all the
 * way down: every read of `public` here is a SELECT and nothing else.**
 */

export type StudentCard = {
  studentId: string;
  fullName: string;
  admissionNo: string | null;
  fatherName: string | null;
  motherName: string | null;
  guardianPhone: string | null;
  primaryPhone: string | null;
  classId: string | null;
  rollNo: string | null;
  status: string | null;
};

export async function getStudentCard(
  studentId: string,
): Promise<StudentCard | null> {
  await assertPermission("attendance:view");

  // Service-role: the fee app's RLS gates `public.students` on its own
  // `public.users.role`, which VPPS One staff do not have — a cookie-client
  // read returns zero rows and no error (D-32).
  const { data, error } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("students")
    .select(
      "id, full_name, admission_no, father_name, mother_name, guardian_phone, primary_phone, class_id, roll_no, status",
    )
    .eq("id", studentId)
    .maybeSingle<{
      id: string;
      full_name: string;
      admission_no: string | null;
      father_name: string | null;
      mother_name: string | null;
      guardian_phone: string | null;
      primary_phone: string | null;
      class_id: string | null;
      roll_no: string | null;
      status: string | null;
    }>();

  if (error) throw new Error(`Could not read that student: ${error.message}`);
  if (!data) return null;

  return {
    studentId: data.id,
    fullName: data.full_name,
    admissionNo: data.admission_no,
    fatherName: data.father_name,
    motherName: data.mother_name,
    guardianPhone: data.guardian_phone,
    primaryPhone: data.primary_phone,
    classId: data.class_id,
    rollNo: data.roll_no,
    status: data.status,
  };
}

export type FeeStanding = {
  /** Whole rupees. Fees only — never with the late fee added in. */
  feeDue: number;
  /** Whole rupees. Reported beside the fee, never summed with it. */
  lateFeeDue: number;
  paid: number;
  lastPaymentDate: string | null;
  available: boolean;
};

/**
 * What the child owes, read from the fee app's **own view**.
 *
 * VPPS One does not model fees, does not compute them, and must not appear to.
 * The fee app's money rules are deep — carry-forward balances, EMI repayment
 * plans, waived and pending late fees, adjustments — and reimplementing any of
 * it here would create a second answer to a question that must have one.
 * `public.v_student_directory` is where the fee app itself keeps the answer,
 * so this reads that and nothing else.
 *
 * **Fees and late fees are returned separately and are never added together.**
 * That is the fee system's own first rule: a family whose only debt is a late
 * fee is not a defaulter, and a single combined number would tell a teacher
 * otherwise in a conversation with a parent.
 *
 * When the view cannot be read, this reports `available: false` and the card
 * says the figure is unavailable — honest, where a zero would be a lie
 * somebody might repeat.
 *
 * **Only for `fees:view`, checked here as well as by the caller.** The read is
 * service-role, so nothing below this line would stop it; a caller that gates
 * on the wrong permission must fail before any figure is fetched.
 */
export async function feeStanding(studentId: string): Promise<FeeStanding> {
  await assertPermission("fees:view");

  const unavailable: FeeStanding = {
    feeDue: 0,
    lateFeeDue: 0,
    paid: 0,
    lastPaymentDate: null,
    available: false,
  };

  const staff=feesBridgeEnabled() ? await getCurrentStaff() : null;
  const session=staff ? await getViewSessionCookie() : null;
  if(staff && usesCanonicalFees(staff,session)) {
    try {
      const {data,error}=await createAdminClient().from("fees_bridge_students").select("session_label").eq("id",studentId).maybeSingle<{session_label:string}>();
      if(error || !data)return unavailable;
      const {standing}=await getBridgeStudent(studentId,data.session_label);
      return {feeDue:standing.feesPending,lateFeeDue:standing.lateFeePending,paid:standing.totalPaid,lastPaymentDate:standing.lastPaymentDate,available:true};
    }catch{return unavailable;}
  }

  const { data, error } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("v_student_directory")
    .select(
      "base_outstanding_amount, late_fee_outstanding_amount, total_paid, last_payment_date",
    )
    .eq("student_id", studentId)
    .maybeSingle<{
      base_outstanding_amount: number | null;
      late_fee_outstanding_amount: number | null;
      total_paid: number | null;
      last_payment_date: string | null;
    }>();

  if (error || !data) return unavailable;

  return {
    feeDue: data.base_outstanding_amount ?? 0,
    lateFeeDue: data.late_fee_outstanding_amount ?? 0,
    paid: data.total_paid ?? 0,
    lastPaymentDate: data.last_payment_date,
    available: true,
  };
}

/** Which class this child is enrolled in, per VPPS One's own record. */
export async function enrolmentForStudent(
  studentId: string,
  sessionLabel: string,
): Promise<{ classId: string; rollNo: string | null } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrolments")
    .select("class_id, roll_no")
    .eq("student_id", studentId)
    .eq("session_label", sessionLabel)
    .maybeSingle<{ class_id: string; roll_no: string | null }>();

  if (error) throw new Error(`Could not read the enrolment: ${error.message}`);
  return data ? { classId: data.class_id, rollNo: data.roll_no } : null;
}
