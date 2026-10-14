import type { Metadata } from "next";

import { requirePermission } from "@/platform/auth/current-staff";
import { SchoolCalendar } from "@/vx/screens/calendar/calendar";
import { param } from "@/vx/screens/academics/ui";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Calendar" };

/** School calendar: month, next 30 days, holidays, a day, an event; add and notify sheets. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("academics:view", "/calendar");
  const sp = await searchParams;
  return (
    <SchoolCalendar
      staff={staff}
      view={param(sp.view)}
      month={param(sp.month)}
      day={param(sp.day)}
      eventId={param(sp.event)}
      sheet={param(sp.sheet)}
      holiday={param(sp.holiday)}
      hide={param(sp.hide)}
      kind={param(sp.kind)}
    />
  );
}
