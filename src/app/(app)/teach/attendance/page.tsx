import { requirePermission } from "@/platform/auth/current-staff";
import { schoolProfile } from "@/platform/config/school";
import { schoolToday } from "@/vx/format";
import { loadAttendance } from "@/vx/screens/teach/data";
import { AttendChoose, TeachAttend } from "@/vx/screens/teach/ui/attend";
import { TeachEmpty } from "@/vx/screens/teach/ui/empty";

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
  const data = await loadAttendance(staff, {
    classId: classParam && UUID.test(classParam) ? classParam : null,
    day: dayParam && DAY.test(dayParam) ? dayParam : schoolToday(),
    month: monthParam && MONTH.test(monthParam) ? monthParam : null,
  });
  const title = { en: "Attendance", hi: "हाज़िरी" };
  if (data.kind === "no-session") return <TeachEmpty kind="no-session" title={title} back="/teach" />;
  if (data.kind === "not-yours") return <TeachEmpty kind="not-yours" title={title} back="/teach/attendance" />;
  if (data.kind === "choose") return <AttendChoose data={data} />;
  // eslint-disable-next-line react-hooks/purity -- the server's clock, read once per request and handed to the client to tick.
  const serverNow = Date.now();
  return <TeachAttend data={data} ownerId={staff.id} initialSheet={one(sp.sheet) ?? null} initialView={one(sp.view) ?? null} serverNow={serverNow} school={schoolProfile.shortName} />;
}
