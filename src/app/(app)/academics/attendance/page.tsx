import type { Metadata } from "next";

import { requirePermission } from "@/platform/auth/current-staff";
import { AcadAttendance } from "@/vx/screens/academics/attendance";
import { param } from "@/vx/screens/academics/ui";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Attendance" };

/** AcadAttendance: today, month, below 75%, change requests, class register. */
export default async function AttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("attendance:view", "/academics/attendance");
  const sp = await searchParams;
  return (
    <AcadAttendance
      staff={staff}
      view={param(sp.view)}
      sheet={param(sp.sheet)}
      classId={param(sp.class)}
      month={param(sp.month)}
      studentId={param(sp.student)}
      filter={param(sp.filter)}
    />
  );
}
