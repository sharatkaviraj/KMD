"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listMarks, registerById, saveRegisterCommand, studentNames } from "@/modules/attendance/data/attendance-repo";
import { getCorrection, rejectCorrection } from "@/modules/attendance/data/corrections-repo";
import { classScopeFor, heldClassIds } from "@/modules/attendance/data/teaching-repo";
import { registerAuthority, saveRegisterSchema, type SaveRegisterInput } from "@/modules/attendance/domain/attendance";
import { attendanceRefusals } from "@/modules/attendance/domain/attendance-receipt";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { canDecide } from "@/modules/attendance/domain/corrections";
import { dispatchStaffNotices } from "@/modules/staff-notices/data/dispatcher";
import { schoolToday } from "@/vx/format";
import { academicContext, attendanceOn, marksEntry, staffDirectory, weekFacts } from "@/vx/screens/academics/data";
import { isUuid, weeklySummaryLine } from "@/vx/screens/academics/domain";
import { p, type Pair } from "@/vx/text";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * Writes from the coordinator's screens (AcadHome, AcadProgress,
 * AcadAttendance). Each one checks a permission first, then that an admin is
 * not previewing another role, then the class scope — and only then writes,
 * through the service role like the rest of `vppsone`.
 */

export type ActionResult = { ok: boolean; text: Pair; ids?: string[] };

const fail = (en: string, hi: string): ActionResult => ({ ok: false, text: p(en, hi) });

function revalidateAcademics() {
  revalidatePath("/academics");
  revalidatePath("/academics/progress");
  revalidatePath("/academics/attendance");
}

/* ------------------------------------------------- remind about registers */

/**
 * Ask whoever answers for each unmarked register today to mark it — the same
 * staff notice the 9:30 job sends, keyed by class, day and person, so asking
 * twice adds nothing and the outbox suppresses it if the register is saved
 * before it goes.
 */
export async function remindRegistersAction(classIds: string[]): Promise<ActionResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  const ctx = await academicContext(actor);
  if (!ctx) return fail("No session is open.", "कोई सत्र खुला नहीं है।");
  const day = await attendanceOn(ctx, ctx.today);
  if (day.closed) return fail("School is closed today.", "आज विद्यालय बंद है।");
  const wanted = new Set(classIds.filter(isUuid));
  const targets = day.notMarked.filter((c) => (wanted.size === 0 || wanted.has(c.classId)) && c.teacherId);
  if (targets.length === 0) return fail("Every register is already marked.", "सभी रजिस्टर दर्ज हो चुके हैं।");
  const commandId = randomUUID();
  const notAfter = new Date(`${ctx.today}T23:59:00+05:30`).toISOString();
  const rows = targets.map((c) => ({
    notice_key: `attendance:${c.classId}:${ctx.today}:${c.teacherId}`,
    kind: "attendance_reminder",
    class_id: c.classId,
    class_label: c.label,
    staff_profile_id: c.teacherId,
    session_label: ctx.session,
    day: ctx.today,
    not_after: notAfter,
    command_id: commandId,
  }));
  const { error } = await createAdminClient().from("staff_notices").upsert(rows, { onConflict: "notice_key", ignoreDuplicates: true });
  if (error) return fail("Could not send the reminders.", "रिमाइंडर नहीं भेजे जा सके।");
  await dispatchStaffNotices({ max: rows.length + 5 }).catch(() => null);
  revalidateAcademics();
  const names = targets.map((c) => c.label).join(", ");
  return { ok: true, text: p(`Asked ${targets.length} ${targets.length === 1 ? "teacher" : "teachers"} to mark ${names}.`, `${targets.length} शिक्षकों से ${names} की हाज़िरी लेने को कहा।`) };
}

/* ------------------------------------------------------ remind about marks */

async function staffTemplate(code: string) {
  const { data } = await createAdminClient()
    .from("message_templates")
    .select("id, body_hi, body_en, audience, is_active")
    .eq("code", code)
    .maybeSingle<{ id: string; body_hi: string; body_en: string; audience: string; is_active: boolean }>();
  if (!data || data.audience !== "staff" || data.is_active === false) return null;
  return data;
}

function fill(body: string, variables: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => variables[Number(n) - 1] ?? "");
}

/**
 * WhatsApp each late teacher once, naming every paper of hers still open. A
 * staff message, queued for the dispatcher; undo cancels what has not gone.
 */
