"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import {
  checkAttendanceSaveAction,
  saveAttendanceAction,
} from "@/app/(app)/teach/actions";
import { acknowledgeDutyAction, cannotCoverAction } from "@/app/(app)/duty/[id]/actions";
import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { schoolProfile } from "@/platform/config/school";
import { CACHE_TAGS, expireTag } from "@/platform/performance/shared-cache";
import { createAdminClient } from "@/platform/supabase/admin";
import { chunkArray } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listMarks } from "@/modules/attendance/data/attendance-repo";
import { heldClassIds } from "@/modules/attendance/data/teaching-repo";
import { idleAttendanceState, type AttendanceSaveState } from "@/modules/attendance/domain/attendance-receipt";
import { idleSubsState } from "@/modules/substitutions/domain/form-state";
import { enrolmentForStudent } from "@/modules/students/data/student-repo";
import { dayMonth, schoolToday } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { assertNotPreviewing } from "@/vx/view-as";

import { getPublishedVersion, listSlots } from "@/modules/timetable/data/timetable-repo";
import { dayHeaders } from "@/modules/attendance/data/teaching-repo";
import { matchDayHeader } from "@/modules/timetable/domain/weekday";
import { leavePeriods, leaveSpanFor, type LeaveDayPeriods, type LeaveSpan } from "@/vx/screens/timetable/domain/timetable";
import { absentAlertChanges } from "@/vx/screens/messages/domain/outbox";

import { absentAlert, birthdayWish, leaveRuns } from "./domain/teach";
import { childBasics } from "./students";

/*
 * The teacher screens' writes. Each asks a permission, then refuses while an
 * administrator is previewing another role, then hands over to the action
 * that already does the work (the register save, a cover answer) so the business rules stay in one place. Messages to parents
 * are queued only; nothing here sends one.
 */

export type VxResult = { ok: true } | { ok: false; error: Pair };
const fail = (en: string, hi: string): VxResult => ({ ok: false, error: p(en, hi) });

/* ------------------------------------------------------------ the register */

export type VxSaveState = AttendanceSaveState & { queued?: number; queueWarning?: Pair };

/**
 * Save or change a register from the teacher's screen.
 *
 * A class teacher may change her own register whenever she needs to, with a
 * reason; nobody approves it (D-248). The office and admin, who hold
 * `attendance:correct`, may change any register. With `alerts`, the absent children's parents get a 10 am message
 * queued — never sent from here.
 */
/**
 * A server-side failure comes back as "refused" with its reason. Only a save
 * that never got an answer throws on the phone, and only that goes to the
 * offline outbox; before, a permission or database error was retried forever
 * as "waiting to send" and the teacher never saw why.
 */
export async function saveRegisterVx(payloadJson: string, alerts: boolean): Promise<VxSaveState> {
  try {
    const actor = await assertPermission("attendance:view");
    await assertNotPreviewing();
    return await saveRegisterVxUnsafe(actor, payloadJson, alerts);
  } catch (error) {
    unstable_rethrow(error);
    const reason = error instanceof Error && error.message ? error.message : "Something went wrong.";
    return { status: "refused", message: { en: `Not saved: ${reason}`, hi: `सहेजा नहीं गया: ${reason}` } };
  }
}

