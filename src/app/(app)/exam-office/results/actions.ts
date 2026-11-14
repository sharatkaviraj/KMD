"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { sendResultsOutNotices } from "@/modules/whatsapp/data/report-card-notice-send";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertClassVisible, assertSessionVisible, assertStudentVisible, passesFence } from "@/platform/auth/test-session-access";
import { schoolToday } from "@/platform/dates";
import { createAdminClient } from "@/platform/supabase/admin";
import { p, type Pair } from "@/vx/text";
import { enrolmentsFor, graceFor, issuedStudents, listExams, locksFor, logActivity, marksOf, paperById, papersOf, trackerFor } from "@/vx/screens/exams/data";
import { issueOne } from "@/vx/screens/exams/cards-data";
import { canFinaliseMarks, canReopenMarks } from "@/vx/screens/exams/domain/finalise";
import { lockRefusal, lockRefusalText } from "@/vx/screens/exams/domain/progress";
import { graceVerdict } from "@/vx/screens/exams/domain/results";
import { onRoll } from "@/vx/screens/exams/domain/tracker";
import { previewRefusal } from "@/vx/screens/exams/guards";
import { commitMarks } from "@/vx/screens/exams/marks-save";
import type { ActionResult } from "@/vx/screens/exams/save-types";

/*
 * The results pipeline's writes: a look at an unusual average, the grace
 * rule and the grace it gives, locking classes, issuing cards, publishing,
 * and re-check requests. Exam office only; each asks the permission, then
 * that an administrator is not previewing another role. Marks themselves
 * change only through `save_marks`.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const RELOAD: Pair = p("Something was missing. Reload the page.", "कुछ अधूरा था। पेज फिर खोलें।");
const NOT_SAVED: Pair = p("Not saved. Try again.", "सहेजा नहीं गया। फिर से कोशिश करें।");
const db = () => createAdminClient();

function refresh() {
  revalidatePath("/exam-office/results");
  revalidatePath("/exam-office");
  revalidatePath("/exams");
}

async function examOf(id: string) {
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return null;
  const exams = await listExams(sessionLabel);
  const exam = exams.find((e) => e.id === id);
  return exam ? { exam, exams, sessionLabel } : null;
}

/** The exam office looked at an average that moved: it is fine, or the teacher re-checks the copies. */
export async function moderateAction(input: { paperId: string; decision: "fine" | "recheck"; note?: string | null }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.paperId) || !["fine", "recheck"].includes(input.decision)) return { ok: false, message: RELOAD };
  const paper = await paperById(input.paperId);
  if (!paper) return { ok: false, message: RELOAD };
  const { error } = await db()
    .from("exam_moderation")
    .upsert({ paper_id: input.paperId, decision: input.decision, note: input.note?.trim().slice(0, 300) || null, decided_by: staff.id, decided_at: new Date().toISOString() }, { onConflict: "paper_id" });
  if (error) return { ok: false, message: NOT_SAVED };
  let handedBack = false;
  if (input.decision === "recheck" && paper.entry_status === "submitted") {
    // Hand the paper back so its teacher can change marks after re-checking.
    const r = await commitMarks(staff.id, { commandId: randomUUID(), paperId: paper.id, kind: "reopen", expectedRevision: paper.entry_revision, reason: "Average moved a lot — please re-check the copies", entries: [] });
    handedBack = r.ok;
  }
  await logActivity({
    assessmentId: paper.assessment_id,
    kind: "moderation",
    en: `${staff.displayName} ${input.decision === "fine" ? "checked" : "sent back for re-check"} ${paper.class_label} ${paper.subject_code}`,
    hi: `${staff.displayName} ने ${paper.class_label} ${paper.subject_code} ${input.decision === "fine" ? "जाँचा" : "दोबारा जाँच को भेजा"}`,
    actorId: staff.id,
  }).catch(() => undefined);
  refresh();
  return {
    ok: true,
    message: input.decision === "fine" ? p("Marked as checked", "जाँचा हुआ") : handedBack ? p("Sent back — the paper is open for its teacher", "वापस भेजा — पेपर शिक्षक के लिए खुला") : p("Marked for re-check", "दोबारा जाँच के लिए"),
  };
}