export async function remindMarksAction(teacherIds: string[]): Promise<ActionResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  const ctx = await academicContext(actor);
  if (!ctx) return fail("No session is open.", "कोई सत्र खुला नहीं है।");
  const [entry, staff, template] = await Promise.all([marksEntry(ctx), staffDirectory(), staffTemplate("vppsone_marks_reminder")]);
  if (!template) return fail("The marks reminder template is not set up.", "अंक रिमाइंडर का टेम्पलेट नहीं है।");
  const wanted = new Set(teacherIds.filter(isUuid));
  const late = entry.late.filter((t) => wanted.size === 0 || wanted.has(t.teacherId));
  const rows = late.flatMap((t) => {
    const person = staff.get(t.teacherId);
    const phone = person?.whatsapp_phone ?? person?.phone ?? null;
    if (!person || !phone) return [];
    const variables = [person.display_name, t.papers.map((paper) => `${paper.classLabel} ${paper.subject}`).sort().join(", ")];
    return [
      {
        session_label: ctx.session,
        template_id: template.id,
        to_phone: phone,
        to_name: person.display_name,
        staff_profile_id: person.id,
        variables,
        rendered_hi: fill(template.body_hi, variables),
        rendered_en: fill(template.body_en, variables),
        status: "queued",
        requested_by: actor.id,
      },
    ];
  });
  if (rows.length === 0) return fail("Nobody to remind — no late teacher has a phone on file.", "किसी को याद दिलाने के लिए फ़ोन नंबर नहीं।");
  const { data, error } = await createAdminClient().from("message_sends").insert(rows).select("id").returns<{ id: string }[]>();
  if (error) return fail("Could not queue the reminders.", "रिमाइंडर कतार में नहीं डाले जा सके।");
  revalidateAcademics();
  return { ok: true, ids: data.map((row) => row.id), text: p(`Reminded ${rows.length} ${rows.length === 1 ? "teacher" : "teachers"} on WhatsApp.`, `${rows.length} शिक्षकों को WhatsApp पर याद दिलाया।`) };
}

/** Undo: cancel the reminders just queued, if they have not gone yet. */
export async function cancelRemindersAction(ids: string[]): Promise<ActionResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  const wanted = ids.filter(isUuid);
  if (wanted.length === 0) return fail("Nothing to undo.", "वापस लेने को कुछ नहीं।");
  const { error } = await createAdminClient()
    .from("message_sends")
    .update({ status: "cancelled" })
    .in("id", wanted)
    .eq("requested_by", actor.id)
    .in("status", ["draft", "queued"]);
  if (error) return fail("Could not undo.", "वापस नहीं लिया जा सका।");
  revalidateAcademics();
  return { ok: true, text: p("Reminders cancelled.", "रिमाइंडर रद्द।") };
}

/* ------------------------------------------------------- weekly summary */

/** Send the week's summary to the principal (every active admin with a phone). */
export async function sendWeeklySummaryAction(): Promise<ActionResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  const ctx = await academicContext(actor);
  if (!ctx) return fail("No session is open.", "कोई सत्र खुला नहीं है।");
  const [week, staff, template] = await Promise.all([weekFacts(ctx), staffDirectory(), staffTemplate("vppsone_weekly_summary")]);
  if (!template) return fail("The weekly summary template is not set up.", "साप्ताहिक सारांश का टेम्पलेट नहीं है।");
  const admins = [...staff.values()].filter((s) => s.role === "admin" && s.is_active && (s.whatsapp_phone ?? s.phone));
  if (admins.length === 0) return fail("No principal has a phone on file.", "प्रधानाचार्य का फ़ोन नंबर नहीं है।");
  const summary = weeklySummaryLine(week.facts);
  const rows = admins.map((a) => {
    const variables = [a.display_name, summary, actor.displayName];
    return {
      session_label: ctx.session,
      template_id: template.id,
      to_phone: (a.whatsapp_phone ?? a.phone)!,
      to_name: a.display_name,
      staff_profile_id: a.id,
      variables,
      rendered_hi: fill(template.body_hi, variables),
      rendered_en: fill(template.body_en, variables),
      status: "queued",
      requested_by: actor.id,
    };
  });
  const { data, error } = await createAdminClient().from("message_sends").insert(rows).select("id").returns<{ id: string }[]>();
  if (error) return fail("Could not send the summary.", "सारांश नहीं भेजा जा सका।");
  return { ok: true, ids: data.map((row) => row.id), text: p(`Weekly summary sent to ${admins.map((a) => a.display_name).join(", ")}.`, `साप्ताहिक सारांश ${admins.map((a) => a.display_name).join(", ")} को भेजा।`) };
}

