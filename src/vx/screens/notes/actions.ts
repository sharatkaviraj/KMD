"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { assertStudentVisible, passesFence } from "@/platform/auth/test-session-access";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { schoolProfile } from "@/platform/config/school";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { enrolmentForStudent } from "@/modules/students/data/student-repo";
import { schoolToday } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { childBasics } from "@/vx/screens/teach/students";
import { assertNotPreviewing } from "@/vx/view-as";
import { allowsParentKind } from "@/vx/screens/settings/domain/parent-switches";
import { readParentSwitches } from "@/vx/screens/settings/parent-switches";

import { noteViewer, visibleNotes, visiblePlans, type NoteViewer } from "./data";
import {
  canEditNote,
  canWorkOnNote,
  EDIT_DAYS,
  FOLLOW_ON_MAX_DAYS,
  pickedFollowOn,
  followUpDate,
  kindForTags,
  NOTE_TAGS,
  parentNoteMessage,
  parentPlanMessage,
  planSourceRefusal,
  type FollowOwner,
  type PlanSourceRefusal,
  followOwnerAllowed,
  followUpsSettledBy,
  type NoteStatus,
  type SettledFollowUp,
} from "./domain/notes";

/*
 * Writes on notes, replies and support plans. Each one: a permission first,
 * then `assertNotPreviewing()`, then the facts about this note and this
 * reader (who wrote it, whose class it is). Messages to parents are only
 * ever queued in `vppsone.parent_message_queue`; nothing here sends one.
 */

/** `settled`: the writer's own due follow-ups for the same child that a new note closed by itself (D-646). */
export type NoteResult = { ok: true; id?: string; settled?: SettledFollowUp[] } | { ok: false; error: Pair };

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

/**
 * Who a follow-up goes to, as a person: the class teacher of that class, a
 * coordinator, an admin. A coordinator who hands a note to "the coordinator"
 * keeps it herself, as notesPeople() names her (smoke 20 Oct: with two
 * coordinators it went to the other one).
 */
async function followUpStaff(owner: FollowOwner, actor: { id: string; role: string }, classId: string | null, sessionLabel: string): Promise<string | null> {
  const admin = createAdminClient();
  const actorId = actor.id;
  if (owner === "me") return actorId;
  if (owner === "coordinator" && actor.role === "academic_coordinator") return actorId;
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
  // Somebody of this session (owner, 8 Nov 2026): the real year had no real
  // coordinator, so "the coordinator" was the QA test coordinator.
  const { data } = await admin
    .from("staff_profiles")
    .select("id")
    .eq("role", role)
    .eq("is_active", true)
    .eq("is_test_account", isTestSessionLabel(sessionLabel))
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
  // The same action shows on Student 360's support card and the home page,
  // so finishing it once updates every place it appears.
  revalidatePath("/students/[id]", "page");
  revalidatePath("/");
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
  /** A date the writer picked instead of the three ready choices (YYYY-MM-DD); wins over followWhen. */
  followOn: z.string().max(10).nullable().optional(),
  visibility: z.enum(["team", "private"]),
  tellParents: z.boolean(),
  /** The composer's id for this draft, the same on every retry of it (20261106123000). */
  requestId: UUID.nullable().optional(),
});

/** The note this writer already filed under a draft's id, if any. */
async function noteFiledUnder(staffId: string, requestId: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("notes")
    .select("id")
    .eq("written_by", staffId)
    .eq("client_request_id", requestId)
    .limit(1)
    .returns<{ id: string }[]>();
  if (error) return null;
  return data?.[0]?.id ?? null;
}

/**
 * Save one note about a child.
 *
 * **A retry files once.** A save can take a minute on a slow day; a teacher
 * who leaves while it says "Still saving" comes back to her draft and saves it
 * again. The composer sends the same `requestId` for every save of one draft,
 * so the second save gets the first note back instead of filing a twin (the
 * 6 Nov school day found six). Two saves at once meet `notes_request_once`:
 * the loser reads back what the winner filed.
 */
/** A health or family note offered to the coordinator, who may not read it (`followOwnerAllowed`). */
const SENSITIVE_OWNER = () =>
  fail(
    "A health or family note can only be followed up by the class teacher or the admin, who are the only ones who can read it.",
    "स्वास्थ्य या परिवार वाला नोट सिर्फ़ कक्षा अध्यापक या प्रशासक देख सकते हैं, इसलिए वही इसे फिर से देखेंगे।",
  );

