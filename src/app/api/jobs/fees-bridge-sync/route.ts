import { NextResponse } from "next/server";
import { isPlatformCron } from "@/modules/jobs/domain/token";
import { runFeesBridgeSync } from "@/modules/coexistence/data/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!isPlatformCron(process.env.FEES_BRIDGE_CRON_SECRET, request.headers.get("authorization"))) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const forceVerification = new URL(request.url).searchParams.get("verify") === "1";
    return NextResponse.json({ ok: true, ...await runFeesBridgeSync({ forceVerification }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && /^bridge_[a-z0-9_]+$/.test(error.message) ? error.message : "bridge_sync_failed";
    return NextResponse.json({ ok: false, code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
