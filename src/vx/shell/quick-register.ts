"use server";

import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { isSchoolOpen } from "@/modules/academics/domain/calendar";
import { attendanceCalendar, registersForDay } from "@/modules/attendance/data/attendance-repo";
import { heldClassIds } from "@/modules/attendance/data/teaching-repo";
import { assertPermission } from "@/platform/auth/current-staff";
import { schoolNow } from "@/platform/auth/qa-clock";
import { logWarn } from "@/platform/observability/log";
import { schoolToday } from "@/vx/format";
import { classWord } from "@/vx/screens/teach/domain/today";

import { summariseRegisters, type QuickRegister } from "./quick-logic";

/**
 * The line on a class teacher's "Mark attendance" card in the "+" sheet
 * (D-643): asked once when the sheet opens, never on page load, so no screen
 * pays for it. Four small reads, three of them cached, the same ones Today
 * makes; the register read goes through the person's own client, so RLS
 * shows them their classes only. Null when anything fails: the card then
 * says nothing rather than something untrue.
 */
export async function quickRegisterAction(): Promise<QuickRegister | null> {
  const staff = await assertPermission("attendance:mark");
  try {
    const sessionLabel = await resolveSessionLabel();
    if (!sessionLabel) return null;
    const today = schoolToday(await schoolNow(staff));
    const [calendar, held, registers, labels] = await Promise.all([
      attendanceCalendar(sessionLabel),
      heldClassIds(staff.id, sessionLabel, today),
      registersForDay(sessionLabel, today),
      classLabelMap(sessionLabel),
    ]);
    return summariseRegisters({
      open: isSchoolOpen(today, calendar),
      held,
      registers,
      label: (classId) => classWord(labels.get(classId) ?? ""),
    });
  } catch (error) {
    logWarn("quick.register", { message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
