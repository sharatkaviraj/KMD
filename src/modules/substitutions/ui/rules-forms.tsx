"use client";

import { useActionState } from "react";

import { saveBellsAction, saveTeamRuleAction } from "@/app/(app)/substitutions/rules/actions";
import { m } from "@/messages";
import { idleSubsState } from "@/modules/substitutions/domain/form-state";
import type { BellPeriod } from "@/modules/timetable/domain/bells";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Input, Notice, Select } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/** Eight rows of start and end, saved together, because one moved bell moves the next. */
export function BellsForm({ periods }: { periods: readonly BellPeriod[] }) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(saveBellsAction, idleSubsState);

  return (
    <form action={action} className="space-y-3">
      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}
      {state.status === "saved" ? <Notice tone="success" text={m.saved} language={language} /> : null}

      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-2">
        <span />
        <span className="text-[12px] font-semibold text-subtle-foreground">{primary(m.bellsStarts, language)}</span>
        <span className="text-[12px] font-semibold text-subtle-foreground">{primary(m.bellsEnds, language)}</span>
        {periods.map((period) => (
          <div key={period.index} className="contents">
            <label
              htmlFor={`starts-${period.index}`}
              className="text-[14px] font-semibold tabular-nums text-foreground"
            >
              {primary(m.teachPeriod, language)} {periodNumber(period.index)}
            </label>
            <Input
              id={`starts-${period.index}`}
              name={`starts-${period.index}`}
              type="time"
              required
              defaultValue={period.starts}
            />
            <Input
              aria-label={`${primary(m.teachPeriod, language)} ${periodNumber(period.index)} ${primary(m.bellsEnds, language)}`}
              name={`ends-${period.index}`}
              type="time"
              required
              defaultValue={period.ends}
            />
          </div>
        ))}
      </div>

      <Button type="submit" fullWidth loading={pending} loadingText={primary(m.saving, language)}>
        {primary(m.save, language)}
      </Button>
    </form>
  );
}

/** One team's rule: how many of its teachers must be there. */
export function TeamRuleForm({
  subjectCode,
  largestTeam,
  current,
}: {
  subjectCode: string;
  largestTeam: number;
  current: number | null;
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(saveTeamRuleAction, idleSubsState);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="subjectCode" value={subjectCode} />
      <input type="hidden" name="largestTeam" value={largestTeam} />
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-[13px] font-medium text-muted-foreground">
        {primary(m.teamMinimum, language)}
        <Select name="minimumPresent" defaultValue={current ? String(current) : ""} required>
          <option value="">—</option>
          {Array.from({ length: largestTeam }, (_, at) => at + 1).map((count) => (
            <option key={count} value={count}>
              {count} / {largestTeam}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" size="sm" loading={pending} loadingText={primary(m.saving, language)}>
        {primary(m.save, language)}
      </Button>
      {state.status === "error" && state.message ? (
        <Notice className="w-full" tone="danger" text={state.message} language={language} />
      ) : null}
    </form>
  );
}
