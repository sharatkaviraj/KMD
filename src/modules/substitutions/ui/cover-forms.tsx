"use client";

import { m } from "@/messages";
import { CoverCommandForm } from "@/modules/substitutions/ui/cover-command";
import { PeriodPicker } from "@/modules/substitutions/ui/period-picker";
import { flat, primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Select } from "@/ui/primitives";

/*
 * The cover screen's forms. Each is one cover command (cover-command.tsx);
 * none of them writes anything itself, and none asks for a reason — why a
 * colleague is away is not the app's business and never goes in a notice
 * (PLAN §5: "without asking for a medical reason").
 */

/** Teacher, whole day or periods, one button. */
export function AbsenceCommandForm({
  day,
  dayRevision,
  staff,
}: {
  day: string;
  dayRevision: number;
  staff: { id: string; displayName: string; shortName: string }[];
}) {
  const language = useLanguage();

  return (
    <CoverCommandForm
      intent="absence"
      day={day}
      dayRevision={dayRevision}
      label={m.coverSaveAbsence}
      size="lg"
      fullWidth
      resetOnSave
      className="space-y-4"
    >
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
    </CoverCommandForm>
  );
}

export type CoverChoice = {
  id: string;
  label: string;
  /** Tier and warnings, or why they cannot. */
  detail: string;
  blocked: boolean;
};

/** Put a person on a duty — the coordinator's choice, pinned against re-planning. */
export function AssignCommandForm({
  day,
  dayRevision,
  needKey,
  choices,
  current,
}: {
  day: string;
  dayRevision: number;
  needKey: string;
  choices: CoverChoice[];
  current: string | null;
}) {
  const language = useLanguage();
  const fieldId = `assign-${needKey.replace(/[^a-z0-9]/gi, "").slice(-24)}`;

  return (
    <CoverCommandForm
      intent="assign"
      day={day}
      dayRevision={dayRevision}
      label={m.coverAssign}
      hidden={{ needKey }}
      size="sm"
      className="mt-3 space-y-2"
    >
      <label htmlFor={fieldId} className="sr-only">
        {flat(m.coverChooseTeacher, language)}
      </label>
      <Select id={fieldId} name="coveringStaffId" required defaultValue={current ?? ""}>
        <option value="">{primary(m.coverChooseTeacher, language)}</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id} disabled={choice.blocked}>
            {choice.label}
            {choice.detail ? ` — ${choice.detail}` : ""}
          </option>
        ))}
      </Select>
    </CoverCommandForm>
  );
}

export function ReleaseCommandForm({
  day,
  dayRevision,
  needKey,
}: {
  day: string;
  dayRevision: number;
  needKey: string;
}) {
  return (
    <CoverCommandForm
      intent="release"
      day={day}
      dayRevision={dayRevision}
      label={m.coverRelease}
      hidden={{ needKey }}
      variant="ghost"
      size="sm"
      className="mt-2"
    />
  );
}

export function BackAtSchoolForm({
  day,
  dayRevision,
  staffProfileId,
}: {
  day: string;
  dayRevision: number;
  staffProfileId: string;
}) {
  return (
    <CoverCommandForm
      intent="clear_absence"
      day={day}
      dayRevision={dayRevision}
      label={m.coverBackAtSchool}
      hidden={{ staffProfileId }}
      variant="outline"
      size="sm"
    />
  );
}

export function RearrangeForm({ day, dayRevision }: { day: string; dayRevision: number }) {
  return (
    <CoverCommandForm
      intent="refresh"
      day={day}
      dayRevision={dayRevision}
      label={m.coverRearrange}
      variant="outline"
      size="sm"
    />
  );
}