export async function createNoteAction(input: z.input<typeof createSchema>): Promise<NoteResult> {
  const staff = await writer(await assertPermission("notes:view"));
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("Write the note and pick a child.", "नोट लिखें और बच्चा चुनें।");
  // The child's own session, before anything is written about them or closed for them (D-646).
  if (!(await passesFence(() => assertStudentVisible(staff, parsed.data.studentId)))) {
    return fail("This child is not in your classes.", "यह बच्चा आपकी कक्षा में नहीं है।");
  }
  const ctx = await context(staff);
  if (!ctx) return NOT_SAVED();
  // Settings → Parent messages: with "Tell parents" turned off by the admin
  // the note is still saved, and nothing is queued for the family.
  const v = parsed.data.tellParents && !allowsParentKind(await readParentSwitches(), "note") ? { ...parsed.data, tellParents: false } : parsed.data;
  const requestId = v.requestId ?? null;
  if (requestId) {
    const filed = await noteFiledUnder(staff.id, requestId);
    if (filed) return { ok: true, id: filed };
  }

  const classId = await inScope(ctx.viewer, v.studentId, ctx.sessionLabel);
  if (classId === false) return fail("This child is not in your classes.", "यह बच्चा आपकी कक्षा में नहीं है।");
  if (v.tellParents && v.visibility === "private") {
    return fail("A note for parents cannot be 'only me'.", "माता-पिता को भेजा जाने वाला नोट 'सिर्फ़ मैं' नहीं हो सकता।");
  }

  const kind = await kindId(kindForTags(v.tags));
  if (!kind) return NOT_SAVED();
  const today = schoolToday();
  const picked = v.followOn ? pickedFollowOn(v.followOn, today) : null;
  if (v.needsFollowUp && v.followOn && !picked) {
    return fail(`Pick a follow-up date after today and within ${FOLLOW_ON_MAX_DAYS} days.`, `आज के बाद और ${FOLLOW_ON_MAX_DAYS} दिन के अंदर की तारीख़ चुनें।`);
  }
  const owner = v.needsFollowUp ? (v.followOwner ?? "me") : null;
  if (owner && !followOwnerAllowed(owner, { tags: v.tags })) return SENSITIVE_OWNER();
  const ownerId = owner ? await followUpStaff(owner, staff, classId, ctx.sessionLabel) : null;
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
      follow_up_on: v.needsFollowUp ? (picked ?? followUpDate(v.followWhen ?? "tomorrow", today)) : null,
      follow_up_owner: owner,
      follow_up_staff_id: ownerId,
      visibility: v.visibility,
      tell_parents: v.tellParents,
      author_relation: relation,
      ...(requestId ? { client_request_id: requestId } : {}),
    })
    .select("id")
    .single<{ id: string }>();
  if (error && requestId && error.code === "23505") {
    const filed = await noteFiledUnder(staff.id, requestId);
    if (filed) return { ok: true, id: filed };
  }
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

  // The follow-up the teacher wrote as a new note instead of closing the old one (D-646).
  const settled = await settleFollowUps({ staffId: staff.id, studentId: v.studentId, sessionLabel: ctx.sessionLabel, newNoteId: data.id, today });

  revalidateNotes();
  return { ok: true, id: data.id, ...(settled.length ? { settled } : {}) };
}

/** The line a follow-up closed by a newer note gets in its history (detail.tsx says it in both languages). */
const SETTLED_REPLY = "Closed by a newer note";

/**
 * Close the writer's own due follow-ups for this child, now that they wrote a
 * new note about the child (D-646, `followUpsSettledBy`). Each is guarded on
 * the status it had, so a change somebody made in between is never undone,
 * and each gets a line in its history. A failure closes nothing more and
 * never fails the save: the note is what the teacher asked for.
 */
