"use client";

import { useActionState } from "react";

import { saveCoverPolicyAction } from "@/app/(app)/substitutions/actions";
import * as m from "@/messages/pairs";
import { idleSubsState } from "@/modules/substitutions/domain/form-state";
import {
  coverRoleHints,
  coverRoleLabels,
  coverRoles,
  type CoverRole,
} from "@/modules/substitutions/domain/policies";
import { PeriodPicker } from "@/modules/substitutions/ui/period-picker";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Input, Notice, Select } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * One member of staff's cover policy.
 *
 * Its own form per row, like the class-label editor in task 1.4: this is
 * filled in over more than one sitting, and a single save button for
 * twenty-one people is a save button nobody presses.
 */
export function PolicyForm({
  staffProfileId,
  allowedPeriods,
  coverRole,
  maxAutoCovers,
  note,
}: {
  staffProfileId: string;
  allowedPeriods: number[];
  coverRole: CoverRole;
  maxAutoCovers: number;
  note: string | null;
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(saveCoverPolicyAction, idleSubsState);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="staffProfileId" value={staffProfileId} />

      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <Field
        label={m.subsOnSite}
        htmlFor={`periods-${staffProfileId}`}
        language={language}
      >
        <div id={`periods-${staffProfileId}`}>
          <PeriodPicker name="allowedPeriods" defaultPeriods={allowedPeriods} />
        </div>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.subsRole} htmlFor={`role-${staffProfileId}`} language={language}>
          <Select
            id={`role-${staffProfileId}`}
            name="coverRole"
            defaultValue={coverRole}
          >
            {coverRoles.map((role) => (
              <option key={role} value={role}>
                {primary(coverRoleLabels[role], language)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={m.subsMaxAuto}
          htmlFor={`max-${staffProfileId}`}
          language={language}
        >
          <Input
            id={`max-${staffProfileId}`}
            name="maxAutoCovers"
            type="number"
            inputMode="numeric"
            min={0}
            max={8}
            defaultValue={maxAutoCovers}
          />
        </Field>
      </div>

      <p className="text-[12px] leading-5 text-subtle-foreground">
        {primary(coverRoleHints[coverRole], language)}
      </p>

      <Field
        label={m.subsPolicyNote}
        htmlFor={`note-${staffProfileId}`}
        language={language}
      >
        <Input
          id={`note-${staffProfileId}`}
          name="note"
          maxLength={120}
          defaultValue={note ?? ""}
        />
      </Field>

      <Button
        type="submit"
        variant="outline"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(state.status === "saved" ? m.saved : m.save, language)}
      </Button>
    </form>
  );
}
