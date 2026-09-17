"use client";

import { useActionState } from "react";
import { Wand2 } from "lucide-react";

import {
  generatePlanAction,
  setCoverAction,
} from "@/app/(app)/substitutions/actions";
import { m } from "@/messages";
import { idleSubsState } from "@/modules/substitutions/domain/form-state";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Notice, Select } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * Work the cover out, and say what happened.
 *
 * Its own form because the result is a sentence — how many periods were
 * allocated, or that nobody is away — and a plain action would have to throw
 * to say anything at all.
 */
export function GeneratePlanButton({
  day,
  again,
}: {
  day: string;
  again: boolean;
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(generatePlanAction, idleSubsState);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="day" value={day} />

      {state.message ? (
        <Notice
          tone={state.status === "error" ? "danger" : "success"}
          text={state.message}
          language={language}
        />
      ) : null}

      <Button
        type="submit"
        fullWidth
        size="lg"
        variant={again ? "outline" : "primary"}
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        <Wand2 aria-hidden />
        {primary(again ? m.subsRegenerate : m.subsGenerate, language)}
      </Button>
    </form>
  );
}

export type CoverOption =
  | { kind: "teacher"; id: string; label: string; detail: string }
  | { kind: "merge"; id: string; label: string; detail: string };

/**
 * Change one row by hand.
 *
 * The options are ordered the way the engine ranks them, so the first name a
 * coordinator sees is the one it would have chosen — and the ones it refused
 * are still there, below, with the reason on them. Hiding a blocked teacher
 * would make the list look shorter than the staff room.
 */
export function CoverChoice({
  day,
  period,
  classId,
  classLabel,
  subjectCode,
  originalStaffId,
  current,
  options,
}: {
  day: string;
  period: number;
  classId: string;
  classLabel: string;
  subjectCode: string | null;
  originalStaffId: string | null;
  current: string;
  options: CoverOption[];
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(setCoverAction, idleSubsState);

  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="classId" value={classId} />
      <input type="hidden" name="classLabel" value={classLabel} />
      <input type="hidden" name="subjectCode" value={subjectCode ?? ""} />
      <input type="hidden" name="originalStaffId" value={originalStaffId ?? ""} />

      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <div className="flex gap-2">
        <Select
          name="choice"
          defaultValue={current}
          aria-label={primary(m.subsChooseTeacher, language)}
          className="min-w-0 flex-1"
        >
          <option value="self_study">{primary(m.subsSetSelfStudy, language)}</option>
          {options.map((option) => (
            <option
              key={`${option.kind}:${option.id}`}
              value={option.kind === "merge" ? `merge:${option.id}:${option.label}` : option.id}
            >
              {option.kind === "merge"
                ? `${primary(m.subsMergeInto, language)} ${option.label}`
                : option.label}
              {option.detail ? ` — ${option.detail}` : ""}
            </option>
          ))}
        </Select>

        <Button
          type="submit"
          variant="outline"
          loading={pending}
          loadingText={primary(m.saving, language)}
        >
          {primary(m.save, language)}
        </Button>
      </div>
    </form>
  );
}