async function settleFollowUps(scope: { staffId: string; studentId: string; sessionLabel: string; newNoteId: string; today: string }): Promise<SettledFollowUp[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("notes")
      .select("id, student_id, status, needs_follow_up, follow_up_on, follow_up_staff_id, written_by")
      .eq("session_label", scope.sessionLabel)
      .eq("student_id", scope.studentId)
      .eq("needs_follow_up", true)
      .neq("status", "done")
      .lte("follow_up_on", scope.today)
      .limit(20)
      .returns<
        { id: string; student_id: string | null; status: NoteStatus; needs_follow_up: boolean; follow_up_on: string | null; follow_up_staff_id: string | null; written_by: string }[]
      >();
    if (error || !data?.length) return [];
    const due = followUpsSettledBy(
      scope,
      data.map((row) => ({
        id: row.id,
        studentId: row.student_id,
        status: row.status,
        needsFollowUp: row.needs_follow_up,
        followUpOn: row.follow_up_on,
        followUpStaffId: row.follow_up_staff_id,
        writtenBy: row.written_by,
      })),
    );
    const settled: SettledFollowUp[] = [];
    for (const item of due) {
      const { data: moved, error: moveError } = await admin
        .from("notes")
        .update({ status: "done", status_changed_at: new Date().toISOString(), status_changed_by: scope.staffId })
        .eq("id", item.id)
        .eq("status", item.previous)
        .select("id")
        .returns<{ id: string }[]>();
      if (moveError || !moved?.length) continue;
      await admin.from("note_replies").insert({ note_id: item.id, body: SETTLED_REPLY, source: "system", written_by: scope.staffId });
      settled.push(item);
    }
    return settled;
  } catch {
    return [];
  }
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

/**
 * Change a saved note's words (smoke 20 Oct: a 680-letter note could only be
 * undone, not corrected). Only its author, while it is not done and within
 * EDIT_DAYS of writing it (`canEditNote`). The note's history gets a line
 * saying it was changed and when; the earlier words are not kept, so a
 * teacher who takes out something she should not have written takes it out.
 * A message already queued for the parents is not changed.
 */
export async function editNoteAction(noteId: string, body: string): Promise<NoteResult> {
  const staff = await writer(await assertPermission("notes:view"));
  const text = String(body ?? "").trim();
  if (!text || text.length > 2000) return fail("Write the note first.", "पहले नोट लिखें।");
  const found = await workable(staff, noteId);
  if (!found) return fail("That note was not found.", "यह नोट नहीं मिला।");
  if (!canEditNote(found.note, staff.id, schoolToday())) {
    return fail(`Only the teacher who wrote a note can change it, within ${EDIT_DAYS} days and before it is done. Add a reply instead.`, `नोट वही अध्यापक बदल सकते हैं जिन्होंने लिखा, ${EDIT_DAYS} दिन के अंदर और पूरा होने से पहले। इसके बजाय जवाब जोड़ें।`);
  }
  if (text === found.note.body.trim()) return { ok: true, id: noteId };
  const admin = createAdminClient();
  const { error } = await admin.from("notes").update({ body: text }).eq("id", noteId).eq("written_by", staff.id);
  if (error) return NOT_SAVED();
  await admin.from("note_replies").insert({ note_id: noteId, body: "Note changed", source: "system", written_by: staff.id });
  revalidateNotes();
  return { ok: true, id: noteId };
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
    return fail("Only the writer, the class teacher or the person following up can change this.", "इसे लिखने वाले, कक्षा अध्यापक या इसे फिर से देखने वाले ही बदल सकते हैं।");
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

/**
 * Give a note's follow-up to someone. `when` sets a new date; null keeps the
 * date the note already has (handing it to another person does not move it),
 * or next Monday when it had none.
 */
export async function setFollowUpAction(noteId: string, owner: FollowOwner, when: "tomorrow" | "next_monday" | "one_week" | null): Promise<NoteResult> {
  const staff = await assertPermission("notes:view");
  await assertNotPreviewing();
  if (!["me", "class_teacher", "coordinator", "admin"].includes(owner)) return NOT_SAVED();
  if (when !== null && !["tomorrow", "next_monday", "one_week"].includes(when)) return NOT_SAVED();
  const found = await workable(staff, noteId);
  if (!found) return fail("That note was not found.", "यह नोट नहीं मिला।");
  if (!canWorkOnNote(found.note, found.viewer)) return fail("You cannot change who follows this up.", "आप नहीं बदल सकते कि इसे फिर से कौन देखेगा।");
  if (!followOwnerAllowed(owner, found.note)) return SENSITIVE_OWNER();
  const ownerId = await followUpStaff(owner, staff, found.note.classId, found.sessionLabel);
  const on = when ? followUpDate(when, schoolToday()) : (found.note.followUpOn ?? followUpDate("next_monday", schoolToday()));
  const { error } = await createAdminClient()
    .from("notes")
    .update({ needs_follow_up: true, follow_up_owner: owner, follow_up_staff_id: ownerId, follow_up_on: on })
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
  if (!allowsParentKind(await readParentSwitches(), "note")) return fail("The admin has turned off messages to parents about notes.", "प्रशासक ने नोट के बारे में अभिभावकों को संदेश बंद किए हैं।");
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
  /** The author pressed "Use words from the note" and saw who would read them. */
  shareExcerpt: z.boolean().optional(),
});

