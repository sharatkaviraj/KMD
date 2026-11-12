import { NextResponse } from "next/server";

import { isPlatformCron } from "@/modules/jobs/domain/token";
import { submitNewHubTemplates, syncHubTemplates } from "@/modules/whatsapp/data/hub-templates";
import { getSiteUrl } from "@/platform/env";
import { logWarn } from "@/platform/observability/log";
import { queueSecretMatches } from "@/platform/whatsapp/store";

/**
 * One reads the school's hub's template list by itself, once an hour (owner,
 * 11 Nov 2026). Meta's approvals usually reach One at once through the hub's
 * webhook; this is for the one that did not, so a template never sits as
 * "waiting" in One for days until an admin presses "Check with WhatsApp".
 * The same check that button runs: One's own rows held to their wording,
 * button host and blanks (`syncHubTemplates`). Then any of One's templates
 * that has never been sent for approval goes to Meta, up to 15 an hour
 * (owner, 12 Nov 2026: "Yes submit them", D-573); one the hub refused waits
 * for an admin's "Send for approval". Templates only: nothing is sent to anyone.
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
  const submitted = await submitNewHubTemplates().catch((caught) => ({
    ok: false as const,
    problem: caught instanceof Error ? caught.message : "unknown",
  }));
  if (!submitted.ok) logWarn("jobs.whatsapp_templates.submit_failed", { problem: submitted.problem });
  else if (submitted.failed.length > 0) logWarn("jobs.whatsapp_templates.submit_refused", { failed: submitted.failed.length, problem: submitted.failed[0]?.problem });
  return NextResponse.json(
    {
      ok: true,
      checked: answer.checked,
      approved: answer.approved,
      missing: answer.missing,
      submitted: submitted.ok ? submitted.sent : 0,
      refused: submitted.ok ? submitted.failed.length : 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
