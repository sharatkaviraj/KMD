"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { schoolToday } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { assertNotPreviewing } from "@/vx/view-as";

import { familyContactAccess } from "./data";
import { parseContact } from "./domain";

export type ContactResult = { ok: true } | { ok: false; error: Pair };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Record how a contact with a child's family went (D-265). Appended, never
 * edited. Nothing is sent to the family: this is the record of a call or a
 * meeting that already happened.
 */
export async function logFamilyContactAction(input: { studentId: string; outcome: string; note?: string | null; agreedOn?: string | null; noteId?: string | null }): Promise<ContactResult> {
  const actor = await assertPermission("students:view");
  await assertNotPreviewing();
  if (!UUID.test(input.studentId)) return { ok: false, error: p("Choose a child.", "बच्चा चुनें।") };
  const parsed = parseContact(input, schoolToday());
  if (!parsed.ok) return parsed;
  const session = await resolveSessionLabel();
  if (!session) return { ok: false, error: p("No session is open.", "कोई सत्र खुला नहीं है।") };

  const admin = createAdminClient();
  const { data: enrolment } = await admin
    .from("enrolments")
    .select("class_id")
    .eq("session_label", session)
    .eq("student_id", input.studentId)
    .maybeSingle<{ class_id: string }>();
  if (!(await familyContactAccess(actor, session, enrolment?.class_id ?? null))) {
    return { ok: false, error: p("Only the class teacher and the office record family contact.", "परिवार से संपर्क कक्षा अध्यापक और कार्यालय दर्ज करते हैं।") };
  }

  const { error } = await admin.from("student_followups").insert({
    session_label: session,
    student_id: input.studentId,
    kind: "contact",
    outcome: parsed.value.outcome,
    note: parsed.value.note,
    agreed_on: parsed.value.agreedOn,
    note_id: input.noteId && UUID.test(input.noteId) ? input.noteId : null,
    created_by: actor.id,
  });
  if (error) return { ok: false, error: p("Not saved. Try again.", "सहेजा नहीं गया। फिर से कोशिश करें।") };
  revalidatePath(`/students/${input.studentId}`);
  revalidatePath("/academics/progress");
  return { ok: true };
}