/** The school's grace rule for this exam. */
export async function saveGraceRuleAction(input: { examId: string; max: number; subjects: number }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId) || !(input.max >= 0 && input.max <= 10) || ![1, 2].includes(input.subjects)) return { ok: false, message: RELOAD };
  const { error } = await db()
    .from("exam_plans")
    .upsert({ assessment_id: input.examId, grace_max: input.max, grace_subjects: input.subjects, updated_by: staff.id, updated_at: new Date().toISOString() }, { onConflict: "assessment_id" });
  if (error) return { ok: false, message: NOT_SAVED };
  refresh();
  return { ok: true };
}

/**
 * Give grace to every child the rule carries through, worked out again here
 * from the marks as they stand. Kept beside the mark, never added into it.
 * Locked classes are left as they are.
 */
export async function giveGraceAction(input: { examId: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId)) return { ok: false, message: RELOAD };
  const found = await examOf(input.examId);
  if (!found) return { ok: false, message: RELOAD };
  const { exam, sessionLabel } = found;
  const rule = { maxPerPaper: exam.plan?.graceMax ?? 3, maxSubjects: exam.plan?.graceSubjects ?? 2 };
  const [papers, locks] = await Promise.all([papersOf([exam.id]), locksFor(exam.id)]);
  const open = papers.filter((x) => !locks.has(x.class_id));
  const [marks, given, roll] = await Promise.all([marksOf(open.map((x) => x.id)), graceFor(open.map((x) => x.id)), enrolmentsFor(sessionLabel, [...new Set(open.map((x) => x.class_id))])]);
  const today = schoolToday();
  const had = new Set(given.map((g) => `${g.paper_id}|${g.student_id}`));
  const markOf = new Map(marks.map((m) => [`${m.assessment_subject_id}|${m.student_id}`, m]));
  const rows: { paper_id: string; student_id: string; grace: number; applied_by: string }[] = [];
  for (const e of roll) {
    if (!onRoll(e, exam, today)) continue;
    const mine = open.filter((x) => x.class_id === e.classId);
    const verdict = graceVerdict(
      e.studentId,
      mine.map((x) => {
        const m = markOf.get(`${x.id}|${e.studentId}`);
        return { paperId: x.id, subjectCode: x.subject_code, value: m?.value === null || m?.value === undefined ? null : Number(m.value), absent: Boolean(m?.absent), exempt: Boolean(m?.exempt), passMarks: x.pass_marks === null ? null : Number(x.pass_marks), maxMarks: Number(x.max_marks) };
      }),
      rule,
    );
    if (!verdict?.canPass) continue;
    for (const need of verdict.needs) if (!had.has(`${need.paperId}|${e.studentId}`)) rows.push({ paper_id: need.paperId, student_id: e.studentId, grace: need.grace, applied_by: staff.id });
  }
  if (rows.length) {
    const { error } = await db().from("exam_grace").upsert(rows, { onConflict: "paper_id,student_id" });
    if (error) return { ok: false, message: NOT_SAVED };
  }
  const children = new Set(rows.map((r) => r.student_id)).size;
  await logActivity({ assessmentId: exam.id, kind: "grace", en: `${staff.displayName} gave grace to ${children} children`, hi: `${staff.displayName} ने ${children} बच्चों को ग्रेस दिए`, actorId: staff.id }).catch(() => undefined);
  refresh();
  return { ok: true, message: children ? p(`Grace given to ${children} children`, `${children} बच्चों को ग्रेस दिए`) : p("Nobody new needed grace", "किसी और को ग्रेस की ज़रूरत नहीं") };
}

/** Take back grace on one paper for one child. */
export async function removeGraceAction(input: { paperId: string; studentId: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.paperId) || !UUID.test(input.studentId)) return { ok: false, message: RELOAD };
  if (!(await passesFence(() => assertStudentVisible(staff, input.studentId)))) return { ok: false, message: RELOAD };
  const paper = await paperById(input.paperId);
  if (!paper) return { ok: false, message: RELOAD };
  const locks = await locksFor(paper.assessment_id);
  if (locks.has(paper.class_id)) return { ok: false, message: p("This class is locked. Unlock it first.", "यह कक्षा बंद है। पहले खोलें।") };
  const { error } = await db().from("exam_grace").delete().eq("paper_id", input.paperId).eq("student_id", input.studentId);
  if (error) return { ok: false, message: NOT_SAVED };
  refresh();
  return { ok: true, message: p("Grace taken back", "ग्रेस वापस लिए") };
}

