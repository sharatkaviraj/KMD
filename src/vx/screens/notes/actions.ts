"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { schoolProfile } from "@/platform/config/school";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { enrolmentForStudent } from "@/modules/students/data/student-repo";
import { schoolToday } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { childBasics } from "@/vx/screens/teach/students";
import { assertNotPreviewing } from "@/vx/view-as";

import { noteViewer, visibleNotes, visiblePlans, type NoteViewer } from "./data";
import {
  canWorkOnNote,
  followUpDate,
  kindForTags,
  NOTE_TAGS,
  parentNoteMessage,
  parentPlanMessage,
  type FollowOwner,
} from "./domain/notes";

/*
 * Writes on notes, replies and support plans. Each one: a permission first,
 * then `assertNotPreviewing()`, then the facts about this note and this
 * reader (who wrote it, whose class it is). Messages to parents are only
 * ever queued in `vppsone.parent_message_queue`; nothing here sends one.
 */

export type NoteResult = { ok: true; id?: string } | { ok: false; error: Pair };

const fail = (en: string, hi: string): NoteResult => ({ ok: false, error: p(en, hi) });
const NOT_SAVED = (): NoteResult => fail("Not saved. Try again.", "सहेजा नहीं गया। फिर से कोशिश करें।");
const UUID = z.uuid();

/** notes:write, or a coordinator who reads every class (they hold notes:view only). */
async function writer(staff: CurrentStaff): Promise<CurrentStaff> {
  if (!can(staff, "notes:write") && !readsEveryClass(staff)) {
    throw new Error("You do not have permission to write notes.");
  }
  await assertNotPreviewing();
  return staff;
}

async function context(staff: CurrentStaff): Promise<{ sessionLabel: string; viewer: NoteViewer } | null> {
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return null;
  return { sessionLabel, viewer: await noteViewer(staff, sessionLabel) };
}

async function inScope(viewer: NoteViewer, studentId: string, sessionLabel: string): Promise<string | null | false> {
  const placement = await enrolmentForStudent(studentId, sessionLabel);
  const classId = placement?.classId ?? null;
  if (viewer.readsEveryClass || viewer.correctsAttendance) return classId;
  return classId !== null && viewer.classIds.has(classId) ? classId : false;
}

/** Who a follow-up goes to, as a person: the class teacher of that class, a coordinator, an admin. */
async function followUpStaff(owner: FollowOwner, actorId: string, classId: string | null, sessionLabel: string): Promise<string | null> {
  const admin = createAdminClient();
  if (owner === "me") return actorId;
  if (owner === "class_teacher") {
    if (!classId) return null;
    const { data } = await admin
      .from("class_teachers")
      .select("staff_profile_id, effective_to")
      .eq("class_id", classId)
      .eq("session_label", sessionLabel)
      .order("effective_from", { ascending: false })
      .returns<{ staff_profile_id: string; effective_to: string | null }[]>();
    const today = schoolToday();
    return (data ?? []).find((r) => !r.effective_to || r.effective_to >= today)?.staff_profile_id ?? null;
  }
  const role = owner === "coordinator" ? "academic_coordinator" : "admin";
  const { data } = await admin
    .from("staff_profiles")
    .select("id")
    .eq("role", role)
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .returns<{ id: string }[]>();
  return data?.[0]?.id ?? null;
}

async function kindId(code: string): Promise<string | null> {
  const { data } = await createAdminClient().from("note_kinds").select("id, code").returns<{ id: string; code: string }[]>();
  return (data ?? []).find((k) => k.code === code)?.id ?? (data ?? []).find((k) => k.code === "other")?.id ?? data?.[0]?.id ?? null;
}

function revalidateNotes() {
  revalidatePath("/notes");
  revalidatePath("/teach/notes");
  revalidatePath("/teach");
  revalidatePath("/teach/class");
}

/* ---------------------------------------------------------------- a note */

