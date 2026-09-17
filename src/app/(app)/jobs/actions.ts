"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { assertPermission } from "@/platform/auth/current-staff";
import { schoolToday } from "@/platform/dates";
import { jobWork } from "@/modules/jobs/data/job-work";
import { runJob } from "@/modules/jobs/data/run-job";
import { isJobName } from "@/modules/jobs/domain/jobs";
import type { JobActionState } from "@/modules/jobs/domain/form-state";

/**
 * Run a job because somebody pressed the button.
 *
 * The same `runJob()` the scheduler calls, so a job cannot behave one way at
 * 7:15 and another way when a person asks — which is the failure mode of every
 * "run now" that reimplements the work.
 *
 * Pressing once respects "already done today". Pressing again forces it,
 * because a person asking twice means it, and the button that appears after
 * the first press says exactly that.
 */
export async function runJobAction(
  _previous: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  // The permission first, before this reads a single field. An action that
  // validates its input before checking who is asking will, sooner or later,
  // answer a question for somebody who should not have been able to ask it.
  const staff = await assertPermission("jobs:run");

  const job = (formData.get("job") ?? "").toString();
  const force = formData.get("force") === "yes";

  if (!isJobName(job)) {
    return { status: "error", message: m.notFound, job: null };
  }

  const day = schoolToday();

  const result = await runJob(
    job,
    { trigger: "manual", staffProfileId: staff?.id ?? null, day, force },
    () => jobWork[job](day),
  );

  revalidatePath("/jobs");

  if (result.status === "skipped") {
    return { status: "already", message: m.jobsAlreadyToday, job };
  }

  if (result.status === "busy") {
    return { status: "error", message: m.jobsBusy, job };
  }

  if (result.status === "failed") {
    return { status: "error", message: m.jobsFailed, job };
  }

  return { status: "ok", message: m.jobsDone, job };
}