/**
 * Lock (finalise) classes: after this no mark on their papers changes, in
 * either app, until the admin reopens. Who may is `MARKS_FINALISERS` (D-262).
 */
export async function lockClassesAction(input: { examId: string; classIds: string[] }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!canFinaliseMarks(staff)) return { ok: false, message: p("Only the admin finalises marks. Ask the admin to lock this class.", "अंक केवल प्रशासक अंतिम करते हैं। कक्षा बंद करने के लिए प्रशासक से कहें।") };
  const ids = [...new Set(input.classIds)].filter((id) => UUID.test(id));
  if (!UUID.test(input.examId) || ids.length === 0) return { ok: false, message: RELOAD };
  for (const id of ids) {
    if (!(await passesFence(() => assertClassVisible(staff, id)))) return { ok: false, message: RELOAD };
  }
  const found = await examOf(input.examId);
  if (!found) return { ok: false, message: RELOAD };
  // The same check the board's "Ready to lock" makes, from the marks as they
  // stand now: every paper submitted, every child on its roster marked, and
  // no saved mark its paper cannot hold (B04). Nothing is locked otherwise.
  const tracked = await trackerFor({ exam: found.exam, classes: [], staff: [], onlyPapers: (x) => ids.includes(x.class_id) });
  const papers = tracked.rows;
  const refused = lockRefusal(tracked.papers);
  if (refused) return { ok: false, message: lockRefusalText(refused) };
  const { error } = await db()
    .from("exam_class_locks")
    .upsert(ids.map((id) => ({ assessment_id: input.examId, class_id: id, locked_by: staff.id })), { onConflict: "assessment_id,class_id", ignoreDuplicates: true });
  if (error) return { ok: false, message: NOT_SAVED };
  const labels = [...new Set(papers.map((x) => x.class_label))];
  await logActivity({ assessmentId: input.examId, kind: "locked", en: `${staff.displayName} locked ${labels.join(", ")}`, hi: `${staff.displayName} ने ${labels.join(", ")} बंद किया`, actorId: staff.id }).catch(() => undefined);
  refresh();
  return { ok: true, message: p(`${ids.length} classes locked`, `${ids.length} कक्षाएँ बंद`) };
}

/** Only `MARKS_REOPENERS` (the administrator) open a locked class again (D-262). */
export async function unlockClassAction(input: { examId: string; classId: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!canReopenMarks(staff)) return { ok: false, message: p("Only the admin can unlock a class.", "कक्षा केवल प्रशासक खोल सकते हैं।") };
  if (!UUID.test(input.examId) || !UUID.test(input.classId)) return { ok: false, message: RELOAD };
  if (!(await passesFence(() => assertClassVisible(staff, input.classId)))) return { ok: false, message: RELOAD };
  const { error } = await db().from("exam_class_locks").delete().eq("assessment_id", input.examId).eq("class_id", input.classId);
  if (error) return { ok: false, message: NOT_SAVED };
  await logActivity({ assessmentId: input.examId, kind: "unlocked", en: `${staff.displayName} unlocked a class`, hi: `${staff.displayName} ने एक कक्षा खोली`, actorId: staff.id }).catch(() => undefined);
  refresh();
  return { ok: true, message: p("Class unlocked", "कक्षा खुली") };
}

