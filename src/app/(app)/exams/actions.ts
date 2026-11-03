"use server";

import { revalidatePath } from "next/cache";

import { listSubjects, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { upsertAssessment } from "@/modules/assessments/data/assessments-repo";
import { assessmentSchema } from "@/modules/assessments/domain/assessments";
import { assertPermission } from "@/platform/auth/current-staff";
import { chunkArray } from "@/platform/helpers/chunk";
import { createAdminClient } from "@/platform/supabase/admin";
import { p } from "@/vx/text";
import { assignmentsFor, classesFor, logActivity, paperById } from "@/vx/screens/exams/data";
import { codeFor, exemptSwitch, papersToCreate } from "@/vx/screens/exams/domain/board";
import type { GroupKey } from "@/vx/screens/exams/domain/groups";
import { previewRefusal } from "@/vx/screens/exams/guards";
import type { ActionResult } from "@/vx/screens/exams/save-types";

/*
 * Making an exam from the marks tracker. Permission first, then the preview
 * check; the exam row goes through the same `upsertAssessment` the
 * assessments screen uses, and its papers come from who teaches what.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type CreateExamInput = {
  nameEn: string;
  nameHi: string;
  term: string;
  kind: "formative" | "summative";
  startsOn: string;
  endsOn: string;
  marksDueOn: string;
  resultsOn: string;
  maxByGroup: Partial<Record<GroupKey, number>>;
  withPapers: boolean;
};

export async function createExamAction(input: CreateExamInput): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { ok: false, message: p("No session is set up yet.", "अभी कोई सत्र नहीं है।") };

  const dates = [input.startsOn, input.endsOn, input.marksDueOn, input.resultsOn];
  if (dates.some((d) => d && !DAY.test(d))) return { ok: false, message: p("Check the dates.", "तारीखें जाँचें।") };
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) {
    return { ok: false, message: p("The exam ends before it starts.", "परीक्षा शुरू होने से पहले खत्म हो रही है।") };
  }
  if (input.marksDueOn && input.endsOn && input.marksDueOn < input.endsOn) {
    return { ok: false, message: p("Marks are due after the last paper.", "अंक आखिरी पेपर के बाद देय होते हैं।") };
  }

  const parsed = assessmentSchema.safeParse({
    term: input.term,
    code: codeFor(input.nameEn),
    labelEn: input.nameEn,
    labelHi: input.nameHi.trim() || input.nameEn,
    kind: input.kind,
    startsOn: input.startsOn ?? "",
    endsOn: input.endsOn ?? "",
    weight: "1",
  });
  if (!parsed.success) return { ok: false, message: p("Give the exam a name and a term.", "परीक्षा का नाम और टर्म भरें।") };

  const db = createAdminClient();
  const { data: same } = await db
    .from("assessments")
    .select("id")
    .eq("session_label", sessionLabel)
    .eq("term", parsed.data.term)
    .eq("code", parsed.data.code)
    .maybeSingle<{ id: string }>();
  if (same) return { ok: false, message: p(`There is already an exam ${parsed.data.code} in ${parsed.data.term}.`, `${parsed.data.term} में ${parsed.data.code} परीक्षा पहले से है।`) };

  try {
    await upsertAssessment(parsed.data, sessionLabel, staff.userId);
  } catch {
    return { ok: false, message: p("Not saved. Try again.", "सहेजा नहीं गया। फिर से कोशिश करें।") };
  }
  const { data: made } = await db
    .from("assessments")
    .select("id")
    .eq("session_label", sessionLabel)
    .eq("term", parsed.data.term)
    .eq("code", parsed.data.code)
    .maybeSingle<{ id: string }>();
  if (!made) return { ok: false, message: p("Not saved. Try again.", "सहेजा नहीं गया। फिर से कोशिश करें।") };

  await db.from("exam_plans").upsert(
    {
      assessment_id: made.id,
      marks_due_on: input.marksDueOn || null,
      results_on: input.resultsOn || null,
      updated_by: staff.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "assessment_id" },
  );

  let papers = 0;
  if (input.withPapers) {
    const [assignments, classes, subjects] = await Promise.all([assignmentsFor(sessionLabel), classesFor(sessionLabel), listSubjects()]);
    const planned = papersToCreate({
      assignments,
      classes,
      subjects,
      maxFor: (g) => {
        const v = Number(input.maxByGroup[g]);
        return Number.isFinite(v) && v > 0 && v <= 1000 ? v : g === "pre" ? 25 : 100;
      },
    });
    for (const chunk of chunkArray(planned, 200)) {
      const { error } = await db.from("assessment_subjects").upsert(
        chunk.map((x) => ({
          assessment_id: made.id,
          class_id: x.classId,
          class_label: x.classLabel,
          subject_id: x.subjectId,
          subject_code: x.subjectCode,
          max_marks: x.maxMarks,
          pass_marks: x.passMarks,
          sort_order: x.sortOrder,
          mark_step: 0.5,
          allow_exempt: true,
        })),
        { onConflict: "assessment_id,class_id,subject_id", ignoreDuplicates: true },
      );
      if (error) return { ok: false, message: p("The exam is made, but its papers were not. Add them from Assessments.", "परीक्षा बनी, पर पेपर नहीं बने। Assessments से जोड़ें।") };
      papers += chunk.length;
    }
  }

  await logActivity({
    assessmentId: made.id,
    kind: "created",
    en: `${staff.displayName} created ${parsed.data.labelEn}${papers ? ` with ${papers} papers` : ""}`,
    hi: `${staff.displayName} ने ${parsed.data.labelHi} बनाई`,
    actorId: staff.id,
  }).catch(() => undefined);

  revalidatePath("/exams");
  revalidatePath("/exam-office");
  return { ok: true, message: p(`Exam created${papers ? ` · ${papers} papers` : ""}`, `परीक्षा बनी${papers ? ` · ${papers} पेपर` : ""}`), data: { id: made.id } };
}


/**
 * The exam office's per-paper "a child may be excused" switch (smoke 20 Oct:
 * 90 of 107 Half yearly papers do not allow it, and the marks stream asked
 * whether they should). Changes one paper's `allow_exempt`, nothing else, and
 * only as `exemptSwitch` allows; which papers should allow it is the
 * school's call, so no paper is changed by this commit.
 */
export async function setPaperExemptAction(input: { paperId: string; allow: boolean }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };

  const paper = await paperById(input.paperId);
  if (!paper) return { ok: false, message: p("That paper was not found.", "वह पेपर नहीं मिला।") };
  const verdict = exemptSwitch({ allowExempt: paper.allow_exempt, entryRevision: paper.entry_revision }, input.allow);
  if (!verdict.ok) {
    return { ok: false, message: p("Marks are already being entered on this paper, so excusing can no longer be switched off.", "इस पेपर के अंक भरे जा रहे हैं, इसलिए अब छूट बंद नहीं हो सकती।") };
  }
  if (verdict.change) {
    const { error } = await createAdminClient().from("assessment_subjects").update({ allow_exempt: input.allow }).eq("id", paper.id);
    if (error) return { ok: false, message: p("Not saved. Try again.", "सहेजा नहीं गया। फिर कोशिश करें।") };
    await logActivity({
      assessmentId: paper.assessment_id,
      kind: "paper",
      en: `${staff.displayName} ${input.allow ? "allowed" : "stopped"} excusing a child from ${paper.class_label} ${paper.subject_code}`,
      hi: `${staff.displayName} ने ${paper.class_label} ${paper.subject_code} में छूट ${input.allow ? "दी" : "बंद की"}`,
      actorId: staff.id,
    }).catch(() => undefined);
  }
  revalidatePath("/exams");
  return { ok: true, message: input.allow ? p("A child can now be excused from this paper.", "अब इस पेपर में बच्चे को छूट दी जा सकती है।") : p("Excusing is off for this paper.", "इस पेपर में छूट बंद।") };
}
