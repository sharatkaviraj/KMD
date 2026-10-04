"use client";

import { useActionState } from "react";

import { saveAttendanceRulesAction } from "@/app/(app)/academics/actions";
import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { idleAcademicsState } from "@/modules/academics/domain/form-state";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Input, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * How much a half day counts (P6). One number, because it is one rule: the
 * register, the student card, the monthly sheet and the report card all read
 * it, so changing it here changes every percentage the same way at once.
 */
export function AttendanceRulesForm({ halfDayCredit }: { halfDayCredit: number }) {
  const language = useLanguage();
  const [state, save, saving] = useActionState(saveAttendanceRulesAction, idleAcademicsState);

  return (
    <form action={save} className="space-y-3">
      {state.status === "saved" ? (
        <Notice tone="success" text={ms.attendanceRulesSaved} language={language} />
      ) : null}
      {state.message ? <Notice tone="danger" text={state.message} language={language} /> : null}
      <Field
        label={ms.attendanceRulesHalfDay}
        htmlFor="half-day-credit"
        hint={ms.attendanceRulesHalfDayHint}
        error={state.fieldErrors.halfDayCredit ?? null}
        language={language}
      >
        <Input
          id="half-day-credit"
          name="halfDayCredit"
          type="number"
          inputMode="decimal"
          min={0}
          max={1}
          step={0.05}
          required
          defaultValue={halfDayCredit}
          aria-describedby="half-day-credit-hint"
        />
      </Field>
      <Button type="submit" variant="outline" loading={saving} loadingText={primary(m.saving, language)}>
        {primary(m.save, language)}
      </Button>
    </form>
  );
}
