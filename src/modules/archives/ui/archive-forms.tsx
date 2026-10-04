"use client";

import { useActionState, useTransition } from "react";

import { buildArchiveAction, manifestLinkAction, runDrillAction } from "@/app/(app)/archives/actions";
import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { idleCollectionState } from "@/modules/collection/domain/form-state";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Input, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/** Name an archive and build it. It takes as long as the bytes take. */
export function BuildArchiveForm() {
  const language = useLanguage();
  const [state, build, building] = useActionState(buildArchiveAction, idleCollectionState);
  return (
    <form action={build} className="space-y-3" data-archive-build>
      {state.message ? (
        <Notice tone={state.status === "error" ? "danger" : "success"} text={state.message} language={language} />
      ) : null}
      <Field label={ms.archiveLabel} htmlFor="archive-label" hint={ms.archiveLabelHint} language={language}>
        <Input id="archive-label" name="label" required maxLength={120} />
      </Field>
      <Button type="submit" loading={building} loadingText={primary(ms.archiveBuilding, language)}>
        {primary(ms.archiveBuild, language)}
      </Button>
    </form>
  );
}

/** Run a restore drill, or fetch the manifest, for one archive. */
export function ArchiveActions({ archiveId }: { archiveId: string }) {
  const language = useLanguage();
  const [state, drill, drilling] = useActionState(runDrillAction, idleCollectionState);
  const [fetching, startFetch] = useTransition();

  return (
    <div className="space-y-2" data-archive-actions={archiveId}>
      {state.message ? (
        <Notice tone={state.status === "error" ? "danger" : "success"} text={state.message} language={language} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <form action={drill}>
          <input type="hidden" name="archiveId" value={archiveId} />
          <Button type="submit" size="sm" variant="outline" loading={drilling} loadingText={primary(m.saving, language)}>
            {primary(ms.drillRun, language)}
          </Button>
        </form>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={fetching}
          loadingText={primary(m.saving, language)}
          onClick={() =>
            startFetch(async () => {
              const link = await manifestLinkAction(archiveId);
              if (link) window.location.assign(link);
            })
          }
        >
          {primary(ms.archiveManifest, language)}
        </Button>
      </div>
    </div>
  );
}
