"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { chunkArray } from "@/platform/helpers/chunk";
import { schoolToday } from "@/platform/dates";
import { createAdminClient } from "@/platform/supabase/admin";
import { p, type Pair } from "@/vx/text";
import {
  classesFor,
  enrolmentsFor,
  holidaysBetween,
  logActivity,
  rooms as loadRooms,
  seatsFor,
  slotsFor,
  staffList,
} from "@/vx/screens/exams/data";
import { copyOnto, examDays, minutesOf } from "@/vx/screens/exams/domain/datesheet";
import { isGroupKey } from "@/vx/screens/exams/domain/groups";
import { assignDuties, invigilatorsFor, seatPlan, type SeatClass } from "@/vx/screens/exams/domain/rooms";
import { onRoll } from "@/vx/screens/exams/domain/tracker";
import { previewRefusal } from "@/vx/screens/exams/guards";
import type { ActionResult } from "@/vx/screens/exams/save-types";

/*
 * Planning an exam: the date sheet, seating, invigilation duties, question
 * papers and publishing. Exam-office only; every write asks the permission,
 * then that an administrator is not previewing another role.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const RELOAD: Pair = p("Something was missing. Reload the page.", "कुछ अधूरा था। पेज फिर खोलें।");
const NOT_SAVED: Pair = p("Not saved. Try again.", "सहेजा नहीं गया। फिर से कोशिश करें।");

const db = () => createAdminClient();

function done(path = "/exam-office/plan") {
  revalidatePath(path);
  revalidatePath("/exam-office");
}

/** Add a sitting, or change one's subject, day, time or length. */
export async function saveSlotAction(input: {
  examId: string;
  slotId: string | null;
  groupKey: string;
  subject: string;
  day: string;
  start: string;
  minutes: number;
}): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  const subject = input.subject.trim();
  if (
    !UUID.test(input.examId) ||
    (input.slotId !== null && !UUID.test(input.slotId)) ||
    !isGroupKey(input.groupKey) ||
    subject.length < 1 ||
    subject.length > 80 ||
    !DAY.test(input.day) ||
    !TIME.test(input.start) ||
    !Number.isInteger(input.minutes) ||
    input.minutes < 15 ||
    input.minutes > 240
  ) {
    return { ok: false, message: RELOAD };
  }
  const row = { group_key: input.groupKey, subject_label: subject, sits_on: input.day, starts_at: input.start, minutes: input.minutes, updated_at: new Date().toISOString() };
  if (input.slotId) {
    const { error } = await db().from("exam_slots").update(row).eq("id", input.slotId).eq("assessment_id", input.examId);
    if (error) return { ok: false, message: NOT_SAVED };
  } else {
    const { data, error } = await db()
      .from("exam_slots")
      .insert({ ...row, assessment_id: input.examId, created_by: staff.id })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) return { ok: false, message: NOT_SAVED };
    await db().from("exam_question_papers").insert({ slot_id: data.id, status: "waiting", updated_by: staff.id });
  }
  // A changed date sheet has to be looked at again before it is final.
  await db().from("exam_plans").update({ datesheet_checked_at: null }).eq("assessment_id", input.examId);
  done();
  return { ok: true, message: p("Date sheet changed", "डेट शीट बदली") };
}

/** Two papers of one band swap their days and times. */
export async function swapSlotsAction(input: { examId: string; a: string; b: string }): Promise<ActionResult> {
  await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId) || !UUID.test(input.a) || !UUID.test(input.b) || input.a === input.b) return { ok: false, message: RELOAD };
  const slots = await slotsFor(input.examId);
  const a = slots.find((s) => s.id === input.a);
  const b = slots.find((s) => s.id === input.b);
  if (!a || !b || a.group_key !== b.group_key) return { ok: false, message: RELOAD };
  const now = new Date().toISOString();
  const r1 = await db().from("exam_slots").update({ sits_on: b.sits_on, starts_at: b.starts_at, updated_at: now }).eq("id", a.id);
  const r2 = await db().from("exam_slots").update({ sits_on: a.sits_on, starts_at: a.starts_at, updated_at: now }).eq("id", b.id);
  if (r1.error || r2.error) return { ok: false, message: NOT_SAVED };
  await db().from("exam_plans").update({ datesheet_checked_at: null }).eq("assessment_id", input.examId);
  done();
  return { ok: true, message: p(`${a.subject_label} and ${b.subject_label} swapped days`, `${a.subject_label} और ${b.subject_label} के दिन बदले`) };
}

