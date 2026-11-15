import { NextResponse } from "next/server";

import { liveChatNudgeDeps, runChatNudges } from "@/modules/chats/data/nudges";
import { isPlatformCron } from "@/modules/jobs/domain/token";
import { logWarn } from "@/platform/observability/log";
import { queueSecretMatches } from "@/platform/whatsapp/store";

/**
 * Parent chats' WhatsApp nudges (D-616): a parent waiting in a chat, and
 * nobody on its desk has opened it. Each person on the desk gets one message
 * with a link that opens their whole Chats section; a reminder if it still
 * waits; after a day, the admins too. Never at night in India.
 *
 * Called by pg_cron every two minutes, and only when a nudge is due
 * (`parent-chats`, migration 20261115034215), with the WhatsApp queue's
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
    const counts = await runChatNudges(liveChatNudgeDeps(), { limit: 40 });
    return NextResponse.json({ ok: true, ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    logWarn("jobs.parent_chats.failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
