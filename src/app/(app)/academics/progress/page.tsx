import type { Metadata } from "next";

import { requirePermission } from "@/platform/auth/current-staff";
import { AcadProgress } from "@/vx/screens/academics/progress";
import { param } from "@/vx/screens/academics/ui";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Student progress" };

/** AcadProgress: classes, one class, one child, compare, needs attention, support plan. */
export default async function ProgressPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("marks:view", "/academics/progress");
  const sp = await searchParams;
  return (
    <AcadProgress
      staff={staff}
      view={param(sp.view)}
      exam={param(sp.exam)}
      classId={param(sp.class)}
      studentId={param(sp.student)}
      a={param(sp.a)}
      b={param(sp.b)}
      reason={param(sp.reason)}
    />
  );
}
