import { type NextRequest, NextResponse } from "next/server";

import { getCurrentStaff } from "@/platform/auth/current-staff";
import { smokeLabEnabled } from "@/platform/auth/smoke-lab";
import { listFindings, runHeader } from "@/modules/smoke/data/smoke-repo";
import { findingsMarkdown } from "@/modules/smoke/domain/smoke";
import { isSmokeEmail } from "@/modules/smoke/domain/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `/smoke/runs/<id>/export` — a run's open findings as Markdown (admin, test database). */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "admin" || staff.smokeLab || isSmokeEmail(staff.email) || !smokeLabEnabled()) return new NextResponse("Not found", { status: 404 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const run = await runHeader(id);
  if (!run) return new NextResponse("Not found", { status: 404 });
  const body = findingsMarkdown(run, await listFindings(id));
  return new NextResponse(body, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `inline; filename="smoke-run-${id.slice(0, 8)}.md"` } });
}
