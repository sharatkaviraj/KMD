"use client";

import { useActionState, useState } from "react";
import { Check, History } from "lucide-react";

import { assignClassTeacherAction } from "@/app/(app)/academics/class-teacher-actions";
import * as m from "@/messages/pairs";
import { listMessages as lm } from "@/messages/setup";
import {
  idleAcademicsState,
  type AcademicsFormState,
} from "@/modules/academics/domain/form-state";
import {
  classTeacherRoleLabels,
  type ClassWithTeachers,
} from "@/modules/academics/domain/class-teachers";
import { feeClassName } from "@/modules/academics/domain/subjects";
import type { StaffProfile } from "@/modules/staff/domain/staff";
import { flat, primary, t } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Badge, Select } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * One row per class, each its own form — the same shape as the class-label
 * editor, for the same reason: nineteen classes get filled in over more than
 * one sitting, and a single Save loses the lot to an interruption.
 */
function ClassTeacherRow({
  row,
  teachers,
  sessionLabel,
  today,
  editable,
}: {
  row: ClassWithTeachers;
  teachers: StaffProfile[];
  sessionLabel: string;
  today: string;
  editable: boolean;
}) {
  const language = useLanguage();
  const [state, formAction, isPending] = useActionState<
    AcademicsFormState,
    FormData
  >(assignClassTeacherAction, idleAcademicsState);
  const [showHistory, setShowHistory] = useState(false);
  // A class that has its teacher shows the name and one button; the hand-over
  // form opens only when asked for. A class with nobody shows the form.
  // Remembering whose hand-over was opened closes it by itself once the
  // save lands: the class then has a different teacher.
  const [changingFrom, setChangingFrom] = useState<string | null>(null);

  const current = row.current.class_teacher ?? null;
  const changing = current !== null && changingFrom === current.staffProfileId;
  const error = state.fieldErrors.staffProfileId ?? state.fieldErrors.effectiveFrom ?? null;
  const saved = state.status === "saved";
  // The current holder plus every closed term. One row means nothing has
  // changed yet, so there is no history worth a toggle.
  const closed = row.history.filter((entry) => entry.effectiveTo !== null);

  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="classId" value={row.feeClass.id} />
        <input type="hidden" name="sessionLabel" value={sessionLabel} />
        <input type="hidden" name="role" value="class_teacher" />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-foreground">
              {feeClassName(row.feeClass)}
            </p>
            <p className="truncate text-[13px] text-muted-foreground">
              {current ? (
                <>
                  {current.staffDisplayName}
                  <span className="ml-1.5 font-mono text-[12px] opacity-70">
                    {current.staffShortName}
                  </span>
                </>
              ) : (
                flat(m.classTeacherNone, language)
              )}
            </p>
          </div>
          {saved ? (
            <Badge tone="success">
              <Check aria-hidden className="size-3" />
              {primary(m.saved, language)}
            </Badge>
          ) : current ? (
            <Badge tone="neutral">
              {primary(classTeacherRoleLabels.class_teacher, language)}
            </Badge>
          ) : (
            <Badge tone="warning">{primary(m.pending, language)}</Badge>
          )}
        </div>

        {editable && current && !changing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            fullWidth
            onClick={() => setChangingFrom(current.staffProfileId)}
          >
            {primary(lm.changeTeacher, language)}
          </Button>
        ) : null}

        {editable && (!current || changing) ? (
          <div className="space-y-2">
            <label
              htmlFor={`teacher-${row.feeClass.id}`}
              className="block text-[13px] font-medium text-muted-foreground"
            >
              {flat(current ? m.classTeacherReplace : m.classTeacherAssign, language)}
            </label>
            <div className="flex gap-2">
              <Select
                id={`teacher-${row.feeClass.id}`}
                name="staffProfileId"
                defaultValue=""
                className="min-w-0 flex-1"
                aria-invalid={Boolean(error) || undefined}
              >
                <option value="">— {primary(m.classTeacherChoose, language)} —</option>
                {teachers.map((teacher) => (
                  <option
                    key={teacher.id}
                    value={teacher.id}
                    // The current holder cannot be reassigned to themselves;
                    // the action refuses it too.
                    disabled={current?.staffProfileId === teacher.id}
                  >
                    {teacher.displayName} · {teacher.shortName}
                  </option>
                ))}
              </Select>
              <Button
                type="submit"
                variant="outline"
                className="shrink-0"
                loading={isPending}
                loadingText="…"
              >
                {primary(m.save, language)}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor={`from-${row.feeClass.id}`}
                className="text-[13px] text-muted-foreground"
              >
                {primary(m.classTeacherFrom, language)}
              </label>
              <input
                id={`from-${row.feeClass.id}`}
                name="effectiveFrom"
                type="date"
                defaultValue={today}
                className="h-11 rounded-xl border border-border bg-surface px-3 text-base text-foreground focus-ring"
              />
            </div>

            {current ? (
              <p className="text-[12px] leading-5 text-subtle-foreground">
                {flat(m.classTeacherReplaceHint, language)}
              </p>
            ) : null}

            {changing ? (
              <Button type="button" variant="ghost" size="sm" fullWidth onClick={() => setChangingFrom(null)}>
                {primary(m.cancel, language)}
              </Button>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="text-[13px] text-destructive-soft-foreground">
            {flat(error, language)}
          </p>
        ) : null}

        {state.message ? (
          <p className="text-[13px] text-destructive-soft-foreground">
            {flat(state.message, language)}
          </p>
        ) : null}

        {closed.length > 0 ? (
          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setShowHistory((open) => !open)}
              className="focus-ring flex min-h-11 items-center gap-2 rounded-lg text-[13px] font-medium text-muted-foreground"
            >
              <History aria-hidden className="size-4" />
              {primary(m.classTeacherHistory, language)} ({closed.length})
            </button>

            {showHistory ? (
              <ul className="mt-2 space-y-1.5">
                {closed.map((entry) => (
                  <li key={entry.id} className="text-[13px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {entry.staffDisplayName}
                    </span>{" "}
                    {entry.effectiveFrom} → {entry.effectiveTo}
                    {entry.replacedReason ? (
                      <span className="block text-[12px] opacity-80">
                        {entry.replacedReason}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>
    </li>
  );
}

export function ClassTeacherEditor({
  rows,
  teachers,
  sessionLabel,
  today,
  editable,
}: {
  rows: ClassWithTeachers[];
  teachers: StaffProfile[];
  sessionLabel: string;
  today: string;
  editable: boolean;
}) {
  const language = useLanguage();

  if (teachers.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border-strong bg-surface-2 px-5 py-8 text-center text-[14px] text-muted-foreground">
        {flat(
          t(
            "पहले ऐसे स्टाफ़ जोड़ें जो कक्षा लेते हैं।",
            "Add staff who teach classes first — only they can be a class teacher.",
          ),
          language,
        )}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <ClassTeacherRow
          key={row.feeClass.id}
          row={row}
          teachers={teachers}
          sessionLabel={sessionLabel}
          today={today}
          editable={editable}
        />
      ))}
    </ul>
  );
}