/** Issue every card in a class that is not issued yet, each through `issue_report_card`. */
export async function issueClassCardsAction(input: { examId: string; classId: string; reissue?: boolean }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId) || !UUID.test(input.classId)) return { ok: false, message: RELOAD };
  if (!(await passesFence(() => assertClassVisible(staff, input.classId)))) return { ok: false, message: RELOAD };
  const found = await examOf(input.examId);
  if (!found) return { ok: false, message: RELOAD };
  const { exam, sessionLabel } = found;
  const locks = await locksFor(exam.id);
  if (!locks.has(input.classId)) return { ok: false, message: p("Lock the class's marks first — a card is made from locked marks.", "पहले कक्षा के अंक बंद करें — कार्ड बंद अंकों से बनता है।") };
  const today = schoolToday();
  const roll = (await enrolmentsFor(sessionLabel, [input.classId])).filter((e) => onRoll(e, { startsOn: today, endsOn: today }, today));
  const have = await issuedStudents(sessionLabel, exam.term, exam.startsOn);
  let done = 0;
  let firstRefusal: Pair | null = null;
  for (const e of roll) {
    if (have.has(e.studentId) && !input.reissue) continue;
    const r = await issueOne({ actorStaffId: staff.id, studentId: e.studentId, sessionLabel, term: exam.term });
    if (r.ok) done += 1;
    else if (!firstRefusal) firstRefusal = r.message;
  }
  if (done) {
    await logActivity({ assessmentId: exam.id, kind: "cards", en: `${staff.displayName} issued ${done} report cards`, hi: `${staff.displayName} ने ${done} प्रगति पत्र जारी किए`, actorId: staff.id }).catch(() => undefined);
  }
  refresh();
  if (!done && firstRefusal) return { ok: false, message: firstRefusal };
  return {
    ok: true,
    message: firstRefusal
      ? p(`${done} cards issued · some could not be: ${firstRefusal.en}`, `${done} कार्ड जारी · कुछ नहीं हुए: ${firstRefusal.hi ?? firstRefusal.en}`)
      : p(`${done} report cards issued`, `${done} प्रगति पत्र जारी`),
  };
}

/**
 * When results go out. This records the release and the PTM; it does not
 * message parents — a send to families goes from Notices, where it is
 * approved before it leaves.
 */
export async function publishResultsAction(input: { examId: string; when: "now" | "scheduled"; at: string | null; ptm: boolean }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId) || !["now", "scheduled"].includes(input.when) || (input.when === "scheduled" && (!input.at || Number.isNaN(Date.parse(input.at))))) {
    return { ok: false, message: RELOAD };
  }
  // "Now" releases only what is locked; with nothing locked there is nothing
  // to release, and the board used to say "Results released" anyway (day-run
  // 6 Nov 2026, E26). A schedule may still be set ahead of the locks.
  // The exam must be one of the viewer's own session (a test account names a
  // TEST exam only).
  const found = await examOf(input.examId);
  if (!found || !(await passesFence(() => assertSessionVisible(staff, found.sessionLabel)))) return { ok: false, message: RELOAD };
  if (input.when === "now") {
    const { count, error: lockError } = await db().from("exam_class_locks").select("*", { count: "exact", head: true }).eq("assessment_id", input.examId);
    if (lockError) return { ok: false, message: NOT_SAVED };
    if (!count) return { ok: false, message: p("No class is locked yet, so nothing can go now. Ask the admin to lock marks first.", "अभी कोई कक्षा बंद नहीं, इसलिए कुछ नहीं जाएगा। पहले एडमिन से अंक बंद करवाएँ।") };
  }
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    assessment_id: input.examId,
    results_publish_at: input.when === "now" ? now : new Date(input.at!).toISOString(),
    results_channels: { whatsapp: false, ptm: input.ptm },
    updated_by: staff.id,
    updated_at: now,
  };
  if (input.when === "now") {
    row.results_published_at = now;
    row.results_published_by = staff.id;
  }
  const { error } = await db().from("exam_plans").upsert(row, { onConflict: "assessment_id" });
  if (error) return { ok: false, message: NOT_SAVED };
  await logActivity({ assessmentId: input.examId, kind: "results", en: `${staff.displayName} ${input.when === "now" ? "released the results" : "scheduled the results"}`, hi: `${staff.displayName} ने परिणाम ${input.when === "now" ? "जारी किए" : "तय किए"}`, actorId: staff.id }).catch(() => undefined);
  refresh();
  return { ok: true, message: input.when === "now" ? p("Results released", "परिणाम जारी") : p("Results scheduled", "परिणाम का समय तय") };
}

/**
 * "Results are out" on WhatsApp for one released class (D-615): one message
 * per child with a Get report card button, whose tap sends the card. Only a
 * locked class of a released exam. Practice only for now: in the test year
 * it goes to the owner's number for the practice children; a real year sends
 * nothing until real families are switched on.
 */