export async function deleteSlotAction(input: { examId: string; slotId: string }): Promise<ActionResult> {
  await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId) || !UUID.test(input.slotId)) return { ok: false, message: RELOAD };
  const { error } = await db().from("exam_slots").delete().eq("id", input.slotId).eq("assessment_id", input.examId);
  if (error) return { ok: false, message: NOT_SAVED };
  done();
  return { ok: true, message: p("Paper taken off the date sheet", "पेपर डेट शीट से हटाया") };
}

/** Start this exam's date sheet from another's: same order, this exam's school days. */
export async function copyDatesheetAction(input: { examId: string; fromExamId: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId) || !UUID.test(input.fromExamId) || input.examId === input.fromExamId) return { ok: false, message: RELOAD };
  const [target, source] = await Promise.all([slotsFor(input.examId), slotsFor(input.fromExamId)]);
  if (target.length) return { ok: false, message: p("This exam already has a date sheet.", "इस परीक्षा की डेट शीट पहले से है।") };
  if (!source.length) return { ok: false, message: p("That exam has no date sheet to copy.", "उस परीक्षा की कोई डेट शीट नहीं है।") };
  const { data: exam } = await db().from("assessments").select("session_label, starts_on, ends_on").eq("id", input.examId).maybeSingle<{ session_label: string; starts_on: string | null; ends_on: string | null }>();
  if (!exam?.starts_on || !exam.ends_on) return { ok: false, message: p("Give this exam its dates first.", "पहले इस परीक्षा की तिथियाँ भरें।") };
  const holidays = await holidaysBetween(exam.session_label, exam.starts_on, exam.ends_on);
  const days = examDays(exam.starts_on, exam.ends_on, holidays);
  const { slots, overflow } = copyOnto(
    source.map((s) => ({ groupKey: s.group_key as never, subject: s.subject_label, day: s.sits_on, start: s.starts_at, minutes: s.minutes })),
    days,
  );
  const { data: inserted, error } = await db()
    .from("exam_slots")
    .insert(slots.map((s, i) => ({ assessment_id: input.examId, group_key: s.groupKey, subject_label: s.subject, sits_on: s.day, starts_at: s.start, minutes: s.minutes, sort_order: i, created_by: staff.id })))
    .select("id")
    .returns<{ id: string }[]>();
  if (error || !inserted) return { ok: false, message: NOT_SAVED };
  await db().from("exam_question_papers").insert(inserted.map((s) => ({ slot_id: s.id, status: "waiting", updated_by: staff.id })));
  await db()
    .from("exam_plans")
    .upsert({ assessment_id: input.examId, copied_from: input.fromExamId, datesheet_checked_at: null, updated_by: staff.id, updated_at: new Date().toISOString() }, { onConflict: "assessment_id" });
  await logActivity({ assessmentId: input.examId, kind: "datesheet", en: `${staff.displayName} copied a date sheet as a draft`, hi: `${staff.displayName} ने डेट शीट कच्ची कॉपी के रूप में बनाई`, actorId: staff.id }).catch(() => undefined);
  done();
  return {
    ok: true,
    message: overflow
      ? p(`Copied. ${overflow} day(s) did not fit — add them by hand.`, `कॉपी हुई। ${overflow} दिन नहीं समाए — उन्हें खुद जोड़ें।`)
      : p("Copied as a draft — check the dates", "कच्ची कॉपी बनी — तिथियाँ जाँचें"),
  };
}