async function saveRegisterVxUnsafe(actor: CurrentStaff, payloadJson: string, alerts: boolean): Promise<VxSaveState> {
  let payload: { classId?: string; day?: string; kind?: string; marks?: { studentId: string; status: string }[] };
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return { status: "refused", message: { en: "The register could not be read. Reload and try again.", hi: "हाज़िरी पढ़ी नहीं जा सकी। पेज फिर खोलें।" } };
  }

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel || !payload.classId || !payload.day) {
    return { status: "refused", message: { en: "Choose a class and a day.", hi: "कक्षा और दिन चुनें।" } };
  }

  const form = new FormData();
  form.set("payload", payloadJson);
  const result = await saveAttendanceAction(idleAttendanceState, form);
  if (result.status !== "saved") return result;

  // Absent alerts follow the register as saved: queue the absent children,
  // cancel any queued for a child who is no longer absent.
  let queued: number | undefined;
  let queueWarning: Pair | undefined;
  try {
    queued = await syncAbsentAlerts({
      registerId: result.receipt.registerId,
      classId: payload.classId,
      day: payload.day,
      sessionLabel,
      actorId: actor.id,
      wanted: alerts,
    });
  } catch {
    queueWarning = p("Attendance saved. The parent message queue could not be updated. Ask the office to review it.", "उपस्थिति सहेजी गई। अभिभावक संदेशों की कतार अपडेट नहीं हुई। ऑफ़िस से जाँच करने को कहें।");
  }

  revalidatePath("/teach");
  revalidatePath("/teach/class");
  return { ...result, queued, queueWarning };
}

async function syncAbsentAlerts(input: { registerId: string; classId: string; day: string; sessionLabel: string; actorId: string; wanted: boolean }): Promise<number> {
  const admin = createAdminClient();
  const [marks, existing] = await Promise.all([
    listMarks(input.registerId),
    admin
      .from("parent_message_queue")
      .select("id, student_id, status")
      .eq("register_id", input.registerId)
      .eq("kind", "absent_alert")
      .neq("status", "cancelled")
      .returns<{ id: string; student_id: string; status: string }[]>(),
  ]);
  if (existing.error) throw existing.error;
  const absent = [...marks.entries()].filter(([, m]) => m.status === "absent").map(([id]) => id);
  // A sent message counts as the child's message: a correction never queues it again.
  const { drop, add, keep } = absentAlertChanges(absent, input.wanted, (existing.data ?? []).map((row) => ({ id: row.id, studentId: row.student_id, status: row.status })));
  for (const ids of chunkArray(drop, IN_FILTER_CHUNK_SIZE)) {
    const { error } = await admin
      .from("parent_message_queue")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: input.actorId })
      .in("id", ids).eq("status", "queued");
    if (error) throw error;
  }

  if (add.length) {
    const [names, labels] = await Promise.all([childBasics(add), classLabelMap(input.sessionLabel)]);
    const classLabel = labels.get(input.classId) ?? "";
    const { error } = await admin.from("parent_message_queue").insert(
      add.map((studentId) => {
        const text = absentAlert({ childName: names.get(studentId)?.fullName ?? "", classLabel, dayLabel: dayMonth(input.day), school: schoolProfile.shortName });
        return {
          session_label: input.sessionLabel,
          kind: "absent_alert",
          student_id: studentId,
          class_id: input.classId,
          register_id: input.registerId,
          day: input.day,
          body_hi: text.hi,
          body_en: text.en,
          queued_by: input.actorId,
        };
      }),
    );
    if (error) throw error;
  }
  return keep;
}

/** Did a save with this id land? Asked before resending after a lost answer. */
export async function checkRegisterVx(commandId: string): Promise<AttendanceSaveState> {
  await assertPermission("attendance:view");
  return checkAttendanceSaveAction(commandId);
}

/* ------------------------------------------------------------ cover duty */

export async function answerCoverVx(dutyId: string, answer: "acknowledge" | "cannot_cover", note: string): Promise<VxResult> {
  await assertPermission("substitutions:view");
  await assertNotPreviewing();
  const form = new FormData();
  form.set("dutyId", dutyId);
  form.set("note", String(note ?? "").slice(0, 200));
  const result = answer === "acknowledge" ? await acknowledgeDutyAction(idleSubsState, form) : await cannotCoverAction(idleSubsState, form);
  if (result.status === "saved") return { ok: true };
  return { ok: false, error: result.message ?? p("Not saved. Try again.", "सहेजा नहीं गया।") };
}

/* -------------------------------------------------------------- notices */

