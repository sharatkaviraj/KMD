import type { NextRequest } from "next/server";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { isUuid } from "@/modules/toilets/domain/checks";
import { chartPages } from "@/modules/toilets/data/read";
import { pageBytes } from "@/modules/toilets/data/writes";
import { assertPermission } from "@/platform/auth/current-staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One page of an uploaded toilet chart (D-652), for `toilets:view`. The
 * photos sit on a private shelf; this reads them with the server's key, only
 * for a chart of the session this account is on, and never lets a browser or
 * a shared cache keep a copy.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ chartId: string; page: string }> }) {
  const { chartId, page } = await params;
  const n = Number(page);
  if (!isUuid(chartId) || !Number.isInteger(n) || n < 1 || n > 4) return new Response("Not found.", { status: 404 });
  try {
    await assertPermission("toilets:view");
  } catch {
    return new Response("You cannot see toilet charts.", { status: 403 });
  }
  const session = await resolveSessionLabel();
  if (!session) return new Response("Not found.", { status: 404 });
  const chart = await chartPages(session, chartId).catch(() => null);
  const path = chart?.pages[n - 1];
  if (!path) return new Response("Not found.", { status: 404 });
  const bytes = await pageBytes(path).catch(() => null);
  if (!bytes) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="toilet-chart-${chart!.weekStart}-${n}.jpg"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
