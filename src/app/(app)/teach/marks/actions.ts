"use server";

import { revalidatePath } from "next/cache";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { p } from "@/vx/text";
import { assertNotPreviewing } from "@/vx/view-as";
import { logActivity, paperById } from "@/vx/screens/exams/data";
import { classTeacherOf, isManager, mayEnterPaper, newToken, NOT_YOURS, previewRefusal } from "@/vx/screens/exams/guards";
import { commitMarks, withdrawMarks } from "@/vx/screens/exams/marks-save";
import type { ActionResult, SaveOutcome, SavePayload } from "@/vx/screens/exams/save-types";

/*
 * A teacher's marks and remarks. Every action checks the permission, then
 * that an administrator is not previewing, then that the paper or the child
 * is hers — and `save_marks` checks the paper again inside its transaction.
 */

export async function saveTeacherMarksAction(payload: SavePayload): Promise<SaveOutcome> {
  const staff = await assertPermission("marks:write");
  const preview = await previewRefusal();
  if (preview) return { ok: false, reason: "preview", message: preview };

  const sessionLabel = await resolveSessionLabel();
  const paper = await paperById(payload.paperId);
  if (!paper || !sessionLabel || !(await mayEnterPaper(staff, paper, sessionLabel))) {
    return { ok: false, reason: "not_permitted", message: NOT_YOURS };
  }
  const result = await commitMarks(staff.id, payload);
  if (result.ok) {
    if (payload.kind === "submit" && !result.replayed) {
      await logActivity({
        assessmentId: paper.assessment_id,
        kind: "submitted",
        en: `${staff.displayName} sent ${paper.class_label} ${paper.subject_code}`,
        hi: `${staff.displayName} ने ${paper.class_label} ${paper.subject_code} के अंक भेजे`,
        actorId: staff.id,
      }).catch(() => undefined);
    }
    revalidatePath("/teach/marks");
  }
  return result;
}

export async function withdrawTeacherMarksAction(paperId: string, expectedRevision: number): Promise<SaveOutcome> {
  const staff = await assertPermission("marks:write");
  const preview = await previewRefusal();
  if (preview) return { ok: false, reason: "preview", message: preview };
  const result = await withdrawMarks(staff.id, paperId, expectedRevision);
  if (result.ok) revalidatePath("/teach/marks");
  return result;
}

/** The class teacher's one line on a child's card. */
export async function saveRemarkAction(input: { studentId: string; term: string; remark: string }): Promise<ActionResult> {
  const staff = await assertPermission("marks:write");
  await assertNotPreviewing();

  const remark = input.remark.trim();
  if (remark.length < 2 || remark.length > 400) {
    return { ok: false, message: p("Write a remark of up to 400 letters.", "400 अक्षर तक की टिप्पणी लिखें।") };
  }
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel || !/^[0-9a-f-]{36}$/i.test(input.studentId) || !input.term) {
    return { ok: false, message: p("Something was missing. Reload the page.", "कुछ अधूरा था। पेज फिर खोलें।") };
  }

  const db = createAdminClient();
  const { data: enrolment } = await db
    .from("enrolments")
    .select("class_id")
    .eq("session_label", sessionLabel)
    .eq("student_id", input.studentId)
    .maybeSingle<{ class_id: string }>();
  const mine = await classTeacherOf(staff.id, sessionLabel);
  if (!enrolment || (!mine.includes(enrolment.class_id) && !isManager(staff))) {
    return { ok: false, message: p("Only this child's class teacher writes the remark.", "टिप्पणी केवल कक्षा अध्यापक लिखते हैं।") };
  }

  const { error } = await db.from("report_card_remarks").upsert(
    { session_label: sessionLabel, term: input.term, student_id: input.studentId, remark, written_by: staff.id, updated_at: new Date().toISOString() },
    { onConflict: "session_label,term,student_id" },
  );
  if (error) return { ok: false, message: p("Not saved. Try again.", "सहेजा नहीं गया। फिर से कोशिश करें।") };
  revalidatePath("/teach/marks");
  return { ok: true };
}

/** A teacher's own marks link for an exam, made if she has none. */
export async function makeMyMarksLinkAction(assessmentId: string): Promise<ActionResult> {
  const staff = await assertPermission("marks:write");
  await assertNotPreviewing();
  if (!/^[0-9a-f-]{36}$/i.test(assessmentId)) return { ok: false, message: p("Reload the page.", "पेज फिर खोलें।") };

  const db = createAdminClient();
  const { data: existing } = await db
    .from("exam_marks_links")
    .select("token")
    .eq("assessment_id", assessmentId)
    .eq("staff_profile_id", staff.id)
    .is("revoked_at", null)
    .maybeSingle<{ token: string }>();
  if (existing) return { ok: true, data: { token: existing.token } };

  const token = newToken();
  const { error } = await db.from("exam_marks_links").insert({ assessment_id: assessmentId, staff_profile_id: staff.id, token, created_by: staff.id });
  if (error) return { ok: false, message: p("Could not make the link. Try again.", "लिंक नहीं बना। फिर से कोशिश करें।") };
  revalidatePath("/teach/marks");
  return { ok: true, data: { token } };
}
