import "server-only";

import { VISIT_NAME_NOT_GIVEN } from "@/modules/whatsapp/domain/helper-visit";
import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";

import type { Stage, VisitPart } from "@/vx/screens/admissions/logic";

/*
 * VPPS One's own admissions records (`vppsone` schema): the enquiry board,
 * seats per class, and the Hindi name and documents beside a fee student.
 * Fee data is read and written in src/modules/students-fees/vx/admissions.ts.
 *
 * Service role after a permission check, the pattern this app uses for its
 * own tables; every function checks `fees:manage` itself so no caller can
 * forget it.
 */

export type Enquiry = {
  id: string;
  stage: Stage | "closed";
  childName: string;
  classLabel: string | null;
  parentName: string | null;
  phone: string | null;
  studentId: string | null;
  createdAt: string;
  stageChangedAt: string;
  /** The day the family asked to come and see the school, with its part (D-592); null when none. */
  visitOn: string | null;
  visitPart: VisitPart | null;
  /** office: typed in here. whatsapp: booked by the family with Veer Patta AI. */
  source: "office" | "whatsapp";
};

type EnquiryRow = {
  id: string;
  stage: string;
  child_name: string;
  class_label: string | null;
  parent_name: string | null;
  phone: string | null;
  student_id: string | null;
  created_at: string;
  stage_changed_at: string;
  visit_on: string | null;
  visit_part: string | null;
  source: string | null;
};

const ENQUIRY_COLUMNS = "id, stage, child_name, class_label, parent_name, phone, student_id, created_at, stage_changed_at, visit_on, visit_part, source";

const toEnquiry = (r: EnquiryRow): Enquiry => ({
  id: r.id,
  stage: r.stage as Enquiry["stage"],
  // A family that booked on WhatsApp without giving the name: the row keeps a
  // dash (the name is required), the screens show "Name not given".
  childName: r.child_name === VISIT_NAME_NOT_GIVEN ? "" : r.child_name,
  classLabel: r.class_label,
  parentName: r.parent_name,
  phone: r.phone,
  studentId: r.student_id,
  createdAt: r.created_at,
  stageChangedAt: r.stage_changed_at,
  visitOn: r.visit_on && r.visit_part ? String(r.visit_on).slice(0, 10) : null,
  visitPart: r.visit_on && (r.visit_part === "morning" || r.visit_part === "afternoon") ? r.visit_part : null,
  source: r.source === "whatsapp" ? "whatsapp" : "office",
});

