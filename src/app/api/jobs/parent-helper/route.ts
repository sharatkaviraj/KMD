import { NextResponse } from "next/server";

import { isPlatformCron } from "@/modules/jobs/domain/token";
import { liveRelayDeps, runDueHandoffs } from "@/modules/whatsapp/data/helper-relay";
import { logWarn } from "@/platform/observability/log";
import { queueSecretMatches } from "@/platform/whatsapp/store";

/**
 * Veer Patta AI's hand-offs (D-578): the alerts, reminders and passing-up
 * that are due. A message that reached the school at night is told at 6 am;
 * nobody answered in 3 hours, a reminder; a complaint still unanswered a day
 * later, an admin. Never between 9 pm and 6 am in India.
 *
 * Called by pg_cron every five minutes, and only when a step is due
 * (`parent-helper`, migration 20261112052103), with the WhatsApp queue's
 * Bearer secret, which lives in Vault and is checked in Postgres
 * (`whatsapp_queue_secret_matches`); `CRON_SECRET` also opens it, for an
 * operator. Anything else is a 404. Every message still passes
 * `checkWhatsAppSend`, so practice mode or the helper switched off stops it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NOT_HERE = () => new NextResponse("Not found", { status: 404 });

async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization");
  if (isPlatformCron(process.env.CRON_SECRET, header)) return true;
  const bearer = /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1] ?? "";
  return bearer ? queueSecretMatches(bearer).catch(() => false) : false;
}

export async function POST(request: Request) {
  if (!(await authorized(request))) return NOT_HERE();
  try {
    const counts = await runDueHandoffs(liveRelayDeps(), { limit: 10, budgetMs: 40_000 });
    return NextResponse.json({ ok: true, ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    logWarn("jobs.parent_helper.failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
