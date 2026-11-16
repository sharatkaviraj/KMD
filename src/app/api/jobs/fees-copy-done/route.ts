import { NextResponse } from "next/server";

import { feesCopySecretMatches, readFeesCopyCacheTags } from "@/modules/coexistence/data/fees-copy";
import { feesCopyTags } from "@/modules/coexistence/domain/fees-copy";
import { isPlatformCron } from "@/modules/jobs/domain/token";
import { logInfo, logWarn } from "@/platform/observability/log";
import { expireTag } from "@/platform/performance/shared-cache";

/**
 * After the night's copy of the Fees app (D-644, D-648): clear One's saved
 * screens, so the morning's first look shows what the copy brought.
 *
 * `vppsone.fees_copy_nightly` copies, brings the class lists in line, refreshes
 * the money views and then asks for this through pg_net, which sends the
 * request after its transaction commits. With the Fees link off One keeps fee
 * reads under `session:<year>`, `dues-badge:<year>` and `student:<id>`, and
 * those have no expiry of their own: without this a screen would show
 * yesterday until somebody posted a payment in that year. The tags come from
 * the copied rows (`vppsone.fees_copy_cache_tags`), so a child the copy
 * brought tonight is cleared tonight. Nothing is read from or sent to the
 * Fees app here.
 *
 * Its Bearer secret lives in Vault and is checked in Postgres
 * (`fees_copy_secret_matches`), so no copy sits in Vercel; `CRON_SECRET` also
 * opens it, for an operator. Anything else is a 404.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NOT_HERE = () => new NextResponse("Not found", { status: 404 });

async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization");
  if (isPlatformCron(process.env.CRON_SECRET, header)) return true;
  const bearer = /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1] ?? "";
  return bearer ? feesCopySecretMatches(bearer).catch(() => false) : false;
}

export async function POST(request: Request) {
  if (!(await authorized(request))) return NOT_HERE();
  const body = (await request.json().catch(() => null)) as { run?: unknown } | null;
  const run = typeof body?.run === "number" && Number.isSafeInteger(body.run) ? body.run : null;
  try {
    const tags = feesCopyTags(await readFeesCopyCacheTags());
    for (const tag of tags) expireTag(tag);
    const students = tags.filter((tag) => tag.startsWith("student:")).length;
    logInfo("jobs.fees_copy_done", { run, expired: tags.length, students });
    return NextResponse.json({ ok: true, run, expired: tags.length, students }, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    logWarn("jobs.fees_copy_done.failed", { run, error: caught instanceof Error ? caught.message : "unknown" });
    return NextResponse.json({ ok: false, run }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