const createSchema = z.object({
  studentId: UUID,
  body: z.string().trim().min(1).max(2000),
  tags: z.array(z.enum(NOTE_TAGS)).max(6),
  source: z.enum(["typed", "voice"]),
  needsFollowUp: z.boolean(),
  followWhen: z.enum(["tomorrow", "next_monday", "one_week"]).nullable(),
  followOwner: z.enum(["me", "class_teacher", "coordinator", "admin"]).nullable(),
  visibility: z.enum(["team", "private"]),
  tellParents: z.boolean(),
});

export async function createNoteAction(input: z.input<typeof createSchema>): Promise<NoteResult> {
  const staff = await writer(await assertPermission("notes:view"));
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("Write the note and pick a child.", "नोट लिखें और बच्चा चुनें।");
  const ctx = await context(staff);
  if (!ctx) return NOT_SAVED();
  const v = parsed.data;

  const classId = await inScope(ctx.viewer, v.studentId, ctx.sessionLabel);
  if (classId === false) return fail("This child is not in your classes.", "यह बच्चा आपकी कक्षा में नहीं है।");
  if (v.tellParents && v.visibility === "private") {
    return fail("A note for parents cannot be 'only me'.", "माता-पिता को भेजा जाने वाला नोट 'सिर्फ़ मैं' नहीं हो सकता।");
  }

  const kind = await kindId(kindForTags(v.tags));
  if (!kind) return NOT_SAVED();
  const today = schoolToday();
  const owner = v.needsFollowUp ? (v.followOwner ?? "me") : null;
  const ownerId = owner ? await followUpStaff(owner, staff.id, classId, ctx.sessionLabel) : null;
  const relation = classId && ctx.viewer.heldClassIds.has(classId) ? "class_teacher" : classId && ctx.viewer.classIds.has(classId) ? "subject_teacher" : staff.role;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notes")
    .insert({
      session_label: ctx.sessionLabel,
      student_id: v.studentId,
      class_id: classId,
      kind_id: kind,
      body: v.body,
      written_by: staff.id,
      source: v.source,
      tags: v.tags,
      needs_follow_up: v.needsFollowUp,
      follow_up_on: v.needsFollowUp ? followUpDate(v.followWhen ?? "tomorrow", today) : null,
      follow_up_owner: owner,
      follow_up_staff_id: ownerId,
      visibility: v.visibility,
      tell_parents: v.tellParents,
      author_relation: relation,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return NOT_SAVED();

  if (v.tellParents) {
    const kid = (await childBasics([v.studentId])).get(v.studentId);
    const msg = parentNoteMessage({ childName: kid?.fullName ?? "", teacher: staff.displayName, body: v.body, school: schoolProfile.shortName });
    const queued = await admin.from("parent_message_queue").insert({
      session_label: ctx.sessionLabel,
      kind: "note",
      student_id: v.studentId,
      class_id: classId,
      note_id: data.id,
      day: today,
      body_hi: msg.hi,
      body_en: msg.en,
      queued_by: staff.id,
    });
    // The note is saved either way; it must not claim parents were told when
    // the message never reached the queue. "Tell parents" on the note retries.
    if (queued.error) await admin.from("notes").update({ tell_parents: false }).eq("id", data.id);
  }

  revalidateNotes();
  return { ok: true, id: data.id };
}

/** Undo straight after saving: the author's own note, and any message to parents it queued. */
export async function undoNoteAction(noteId: string): Promise<NoteResult> {
  const staff = await writer(await assertPermission("notes:view"));
  if (!UUID.safeParse(noteId).success) return NOT_SAVED();
  const admin = createAdminClient();
  await admin
    .from("parent_message_queue")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: staff.id })
    .eq("note_id", noteId)
    .eq("status", "queued")
    .eq("queued_by", staff.id);
  const { error } = await admin.from("notes").delete().eq("id", noteId).eq("written_by", staff.id);
  if (error) return NOT_SAVED();
  revalidateNotes();
  return { ok: true };
}

