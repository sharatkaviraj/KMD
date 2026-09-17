import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import type { JobName, JobRun, JobStatus } from "@/modules/jobs/domain/jobs";

/**
 * The record of what the scheduler has done.
 *
 * Reads go through the cookie client so the console obeys RLS like every other
 * screen; writes go through the service role, because a job has no session —
 * it is a cron request, and the thing it is allowed to do was decided by the
 * secret before any of this ran.
 */

type JobRunRow = {
  id: string;
  job: string;
  status: JobStatus;
  trigger: "schedule" | "manual";
  for_day: string | null;
  summary: Record<string, number | string> | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  staff_profiles: { display_name: string } | null;
};

const RUN_COLUMNS =
  "id, job, status, trigger, for_day, summary, error, started_at, finished_at, " +
  "staff_profiles(display_name)";

const toRun = (row: JobRunRow): JobRun => ({
  id: row.id,
  job: row.job,
  status: row.status,
  trigger: row.trigger,
  triggeredByName: row.staff_profiles?.display_name ?? null,
  forDay: row.for_day,
  summary: row.summary ?? {},
  error: row.error,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export async function recentRuns(limit = 40): Promise<JobRun[]> {
  await assertPermission("jobs:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_runs")
    .select(RUN_COLUMNS)
    .order("started_at", { ascending: false })
    .limit(limit)
    .returns<JobRunRow[]>();

  if (error) throw new Error(`Could not read the job runs: ${error.message}`);
  return data.map(toRun);
}

/** The latest attempt at each job, for the console's top half. */
export async function lastRunPerJob(): Promise<Map<string, JobRun>> {
  await assertPermission("jobs:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_runs")
    .select(RUN_COLUMNS)
    .order("started_at", { ascending: false })
    .limit(200)
    .returns<JobRunRow[]>();

  if (error) throw new Error(`Could not read the job runs: ${error.message}`);

  const latest = new Map<string, JobRun>();
  for (const row of data) {
    if (!latest.has(row.job)) latest.set(row.job, toRun(row));
  }
  return latest;
}

/**
 * Everything the console needs, and the instant it was true.
 *
 * `asOf` is here rather than in the page because "is this run stale" is a
 * question about a clock, and reading a clock during render is exactly the
 * impurity React tells you not to write: two renders of the same data would
 * disagree about whether a job had hung. Reading it once, beside the rows it
 * is about, makes the page a function of what it was handed.
 */
export async function jobsBoard(): Promise<{
  latest: Map<string, JobRun>;
  history: JobRun[];
  asOf: number;
}> {
  const [latest, history] = await Promise.all([lastRunPerJob(), recentRuns(30)]);
  return { latest, history, asOf: Date.now() };
}

/* ---------------------------------------------------------------- writing */

/** Whether this job already succeeded for this day. */
export async function succeededFor(job: JobName, day: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("job_runs")
    .select("id")
    .eq("job", job)
    .eq("for_day", day)
    .eq("status", "ok")
    .limit(1);

  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Open a run, or say that one is already open.
 *
 * The partial unique index `job_runs_one_at_a_time` is what actually stops two
 * at once — this returns null when it fires rather than throwing, because two
 * crons overlapping is an ordinary thing that happens on a redeploy, not an
 * error anybody needs paging about.
 */
export async function startRun(input: {
  job: JobName;
  trigger: "schedule" | "manual";
  staffProfileId: string | null;
  day: string | null;
}): Promise<{ id: string } | null> {
  const { data, error } = await createAdminClient()
    .from("job_runs")
    .insert({
      job: input.job,
      status: "running",
      trigger: input.trigger,
      triggered_by: input.staffProfileId,
      for_day: input.day,
    })
    .select("id")
    .single<{ id: string }>();

  // 23505 is the unique violation: another run of this job is open.
  if (error && (error as { code?: string }).code === "23505") return null;
  if (error) throw error;
  return data;
}

export async function finishRun(input: {
  id: string;
  status: Exclude<JobStatus, "running">;
  summary?: Record<string, number | string>;
  error?: string | null;
}): Promise<void> {
  const { error } = await createAdminClient()
    .from("job_runs")
    .update({
      status: input.status,
      summary: input.summary ?? {},
      error: input.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", input.id);

  if (error) throw error;
}

/**
 * Close runs that died without writing their ending.
 *
 * A process killed mid-run leaves a `running` row, and that row holds the
 * one-at-a-time index against every future attempt — so the job would never
 * run again, silently, which is the worst way for a scheduler to fail. Called
 * before every attempt.
 */
export async function releaseStaleRuns(olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();

  const { data, error } = await createAdminClient()
    .from("job_runs")
    .update({
      status: "failed",
      error: "The run did not finish — the process stopped before it could say so.",
      finished_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");

  if (error) throw error;
  return (data ?? []).length;
}
