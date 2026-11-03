import { type NextRequest, NextResponse } from "next/server";

import { jobWork } from "@/modules/jobs/data/job-work";
import { runJob } from "@/modules/jobs/data/run-job";
import { isJobName } from "@/modules/jobs/domain/jobs";
import { isPlatformCron, tokenMatches } from "@/modules/jobs/domain/token";
import { schoolToday } from "@/platform/dates";

export const runtime = "nodejs";
// The Drive backup exports every table and copies files; give it five minutes.
export const maxDuration = 300;

/**
 * Where the scheduler knocks.
 *
 * Two ways in, and no third:
 *
 * - `Authorization: Bearer $CRON_SECRET` — Vercel's own cron, which sends this
 *   header on every scheduled request when the variable is set.
 * - `?token=` — the per-job token, `HMAC(JOBS_SECRET, job)`. Each job has a
 *   different one and none of them is the secret, so a token can be handed to
 *   something that should trigger one job without handing over the other three.
 *
 * A deploy with neither variable set runs no jobs at all. That is deliberate:
 * an unconfigured deploy should be inert rather than open, and "the jobs never
 * ran" is a discoverable problem in a way that "anybody could run the jobs" is
 * not.
 *
 * **Every refusal is the same 404.** A 401 on a real job name and a 404 on a
 * made-up one together tell a guesser which job names exist, which is the
 * first half of the work — the same reasoning as the token links in Phase 5
 * (D-68).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ job: string }> },
) {
  const { job } = await context.params;

  const authorised =
    isPlatformCron(process.env.CRON_SECRET, request.headers.get("authorization")) ||
    tokenMatches(
      process.env.JOBS_SECRET,
      job,
      request.nextUrl.searchParams.get("token"),
    );

  if (!authorised || !isJobName(job)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const day = request.nextUrl.searchParams.get("day") ?? schoolToday();

  const result = await runJob(job, { trigger: "schedule", day }, () => jobWork[job](day));

  // 200 even for a failed run. The scheduler asked us to try, we tried, and we
  // wrote down what happened — the failure belongs in the row a person reads
  // tomorrow, not in a retry storm against a job that will fail the same way.
  return NextResponse.json({ job, day, ...result });
}

/**
 * The same thing for a scheduler that can only issue a GET.
 *
 * Vercel's cron sends GET, so this is the one that actually fires in
 * production; POST exists because triggering work with a GET is the kind of
 * thing that gets fetched by a link preview one day.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ job: string }> },
) {
  return POST(request, context);
}