/** "Looks good": the coordinator has checked the dates. */
export async function checkDatesheetAction(input: { examId: string; checked: boolean }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId)) return { ok: false, message: RELOAD };
  const { error } = await db()
    .from("exam_plans")
    .upsert({ assessment_id: input.examId, datesheet_checked_at: input.checked ? new Date().toISOString() : null, updated_by: staff.id, updated_at: new Date().toISOString() }, { onConflict: "assessment_id" });
  if (error) return { ok: false, message: NOT_SAVED };
  done();
  return { ok: true, message: input.checked ? p("Date sheet marked final", "डेट शीट पक्की") : p("Back to draft", "फिर से कच्ची") };
}

/**
 * Publish the date sheet: it becomes final and teachers see it. The message
 * to families is sent from Notices, where every parent send is approved; this
 * does not message anybody.
 */
export async function publishDatesheetAction(input: { examId: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId)) return { ok: false, message: RELOAD };
  const slots = await slotsFor(input.examId);
  if (!slots.length) return { ok: false, message: p("There is nothing on the date sheet yet.", "डेट शीट पर अभी कुछ नहीं है।") };
  const now = new Date().toISOString();
  const { error } = await db()
    .from("exam_plans")
    .upsert({ assessment_id: input.examId, datesheet_checked_at: now, datesheet_published_at: now, datesheet_published_by: staff.id, updated_by: staff.id, updated_at: now }, { onConflict: "assessment_id" });
  if (error) return { ok: false, message: NOT_SAVED };
  await logActivity({ assessmentId: input.examId, kind: "published", en: `${staff.displayName} published the date sheet`, hi: `${staff.displayName} ने डेट शीट प्रकाशित की`, actorId: staff.id }).catch(() => undefined);
  done();
  return { ok: true, message: p("Date sheet published", "डेट शीट प्रकाशित") };
}

/** Fill every room by roll number, two classes to a room in alternate seats. Replaces the old plan. */
export async function fillSeatingAction(input: { examId: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId)) return { ok: false, message: RELOAD };
  const { data: exam } = await db().from("assessments").select("session_label, starts_on, ends_on").eq("id", input.examId).maybeSingle<{ session_label: string; starts_on: string | null; ends_on: string | null }>();
  if (!exam) return { ok: false, message: RELOAD };
  const [classes, roll, roomList] = await Promise.all([classesFor(exam.session_label), enrolmentsFor(exam.session_label), loadRooms()]);
  const today = schoolToday();
  const window = { startsOn: exam.starts_on ?? today, endsOn: exam.ends_on ?? today };
  const seatClasses: SeatClass[] = classes.map((c) => ({
    classId: c.id,
    label: c.label,
    students: roll.filter((e) => e.classId === c.id && onRoll(e, window, today)).map((e) => ({ studentId: e.studentId, roll: e.roll ?? null })),
  }));
  const active = roomList.filter((r) => r.is_active).map((r) => ({ id: r.id, name: r.name, seats: r.seats, cols: r.cols }));
  const { seats, unseated } = seatPlan(active, seatClasses);

  const { error: clearError } = await db().from("exam_seats").delete().eq("assessment_id", input.examId);
  if (clearError) return { ok: false, message: NOT_SAVED };
  for (const chunk of chunkArray(seats, 500)) {
    const { error } = await db()
      .from("exam_seats")
      .insert(chunk.map((s) => ({ assessment_id: input.examId, room_id: s.roomId, seat_no: s.seatNo, class_id: s.classId, student_id: s.studentId, created_by: staff.id })));
    if (error) return { ok: false, message: NOT_SAVED };
  }
  await logActivity({ assessmentId: input.examId, kind: "seating", en: `${staff.displayName} filled the seating · ${seats.length} children`, hi: `${staff.displayName} ने बैठक व्यवस्था बनाई · ${seats.length} बच्चे`, actorId: staff.id }).catch(() => undefined);
  done();
  return {
    ok: true,
    message: unseated
      ? p(`${seats.length} seated · ${unseated} did not fit — add a room`, `${seats.length} बैठे · ${unseated} नहीं समाए — कमरा जोड़ें`)
      : p(`All ${seats.length} children seated`, `सभी ${seats.length} बच्चों की सीट तय`),
  };
}

