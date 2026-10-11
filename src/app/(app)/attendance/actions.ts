"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { assertPermission } from "@/platform/auth/current-staff";
import { saveAttendanceAction } from "@/app/(app)/teach/actions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { idleAttendanceState, type AttendanceSaveState } from "@/modules/attendance/domain/attendance-receipt";
import { dispatchStaffNotices } from "@/modules/staff-notices/data/dispatcher";
import { schoolToday } from "@/vx/format";
import { queueAttendanceReminders } from "@/vx/screens/admin/data";
import { assertNotPreviewing } from "@/vx/view-as";
import type { Pair } from "@/vx/text";

/*
 * The attendance board (P5). Marking goes through the one register save the
 * teacher's screen uses (`saveAttendanceAction`): the payload, the revision
 * check, the roster check and the on-behalf authority are all its own. This
 * file only adds the board's permission and the preview guard in front.
 */

export async function saveRegisterVx(payload: string): Promise<AttendanceSaveState> {
  await assertPermission("attendance:mark_on_behalf");
  await assertNotPreviewing();
  const form = new FormData();
  form.set("payload", payload);
  const state = await saveAttendanceAction(idleAttendanceState, form);
  if (state.status === "saved") {
    revalidatePath("/attendance");
    revalidatePath("/inbox");
    revalidatePath("/");
  }
  return state;
}

export async function remindTeachersVx(classIds: string[], scope?: { day: string; sessionLabel: string; commandId: string }): Promise<{ ok: boolean; queued: number; message?: Pair }> {
  await assertPermission("attendance:mark_on_behalf");
  await assertNotPreviewing();
  const sessionLabel = await resolveSessionLabel();
  if (scope && (scope.sessionLabel !== sessionLabel || scope.day !== schoolToday())) return { ok: false, queued: 0, message: { en: "The reminder day or session changed. Reload.", hi: "याद दिलाने का दिन या सत्र बदला। फिर से खोलें।" } };
  if (!sessionLabel) return { ok: false, queued: 0, message: { en: "No academic session is set up yet.", hi: "अभी कोई सत्र नहीं बना है।" } };

  let queued = 0;
  try {
    queued = await queueAttendanceReminders(sessionLabel, scope?.day ?? schoolToday(), classIds, scope?.commandId);
  } catch {
    return { ok: false, queued: 0, message: { en: "Could not queue the reminders.", hi: "याद दिलाने के संदेश नहीं भेजे जा सके।" } };
  }
  // Sent after the response: a provider outage never fails the tap, and the
  // 10 a.m. job is the safety net for anything left pending (P4).
  if (queued > 0) after(() => dispatchStaffNotices({ max: queued + 5 }).catch(() => undefined));
  revalidatePath("/attendance");
  revalidatePath("/inbox");
  revalidatePath("/");
  return { ok: true, queued };
}