export async function listEnquiries(sessionLabel: string): Promise<Enquiry[]> {
  await assertPermission("fees:manage");
  const { data, error } = await createAdminClient()
    .from("enquiries")
    .select(ENQUIRY_COLUMNS)
    .eq("session_label", sessionLabel)
    .neq("stage", "closed")
    .order("stage_changed_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(`Could not read enquiries: ${error.message}`);
  return ((data ?? []) as EnquiryRow[]).map(toEnquiry);
}

export async function getEnquiry(id: string): Promise<Enquiry | null> {
  await assertPermission("fees:manage");
  const { data, error } = await createAdminClient()
    .from("enquiries")
    .select(ENQUIRY_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the enquiry: ${error.message}`);
  return data ? toEnquiry(data as EnquiryRow) : null;
}

/** The session an enquiry belongs to, for the test-session fence. Null: no such enquiry. */
export async function enquirySessionLabel(id: string): Promise<string | null> {
  await assertPermission("fees:manage");
  const { data, error } = await createAdminClient().from("enquiries").select("session_label").eq("id", id).maybeSingle<{ session_label: string | null }>();
  if (error) throw new Error(`Could not read the enquiry: ${error.message}`);
  return data?.session_label ?? null;
}

export async function insertEnquiry(input: { sessionLabel: string; childName: string; classLabel: string; parentName: string; phone: string; staffId: string }) {
  await assertPermission("fees:manage");
  const { data, error } = await createAdminClient()
    .from("enquiries")
    .insert({
      session_label: input.sessionLabel,
      child_name: input.childName,
      class_label: input.classLabel || null,
      parent_name: input.parentName || null,
      phone: input.phone || null,
      created_by: input.staffId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not save the enquiry: ${error.message}`);
  return (data as { id: string }).id;
}

export async function setEnquiryStage(id: string, stage: Stage | "closed", studentId?: string | null) {
  await assertPermission("fees:manage");
  const patch: Record<string, unknown> = { stage, stage_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (studentId !== undefined) patch.student_id = studentId;
  const { error } = await createAdminClient().from("enquiries").update(patch).eq("id", id);
  if (error) throw new Error(`Could not move the enquiry: ${error.message}`);
}

export async function loadSeats(sessionLabel: string): Promise<Map<string, number>> {
  await assertPermission("fees:manage");
  const { data, error } = await createAdminClient().from("class_seats").select("class_id, seats").eq("session_label", sessionLabel);
  if (error) throw new Error(`Could not read seats: ${error.message}`);
  return new Map(((data ?? []) as Array<{ class_id: string; seats: number }>).map((r) => [r.class_id, r.seats]));
}

/** Set or clear the seats of some classes. A null clears the row: no limit shown. Admin only. */
export async function saveSeats(sessionLabel: string, rows: { classId: string; seats: number | null }[], actorId: string) {
  await assertPermission("settings:manage");
  const admin = createAdminClient();
  const set = rows.filter((r) => r.seats !== null);
  const clear = rows.filter((r) => r.seats === null).map((r) => r.classId);
  if (set.length) {
    const { error } = await admin
      .from("class_seats")
      .upsert(set.map((r) => ({ session_label: sessionLabel, class_id: r.classId, seats: r.seats, updated_by: actorId, updated_at: new Date().toISOString() })), { onConflict: "session_label,class_id" });
    if (error) throw new Error(`Could not save seats: ${error.message}`);
  }
  if (clear.length) {
    const { error } = await admin.from("class_seats").delete().eq("session_label", sessionLabel).in("class_id", clear);
    if (error) throw new Error(`Could not clear seats: ${error.message}`);
  }
}

export type DocKey = "birth" | "tc" | "photo" | "aadhaar" | "address";
export type AdmissionDetail = { studentId: string; nameHi: string | null; docs: Partial<Record<DocKey, boolean>>; admittedAt: string };

export async function loadAdmissionDetails(studentIds: readonly string[]): Promise<Map<string, AdmissionDetail>> {
  await assertPermission("fees:manage");
  const out = new Map<string, AdmissionDetail>();
  if (studentIds.length === 0) return out;
  // Recent admissions only — a short list, well under the .in() limit.
  const { data, error } = await createAdminClient()
    .from("admission_details")
    .select("student_id, name_hi, docs, admitted_at")
    .in("student_id", studentIds.slice(0, 150));
  if (error) throw new Error(`Could not read admission details: ${error.message}`);
  for (const r of (data ?? []) as Array<{ student_id: string; name_hi: string | null; docs: Record<string, boolean> | null; admitted_at: string }>) {
    out.set(r.student_id, { studentId: r.student_id, nameHi: r.name_hi, docs: r.docs ?? {}, admittedAt: r.admitted_at });
  }
  return out;
}

export async function saveAdmissionDetail(input: { studentId: string; sessionLabel: string; nameHi: string | null; docs: Partial<Record<DocKey, boolean>>; enquiryId: string | null; staffId: string }) {
  await assertPermission("fees:manage");
  const { error } = await createAdminClient()
    .from("admission_details")
    .upsert(
      {
        student_id: input.studentId,
        session_label: input.sessionLabel,
        name_hi: input.nameHi,
        docs: input.docs,
        enquiry_id: input.enquiryId,
        admitted_by: input.staffId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id" },
    );
  if (error) throw new Error(`Could not save admission details: ${error.message}`);
}

export async function updateAdmissionDetail(studentId: string, sessionLabel: string, patch: { nameHi?: string | null; docs?: Partial<Record<DocKey, boolean>> }) {
  await assertPermission("fees:manage");
  const admin = createAdminClient();
  const { data } = await admin.from("admission_details").select("student_id").eq("student_id", studentId).maybeSingle();
  if (data) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.nameHi !== undefined) row.name_hi = patch.nameHi;
    if (patch.docs !== undefined) row.docs = patch.docs;
    const { error } = await admin.from("admission_details").update(row).eq("student_id", studentId);
    if (error) throw new Error(`Could not save admission details: ${error.message}`);
  } else {
    const { error } = await admin.from("admission_details").insert({ student_id: studentId, session_label: sessionLabel, name_hi: patch.nameHi ?? null, docs: patch.docs ?? {} });
    if (error) throw new Error(`Could not save admission details: ${error.message}`);
  }
}

/** Record this child in the academic roll for the session (vppsone.enrolments). */
export async function enrolStudent(input: { studentId: string; classId: string; sessionLabel: string; userId: string }) {
  await assertPermission("fees:manage");
  const { error } = await createAdminClient()
    .from("enrolments")
    .upsert(
      { student_id: input.studentId, class_id: input.classId, session_label: input.sessionLabel, status: "enrolled", created_by: input.userId },
      { onConflict: "student_id,session_label", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Could not enrol the student: ${error.message}`);
}