const UUID = z.uuid();

export async function noticeSeenVx(campaignIds: string[]): Promise<VxResult> {
  const staff = await assertPermission("attendance:view");
  await assertNotPreviewing();
  const ids = (Array.isArray(campaignIds) ? campaignIds : []).filter((id) => UUID.safeParse(id).success).slice(0, 100);
  if (ids.length === 0) return { ok: true };
  const { error } = await createAdminClient()
    .from("staff_notice_reads")
    .upsert(ids.map((id) => ({ campaign_id: id, staff_profile_id: staff.id })), { onConflict: "campaign_id,staff_profile_id", ignoreDuplicates: true });
  if (error) return fail("Not saved. Try again.", "सहेजा नहीं गया। फिर कोशिश करें।");
  revalidatePath("/teach");
  revalidatePath("/teach/more");
  return { ok: true };
}

/* ---------------------------------------------------------------- leave */

const leaveSchema = z.object({
  days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(30),
  span: z.enum(["full", "first_half", "second_half"]),
  reason: z.string().trim().max(60),
  note: z.string().trim().max(300),
});

/** Leave goes to the admin as one `teacher_leave` row per run of days, asked, never approved here. */
export async function requestLeaveVx(input: z.input<typeof leaveSchema>): Promise<VxResult> {
  const staff = await assertPermission("attendance:view");
  await assertNotPreviewing();
  const parsed = leaveSchema.safeParse(input);
  if (!parsed.success) return fail("Pick the days first.", "पहले दिन चुनें।");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return fail("There is no school session yet.", "अभी कोई सत्र नहीं है।");
  const today = schoolToday();
  const runs = leaveRuns(parsed.data.days.filter((d) => d >= today));
  if (runs.length === 0) return fail("Leave can be asked for today or later.", "छुट्टी आज या आगे के दिनों के लिए ही माँगी जा सकती है।");
  const half = runs.length === 1 && runs[0].from === runs[0].to ? parsed.data.span : "full";
  const note = [parsed.data.reason, parsed.data.note].filter(Boolean).join(" · ") || null;
  const { error } = await createAdminClient()
    .from("teacher_leave")
    .insert(runs.map((r) => ({ session_label: sessionLabel, staff_profile_id: staff.id, from_day: r.from, to_day: r.to, span: half, note, status: "asked", requested_by: staff.id })));
  if (error) return fail("Not sent. Try again.", "नहीं भेजा गया। फिर कोशिश करें।");
  revalidatePath("/teach/more");
  revalidatePath("/inbox");
  return { ok: true };
}

const previewSchema = z.object({
  days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(30),
  span: z.enum(["full", "first_half", "second_half"]),
});

/**
 * Which of her periods a leave would cover, before she sends it (B11): her
 * slots in the published timetable on each day, through `leavePeriods()`,
 * the resolver the approval's cover command also follows. Reads only.
 */
export async function previewLeaveVx(input: z.input<typeof previewSchema>): Promise<{ ok: true; span: LeaveSpan; days: LeaveDayPeriods[] } | { ok: false }> {
  const staff = await assertPermission("attendance:view");
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { ok: false };
  const published = await getPublishedVersion(sessionLabel).catch(() => null);
  const span = leaveSpanFor(parsed.data.days.length, parsed.data.span);
  if (!published) return { ok: true, span, days: parsed.data.days.map((day) => ({ day, periods: [] })) };
  const [headers, slots] = await Promise.all([dayHeaders(published.id), listSlots(published.id)]);
  const mine = slots.filter((s) => s.staffProfileId === staff.id);
  const days = parsed.data.days.map((day) => {
    const header = matchDayHeader(headers, day);
    return { day, slots: header ? mine.filter((s) => s.day === header).map((s) => ({ period: s.period, classLabel: s.classLabel })) : [] };
  });
  return { ok: true, span, days: leavePeriods(days, span) };
}

