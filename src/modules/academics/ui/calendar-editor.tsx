"use client";

import { useActionState } from "react";
import { Check, Trash2 } from "lucide-react";

import {
  deleteCalendarDayAction,
  saveCalendarDayAction,
} from "@/app/(app)/academics/class-teacher-actions";
import * as m from "@/messages/pairs";
import {
  calendarDayKinds,
  calendarKindLabels,
  groupByMonth,
  KIND_IS_SCHOOL_OPEN,
  type CalendarDay,
} from "@/modules/academics/domain/calendar";
import {
  idleAcademicsState,
  type AcademicsFormState,
} from "@/modules/academics/domain/form-state";
import { flat, primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Badge, Field, Input, Notice, Select } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";

const TONE_FOR_KIND = {
  instructional: "success",
  holiday: "danger",
  exam: "accent",
  event: "info",
  vacation: "neutral",
} as const;

/** "2026-08" -> "August 2026" / "अगस्त 2026", in the reader's language. */
function monthLabel(month: string, locale: string): string {
  const [year, monthNumber] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(monthNumber) - 1, 1)).toLocaleDateString(
    locale,
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
}

function dayNumber(day: string): string {
  return String(Number(day.slice(8, 10)));
}

export function CalendarEditor({
  days,
  sessionLabel,
  today,
  editable,
}: {
  days: CalendarDay[];
  sessionLabel: string;
  today: string;
  editable: boolean;
}) {
  const language = useLanguage();
  const [state, formAction, isPending] = useActionState<
    AcademicsFormState,
    FormData
  >(saveCalendarDayAction, idleAcademicsState);

  const locale = language === "en" ? "en-IN" : "hi-IN";
  const months = groupByMonth(days);
  const error = (field: string): Localized | null =>
    state.fieldErrors[field] ?? null;

  return (
    <div className="space-y-6">
      {editable ? (
        <form action={formAction} className="space-y-4 rounded-2xl border border-border bg-surface p-4">
          <input type="hidden" name="sessionLabel" value={sessionLabel} />

          <p className="text-[15px] font-semibold text-foreground">
            {flat(m.calendarAdd, language)}
          </p>

          {state.status === "saved" ? (
            <Badge tone="success">
              <Check aria-hidden className="size-3" />
              {primary(m.saved, language)}
            </Badge>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={m.calendarDate}
              htmlFor="day"
              error={error("day")}
              language={language}
            >
              <Input id="day" name="day" type="date" defaultValue={today} required />
            </Field>

            <Field
              label={m.calendarUntil}
              htmlFor="until"
              error={error("until")}
              language={language}
            >
              <Input id="until" name="until" type="date" aria-describedby="until-help" />
              <p id="until-help" className="text-[13px] leading-5 text-muted-foreground">
                {flat(m.calendarUntilHint, language)}
              </p>
            </Field>
          </div>

          <Field
            label={m.calendarKind}
            htmlFor="kind"
            error={error("kind")}
            language={language}
          >
            <Select id="kind" name="kind" defaultValue="holiday">
              {calendarDayKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {flat(calendarKindLabels[kind], language)}
                  {KIND_IS_SCHOOL_OPEN[kind]
                    ? ` — ${primary(m.calendarSchoolOpen, language)}`
                    : ` — ${primary(m.calendarSchoolClosed, language)}`}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={m.calendarLabelHi}
              htmlFor="labelHi"
              error={error("labelHi")}
              language={language}
            >
              <Input id="labelHi" name="labelHi" placeholder="स्वतंत्रता दिवस" />
            </Field>
            <Field
              label={m.calendarLabelEn}
              htmlFor="labelEn"
              error={error("labelEn")}
              language={language}
            >
              <Input id="labelEn" name="labelEn" placeholder="Independence Day" />
            </Field>
          </div>

          {state.message ? (
            <Notice tone="danger" text={state.message} language={language} />
          ) : null}

          <Button
            type="submit"
            loading={isPending}
            loadingText={primary(m.saving, language)}
            fullWidth
          >
            {primary(m.calendarAdd, language)}
          </Button>
        </form>
      ) : null}

      {days.length === 0 ? (
        <EmptyState title={m.calendarNone} language={language} />
      ) : (
        <div className="space-y-5">
          {months.map(({ month, days: entries }) => (
            <section key={month}>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-subtle-foreground">
                {monthLabel(month, locale)}
              </h2>
              <ul className="space-y-1.5">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5"
                  >
                    <span
                      aria-hidden
                      className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[15px] font-bold tabular-nums text-foreground"
                    >
                      {dayNumber(entry.day)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-foreground">
                        {(language === "en" ? entry.labelEn : entry.labelHi) ??
                          entry.labelEn ??
                          entry.labelHi ??
                          primary(calendarKindLabels[entry.kind], language)}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {primary(
                          KIND_IS_SCHOOL_OPEN[entry.kind]
                            ? m.calendarSchoolOpen
                            : m.calendarSchoolClosed,
                          language,
                        )}
                      </span>
                    </span>

                    <Badge tone={TONE_FOR_KIND[entry.kind]}>
                      {primary(calendarKindLabels[entry.kind], language)}
                    </Badge>

                    {editable ? (
                      <form action={deleteCalendarDayAction} className="shrink-0">
                        <input type="hidden" name="id" value={entry.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon"
                          aria-label={flat(m.remove, language)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
