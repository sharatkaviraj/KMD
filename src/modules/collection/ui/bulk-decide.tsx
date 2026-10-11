"use client";

import { useActionState, useMemo, useState } from "react";

import { decideSubmissionsAction } from "@/app/(app)/collection/actions";
import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { idleCollectionState, type CollectionState } from "@/modules/collection/domain/form-state";
import type { BulkEligibility } from "@/modules/collection/domain/review";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Card, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

export type BulkRow = {
  id: string;
  studentName: string;
  classLabel: string;
  fieldLabelHi: string;
  fieldLabelEn: string;
  previousValue: string | null;
  value: string | null;
  eligibility: BulkEligibility;
};

/**
 * Decide several student-data changes at once (D-263).
 *
 * Nothing is pre-ticked and there is no hidden "Approve all": the reviewer
 * ticks rows, sees each one's field and old → new value in the list she is
 * ticking from, and the button says how many it covers. Conflicted and
 * superseded rows are listed with the reason and cannot be ticked — they are
 * decided one at a time below, where replacing a newer value is offered.
 *
 * The decision itself is the same `decideSubmissionsAction` the single rows
 * use, with one command id per press, so the database's stale-revision and
 * replay rules apply to every row exactly as before.
 */
export function BulkDecide({ rows }: { rows: BulkRow[] }) {
  const language = useLanguage();
  const eligible = useMemo(() => rows.filter((r) => r.eligibility === "ok"), [rows]);
  const leftOut = rows.filter((r) => r.eligibility !== "ok");
  const [picked, setPicked] = useState<string[]>([]);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(
    async (previous: CollectionState, formData: FormData) => {
      const result = await decideSubmissionsAction(previous, formData);
      setCommandId(crypto.randomUUID());
      if (result.status !== "error") setPicked([]);
      return result;
    },
    idleCollectionState,
  );
  const [accept, setAccept] = useState(true);

  const toggle = (id: string) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  const label = (r: BulkRow) => (language === "en" ? r.fieldLabelEn : r.fieldLabelHi);

  return (
    <Card className="mb-4 p-4" data-bulk-decide>
      <p className="text-[15px] font-semibold text-foreground">{primary(ms.reviewBulkTitle, language)}</p>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{primary(ms.reviewBulkHint, language)}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setPicked(eligible.map((r) => r.id))} disabled={eligible.length === 0}>
          {primary(ms.reviewBulkSelectAll, language)} ({eligible.length})
        </Button>
        {picked.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicked([])}>
            {primary(ms.reviewBulkClear, language)}
          </Button>
        ) : null}
      </div>

      <ul className="mt-3 max-h-[420px] space-y-1 overflow-y-auto">
        {eligible.map((r) => {
          const on = picked.includes(r.id);
          return (
            <li key={r.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
                <input type="checkbox" className="size-5 shrink-0 accent-accent" checked={on} onChange={() => toggle(r.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-foreground">
                    {r.studentName} <span className="font-normal text-subtle-foreground">· {r.classLabel}</span>
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {label(r)}: <span className="line-through">{r.previousValue || "—"}</span> → <strong className="text-foreground">{r.value || "—"}</strong>
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {leftOut.length > 0 ? (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-subtle-foreground">{primary(ms.reviewBulkLeftOut, language)} ({leftOut.length})</p>
          <ul className="mt-1 space-y-1">
            {leftOut.map((r) => (
              <li key={r.id} className="truncate text-[12px] text-warning">
                {r.studentName} · {label(r)} — {primary(r.eligibility === "conflict" ? ms.reviewBulkConflict : ms.reviewBulkSuperseded, language)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form action={action} className="mt-3 space-y-2">
        {picked.map((id) => (
          <input key={id} type="hidden" name="submissionIds" value={id} />
        ))}
        <input type="hidden" name="commandId" value={commandId} />
        <input type="hidden" name="replaceNewer" value="false" />
        {state.message ? <Notice tone={state.status === "error" ? "warning" : "success"} text={state.message} language={language} /> : null}
        <p className="text-[13px] text-muted-foreground">
          {primary(ms.reviewBulkSelected, language)}: <strong className="text-foreground">{picked.length}</strong>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="accept" value="true" size="sm" loading={pending && accept} loadingText={primary(m.saving, language)} disabled={picked.length === 0 || pending} onClick={() => setAccept(true)}>
            {primary(ms.reviewBulkAccept, language)} ({picked.length})
          </Button>
          <Button type="submit" name="accept" value="false" variant="outline" size="sm" loading={pending && !accept} loadingText={primary(m.saving, language)} disabled={picked.length === 0 || pending} onClick={() => setAccept(false)}>
            {primary(ms.reviewBulkReject, language)} ({picked.length})
          </Button>
        </div>
      </form>
    </Card>
  );
}