export async function cancelLeaveVx(leaveId: string): Promise<VxResult> {
  const staff = await assertPermission("attendance:view");
  await assertNotPreviewing();
  if (!UUID.safeParse(leaveId).success) return fail("Not found.", "नहीं मिला।");
  const { error } = await createAdminClient()
    .from("teacher_leave")
    .update({ status: "cancelled" })
    .eq("id", leaveId)
    .eq("staff_profile_id", staff.id)
    .eq("status", "asked");
  if (error) return fail("Not saved. Try again.", "सहेजा नहीं गया।");
  revalidatePath("/teach/more");
  return { ok: true };
}

/* ---------------------------------------------------------- preferences */

export async function setTextSizeVx(large: boolean): Promise<VxResult> {
  const staff = await assertPermission("attendance:view");
  await assertNotPreviewing();
  const { error } = await createAdminClient()
    .from("staff_ui_preferences")
    .upsert({ staff_profile_id: staff.id, large_text: Boolean(large), updated_at: new Date().toISOString() }, { onConflict: "staff_profile_id" });
  if (error) return fail("Not saved. Try again.", "सहेजा नहीं गया।");
  // The shell caches large text per person (perf fix 10).
  expireTag(CACHE_TAGS.uiPrefs);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setAlertVx(key: string, on: boolean): Promise<VxResult> {
  const staff = await assertPermission("attendance:view");
  await assertNotPreviewing();
  if (!["notices", "cover", "followups", "marks"].includes(key)) return fail("Not saved.", "सहेजा नहीं गया।");
  const admin = createAdminClient();
  const { data } = await admin.from("staff_ui_preferences").select("alerts").eq("staff_profile_id", staff.id).maybeSingle<{ alerts: Record<string, boolean> | null }>();
  const alerts = { ...(data?.alerts ?? {}), [key]: Boolean(on) };
  const { error } = await admin
    .from("staff_ui_preferences")
    .upsert({ staff_profile_id: staff.id, alerts, updated_at: new Date().toISOString() }, { onConflict: "staff_profile_id" });
  if (error) return fail("Not saved. Try again.", "सहेजा नहीं गया।");
  revalidatePath("/teach/more");
  return { ok: true };
}

/* ------------------------------------------------------------ birthdays */

/** Queue a birthday wish to a child's parents — the class teacher's own class only. */
export async function queueBirthdayWishVx(studentId: string): Promise<VxResult> {
  const staff = await assertPermission("attendance:view");
  await assertNotPreviewing();
  if (!UUID.safeParse(studentId).success) return fail("Not found.", "नहीं मिला।");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return fail("Not saved.", "सहेजा नहीं गया।");
  const [held, placement] = await Promise.all([heldClassIds(staff.id, sessionLabel), enrolmentForStudent(studentId, sessionLabel)]);
  if (!placement || !held.includes(placement.classId)) return fail("Only the class teacher sends birthday wishes.", "जन्मदिन की शुभकामना कक्षा अध्यापक भेजते हैं।");
  const today = schoolToday();
  const admin = createAdminClient();
  const { data: already } = await admin
    .from("parent_message_queue")
    .select("id")
    .eq("kind", "birthday")
    .eq("student_id", studentId)
    .eq("day", today)
    .eq("status", "queued")
    .limit(1)
    .returns<{ id: string }[]>();
  if (already?.length) return { ok: true };
  const name = (await childBasics([studentId])).get(studentId)?.fullName ?? "";
  const text = birthdayWish({ childName: name, school: schoolProfile.shortName });
  const { error } = await admin.from("parent_message_queue").insert({
    session_label: sessionLabel,
    kind: "birthday",
    student_id: studentId,
    class_id: placement.classId,
    day: today,
    body_hi: text.hi,
    body_en: text.en,
    queued_by: staff.id,
  });
  if (error) return fail("Not saved. Try again.", "सहेजा नहीं गया।");
  return { ok: true };
}