export async function tellParentsAction(input: { examId: string; classId: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId) || !UUID.test(input.classId)) return { ok: false, message: RELOAD };
  if (!(await passesFence(() => assertClassVisible(staff, input.classId)))) return { ok: false, message: RELOAD };
  const found = await examOf(input.examId);
  if (!found || !(await passesFence(() => assertSessionVisible(staff, found.sessionLabel)))) return { ok: false, message: RELOAD };
  const { exam, sessionLabel } = found;
  const publishAt = exam.plan?.resultsPublishedAt ?? exam.plan?.resultsPublishAt ?? null;
  if (!publishAt || Date.parse(publishAt) > Date.now()) {
    return { ok: false, message: p("Release the results first. Parents are told only after that.", "पहले परिणाम जारी करें। उसके बाद ही अभिभावकों को बताया जाता है।") };
  }
  const locks = await locksFor(exam.id);
  if (!locks.has(input.classId)) return { ok: false, message: p("This class is not locked, so its results are not out.", "यह कक्षा बंद नहीं है, इसलिए इसका परिणाम जारी नहीं हुआ।") };
  const today = schoolToday();
  const roll = (await enrolmentsFor(sessionLabel, [input.classId])).filter((e) => onRoll(e, { startsOn: today, endsOn: today }, today));
  const run = await sendResultsOutNotices({
    sessionLabel,
    term: exam.term,
    exam: { en: exam.labelEn, hi: exam.labelHi },
    studentIds: roll.map((e) => e.studentId),
    requestedBy: staff.userId,
  });
  if (!run.ok) {
    const why: Record<typeof run.why, Pair> = {
      real_year: p("Real families are not switched on for WhatsApp yet. Nothing was sent.", "असली परिवारों के लिए WhatsApp अभी चालू नहीं है। कुछ नहीं भेजा।"),
      no_practice_child: p("No practice child is in this class. Nothing was sent.", "इस कक्षा में कोई अभ्यास वाला बच्चा नहीं। कुछ नहीं भेजा।"),
      no_owner: p("The owner's test number is not set. Nothing was sent.", "मालिक का टेस्ट नंबर नहीं है। कुछ नहीं भेजा।"),
      read_failed: NOT_SAVED,
    };
    return { ok: false, message: why[run.why] };
  }
  if (run.sent || run.logged) {
    await logActivity({ assessmentId: exam.id, kind: "results", en: `${staff.displayName} told parents on WhatsApp (practice): ${run.sent + run.logged}`, hi: `${staff.displayName} ने WhatsApp पर अभिभावकों को बताया (अभ्यास): ${run.sent + run.logged}`, actorId: staff.id }).catch(() => undefined);
  }
  refresh();
  if (run.sent) return { ok: true, message: p(`Sent to ${run.sent === 1 ? "1 family" : `${run.sent} families`} on WhatsApp (practice: the owner's number)`, `WhatsApp पर ${run.sent} परिवार को भेजा (अभ्यास: मालिक का नंबर)`) };
  if (run.logged) return { ok: true, message: p("Practice mode is on: written to the WhatsApp log, not sent.", "अभ्यास मोड चालू है: WhatsApp लॉग में लिखा, भेजा नहीं।") };
  if (run.already) return { ok: true, message: p("Already told about this card. Nobody is told twice.", "इस कार्ड के बारे में पहले ही बता दिया। किसी को दो बार नहीं।") };
  if (run.stopped.count) {
    const reason: Pair =
      run.stopped.code === "template_not_approved"
        ? p("Meta has not approved the message yet. Nothing was sent.", "Meta ने संदेश अभी मंज़ूर नहीं किया। कुछ नहीं भेजा।")
        : run.stopped.code === "feature_off"
          ? p("Report cards on WhatsApp are switched off in Settings. Nothing was sent.", "सेटिंग में WhatsApp पर रिपोर्ट कार्ड बंद है। कुछ नहीं भेजा।")
          : p(`Not sent: ${run.stopped.reason ?? "a WhatsApp check stopped it"}`, `नहीं भेजा: ${run.stopped.reason ?? "WhatsApp की जाँच ने रोका"}`);
    return { ok: false, message: reason };
  }
  if (run.failed) return { ok: false, message: p("WhatsApp did not take it. Try again in a few minutes.", "WhatsApp ने नहीं लिया। कुछ मिनट बाद फिर कोशिश करें।") };
  return { ok: false, message: p("No issued report card to send for this class yet. Issue the cards first.", "इस कक्षा का कोई जारी प्रगति पत्र नहीं। पहले कार्ड जारी करें।") };
}

