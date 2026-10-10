"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  checkAttendanceSaveAction,
  requestCorrectionAction,
  saveAttendanceAction,
} from "@/app/(app)/teach/actions";
import { acknowledgeDutyAction, cannotCoverAction } from "@/app/(app)/duty/[id]/actions";
import { assertPermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolProfile } from "@/platform/config/school";
import { createAdminClient } from "@/platform/supabase/admin";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { findRegister, listMarks } from "@/modules/attendance/data/attendance-repo";
import { heldClassIds } from "@/modules/attendance/data/teaching-repo";
import { idleAttendanceState, type AttendanceSaveState } from "@/modules/attendance/domain/attendance-receipt";
import { idleTeachState } from "@/modules/attendance/domain/teach-state";
import { idleSubsState } from "@/modules/substitutions/domain/form-state";
import { enrolmentForStudent } from "@/modules/students/data/student-repo";
import { dayMonth, schoolToday } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { assertNotPreviewing } from "@/vx/view-as";

import { absentAlert, birthdayWish, changeWindow, leaveRuns } from "./domain/teach";
import { childBasics } from "./students";

/*
 * The teacher screens' writes. Each asks a permission, then refuses while an
 * administrator is previewing another role, then hands over to the action
 * that already does the work (the register save, a correction request, a
 * cover answer) so the business rules stay in one place. Messages to parents
 * are queued only; nothing here sends one.
 */

export type VxResult = { ok: true } | { ok: false; error: Pair };
const fail = (en: string, hi: string): VxResult => ({ ok: false, error: p(en, hi) });

/* ------------------------------------------------------------ the register */

export type VxSaveState = AttendanceSaveState & { queued?: number };

/**
 * Save or change a register from the teacher's screen.
 *
 * A class teacher may change her own register for 30 minutes after first
 * saving it; after that she asks the office (a correction request). The
 * office and admin, who hold `attendance:correct`, are not held to the
 * window. With `alerts`, the absent children's parents get a 10 am message
 * queued — never sent from here.
 */
export async function saveRegisterVx(payloadJson: string, alerts: boolean): Promise<VxSaveState> {
  const actor = await assertPermission("attendance:view");
  await assertNotPreviewing();

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

  if (payload.kind === "correction" && !can(actor, "attendance:correct")) {
    const register = await findRegister(payload.classId, sessionLabel, payload.day, null);
    const window = changeWindow(register?.submittedAt ?? null, new Date());
    if (!window.open) {
      return {
        status: "refused",
        message: {
          en: "The 30 minutes to change it yourself are over. Ask the office to change it.",
          hi: "ख़ुद बदलने के 30 मिनट पूरे हो गए। ऑफ़िस से बदलने को कहें।",
        },
      };
    }
  }

  const form = new FormData();
  form.set("payload", payloadJson);
  const result = await saveAttendanceAction(idleAttendanceState, form);
  if (result.status !== "saved") return result;

  // Absent alerts follow the register as saved: queue the absent children,
  // cancel any queued for a child who is no longer absent.
  const queued = await syncAbsentAlerts({
    registerId: result.receipt.registerId,
    classId: payload.classId,
    day: payload.day,
    sessionLabel,
    actorId: actor.id,
    wanted: alerts,
  }).catch(() => 0);

  revalidatePath("/teach");
  revalidatePath("/teach/class");
  return { ...result, queued };
}

async function syncAbsentAlerts(input: { registerId: string; classId: string; day: string; sessionLabel: string; actorId: string; wanted: boolean }): Promise<number> {
  const admin = createAdminClient();
  const [marks, existing] = await Promise.all([
    listMarks(input.registerId),
    admin
      .from("parent_message_queue")
      .select("id, student_id")
      .eq("register_id", input.registerId)
      .eq("kind", "absent_alert")
      .eq("status", "queued")
      .returns<{ id: string; student_id: string }[]>(),
  ]);
  const absent = [...marks.entries()].filter(([, m]) => m.status === "absent").map(([id]) => id);
  const have = new Map((existing.data ?? []).map((r) => [r.student_id, r.id]));
  const keep = new Set(input.wanted ? absent : []);

  const drop = [...have.entries()].filter(([id]) => !keep.has(id)).map(([, rowId]) => rowId);
  if (drop.length) {
    await admin
      .from("parent_message_queue")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: input.actorId })
      .in("id", drop);
  }

  const add = [...keep].filter((id) => !have.has(id));
  if (add.length) {
    const [names, labels] = await Promise.all([childBasics(add), classLabelMap(input.sessionLabel)]);
    const classLabel = labels.get(input.classId) ?? "";
    await admin.from("parent_message_queue").insert(
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
  }
  return keep.size;
}

/** Did a save with this id land? Asked before resending after a lost answer. */
export async function checkRegisterVx(commandId: string): Promise<AttendanceSaveState> {
  await assertPermission("attendance:view");
  return checkAttendanceSaveAction(commandId);
}

/** "Ask the office to change it": a correction request for one child. */
export async function askChangeVx(input: { registerId: string; studentId: string; toStatus: string; reason: string }): Promise<VxResult> {
  await assertPermission("attendance:view");
  await assertNotPreviewing();
  const form = new FormData();
  form.set("registerId", input.registerId);
  form.set("studentId", input.studentId);
  form.set("toStatus", input.toStatus);
  form.set("reason", input.reason);
  const result = await requestCorrectionAction(idleTeachState, form);
  if (result.status === "saved") {
    revalidatePath("/teach/attendance");
    return { ok: true };
  }
  return { ok: false, error: result.message ?? p("Not sent. Try again.", "नहीं भेजा गया। फिर कोशिश करें।") };
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
  revalidatePath("/teach/more");
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