async function workable(staff: CurrentStaff, noteId: string) {
  const ctx = await context(staff);
  if (!ctx || !UUID.safeParse(noteId).success) return null;
  // Looked up by id, so a note older than the board's newest 600 can still be worked on.
  const notes = await visibleNotes(ctx.viewer, ctx.sessionLabel, { noteId, limit: 1 });
  const note = notes.find((n) => n.id === noteId) ?? null;
  return note ? { ...ctx, note } : null;
}

export async function setNoteStatusAction(noteId: string, status: "open" | "working" | "done"): Promise<NoteResult> {
  const staff = await assertPermission("notes:view");
  await assertNotPreviewing();
  if (!["open", "working", "done"].includes(status)) return NOT_SAVED();
  const found = await workable(staff, noteId);
  if (!found) return fail("That note was not found.", "यह नोट नहीं मिला।");
  if (!canWorkOnNote(found.note, found.viewer)) {
    return fail("Only the writer, the class teacher or the person following up can change this.", "इसे लिखने वाले, कक्षा अध्यापक या फ़ॉलो-अप करने वाले ही बदल सकते हैं।");
  }
  if (found.note.status === status) return { ok: true };
  const admin = createAdminClient();
  const { error } = await admin
    .from("notes")
    .update({ status, status_changed_at: new Date().toISOString(), status_changed_by: staff.id })
    .eq("id", noteId);
  if (error) return NOT_SAVED();
  const words = { open: "Opened again", working: "Working on it", done: "Marked done" }[status];
  await admin.from("note_replies").insert({ note_id: noteId, body: words, source: "system", written_by: staff.id });
  revalidateNotes();
  return { ok: true };
}

export async function replyToNoteAction(noteId: string, body: string, source: "typed" | "voice"): Promise<NoteResult> {
  const staff = await assertPermission("notes:view");
  await assertNotPreviewing();
  const text = String(body ?? "").trim();
  if (!text || text.length > 1000) return fail("Write a reply first.", "पहले जवाब लिखें।");
  const found = await workable(staff, noteId);
  if (!found) return fail("That note was not found.", "यह नोट नहीं मिला।");
  const { error } = await createAdminClient()
    .from("note_replies")
    .insert({ note_id: noteId, body: text, source: source === "voice" ? "voice" : "typed", written_by: staff.id });
  if (error) return NOT_SAVED();
  revalidateNotes();
  return { ok: true };
}

export async function setFollowUpAction(noteId: string, owner: FollowOwner, when: "tomorrow" | "next_monday" | "one_week"): Promise<NoteResult> {
  const staff = await assertPermission("notes:view");
  await assertNotPreviewing();
  if (!["me", "class_teacher", "coordinator", "admin"].includes(owner)) return NOT_SAVED();
  const found = await workable(staff, noteId);
  if (!found) return fail("That note was not found.", "यह नोट नहीं मिला।");
  if (!canWorkOnNote(found.note, found.viewer)) return fail("You cannot change who follows this up.", "आप फ़ॉलो-अप करने वाले को नहीं बदल सकते।");
  const ownerId = await followUpStaff(owner, staff.id, found.note.classId, found.sessionLabel);
  const { error } = await createAdminClient()
    .from("notes")
    .update({ needs_follow_up: true, follow_up_owner: owner, follow_up_staff_id: ownerId, follow_up_on: followUpDate(when, schoolToday()) })
    .eq("id", noteId);
  if (error) return NOT_SAVED();
  revalidateNotes();
  return { ok: true };
}