/** Share invigilation fairly: every room in use has its guards each exam day, fewest duties first. */
export async function shareDutiesAction(input: { examId: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId)) return { ok: false, message: RELOAD };
  const [slots, seats, people] = await Promise.all([slotsFor(input.examId), seatsFor(input.examId), staffList()]);
  if (!slots.length) return { ok: false, message: p("Make the date sheet first.", "पहले डेट शीट बनाएँ।") };
  if (!seats.length) return { ok: false, message: p("Fill the seating first — duties follow the rooms in use.", "पहले बैठक भरें — ड्यूटी उपयोग वाले कमरों से बनती है।") };
  const used = new Map<string, number>();
  for (const s of seats) used.set(s.room_id, (used.get(s.room_id) ?? 0) + 1);
  const days = [...new Set(slots.map((s) => s.sits_on))].sort();
  const teachers = people.filter((s) => s.isTeaching).map((s) => ({ id: s.id, name: s.name }));
  if (!teachers.length) return { ok: false, message: p("No teaching staff to share duties among.", "ड्यूटी बाँटने को कोई शिक्षक नहीं।") };
  const duties = assignDuties({ days, rooms: [...used].map(([id, n]) => ({ id, need: invigilatorsFor(n) })), staff: teachers });

  const { error: clearError } = await db().from("exam_duties").delete().eq("assessment_id", input.examId);
  if (clearError) return { ok: false, message: NOT_SAVED };
  for (const chunk of chunkArray(duties, 500)) {
    const { error } = await db()
      .from("exam_duties")
      .insert(chunk.map((d) => ({ assessment_id: input.examId, sits_on: d.day, room_id: d.roomId, staff_profile_id: d.staffId, created_by: staff.id })));
    if (error) return { ok: false, message: NOT_SAVED };
  }
  done();
  return { ok: true, message: p(`${duties.length} duties shared among ${teachers.length} teachers`, `${duties.length} ड्यूटी ${teachers.length} शिक्षकों में बाँटी`) };
}

const QP_STATUS = ["waiting", "received", "checked", "printed"] as const;

/** Where one question paper has got to. */
export async function setPaperStatusAction(input: { examId: string; slotId: string; status: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  const status = QP_STATUS.find((s) => s === input.status);
  if (!UUID.test(input.examId) || !UUID.test(input.slotId) || !status) return { ok: false, message: RELOAD };
  const { data: slot } = await db().from("exam_slots").select("id").eq("id", input.slotId).eq("assessment_id", input.examId).maybeSingle();
  if (!slot) return { ok: false, message: RELOAD };
  const { error } = await db()
    .from("exam_question_papers")
    .upsert({ slot_id: input.slotId, status, updated_by: staff.id, updated_at: new Date().toISOString() }, { onConflict: "slot_id" });
  if (error) return { ok: false, message: NOT_SAVED };
  done();
  return { ok: true };
}

/** Who sets a question paper. */
export async function setPaperSetterAction(input: { examId: string; slotId: string; staffId: string | null }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId) || !UUID.test(input.slotId) || (input.staffId !== null && !UUID.test(input.staffId))) return { ok: false, message: RELOAD };
  const { error } = await db()
    .from("exam_question_papers")
    .upsert({ slot_id: input.slotId, setter_staff_id: input.staffId, updated_by: staff.id, updated_at: new Date().toISOString() }, { onConflict: "slot_id" });
  if (error) return { ok: false, message: NOT_SAVED };
  done();
  return { ok: true };
}

/** The exam's dates and reporting time, from the plan. */
export async function saveExamTimesAction(input: { examId: string; reportingTime: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId) || !TIME.test(input.reportingTime) || minutesOf(input.reportingTime) < 6 * 60) return { ok: false, message: RELOAD };
  const { error } = await db()
    .from("exam_plans")
    .upsert({ assessment_id: input.examId, reporting_time: input.reportingTime, updated_by: staff.id, updated_at: new Date().toISOString() }, { onConflict: "assessment_id" });
  if (error) return { ok: false, message: NOT_SAVED };
  done();
  return { ok: true };
}
