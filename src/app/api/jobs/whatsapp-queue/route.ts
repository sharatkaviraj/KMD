import { NextResponse } from "next/server";

import { isPlatformCron } from "@/modules/jobs/domain/token";
import { syncDeliveryToSource, syncSettledToSource } from "@/modules/whatsapp/data/whatsapp-source-sync";
import { logWarn } from "@/platform/observability/log";
import { drainQueue, pollPendingStatuses, statusWrite } from "@/platform/whatsapp/service";
import { queueSecretMatches } from "@/platform/whatsapp/store";

/**
 * The WhatsApp queue (D-562): sends what is due — messages left for the queue
 * and busy-server failures whose wait is over — and writes each answer back
 * to the row that asked for it.
 *
 * Then it asks the school's hub (`GET /v1/status/{wamid}`) about messages it
 * has not heard back on — the hub's webhook is best-effort — at most four
 * times each, and writes what it learns the same way the webhook would.
 *
 * Called by pg_cron every five minutes, and only when something is due
 * (`whatsapp-queue`, migrations 20261109062459 and 20261109082705). Its Bearer secret lives in
 * Vault and is checked in Postgres (`whatsapp_queue_secret_matches`), so no
 * copy sits in Vercel; `CRON_SECRET` also opens it, for an operator.
 * Anything else is a 404. Every message is checked against today's switches
 * again before it goes, so practice mode or a feature switched off since it
 * was queued stops it here.
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
    const { taken, settled } = await drainQueue(20);
    for (const { row, outcome } of settled) {
      await syncSettledToSource(row, outcome).catch((caught) => {
        logWarn("jobs.whatsapp_queue.source_sync_failed", { error: caught instanceof Error ? caught.message : "unknown" });
      });
    }
    const counts: Record<string, number> = {};
    for (const { outcome } of settled) counts[outcome.outcome] = (counts[outcome.outcome] ?? 0) + 1;

    const polled = await pollPendingStatuses(20).catch(() => []);
    let updated = 0;
    for (const { row, answer } of polled) {
      const write = answer ? statusWrite(answer.status) : null;
      if (!answer?.changed || !write || !row.provider_message_id) continue;
      updated += 1;
      await syncDeliveryToSource({
        providerMessageId: row.provider_message_id,
        status: write.status,
        at: answer.status.at,
        errorCode: write.errorCode,
        errorTitle: answer.status.errorTitle,
        sourceTable: answer.source_table,
        sourceId: answer.source_id,
      }).catch((caught) => {
        logWarn("jobs.whatsapp_queue.poll_sync_failed", { error: caught instanceof Error ? caught.message : "unknown" });
      });
    }
    return NextResponse.json(
      { ok: true, taken, ...counts, polled: polled.length, updated },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    logWarn("jobs.whatsapp_queue.failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