export async function tellParentsAboutNoteAction(noteId: string): Promise<NoteResult> {
  const staff = await writer(await assertPermission("notes:view"));
  const found = await workable(staff, noteId);
  if (!found || !found.note.studentId) return fail("That note was not found.", "यह नोट नहीं मिला।");
  if (found.note.visibility === "private") return fail("An 'only me' note is not sent to parents.", "'सिर्फ़ मैं' नोट माता-पिता को नहीं भेजा जाता।");
  const msg = parentNoteMessage({ childName: found.note.studentName, teacher: found.note.writtenByName, body: found.note.body, school: schoolProfile.shortName });
  const admin = createAdminClient();
  const { error } = await admin.from("parent_message_queue").insert({
    session_label: found.sessionLabel,
    kind: "note",
    student_id: found.note.studentId,
    class_id: found.note.classId,
    note_id: noteId,
    day: schoolToday(),
    body_hi: msg.hi,
    body_en: msg.en,
    queued_by: staff.id,
  });
  if (error) return NOT_SAVED();
  await admin.from("notes").update({ tell_parents: true }).eq("id", noteId);
  revalidateNotes();
  return { ok: true };
}

/* -------------------------------------------------------- support plans */

const planSchema = z.object({
  studentId: UUID,
  noteId: UUID.nullable(),
  goal: z.string().trim().min(1).max(300),
  steps: z
    .array(z.object({ body: z.string().trim().min(1).max(160), ownerRole: z.enum(["me", "class_teacher", "subject_teacher", "coordinator", "admin", "parents"]), whenLabel: z.string().trim().max(40).nullable() }))
    .min(1)
    .max(12),
  tellParents: z.boolean(),
});

export async function createPlanAction(input: z.input<typeof planSchema>): Promise<NoteResult> {
  const staff = await writer(await assertPermission("notes:view"));
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return fail("Write a goal and at least one step.", "एक लक्ष्य और कम से कम एक कदम लिखें।");
  const ctx = await context(staff);
  if (!ctx) return NOT_SAVED();
  const v = parsed.data;
  const classId = await inScope(ctx.viewer, v.studentId, ctx.sessionLabel);
  if (classId === false) return fail("This child is not in your classes.", "यह बच्चा आपकी कक्षा में नहीं है।");

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("support_plans")
    .insert({ session_label: ctx.sessionLabel, student_id: v.studentId, class_id: classId, note_id: v.noteId, goal: v.goal, status: "active", started_at: now, created_by: staff.id, tell_parents: v.tellParents })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return NOT_SAVED();

  const { error: stepError } = await admin.from("support_plan_steps").insert(
    v.steps.map((s, i) => ({
      plan_id: data.id,
      text: s.body,
      owner_role: s.ownerRole,
      owner_staff_id: s.ownerRole === "me" ? staff.id : null,
      due_label: s.whenLabel,
      sort_order: i,
      created_by: staff.id,
    })),
  );
  if (stepError) {
    // Without its steps the plan is an empty shell, and a retry would make a second one.
    await admin.from("support_plans").delete().eq("id", data.id);
    return NOT_SAVED();
  }

  if (v.noteId) await admin.from("notes").update({ status: "working", status_changed_at: now, status_changed_by: staff.id }).eq("id", v.noteId).neq("status", "done");

  if (v.tellParents) {
    const plans = await visiblePlans(ctx.viewer, ctx.sessionLabel, { planId: data.id });
    const plan = plans[0];
    if (plan) {
      const msg = parentPlanMessage({ childName: plan.studentName, goal: plan.goal, steps: plan.steps.map((s) => s.body), school: schoolProfile.shortName });
      await admin.from("parent_message_queue").insert({ session_label: ctx.sessionLabel, kind: "support_plan", student_id: v.studentId, class_id: classId, plan_id: data.id, note_id: v.noteId, day: schoolToday(), body_hi: msg.hi, body_en: msg.en, queued_by: staff.id });
    }
  }

  revalidateNotes();
  return { ok: true, id: data.id };
}

async function plannable(staff: CurrentStaff, planId: string) {
  const ctx = await context(staff);
  if (!ctx || !UUID.safeParse(planId).success) return null;
  const plans = await visiblePlans(ctx.viewer, ctx.sessionLabel, { planId });
  return plans[0] ? { ...ctx, plan: plans[0] } : null;
}