const PLAN_SOURCE_REFUSED: Record<PlanSourceRefusal, () => NoteResult> = {
  missing: () => fail("That note was not found.", "वह नोट नहीं मिला।"),
  other_child: () => fail("That note is about another child.", "वह नोट किसी और बच्चे के बारे में है।"),
  not_yours: () => fail("Only the teacher who wrote this note can start a plan from it.", "इस नोट से योजना वही अध्यापक शुरू कर सकते हैं जिन्होंने इसे लिखा।"),
  private_to_parents: () => fail("This note is Only me, so its plan cannot be sent to the parents.", "यह नोट सिर्फ़ आपके लिए है, इसलिए इसकी योजना माता-पिता को नहीं भेजी जा सकती।"),
  private_words: () => fail("The goal repeats your Only me note. Write the goal in your own words, or press Use words from the note.", "लक्ष्य आपके निजी नोट को दोहराता है। लक्ष्य अपने शब्दों में लिखें, या \"नोट के शब्द लें\" दबाएँ।"),
};

export async function createPlanAction(input: z.input<typeof planSchema>): Promise<NoteResult> {
  const staff = await writer(await assertPermission("notes:view"));
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return fail("Write a goal and at least one step.", "एक लक्ष्य और कम से कम एक कदम लिखें।");
  const ctx = await context(staff);
  if (!ctx) return NOT_SAVED();
  const v = parsed.data.tellParents && !allowsParentKind(await readParentSwitches(), "support_plan") ? { ...parsed.data, tellParents: false } : parsed.data;
  const classId = await inScope(ctx.viewer, v.studentId, ctx.sessionLabel);
  if (classId === false) return fail("This child is not in your classes.", "यह बच्चा आपकी कक्षा में नहीं है।");
  // The note is read as this writer may read it, in this session (R01): a
  // plan is read by the child's whole team, so it may not start from a note
  // she cannot see, about another child, or carry an Only me note's words
  // or its parents' message unasked.
  let sourceBody: string | null = null;
  if (v.noteId) {
    const [source] = await visibleNotes(ctx.viewer, ctx.sessionLabel, { noteId: v.noteId, limit: 1 });
    const refusal = planSourceRefusal(source ?? null, { viewerId: staff.id, studentId: v.studentId, goal: v.goal, tellParents: v.tellParents, shareExcerpt: v.shareExcerpt === true });
    if (refusal) return PLAN_SOURCE_REFUSED[refusal]();
    sourceBody = source?.body ?? null;
  }

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
      const msg = parentPlanMessage({ childName: plan.studentName, goal: plan.goal, steps: plan.steps.map((s) => s.body), school: schoolProfile.shortName, noteBody: sourceBody });
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
  if (!allowsParentKind(await readParentSwitches(), "support_plan")) return fail("The admin has turned off sharing support plans with parents.", "प्रशासक ने अभिभावकों को सहायता योजना भेजना बंद किया है।");
  const { plan } = found;
  let noteBody: string | null = null;
  if (plan.noteId) {
    // An Only me note's plan stays with the school (R01), as the note does (createNoteAction).
    const { data: source, error: sourceError } = await createAdminClient().from("notes").select("visibility, body").eq("id", plan.noteId).maybeSingle<{ visibility: string; body: string }>();
    // A failed/missing read does not prove that this note may be shared.
    if (sourceError) return NOT_SAVED();
    if (!source) return PLAN_SOURCE_REFUSED.missing();
    if (source?.visibility === "private") return PLAN_SOURCE_REFUSED.private_to_parents();
    // A goal that repeats the note's staff wording is left out of the parents' message (smoke 20 Oct).
    noteBody = source?.body ?? null;
  }
  const msg = parentPlanMessage({ childName: plan.studentName, goal: plan.goal, steps: plan.steps.map((s) => s.body), school: schoolProfile.shortName, noteBody });
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
