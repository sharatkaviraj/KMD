import { NextResponse } from "next/server";

import { isPlatformCron } from "@/modules/jobs/domain/token";
import { archiveOldChats, liveParentFilesDeps, sweepParentFiles } from "@/modules/whatsapp/data/parent-files";
import { vercelOidcToken } from "@/platform/google/vercel-oidc";
import { logWarn } from "@/platform/observability/log";
import { queueSecretMatches } from "@/platform/whatsapp/store";

/**
 * Parents' files and old chats into the school's Drive (D-594, D-595).
 *
 *   {"part": "files"}    every hour, only while Veer Patta AI is on: the
 *                        parents' photos, voice notes and files the copy
 *                        started by each message missed (`parent-files`,
 *                        migration 20261112161710).
 *   {"part": "archive"}  once a day: the month of chats the hub says is due
 *                        (older than six months, or sooner when its free
 *                        database passes 40%) becomes one spreadsheet in
 *                        Drive, and only then leaves the hub
 *                        (`whatsapp-chat-archive`).
 *
 * Called by pg_cron with the WhatsApp queue's Bearer secret, which lives in
 * Vault and is checked in Postgres (`whatsapp_queue_secret_matches`);
 * `CRON_SECRET` also opens it, for an operator. Anything else is a 404.
 * Google trusts this deployment's own identity (Vercel OIDC, D-333), so it
 * works on production only.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NOT_HERE = () => new NextResponse("Not found", { status: 404 });

async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization");
  if (isPlatformCron(process.env.CRON_SECRET, header)) return true;
  const bearer = /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1] ?? "";
  return bearer ? queueSecretMatches(bearer).catch(() => false) : false;
}

export async function POST(request: Request) {
  if (!(await authorized(request))) return NOT_HERE();
  const body = (await request.json().catch(() => null)) as { part?: unknown } | null;
  const part = body?.part === "archive" ? "archive" : "files";
  try {
    const deps = liveParentFilesDeps(await vercelOidcToken(request));
    const result = part === "archive" ? await archiveOldChats(deps, { maxMonths: 3, budgetMs: 240_000 }) : await sweepParentFiles(deps, 240_000);
    return NextResponse.json({ ok: true, part, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    logWarn("jobs.parent_files.failed", { part, error: caught instanceof Error ? caught.message : "unknown" });
    return NextResponse.json({ ok: false, part }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