export async function addPlanStepAction(planId: string, body: string, ownerRole: string, whenLabel: string | null): Promise<NoteResult> {
  const staff = await writer(await assertPermission("notes:view"));
  const text = String(body ?? "").trim();
  if (!text || text.length > 160) return fail("Write the step first.", "पहले कदम लिखें।");
  const role = ["me", "class_teacher", "subject_teacher", "coordinator", "admin", "parents"].includes(ownerRole) ? ownerRole : "me";
  const found = await plannable(staff, planId);
  if (!found) return fail("That plan was not found.", "यह योजना नहीं मिली।");
  const { error } = await createAdminClient().from("support_plan_steps").insert({
    plan_id: planId,
    text,
    owner_role: role,
    owner_staff_id: role === "me" ? staff.id : null,
    due_label: whenLabel ? String(whenLabel).slice(0, 40) : null,
    sort_order: found.plan.steps.length,
    created_by: staff.id,
  });
  if (error) return NOT_SAVED();
  revalidateNotes();
  return { ok: true };
}

export async function togglePlanStepAction(planId: string, stepId: string, done: boolean): Promise<NoteResult> {
  const staff = await assertPermission("notes:view");
  await assertNotPreviewing();
  const found = await plannable(staff, planId);
  if (!found || !found.plan.steps.some((s) => s.id === stepId)) return fail("That step was not found.", "यह कदम नहीं मिला।");
  const { error } = await createAdminClient()
    .from("support_plan_steps")
    .update(done ? { done_at: new Date().toISOString(), done_by: staff.id } : { done_at: null, done_by: null })
    .eq("id", stepId)
    .eq("plan_id", planId);
  if (error) return NOT_SAVED();
  revalidateNotes();
  return { ok: true };
}

export async function removePlanStepAction(planId: string, stepId: string): Promise<NoteResult> {
  const staff = await writer(await assertPermission("notes:view"));
  const found = await plannable(staff, planId);
  if (!found || !found.plan.steps.some((s) => s.id === stepId)) return fail("That step was not found.", "यह कदम नहीं मिला।");
  // Removed, not deleted: the plan's history keeps it.
  const { error } = await createAdminClient()
    .from("support_plan_steps")
    .update({ removed_at: new Date().toISOString(), removed_by: staff.id })
    .eq("id", stepId)
    .eq("plan_id", planId);
  if (error) return NOT_SAVED();
  revalidateNotes();
  return { ok: true };
}

export async function closePlanAction(planId: string): Promise<NoteResult> {
  const staff = await writer(await assertPermission("notes:view"));
  const found = await plannable(staff, planId);
  if (!found) return fail("That plan was not found.", "यह योजना नहीं मिली।");
  const { error } = await createAdminClient().from("support_plans").update({ status: "done", closed_at: new Date().toISOString() }).eq("id", planId);
  if (error) return NOT_SAVED();
  revalidateNotes();
  return { ok: true };
}

export async function tellParentsAboutPlanAction(planId: string): Promise<NoteResult> {
  const staff = await writer(await assertPermission("notes:view"));
  const found = await plannable(staff, planId);
  if (!found) return fail("That plan was not found.", "यह योजना नहीं मिली।");
  const { plan } = found;
  const msg = parentPlanMessage({ childName: plan.studentName, goal: plan.goal, steps: plan.steps.map((s) => s.body), school: schoolProfile.shortName });
  const admin = createAdminClient();
  const { error } = await admin.from("parent_message_queue").insert({
    session_label: found.sessionLabel,
    kind: "support_plan",
    student_id: plan.studentId,
    class_id: plan.classId,
    plan_id: plan.id,
    note_id: plan.noteId,
    day: schoolToday(),
    body_hi: msg.hi,
    body_en: msg.en,
    queued_by: staff.id,
  });
  if (error) return NOT_SAVED();
  await admin.from("support_plans").update({ tell_parents: true }).eq("id", planId);
  revalidateNotes();
  return { ok: true };
}
