import type { NextRequest } from "next/server";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { addDays, isMonday, isUuid, onListThatWeek, sortToilets, weekStartOf } from "@/modules/toilets/domain/checks";
import { readToilets } from "@/modules/toilets/data/read";
import { assertPermission } from "@/platform/auth/current-staff";
import { schoolNow } from "@/platform/auth/qa-clock";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { schoolToday } from "@/vx/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The printed weekly chart (D-652): `?week=<Monday>&toilet=<id|all>`, one A4
 * landscape page per toilet, for `toilets:view`. Any week from twelve back to
 * two ahead, so Saturday's office can print Monday's sheets.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const week = url.searchParams.get("week");
  const which = url.searchParams.get("toilet") ?? "all";
  if (!isMonday(week) || (which !== "all" && !isUuid(which))) return new Response("Not found.", { status: 404 });

  let staff;
  try {
    staff = await assertPermission("toilets:view");
  } catch {
    return new Response("You cannot print toilet charts.", { status: 403 });
  }

  try {
    const session = await resolveSessionLabel();
    if (!session) return new Response("No school year is open.", { status: 404 });
    const today = schoolToday(await schoolNow(staff));
    const current = weekStartOf(today);
    if (week > addDays(current, 14) || week < addDays(current, -7 * 12)) return new Response("Choose a nearer week.", { status: 400 });
    const data = await readToilets(session, today);
    if (!data.ready) return new Response("Toilet checks is being set up.", { status: 503 });

    const toilets = sortToilets(data.toilets).filter((t) => (which === "all" ? onListThatWeek(t, week) : t.id === which && !t.removedAt));
    if (!toilets.length) return new Response("No toilet to print.", { status: 404 });

    const origin = url.origin;
    const pages = toilets.map((toilet) => ({ toilet, uploadUrl: `${origin}/toilets?upload=${toilet.id}&week=${week}` }));
    const { renderToiletChartsPdf } = await import("@/modules/toilets/ui/chart-pdf");
    const buffer = await renderToiletChartsPdf({ pages, weekStart: week, settings: data.settings, isOpen: data.isOpen, test: isTestSessionLabel(session) });
    const name = which === "all" ? `toilet-charts-${week}` : `toilet-chart-${week}-${toilets[0].name}`;
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename="${name.replace(/[^a-z0-9-]/gi, "_")}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[toilet-chart-pdf] failed", error);
    return new Response("Could not make the chart. Please try again.", { status: 500 });
  }
}
