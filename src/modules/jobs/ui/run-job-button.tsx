"use client";

import { useActionState } from "react";

import { runJobAction } from "@/app/(app)/jobs/actions";
import * as m from "@/messages/pairs";
import { idleJobState } from "@/modules/jobs/domain/form-state";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * "Run now", and the second press that means it.
 *
 * A job that has already succeeded today is skipped rather than repeated, so
 * the first press on such a job comes back saying so — and only then does the
 * button that forces it appear. That ordering is deliberate: opening a second
 * set of registers should take two decisions, and the person making the second
 * one should have just been told why.
 */
export function RunJobButton({ job }: { job: string }) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(runJobAction, idleJobState);

  const mine = state.job === job;
  const skipped = mine && state.status === "already";

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="job" value={job} />
      {/* Only present after this job came back "already done today", so an
          ordinary press can never force by accident. */}
      {skipped ? <input type="hidden" name="force" value="yes" /> : null}

      {mine && state.message ? (
        <Notice
          tone={
            state.status === "error"
              ? "danger"
              : state.status === "already"
                ? "info"
                : "success"
          }
          text={state.message}
          language={language}
        />
      ) : null}

      <Button
        type="submit"
        variant={skipped ? "primary" : "outline"}
        size="sm"
        fullWidth
        loading={pending}
        loadingText={primary(m.jobsRunning, language)}
      >
        {primary(skipped ? m.jobsForceRun : m.jobsRunNow, language)}
      </Button>
    </form>
  );
}
