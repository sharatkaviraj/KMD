"use client";

import { useActionState } from "react";

import { markAbsentAction } from "@/app/(app)/substitutions/actions";
import { m } from "@/messages";
import { idleSubsState } from "@/modules/substitutions/domain/form-state";
import { PeriodPicker } from "@/modules/substitutions/ui/period-picker";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Input, Notice, Select } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/** Mark somebody away — the whole day, or the periods they are gone for. */
export function AbsenceForm({
  day,
  staff,
}: {
  day: string;
  staff: { id: string; displayName: string; shortName: string }[];
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(markAbsentAction, idleSubsState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="day" value={day} />

      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <Field label={m.subsMarkAbsent} htmlFor="absent-staff" language={language}>
        <Select id="absent-staff" name="staffProfileId" required defaultValue="">
          <option value="">—</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName} ({person.shortName})
            </option>
          ))}
        </Select>
      </Field>

      <Field label={m.subsPeriods} htmlFor="absent-periods" language={language}>
        <div id="absent-periods">
          <PeriodPicker name="periods" />
        </div>
      </Field>

      <Field label={m.subsReason} htmlFor="absent-reason" language={language}>
        <Input id="absent-reason" name="reason" maxLength={200} />
      </Field>

      <Button
        type="submit"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(m.subsMarkAbsent, language)}
      </Button>
    </form>
  );
}
