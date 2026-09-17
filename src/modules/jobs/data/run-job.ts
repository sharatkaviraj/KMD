import "server-only";

import {
  finishRun,
  releaseStaleRuns,
  startRun,
  succeededFor,
} from "@/modules/jobs/data/jobs-repo";
import { JOBS, STALE_AFTER_MS, type JobName } from "@/modules/jobs/domain/jobs";

export type JobResult = {
  status: "ok" | "failed" | "skipped" | "busy";
  summary: Record<string, number | string>;
  error?: string;
};

/**
 * Run one job, and write down what happened either way.
 *
 * Everything that is the same about every job lives here, so a job itself is
 * only the work:
 *
 * - **A dead run does not block the next one.** A process killed mid-run
 *   leaves a `running` row holding the one-at-a-time index, and a scheduler
 *   that stops forever because of one bad afternoon is worse than no
 *   scheduler. Stale rows are closed as failures first.
 * - **Two at once is refused by the database**, not by a flag in memory —
 *   memory is per instance, and on Vercel there is always more than one.
 * - **Twice in a day is a skip, not work.** A cron that fires again after a
 *   redeploy must not open a second set of registers. `force` is how a person
 *   overrides that from the console, because a person asking again means it.
 * - **A job never throws at its caller.** The caller is an HTTP handler that
 *   the scheduler reads as a health signal; the failure belongs in the row,
 *   where somebody can see it tomorrow, not only in a log nobody opens.
 */
export async function runJob(
  job: JobName,
  options: {
    trigger: "schedule" | "manual";
    staffProfileId?: string | null;
    /** The school day this run is *for*. */
    day: string;
    /** A person asking again, which overrides "already done today". */
    force?: boolean;
  },
  work: () => Promise<Record<string, number | string>>,
): Promise<JobResult> {
  const definition = JOBS[job];

  await releaseStaleRuns(STALE_AFTER_MS);

  if (definition.oncePerDay && !options.force && (await succeededFor(job, options.day))) {
    // **The skip is written down.** Returning quietly left the console unable
    // to tell "the cron fired at 7:15 and found the work already done" from
    // "the cron never fired at all" — which is the one question the console
    // exists to answer, and the two look identical from an empty card.
    const noted = await startRun({
      job,
      trigger: options.trigger,
      staffProfileId: options.staffProfileId ?? null,
      day: options.day,
    });

    // No summary. The status *is* the summary — "Already done" is what the
    // badge says, in the reader's own language, and a line underneath reading
    // `skipped: already done today` was both a repetition and a sentence of
    // untranslated English on a Hindi screen (rule 9).
    if (noted) await finishRun({ id: noted.id, status: "skipped", summary: {} });

    return { status: "skipped", summary: {} };
  }

  const run = await startRun({
    job,
    trigger: options.trigger,
    staffProfileId: options.staffProfileId ?? null,
    day: options.day,
  });

  // Another run of this job is open. Not an error: a redeploy or a retry.
  if (!run) return { status: "busy", summary: {} };

  try {
    const summary = await work();
    await finishRun({ id: run.id, status: "ok", summary });
    return { status: "ok", summary };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await finishRun({ id: run.id, status: "failed", error: message });
    return { status: "failed", summary: {}, error: message };
  }
}
