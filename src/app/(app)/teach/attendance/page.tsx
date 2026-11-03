import { schoolNow } from "@/platform/auth/qa-clock";
import { requirePermission } from "@/platform/auth/current-staff";
import { schoolProfile } from "@/platform/config/school";
import { schoolToday } from "@/vx/format";
import { loadAttendance } from "@/vx/screens/teach/data";
import { AttendChoose, TeachAttend } from "@/vx/screens/teach/ui/attend";
import { TeachEmpty } from "@/vx/screens/teach/ui/empty";

import { chooserContext, registerContext } from "./context";

export const runtime = "nodejs";

export const metadata = { title: "Attendance" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * TchAttend: mark (default), `?sheet=save|change|help`, `?view=history`
 * (`&month=`), the saved and change states follow the register itself.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("attendance:view", "/teach/attendance");
  const sp = await searchParams;
  const classParam = one(sp.class);
  const dayParam = one(sp.day);
  const monthParam = one(sp.month);
  // The school's today by the reader's clock, as Today and the timetable read
  // it — the bare clock opened the register on a different day (smoke run).
  const today = schoolToday(await schoolNow(staff));
  const data = await loadAttendance(staff, {
    classId: classParam && UUID.test(classParam) ? classParam : null,
    day: dayParam && DAY.test(dayParam) ? dayParam : today,
    month: monthParam && MONTH.test(monthParam) ? monthParam : null,
  });
  const title = { en: "Attendance", hi: "हाज़िरी" };
  if (data.kind === "no-session") return <TeachEmpty kind="no-session" title={title} back="/teach" />;
  if (data.kind === "not-yours") return <TeachEmpty kind="not-yours" title={title} back="/teach/attendance" />;
  if (data.kind === "choose") return <AttendChoose data={data} ownerId={staff.id} context={await chooserContext(data, today).catch(() => null)} />;
  const context = await registerContext(data, today).catch(() => undefined);
  // Keyed by the register it shows: a link to another day or class of this
  // same screen mounts a fresh register instead of keeping the last one's
  // marks, mode and month view ("Mark now" did nothing; a saved card showed
  // unsaved counts — 20 Oct smoke run, P1).
  return (
    <TeachAttend
      key={`${data.classId}:${data.day}:${data.month}`}
      data={data}
      ownerId={staff.id}
      initialSheet={one(sp.sheet) ?? null}
      initialView={one(sp.view) ?? null}
      school={schoolProfile.shortName}
      officePhone={schoolProfile.phone}
      context={context}
    />
  );
}