/** A parent asked for a paper to be checked again. */
export async function addRecheckAction(input: { paperId: string; studentId: string; askedBy: string; note: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  const askedBy = input.askedBy.trim().slice(0, 120);
  if (!UUID.test(input.paperId) || !UUID.test(input.studentId) || askedBy.length < 2) return { ok: false, message: RELOAD };
  if (!(await passesFence(() => assertStudentVisible(staff, input.studentId)))) return { ok: false, message: RELOAD };
  const { error } = await db()
    .from("exam_rechecks")
    .insert({ paper_id: input.paperId, student_id: input.studentId, asked_by: askedBy, note: input.note.trim().slice(0, 300) || null, created_by: staff.id });
  if (error) return { ok: false, message: NOT_SAVED };
  refresh();
  return { ok: true, message: p("Request added", "अनुरोध जोड़ा") };
}

/** The subject teacher has been asked. */
export async function recheckWithTeacherAction(input: { recheckId: string }): Promise<ActionResult> {
  await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.recheckId)) return { ok: false, message: RELOAD };
  const { error } = await db().from("exam_rechecks").update({ status: "with_teacher" }).eq("id", input.recheckId).is("resolved_at", null);
  if (error) return { ok: false, message: NOT_SAVED };
  refresh();
  return { ok: true };
}

/**
 * What the re-check found. A changed mark goes through `save_marks` as a
 * correction with its reason, like any other change after submission; a
 * locked class refuses it until it is unlocked.
 */
export async function resolveRecheckAction(input: { recheckId: string; delta: number }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.recheckId) || !Number.isFinite(input.delta) || Math.abs(input.delta) > 100) return { ok: false, message: RELOAD };
  const { data: rc } = await db()
    .from("exam_rechecks")
    .select("id, paper_id, student_id, note, resolved_at")
    .eq("id", input.recheckId)
    .maybeSingle<{ id: string; paper_id: string; student_id: string; note: string | null; resolved_at: string | null }>();
  if (!rc || rc.resolved_at) return { ok: false, message: RELOAD };
  const paper = await paperById(rc.paper_id);
  if (!paper) return { ok: false, message: RELOAD };
  const [mark] = (await marksOf([paper.id])).filter((m) => m.student_id === rc.student_id);
  const old = mark?.value === null || mark?.value === undefined ? null : Number(mark.value);

  if (input.delta !== 0) {
    if (old === null) return { ok: false, message: p("This child has no mark to change.", "इस बच्चे का कोई अंक नहीं जिसे बदलें।") };
    const next = old + input.delta;
    if (next < 0 || next > Number(paper.max_marks)) return { ok: false, message: p("That takes the mark outside the paper's range.", "इससे अंक सीमा से बाहर जाता है।") };
    const r = await commitMarks(staff.id, {
      commandId: randomUUID(),
      paperId: paper.id,
      kind: paper.entry_status === "submitted" ? "correction" : "draft",
      expectedRevision: paper.entry_revision,
      reason: `Re-check: ${rc.note ?? "asked by family"}`.slice(0, 300),
      entries: [{ studentId: rc.student_id, state: "value", value: next }],
    });
    if (!r.ok) return { ok: false, message: r.message };
  }
  const { error } = await db()
    .from("exam_rechecks")
    .update({ status: input.delta ? "changed" : "no_change", old_value: old, new_value: old === null ? null : old + input.delta, resolved_by: staff.id, resolved_at: new Date().toISOString() })
    .eq("id", rc.id);
  if (error) return { ok: false, message: NOT_SAVED };
  refresh();
  return { ok: true, message: input.delta ? p("Mark changed and saved", "अंक बदले और सहेजे") : p("Closed · no change", "बंद · कोई बदलाव नहीं") };
}
