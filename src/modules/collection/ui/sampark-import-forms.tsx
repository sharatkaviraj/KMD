"use client";

import { useActionState, useState } from "react";

import {
  applySamparkImportAction,
  resolveSamparkRowAction,
  stageSamparkImportAction,
} from "@/app/(app)/collection/import/actions";
import * as m from "@/messages/pairs";
import { ms } from "@/messages/setup";
import { idleCollectionState, type CollectionState } from "@/modules/collection/domain/form-state";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Input, Notice, Textarea } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/** Choose SamPark's workbook; reading it changes nobody's record. */
export function SamparkUploadForm() {
  const language = useLanguage();
  const [state, upload, uploading] = useActionState(stageSamparkImportAction, idleCollectionState);

  return (
    <form action={upload} className="space-y-3" data-sampark-upload>
      {state.status === "error" && state.message ? <Notice tone="danger" text={state.message} language={language} /> : null}
      <Field label={ms.importFile} htmlFor="sampark-file" language={language}>
        <Input id="sampark-file" name="file" type="file" accept=".xlsx,.xls,.csv" required />
      </Field>
      <Button type="submit" loading={uploading} loadingText={primary(m.saving, language)}>
        {primary(ms.importUpload, language)}
      </Button>
    </form>
  );
}

/**
 * A command id per press, kept until an answer comes back: a press whose
 * answer was lost is asked about again, never applied twice (P10).
 */
function useCommand(action: (previous: CollectionState, formData: FormData) => Promise<CollectionState>) {
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [state, run, pending] = useActionState(async (previous: CollectionState, formData: FormData) => {
    const result = await action(previous, formData);
    setCommandId(crypto.randomUUID());
    return result;
  }, idleCollectionState);
  return { commandId, state, run, pending };
}

/** Apply every matched row of the batch. */
export function SamparkApplyForm({ batchId, count }: { batchId: string; count: number }) {
  const language = useLanguage();
  const { commandId, state, run, pending } = useCommand(applySamparkImportAction);

  return (
    <form action={run} className="space-y-2" data-sampark-apply>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="commandId" value={commandId} />
      {state.message ? (
        <Notice tone={state.status === "error" ? "danger" : "success"} text={state.message} language={language} />
      ) : null}
      <p className="text-[13px] text-muted-foreground">{primary(ms.importApplyHint, language)}</p>
      <Button type="submit" loading={pending} loadingText={primary(m.saving, language)} disabled={count === 0}>
        {primary(ms.importApply, language)} ({count})
      </Button>
    </form>
  );
}

/**
 * Decide one queued row: one of its candidates, a child by the fee record's
 * SR number, or nobody — with a reason. A name in the row is shown to help a
 * person choose; nothing chooses by it.
 */
export function SamparkResolveForm({
  batchId,
  rowNo,
  candidates,
}: {
  batchId: string;
  rowNo: number;
  candidates: { id: string; name: string; admissionNo: string | null }[];
}) {
  const language = useLanguage();
  const { commandId, state, run, pending } = useCommand(resolveSamparkRowAction);
  const [choice, setChoice] = useState<string>(candidates.length === 0 ? "admission" : "");

  return (
    <form action={run} className="space-y-2" data-sampark-resolve={rowNo}>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="rowNo" value={rowNo} />
      <input type="hidden" name="commandId" value={commandId} />
      {state.message ? (
        <Notice tone={state.status === "error" ? "danger" : "success"} text={state.message} language={language} />
      ) : null}

      <fieldset className="space-y-1.5 text-[13px]">
        <legend className="sr-only">{primary(ms.importChooseChild, language)}</legend>
        {candidates.map((candidate) => (
          <label key={candidate.id} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="choice"
              value={candidate.id}
              checked={choice === candidate.id}
              onChange={() => setChoice(candidate.id)}
            />
            <span className="font-medium text-foreground">{candidate.name}</span>
            <span className="text-subtle-foreground">SR {candidate.admissionNo ?? "—"}</span>
          </label>
        ))}
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="choice" value="admission" checked={choice === "admission"} onChange={() => setChoice("admission")} />
          <span>{primary(ms.importBySr, language)}</span>
        </label>
        {choice === "admission" ? (
          <Input
            name="admissionNo"
            aria-label={primary(ms.importBySr, language)}
            className="h-10 max-w-48"
            maxLength={40}
          />
        ) : null}
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="choice" value="dismiss" checked={choice === "dismiss"} onChange={() => setChoice("dismiss")} />
          <span>{primary(ms.importDismiss, language)}</span>
        </label>
      </fieldset>

      <Textarea
        name="note"
        rows={2}
        maxLength={300}
        required={choice === "dismiss"}
        aria-label={primary(ms.importReason, language)}
        placeholder={primary(ms.importReason, language)}
      />
      <Button type="submit" variant="outline" size="sm" loading={pending} loadingText={primary(m.saving, language)} disabled={choice === ""}>
        {primary(ms.importDecide, language)}
      </Button>
    </form>
  );
}
