import type { ReactNode } from "react";

import type { AmountChoice, AmountChoiceKey, LineError } from "@/modules/payments/domain/online/pay-breakdown";
import { PAY_COPY, type Bilingual } from "@/modules/payments/domain/online/pay-page-copy";
import { formatInr } from "@/platform/helpers/currency";

import { BRAND, Both } from "./pay-ui";

/**
 * How a parent says how much: cards to tap, not a box to discover. "Due so
 * far" or "Whole year" in one tap; "Other amount" opens a big number box with
 * the phone's number pad. Owner's decision, 2026-10-30.
 */

export type CheckoutChild = {
  index: number;
  firstName: string;
  classLabel: string;
  choices: AmountChoice[];
  min: number;
  max: number;
};

export type Selection = { kind: AmountChoiceKey | "other" | "skip"; other: string };

export function defaultSelection(child: CheckoutChild): Selection {
  if (child.max <= 0) return { kind: "skip", other: "" };
  return { kind: child.choices[0]?.key ?? "other", other: "" };
}

/** What the selection pays for this child; null for "not now" or an empty box. */
export function selectedAmount(child: CheckoutChild, selection: Selection): number | null {
  if (selection.kind === "skip") return null;
  if (selection.kind === "other") {
    const raw = selection.other.trim();
    return raw === "" ? null : Number(raw);
  }
  return child.choices.find((choice) => choice.key === selection.kind)?.amount ?? null;
}

export function errorCopy(error: LineError, min: number, max: number): Bilingual {
  if (error === "below_min") return PAY_COPY.error.below_min(formatInr(min));
  if (error === "above_max") return PAY_COPY.error.above_max(formatInr(max));
  return PAY_COPY.error.not_whole;
}

function Card({
  checked,
  disabled,
  onSelect,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={`focus-ring flex min-h-[60px] w-full items-center gap-3 rounded-xl border-2 px-3.5 py-2 text-left transition-colors ${
        checked ? "bg-sky-50" : "border-border bg-card"
      }`}
      style={checked ? { borderColor: BRAND } : undefined}
    >
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
        style={{ borderColor: checked ? BRAND : "#94a3b8" }}
      >
        {checked ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BRAND }} /> : null}
      </span>
      {children}
    </button>
  );
}

export function AmountChoices({
  child,
  selection,
  error,
  disabled,
  onChange,
}: {
  child: CheckoutChild;
  selection: Selection;
  error: LineError | undefined;
  disabled?: boolean;
  onChange: (next: Selection) => void;
}) {
  if (child.max <= 0) {
    return <Both text={PAY_COPY.nothingOwed} className="text-base font-semibold text-emerald-800" />;
  }
  return (
    <div role="radiogroup" aria-label={PAY_COPY.amountFor(child.firstName).en} className="flex flex-col gap-2">
      {child.choices.map((choice) => (
        <Card
          key={choice.key}
          checked={selection.kind === choice.key}
          disabled={disabled}
          onSelect={() => onChange({ ...selection, kind: choice.key })}
        >
          <span className="min-w-0 flex-1">
            <Both text={PAY_COPY.choice[choice.key]} className="text-base font-semibold text-foreground" />
            {choice.lateFee > 0 ? (
              <span className="block text-xs font-semibold text-red-700">
                {PAY_COPY.lateFeeIncluded(formatInr(choice.lateFee)).hi}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-lg font-bold tabular-nums text-foreground">{formatInr(choice.amount)}</span>
        </Card>
      ))}
      <Card checked={selection.kind === "other"} disabled={disabled} onSelect={() => onChange({ ...selection, kind: "other" })}>
        <span className="min-w-0 flex-1">
          <Both text={PAY_COPY.choice.other} className="text-base font-semibold text-foreground" />
        </span>
        <span aria-hidden="true" className="shrink-0 text-lg">
          ✏️
        </span>
      </Card>
      {selection.kind === "other" ? (
        <div className="flex flex-col gap-1 pl-1">
          <input
            type="number"
            inputMode="numeric"
            autoFocus
            min={child.min}
            max={child.max}
            step={1}
            value={selection.other}
            disabled={disabled}
            placeholder={formatInr(child.min)}
            aria-label={PAY_COPY.amountFor(child.firstName).en}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange({ ...selection, other: event.target.value })}
            className="focus-ring h-14 w-full rounded-xl border-2 border-border bg-background px-4 text-2xl font-bold tabular-nums text-foreground"
          />
          {error ? (
            <span className="text-sm font-semibold text-red-700">{errorCopy(error, child.min, child.max).hi}</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {PAY_COPY.otherHint(formatInr(child.min), formatInr(child.max)).hi}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