/* ------------------------------------------------------------ follow-ups */

const OUTCOMES = ["reached", "no_answer", "wrong_number", "will_come", "visit_school"] as const;
const KINDS = ["call", "improving", "follow_up"] as const;

/**
 * A call to a parent and how it went, "improving", or a follow-up handed to
 * somebody — appended to the child's record. School-wide readers only: the
 * attention and below-75% lists are theirs.
 */
export async function saveFollowupAction(input: { studentId: string; kind: string; outcome?: string | null; note?: string | null; ownerId?: string | null }): Promise<ActionResult> {
  const actor = await assertPermission("attendance:view");
  await assertNotPreviewing();
  if (!readsEveryClass(actor)) return fail("Only the office and coordinators keep this list.", "यह सूची कार्यालय और संयोजक रखते हैं।");
  const kind = KINDS.find((k) => k === input.kind);
  const outcome = input.outcome ? OUTCOMES.find((o) => o === input.outcome) ?? null : null;
  if (!kind || !isUuid(input.studentId)) return fail("Choose what happened.", "क्या हुआ, चुनें।");
  if (kind === "call" && !outcome) return fail("Choose how the call went.", "कॉल का नतीजा चुनें।");
  const note = (input.note ?? "").trim().slice(0, 400) || null;
  const session = await resolveSessionLabel();
  if (!session) return fail("No session is open.", "कोई सत्र खुला नहीं है।");
  const { error } = await createAdminClient()
    .from("student_followups")
    .insert({ session_label: session, student_id: input.studentId, kind, outcome, note, owner_staff_id: isUuid(input.ownerId) ? input.ownerId : null, created_by: actor.id });
  if (error) return fail("Could not save that.", "सहेजा नहीं जा सका।");
  revalidateAcademics();
  const text =
    kind === "call"
      ? p("Call outcome saved.", "कॉल का नतीजा सहेजा।")
      : kind === "improving"
        ? p("Marked as improving.", "सुधार की ओर चिह्नित।")
        : p("Follow-up assigned.", "फ़ॉलो-अप सौंपा।");
  return { ok: true, text };
}

/* --------------------------------------------------------- support plans */

type StepInput = { id?: string | null; text: string; ownerId?: string | null; due?: string | null; done?: boolean };

/**
 * Save a child's support plan, and start it when asked. One plan open at a
 * time: the draft or active one is updated; a step left out is removed (kept,
 * with `removed_at`), never deleted.
 */
