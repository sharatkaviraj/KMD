"use client";

import { useState } from "react";

import { m } from "@/messages";
import { PERIOD_COUNT } from "@/modules/timetable/domain/parse-timetable";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { cn } from "@/platform/utils";

/**
 * Which periods, as eight buttons.
 *
 * A half day is the case this exists for. The whole-day shortcut is first and
 * largest because it is what most absences are — a teacher ringing in ill at
 * seven in the morning is away for all of it, and making that the common path
 * keeps the uncommon one available without charging for it.
 */
export function PeriodPicker({
  name,
  defaultPeriods,
  wholeDayLabel = m.subsWholeDay,
}: {
  name: string;
  defaultPeriods?: number[];
  wholeDayLabel?: Localized;
}) {
  const language = useLanguage();
  const all = Array.from({ length: PERIOD_COUNT }, (_, index) => index);
  const [chosen, setChosen] = useState<number[]>(defaultPeriods ?? all);

  const isWholeDay = chosen.length === PERIOD_COUNT;

  const toggle = (period: number) => {
    setChosen((current) =>
      current.includes(period)
        ? current.filter((entry) => entry !== period)
        : [...current, period].sort((a, b) => a - b),
    );
  };

  return (
    <div className="space-y-2">
      {/* The value the action reads. Hidden inputs rather than checkboxes, so
          the buttons above can be thumb-sized. */}
      {chosen.map((period) => (
        <input key={period} type="hidden" name={name} value={period} />
      ))}

      <button
        type="button"
        onClick={() => setChosen(isWholeDay ? [] : all)}
        aria-pressed={isWholeDay}
        className={cn(
          "focus-ring min-h-11 w-full rounded-xl border text-[14px] font-semibold transition-colors",
          isWholeDay
            ? "border-accent bg-accent-soft text-accent-soft-foreground"
            : "border-border bg-surface text-muted-foreground",
        )}
      >
        {primary(wholeDayLabel, language)}
      </button>

      <div className="grid grid-cols-4 gap-1.5">
        {all.map((period) => {
          const on = chosen.includes(period);
          return (
            <button
              key={period}
              type="button"
              onClick={() => toggle(period)}
              aria-pressed={on}
              aria-label={`${primary(m.teachPeriod, language)} ${periodNumber(period)}`}
              className={cn(
                "focus-ring min-h-11 rounded-xl border text-[13px] font-semibold tabular-nums transition-colors",
                on
                  ? "border-accent bg-accent-soft text-accent-soft-foreground"
                  : "border-border bg-surface text-muted-foreground",
              )}
            >
              {primary(m.subsPeriodShort, language)}
              {periodNumber(period)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
