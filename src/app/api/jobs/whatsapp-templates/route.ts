import { NextResponse } from "next/server";

import { isPlatformCron } from "@/modules/jobs/domain/token";
import { syncHubTemplates } from "@/modules/whatsapp/data/hub-templates";
import { getSiteUrl } from "@/platform/env";
import { logWarn } from "@/platform/observability/log";
import { queueSecretMatches } from "@/platform/whatsapp/store";

/**
 * One reads the school's hub's template list by itself, once an hour (owner,
 * 11 Nov 2026). Meta's approvals usually reach One at once through the hub's
 * webhook; this is for the one that did not, so a template never sits as
 * "waiting" in One for days until an admin presses "Check with WhatsApp".
 * The same check that button runs: the `_v8` rows held to their wording,
 * button host and blanks (`syncHubTemplates`). Nothing is sent to anyone.
 *
 * Called by pg_cron at minute 17 (`whatsapp-templates`, migration
 * 20261111060151). Its Bearer secret is the queue's, kept in Vault and checked
 * in Postgres (`whatsapp_queue_secret_matches`); `CRON_SECRET` also opens it,
 * for an operator. Anything else is a 404.
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
  const answer = await syncHubTemplates({ staffId: null }, getSiteUrl()).catch((caught) => ({
    ok: false as const,
    problem: caught instanceof Error ? caught.message : "unknown",
  }));
  if (!answer.ok) {
    logWarn("jobs.whatsapp_templates.failed", { problem: answer.problem });
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    { ok: true, checked: answer.checked, approved: answer.approved, missing: answer.missing },
    { headers: { "Cache-Control": "no-store" } },
  );
}
