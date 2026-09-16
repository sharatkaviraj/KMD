"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";

import { saveClassAliasAction } from "@/app/(app)/academics/actions";
import { m } from "@/messages";
import {
  idleAcademicsState,
  type AcademicsFormState,
} from "@/modules/academics/domain/form-state";
import {
  feeClassName,
  type ClassWithAlias,
} from "@/modules/academics/domain/subjects";
import { flat, primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Badge, Input } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * One row per class, each its own form.
 *
 * Deliberately not one big form with a Save at the bottom: there are nineteen
 * classes, the school fills them in over more than one sitting, and a single
 * submit means an interruption loses the lot. A row saves itself and says so.
 */
function ClassAliasRow({
  row,
  sessionLabel,
  editable,
}: {
  row: ClassWithAlias;
  sessionLabel: string;
  editable: boolean;
}) {
  const language = useLanguage();
  const [state, formAction, isPending] = useActionState<
    AcademicsFormState,
    FormData
  >(saveClassAliasAction, idleAcademicsState);

  const error = state.fieldErrors.timetableLabel ?? null;
  const saved = state.status === "saved";
  const mapped = Boolean(row.alias);

  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="classId" value={row.feeClass.id} />
        <input type="hidden" name="sessionLabel" value={sessionLabel} />
        <input type="hidden" name="sortOrder" value={row.feeClass.sortOrder} />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-foreground">
              {feeClassName(row.feeClass)}
            </p>
            <p className="text-[12px] text-subtle-foreground">
              {flat(m.feeAppClass, language)}
            </p>
          </div>
          {saved ? (
            <Badge tone="success">
              <Check aria-hidden className="size-3" />
              {primary(m.saved, language)}
            </Badge>
          ) : mapped ? (
            <Badge tone="neutral">{primary(m.mapped, language)}</Badge>
          ) : (
            <Badge tone="warning">{primary(m.pending, language)}</Badge>
          )}
        </div>

        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <label
              htmlFor={`label-${row.feeClass.id}`}
              className="mb-1 block text-[13px] font-medium text-muted-foreground"
            >
              {flat(m.timetableLabel, language)}
            </label>
            <Input
              id={`label-${row.feeClass.id}`}
              name="timetableLabel"
              defaultValue={row.alias?.timetableLabel ?? ""}
              placeholder="11-S"
              maxLength={12}
              disabled={!editable}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? `label-${row.feeClass.id}-error` : undefined}
            />
          </div>
          {editable ? (
            <Button
              type="submit"
              variant="outline"
              className="mt-[26px] shrink-0"
              loading={isPending}
              loadingText="…"
            >
              {primary(m.save, language)}
            </Button>
          ) : null}
        </div>

        {error ? (
          <p
            id={`label-${row.feeClass.id}-error`}
            className="text-[13px] text-destructive-soft-foreground"
          >
            {flat(error, language)}
          </p>
        ) : null}

        {state.message ? (
          <p className="text-[13px] text-destructive-soft-foreground">
            {flat(state.message, language)}
          </p>
        ) : null}
      </form>
    </li>
  );
}

export function ClassAliasEditor({
  rows,
  sessionLabel,
  editable,
}: {
  rows: ClassWithAlias[];
  sessionLabel: string;
  editable: boolean;
}) {
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <ClassAliasRow
          key={row.feeClass.id}
          row={row}
          sessionLabel={sessionLabel}
          editable={editable}
        />
      ))}
    </ul>
  );
}