export async function savePlanAction(input: { studentId: string; goal: string; steps: StepInput[]; start: boolean }): Promise<ActionResult> {
  const actor = await assertPermission("academics:manage");
  await assertNotPreviewing();
  if (!isUuid(input.studentId)) return fail("Choose a child.", "बच्चा चुनें।");
  const session = await resolveSessionLabel();
  if (!session) return fail("No session is open.", "कोई सत्र खुला नहीं है।");
  const scope = await classScopeFor(actor, session);
  const admin = createAdminClient();
  const { data: enrolment } = await admin.from("enrolments").select("class_id").eq("session_label", session).eq("student_id", input.studentId).eq("status", "enrolled").maybeSingle<{ class_id: string }>();
  if (!enrolment || !scopeIncludes(scope, enrolment.class_id)) return fail("That child is not in your classes.", "यह बच्चा आपकी कक्षाओं में नहीं है।");
  const goal = input.goal.trim().slice(0, 300);
  const steps = input.steps.map((s) => ({ ...s, text: s.text.trim().slice(0, 160) })).filter((s) => s.text.length > 0).slice(0, 12);
  if (input.start && (!goal || steps.length === 0)) return fail("Write a goal and at least one step to start the plan.", "योजना शुरू करने के लिए लक्ष्य और कम से कम एक कदम लिखें।");

  const { data: existing } = await admin
    .from("support_plans")
    .select("id, status")
    .eq("session_label", session)
    .eq("student_id", input.studentId)
    .in("status", ["draft", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string }>();

  const now = new Date().toISOString();
  let planId = existing?.id ?? null;
  const status = input.start || existing?.status === "active" ? "active" : "draft";
  if (planId) {
    const { error } = await admin
      .from("support_plans")
      .update({ goal: goal || null, status, ...(status === "active" && existing?.status !== "active" ? { started_at: now } : {}) })
      .eq("id", planId);
    if (error) return fail("Could not save the plan.", "योजना सहेजी नहीं जा सकी।");
  } else {
    const { data, error } = await admin
      .from("support_plans")
      .insert({ session_label: session, student_id: input.studentId, goal: goal || null, status, created_by: actor.id, started_at: status === "active" ? now : null })
      .select("id")
      .single<{ id: string }>();
    if (error) return fail("Could not save the plan.", "योजना सहेजी नहीं जा सकी।");
    planId = data.id;
  }

  const { data: current } = await admin.from("support_plan_steps").select("id").eq("plan_id", planId).is("removed_at", null).returns<{ id: string }[]>();
  const kept = new Set(steps.map((s) => s.id).filter(isUuid));
  const gone = (current ?? []).map((row) => row.id).filter((id) => !kept.has(id));
  if (gone.length) await admin.from("support_plan_steps").update({ removed_at: now }).in("id", gone);
  for (const [i, s] of steps.entries()) {
    const row = { text: s.text, owner_staff_id: isUuid(s.ownerId) ? s.ownerId : null, due_label: (s.due ?? "").trim().slice(0, 40) || null, sort_order: i };
    if (s.id && isUuid(s.id) && (current ?? []).some((c) => c.id === s.id)) {
      await admin.from("support_plan_steps").update(row).eq("id", s.id).eq("plan_id", planId);
    } else {
      await admin.from("support_plan_steps").insert({ ...row, plan_id: planId, done_at: s.done ? now : null, done_by: s.done ? actor.id : null });
    }
  }
  revalidateAcademics();
  return { ok: true, text: status === "active" ? p("Plan started. Owners will see their steps.", "योजना शुरू। ज़िम्मेदार लोग अपने कदम देखेंगे।") : p("Plan saved as a draft.", "योजना ड्राफ़्ट के रूप में सहेजी।") };
}

export async function toggleStepAction(stepId: string, done: boolean): Promise<ActionResult> {
  const actor = await assertPermission("academics:manage");
  await assertNotPreviewing();
  if (!isUuid(stepId)) return fail("Choose a step.", "कदम चुनें।");
  const { error } = await createAdminClient()
    .from("support_plan_steps")
    .update(done ? { done_at: new Date().toISOString(), done_by: actor.id } : { done_at: null, done_by: null })
    .eq("id", stepId)
    .is("removed_at", null);
  if (error) return fail("Could not update the step.", "कदम अपडेट नहीं हुआ।");
  revalidateAcademics();
  return { ok: true, text: done ? p("Step done.", "कदम पूरा।") : p("Step reopened.", "कदम फिर खुला।") };
}

/* ----------------------------------------------- mark for a teacher away */

function payloadHash(input: SaveRegisterInput): string {
  const marks = [...input.marks].sort((a, b) => a.studentId.localeCompare(b.studentId));
  return createHash("sha256")
    .update(
      JSON.stringify({
        classId: input.classId,
        day: input.day,
        kind: input.kind,
        expectedRevision: input.expectedRevision,
        reason: input.reason,
        marks: marks.map((mark) => [mark.studentId, mark.status]),
      }),
    )
    .digest("hex");
}

/**
 * Save a register on a teacher's behalf (she is on leave). The same command
 * the teacher's own save uses — roll, revision and authority are checked
 * again inside the transaction — under the `attendance:mark_on_behalf`
 * permission.
 */
export async function markRegisterAction(payload: unknown): Promise<ActionResult> {
  const actor = await assertPermission("attendance:view");
  await assertNotPreviewing();
  const session = await resolveSessionLabel();
  if (!session) return fail("No session is open.", "कोई सत्र खुला नहीं है।");
  const parsed = saveRegisterSchema.safeParse(payload);
  if (!parsed.success) return fail("Mark every child before saving.", "सहेजने से पहले हर बच्चे की हाज़िरी लगाएँ।");
  if (parsed.data.day !== schoolToday() && parsed.data.kind === "save") return fail("Only today's register can be marked here.", "यहाँ केवल आज का रजिस्टर दर्ज होता है।");
  const held = await heldClassIds(actor.id, session);
  const authority = registerAuthority({
    isOwner: held.includes(parsed.data.classId),
    hasMarkPermission: can(actor, "attendance:mark"),
    hasMarkOnBehalfPermission: can(actor, "attendance:mark_on_behalf"),
    hasCorrectPermission: can(actor, "attendance:correct"),
  });
  if (!(parsed.data.kind === "save" ? authority.save : authority.correct)) {
    const r = authority.reason ?? attendanceRefusals.not_permitted;
    return { ok: false, text: { en: r.en, hi: r.hi } };
  }
  let outcome;
  try {
    outcome = await saveRegisterCommand({ ...parsed.data, sessionLabel: session, actorStaffId: actor.id, payloadHash: payloadHash(parsed.data) });
  } catch {
    const r = attendanceRefusals.failed;
    return { ok: false, text: { en: r.en, hi: r.hi } };
  }
  if (outcome.outcome === "saved") {
    revalidateAcademics();
    revalidatePath("/teach");
    return { ok: true, text: p("Register saved. The teacher can see it was marked for her.", "रजिस्टर सहेजा। शिक्षक को दिखेगा कि उनकी ओर से दर्ज हुआ।") };
  }
  if (outcome.outcome === "roster_changed") {
    const names = await studentNames([...outcome.missing, ...outcome.extra]);
    const who = [...outcome.missing, ...outcome.extra].map((id) => names.get(id) ?? "—").join(", ");
    return fail(`The class list changed (${who}). Open it again and save.`, `कक्षा सूची बदल गई (${who})। फिर खोलकर सहेजें।`);
  }
  const reason = outcome.outcome === "stale" ? "stale" : outcome.reason;
  const r = attendanceRefusals[reason] ?? attendanceRefusals.failed;
  return { ok: false, text: { en: r.en, hi: r.hi } };
}

/* ------------------------------------------------------ change requests */

/**
 * Approve or decline a teacher's change request — the teacher screen's own
 * rule: `attendance:correct`, never your own request, and approving is a
 * correction of the whole register in one transaction.
 */
export async function decideChangeAction(input: { correctionId: string; approve: boolean; note?: string }): Promise<ActionResult> {
  const actor = await assertPermission("attendance:correct");
  await assertNotPreviewing();
  if (!isUuid(input.correctionId)) return fail("Choose a request.", "अनुरोध चुनें।");
  const correction = await getCorrection(input.correctionId);
  if (!correction) return fail("That request is gone.", "वह अनुरोध नहीं मिला।");
  const verdict = canDecide({ hasCorrectPermission: can(actor, "attendance:correct"), requestedByStaffId: correction.requestedBy, deciderStaffId: actor.id, status: correction.status });
  if (!verdict.allowed) return { ok: false, text: verdict.reason ? { en: verdict.reason.en, hi: verdict.reason.hi } : p("You cannot decide this one.", "आप यह तय नहीं कर सकते।") };
  const note = (input.note ?? "").trim().slice(0, 200);
  if (!input.approve) {
    await rejectCorrection({ correctionId: correction.id, decisionNote: note, deciderStaffId: actor.id });
    revalidateAcademics();
    return { ok: true, text: p("Request declined. The teacher will see why.", "अनुरोध अस्वीकार। शिक्षक को कारण दिखेगा।") };
  }
  const register = await registerById(correction.registerId);
  const session = await resolveSessionLabel();
  if (!register || !session || register.sessionLabel !== session) return fail("That register is not in this session.", "वह रजिस्टर इस सत्र का नहीं है।");
  const scope = await classScopeFor(actor, session);
  if (!scopeIncludes(scope, register.classId)) return fail("That class is not yours.", "वह कक्षा आपकी नहीं है।");
  const marks = await listMarks(register.id);
  const input2: SaveRegisterInput = {
    commandId: randomUUID(),
    classId: register.classId,
    day: register.day,
    kind: "correction",
    expectedRevision: register.revision,
    reason: correction.reason,
    marks: [...marks.entries()].map(([studentId, mark]) => ({ studentId, status: studentId === correction.studentId ? correction.toStatus : mark.status })),
  };
  const outcome = await saveRegisterCommand({ ...input2, sessionLabel: session, actorStaffId: actor.id, payloadHash: payloadHash(input2), correctionRequestId: correction.id, decisionNote: note || null });
  if (outcome.outcome !== "saved") {
    const reason = outcome.outcome === "refused" ? outcome.reason : outcome.outcome;
    const r = attendanceRefusals[reason] ?? attendanceRefusals.failed;
    return { ok: false, text: { en: r.en, hi: r.hi } };
  }
  revalidateAcademics();
  revalidatePath("/teach/corrections");
  return { ok: true, text: p("Approved. The register is corrected and the teacher is told.", "स्वीकृत। रजिस्टर सुधरा और शिक्षक को सूचना गई।") };
}
