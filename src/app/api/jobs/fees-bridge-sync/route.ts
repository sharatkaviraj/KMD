import { NextResponse } from "next/server";
import { isPlatformCron } from "@/modules/jobs/domain/token";
import { runFeesBridgeSync } from "@/modules/coexistence/data/sync";
import { refreshRouteCopy } from "@/modules/transport/data/routes";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!isPlatformCron(process.env.FEES_BRIDGE_CRON_SECRET, request.headers.get("authorization"))) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const forceVerification = new URL(request.url).searchParams.get("verify") === "1";
    const result = await runFeesBridgeSync({ forceVerification });
    // Transport's route names ride on the same nightly run (D-550, never more often:
    // D-457). Best effort: a failure here is recorded on its own row and never
    // fails the roster copy.
    const routes = await refreshRouteCopy({ force: true }).catch(() => ({ ok: false as const, code: "transport_routes_failed" }));
    return NextResponse.json({ ok: true, ...result, routes }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && /^bridge_[a-z0-9_]+$/.test(error.message) ? error.message : "bridge_sync_failed";
    return NextResponse.json({ ok: false, code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
