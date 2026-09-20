import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel } from "@/platform/dates";
import { primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { jobsBoard } from "@/modules/jobs/data/jobs-repo";
import {
  isStale,
  jobList,
  jobStatusLabels,
  runDurationMs,
  summaryLine,
  JOBS,
  type JobRun,
} from "@/modules/jobs/domain/jobs";
import { RunJobButton } from "@/modules/jobs/ui/run-job-button";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.jobsTitle) };
}

const TONE = {
  running: "warning",
  ok: "success",
  failed: "danger",
  skipped: "neutral",
} as const;

/**
 * What runs on its own, and whether it did.
 *
 * A scheduler nobody can see is a scheduler nobody trusts, and the first
 * question on a morning when the registers are missing is "when did that last
 * work" — which needs a screen, not a log. Every attempt is here, the failed
 * ones included, because a list of successes would be silent on exactly the
 * morning somebody is asking.
 *
 * The run-now button calls the same `runJob()` the cron calls, so a job cannot
 * behave one way at 7:15 and another way when a person asks.
 */
export default async function JobsPage() {
  const staff = await requirePermission("jobs:view", "/jobs");
  const language = staff.language;
  const mayRun = can(staff, "jobs:run");

  const { latest, worked, history, asOf: now } = await jobsBoard();

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAdministration}
        title={m.jobsTitle}
        description={m.jobsIntro}
        language={language}
        back={BACK}
      />

      <Section title={m.jobsTitle} language={language}>
        <ul className="space-y-3">
          {jobList.map((job) => {
            const run = latest.get(job.name);
            // What it last did, which is a different row from what it last
            // tried whenever the last try was a skip.
            const did = worked.get(job.name);

            return (
              <li key={job.name}>
                <Card className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold text-foreground">
                        {primary(job.label, language)}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                        {primary(job.what, language)}
                      </p>
                      <p className="mt-1 text-[12px] text-subtle-foreground">
                        {primary(m.jobsSchedule, language)}{" "}
                        {primary(job.when, language)}
                      </p>
                    </div>

                    {run ? (
                      <Badge tone={TONE[run.status]}>
                        {primary(jobStatusLabels[run.status], language)}
                      </Badge>
                    ) : null}
                  </div>

                  {run ? (
                    <>
                      <RunLine run={run} now={now} language={language} />
                      {/* Only when the last attempt was a skip: the numbers
                          belong to the run that did the work, and losing them
                          is how a console stops being worth opening. */}
                      {did && did.id !== run.id ? (
                        <p className="text-[12px] tabular-nums text-muted-foreground">
                          {summaryLine(did.summary, language)}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-[13px] text-subtle-foreground">
                      {primary(m.jobsNeverRun, language)}
                    </p>
                  )}

                  {run && isStale(run, now) ? (
                    <Notice tone="warning" text={m.jobsStale} language={language} />
                  ) : null}

                  {mayRun ? <RunJobButton job={job.name} /> : null}
                </Card>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section className="mt-8" title={m.jobsHistory} language={language}>
        {history.length === 0 ? (
          <EmptyState title={m.jobsNoHistory} language={language} />
        ) : (
          <ul className="space-y-1.5">
            {history.map((run) => {
              const known = JOBS[run.job as keyof typeof JOBS];

              return (
                <li
                  key={run.id}
                  className="rounded-xl border border-border bg-surface px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
                      {known ? primary(known.label, language) : run.job}
                    </span>
                    <Badge tone={TONE[run.status]}>
                      {primary(jobStatusLabels[run.status], language)}
                    </Badge>
                  </div>
                  <RunLine run={run} now={now} language={language} />
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}

/** When it ran, how long it took, who asked, and what it did. */
function RunLine({
  run,
  now,
  language,
}: {
  run: JobRun;
  now: number;
  language: "hi" | "en" | "both";
}) {
  const seconds = Math.round(runDurationMs(run, now) / 100) / 10;
  const summary = summaryLine(run.summary, language);

  return (
    <div className="space-y-0.5">
      <p className="text-[12px] text-subtle-foreground">
        {run.forDay ? primary(dayLabel(run.forDay), language) : "—"} ·{" "}
        {primary(
          run.trigger === "manual" ? m.jobsManual : m.jobsScheduled,
          language,
        )}
        {run.triggeredByName ? ` · ${run.triggeredByName}` : ""} ·{" "}
        {primary(m.jobsTookMs, language)} {seconds}s
      </p>

      {summary ? (
        <p className="text-[12px] tabular-nums text-muted-foreground">{summary}</p>
      ) : null}

      {run.error ? (
        <p className="text-[12px] text-destructive-soft-foreground">{run.error}</p>
      ) : null}
    </div>
  );
}

const BACK = { href: "/more", label: t("और", "More") };
