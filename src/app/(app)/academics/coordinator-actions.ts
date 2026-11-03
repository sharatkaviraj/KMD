"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { assertClassVisible, assertStudentVisible, passesFence } from "@/platform/auth/test-session-access";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { saveRegisterCommand, studentNames } from "@/modules/attendance/data/attendance-repo";
import { classScopeFor, heldClassIds } from "@/modules/attendance/data/teaching-repo";
import { registerAuthority, saveRegisterSchema, type SaveRegisterInput } from "@/modules/attendance/domain/attendance";
import { attendanceRefusals } from "@/modules/attendance/domain/attendance-receipt";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { dispatchStaffNotices } from "@/modules/staff-notices/data/dispatcher";
import { cancelQueuedStaffNotices, queueStaffNotice } from "@/modules/staff-notices/data/enqueue";
import { schoolToday } from "@/vx/format";
import { academicContext, attendanceOn, marksEntry, planHiddenFrom, staffDirectory, weekFacts } from "@/vx/screens/academics/data";
import { isUuid, weeklySummaryKey, weeklySummaryLine } from "@/vx/screens/academics/domain";
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

/** A record in a session this reader may not write — said like "not found". */
const NOT_YOURS = p("That record could not be found.", "यह रिकॉर्ड नहीं मिला।");

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
  const ctx = await academicContext(actor, { writes: true });
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

/**
 * WhatsApp each late teacher once, naming every paper of hers still open. A
 * staff notice in the outbox (go-live Phase F: it used to be a message_sends
 * row somebody had to send by hand); the dispatcher asks consent and the
 * limits when it sends. Undo cancels what has not gone.
 */
export async function remindMarksAction(teacherIds: string[]): Promise<ActionResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  const ctx = await academicContext(actor, { writes: true });
  if (!ctx) return fail("No session is open.", "कोई सत्र खुला नहीं है।");
  const [entry, staff] = await Promise.all([marksEntry(ctx), staffDirectory()]);
  const wanted = new Set(teacherIds.filter(isUuid));
  const late = entry.late.filter((t) => wanted.size === 0 || wanted.has(t.teacherId));
  const commandId = randomUUID();
  const ids: string[] = [];
  try {
    for (const t of late) {
      const person = staff.get(t.teacherId);
      if (!person) continue;
      const id = await queueStaffNotice({
        key: `marks:${commandId}:${person.id}`,
        kind: "marks_reminder",
        staffId: person.id,
        sessionLabel: ctx.session,
        payload: { papers: t.papers.map((paper) => `${paper.classLabel} ${paper.subject}`).sort().join(", ") },
        notAfter: new Date(Date.now() + 2 * 86_400_000),
        requestedBy: actor.id,
      });
      if (id) ids.push(id);
    }
  } catch {
    return fail("Could not queue the reminders.", "रिमाइंडर कतार में नहीं डाले जा सके।");
  }
  if (ids.length === 0) return fail("Nobody to remind.", "याद दिलाने के लिए कोई नहीं।");
  await dispatchStaffNotices({ max: ids.length + 5 }).catch(() => null);
  revalidateAcademics();
  return { ok: true, ids, text: p(`Reminded ${ids.length} ${ids.length === 1 ? "teacher" : "teachers"} on WhatsApp.`, `${ids.length} शिक्षकों को WhatsApp पर याद दिलाया।`) };
}

/** Undo: take back the reminders just queued, if they have not gone yet. */
export async function cancelRemindersAction(ids: string[]): Promise<ActionResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  const wanted = ids.filter(isUuid);
  if (wanted.length === 0) return fail("Nothing to undo.", "वापस लेने को कुछ नहीं।");
  try {
    await cancelQueuedStaffNotices(wanted, actor.id);
  } catch {
    return fail("Could not undo.", "वापस नहीं लिया जा सका।");
  }
  revalidateAcademics();
  return { ok: true, text: p("Reminders cancelled.", "रिमाइंडर रद्द।") };
}

/* ------------------------------------------------------- weekly summary */

/**
 * Send the week's summary to the principal (every active admin with a phone):
 * short or detailed, with the coordinator's own line if she added one — the
 * same lines the screen shows.
 */
export async function sendWeeklySummaryAction(input: { long?: boolean; extra?: string | null } = {}): Promise<ActionResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  const ctx = await academicContext(actor, { writes: true });
  if (!ctx) return fail("No session is open.", "कोई सत्र खुला नहीं है।");
  const [week, staff] = await Promise.all([weekFacts(ctx), staffDirectory()]);
  const admins = [...staff.values()].filter((s) => s.role === "admin" && s.is_active && (s.whatsapp_phone ?? s.phone));
  if (admins.length === 0) return fail("No principal has a phone on file.", "प्रधानाचार्य का फ़ोन नंबर नहीं है।");
  const summary = weeklySummaryLine(week.facts, { long: input?.long !== false, extra: typeof input?.extra === "string" ? input.extra : null });
  // A staff notice in the outbox (go-live Phase F), no longer a message_sends
  // row to send by hand. A summary is the same week's: one per week per admin,
  // keyed by the session and the week's Monday, so a second press queues
  // nothing (the outbox is idempotent on the key).
  const ids: string[] = [];
  try {
    for (const a of admins) {
      const id = await queueStaffNotice({
        key: weeklySummaryKey(ctx.session, week.monday, a.id),
        kind: "weekly_summary",
        staffId: a.id,
        sessionLabel: ctx.session,
        payload: { summary, from: actor.displayName },
        notAfter: new Date(Date.now() + 3 * 86_400_000),
        requestedBy: actor.id,
      });
      if (id) ids.push(id);
    }
  } catch {
    return fail("Could not send the summary.", "सारांश नहीं भेजा जा सका।");
  }
  if (ids.length === 0) {
    return fail("This week's summary has already been sent.", "इस सप्ताह का सारांश पहले ही भेजा जा चुका है।");
  }
  await dispatchStaffNotices({ max: ids.length + 5 }).catch(() => null);
  return { ok: true, ids, text: p(`Weekly summary sent to ${admins.map((a) => a.display_name).join(", ")}.`, `साप्ताहिक सारांश ${admins.map((a) => a.display_name).join(", ")} को भेजा।`) };
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
  // The child's own session, not only the one resolved (Phase 3 fence): a test
  // account never writes about a real child, nor real staff about a TEST one.
  if (!(await passesFence(() => assertStudentVisible(actor, input.studentId)))) return { ok: false, text: NOT_YOURS };
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
  if (!(await passesFence(() => assertStudentVisible(actor, input.studentId)))) return { ok: false, text: NOT_YOURS };
  const scope = await classScopeFor(actor, session);
  const admin = createAdminClient();
  const { data: enrolment } = await admin.from("enrolments").select("class_id").eq("session_label", session).eq("student_id", input.studentId).eq("status", "enrolled").maybeSingle<{ class_id: string }>();
  if (!enrolment || !scopeIncludes(scope, enrolment.class_id)) return fail("That child is not in your classes.", "यह बच्चा आपकी कक्षाओं में नहीं है।");
  const goal = input.goal.trim().slice(0, 300);
  const steps = input.steps.map((s) => ({ ...s, text: s.text.trim().slice(0, 160) })).filter((s) => s.text.length > 0).slice(0, 12);
  if (input.start && (!goal || steps.length === 0)) return fail("Write a goal and at least one step to start the plan.", "योजना शुरू करने के लिए लक्ष्य और कम से कम एक कदम लिखें।");

  const { data: existing } = await admin
    .from("support_plans")
    .select("id, status, note_id, created_by, goal")
    .eq("session_label", session)
    .eq("student_id", input.studentId)
    .in("status", ["draft", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string; note_id: string | null; created_by: string | null; goal: string | null }>();
  // A plan this reader is not shown (D-264, R01) is not written over from an
  // empty editor: its goal and steps belong to the teacher who made it.
  if (existing && (await planHiddenFrom(actor, existing))) {
    return fail("This child already has a support plan kept by the teacher who made it. Ask them, or the admin, to change it.", "इस बच्चे की सहायता योजना पहले से है, जो उसे बनाने वाले अध्यापक के पास है। बदलाव के लिए उनसे या प्रशासक से कहें।");
  }

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

  const { data: current, error: currentError } = await admin.from("support_plan_steps").select("id").eq("plan_id", planId).is("removed_at", null).returns<{ id: string }[]>();
  if (currentError) return fail("Could not save the plan.", "योजना सहेजी नहीं जा सकी।");
  const kept = new Set(steps.map((s) => s.id).filter(isUuid));
  const gone = (current ?? []).map((row) => row.id).filter((id) => !kept.has(id));
  if (gone.length) {
    const { error: goneError } = await admin.from("support_plan_steps").update({ removed_at: now }).in("id", gone);
    if (goneError) return fail("Could not save the plan.", "योजना सहेजी नहीं जा सकी।");
  }
  for (const [i, s] of steps.entries()) {
    const row = { text: s.text, owner_staff_id: isUuid(s.ownerId) ? s.ownerId : null, due_label: (s.due ?? "").trim().slice(0, 40) || null, sort_order: i };
    if (s.id && isUuid(s.id) && (current ?? []).some((c) => c.id === s.id)) {
      const { error: stepError } = await admin.from("support_plan_steps").update(row).eq("id", s.id).eq("plan_id", planId);
      if (stepError) return fail("Could not save the plan.", "योजना सहेजी नहीं जा सकी।");
    } else {
      const { error: stepError } = await admin.from("support_plan_steps").insert({ ...row, plan_id: planId, done_at: s.done ? now : null, done_by: s.done ? actor.id : null });
      if (stepError) return fail("Could not save the plan.", "योजना सहेजी नहीं जा सकी।");
    }
  }
  revalidateAcademics();
  return { ok: true, text: status === "active" ? p("Plan started. Owners will see their steps.", "योजना शुरू। ज़िम्मेदार लोग अपने कदम देखेंगे।") : p("Plan saved as a draft.", "योजना सहेजी, अभी शुरू नहीं हुई।") };
}

export async function toggleStepAction(stepId: string, done: boolean): Promise<ActionResult> {
  const actor = await assertPermission("academics:manage");
  await assertNotPreviewing();
  if (!isUuid(stepId)) return fail("Choose a step.", "कदम चुनें।");
  // The step names a plan, and the plan a child: that child's session decides.
  const { data: step } = await createAdminClient()
    .from("support_plan_steps")
    .select("plan:support_plans!inner(student_id)")
    .eq("id", stepId)
    .maybeSingle<{ plan: { student_id: string } | null }>();
  if (!step?.plan) return fail("Choose a step.", "कदम चुनें।");
  const studentId = step.plan.student_id;
  if (!(await passesFence(() => assertStudentVisible(actor, studentId)))) return { ok: false, text: NOT_YOURS };
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
  if (!(await passesFence(() => assertClassVisible(actor, parsed.data.classId)))) return { ok: false, text: NOT_YOURS };
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

