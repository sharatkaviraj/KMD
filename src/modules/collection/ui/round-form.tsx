import { Users } from "lucide-react";

import { createRoundAction } from "@/app/(app)/collection/rounds/new/actions";
import * as m from "@/messages/pairs";
import { optionalHalf, requiredHalf } from "@/platform/i18n/authored";
import {
  countOf,
  counted,
  primary,
  type Language,
  type Localized,
} from "@/platform/i18n/language";
import { cn } from "@/platform/utils";
import { Card, Checkbox, Field, Input, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * Choosing who a round asks about, and seeing the answer before creating it.
 *
 * **Two forms on one screen, and that is deliberate.** The top one is a `GET`
 * that only changes the URL — ticking a class reloads the page, and the count
 * underneath it is the real resolver's answer. The bottom one is the `POST`
 * that creates the round, and it carries the same selection as hidden fields,
 * so the thing created is exactly the thing previewed.
 *
 * A **server** component: no `useState`, no fetch, nothing to hydrate. The cost
 * is a page load per tick; the return is a screen that works on a phone on the
 * school's connection, with Back, a shareable URL, and a count nobody can
 * disagree with (D-139).
 */

type ClassOption = { id: string; label: string };
type FieldOption = { id: string; key: string; label: string; under: string | null };

export function NewRoundForm({
  language,
  classes,
  fields,
  audience,
  preview,
  needsReason,
  suggestedReason,
}: {
  language: Language;
  classes: ClassOption[];
  fields: FieldOption[];
  audience: { classIds: string[]; gapKeys: string[]; allEnrolled: boolean };
  preview: { covered: number; beforeGaps: number; classes: number; narrowed: boolean };
  needsReason: boolean;
  suggestedReason: Localized | null;
}) {
  const required = requiredHalf(language);
  const optional = optionalHalf(language);

  const chosenClasses = new Set(audience.classIds);
  const chosenGaps = new Set(audience.gapKeys);
  const nothingChosen =
    audience.classIds.length === 0 && !audience.allEnrolled && audience.gapKeys.length === 0;

  const tile = (on: boolean) =>
    cn(
      "flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3",
      on
        ? "border-accent bg-accent-soft text-accent-soft-foreground"
        : "border-border bg-surface",
    );

  return (
    <div className="space-y-6">
      {/* ------------------------------------------- 1. who, as a GET form */}

      <form method="get" action="/collection/rounds/new">
        <Card className="p-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-[13px] font-medium text-muted-foreground">
              {primary(m.roundClasses, language)}
            </legend>

            <label htmlFor="all-classes" className={tile(audience.allEnrolled)}>
              <input
                type="checkbox"
                id="all-classes"
                name="all"
                value="1"
                defaultChecked={audience.allEnrolled}
                className="size-5 shrink-0"
              />
              <span className="text-[15px]">{primary(m.roundAllClasses, language)}</span>
            </label>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {classes.map((klass) => (
                <label
                  key={klass.id}
                  htmlFor={`class-${klass.id}`}
                  className={tile(chosenClasses.has(klass.id))}
                >
                  <input
                    type="checkbox"
                    id={`class-${klass.id}`}
                    name="class"
                    value={klass.id}
                    defaultChecked={chosenClasses.has(klass.id)}
                    className="size-5 shrink-0"
                  />
                  <span className="truncate text-[14px]">{klass.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-5 space-y-2">
            <legend className="text-[13px] font-medium text-muted-foreground">
              {primary(m.roundGaps, language)}
            </legend>
            <p className="mb-2 text-[12px] leading-5 text-subtle-foreground">
              {primary(m.roundGapsHint, language)}
            </p>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {fields.map((field) => (
                <label
                  key={field.key}
                  htmlFor={`gap-${field.key}`}
                  className={tile(chosenGaps.has(field.key))}
                >
                  <input
                    type="checkbox"
                    id={`gap-${field.key}`}
                    name="gap"
                    value={field.key}
                    defaultChecked={chosenGaps.has(field.key)}
                    className="size-5 shrink-0"
                  />
                  <span className="truncate text-[14px]">{field.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <Button type="submit" variant="outline" fullWidth className="mt-4">
            {primary(m.roundPreviewUpdate, language)}
          </Button>
        </Card>
      </form>

      {/* -------------------------------------------------- 2. the answer */}

      <Card className="p-4">
        {nothingChosen ? (
          <p className="text-[14px] leading-6 text-muted-foreground">
            {primary(m.roundNobody, language)}
          </p>
        ) : preview.covered === 0 ? (
          <p className="text-[14px] leading-6 text-muted-foreground">
            {primary(m.roundNobodyMatched, language)}
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <Users aria-hidden className="size-5 shrink-0 text-accent" />
            <p className="text-[15px] text-foreground">
              <strong className="text-[22px] font-semibold tabular-nums">
                {preview.covered}
              </strong>{" "}
              {primary(
                preview.covered === 1 ? m.roundCoversOne : m.roundCoversMany,
                language,
              )}
              {preview.classes > 0 ? (
                <span className="text-muted-foreground">
                  {" · "}
                  {primary(
                    counted(
                      preview.classes,
                      m.roundAcrossOne,
                      m.roundAcrossMany,
                    ),
                    language,
                  )}
                </span>
              ) : null}
              {/* "9 of 46" — what the filter actually removed. A bare 9 with
                  no denominator is a number nobody can sanity-check. */}
              {preview.narrowed && preview.beforeGaps > preview.covered ? (
                <span className="block text-[13px] text-subtle-foreground">
                  {countOf(preview.covered, preview.beforeGaps, language)}
                </span>
              ) : null}
            </p>
          </div>
        )}
      </Card>

      {/* --------------------------------------- 3. the rest, as a POST form */}

      <form action={createRoundAction} className="space-y-4">
        {/* The same selection the count above was built from, carried across
            so the round created is the round that was previewed. */}
        {audience.classIds.map((id) => (
          <input key={id} type="hidden" name="class" value={id} />
        ))}
        {audience.gapKeys.map((key) => (
          <input key={key} type="hidden" name="gap" value={key} />
        ))}
        {audience.allEnrolled ? <input type="hidden" name="all" value="1" /> : null}

        {/* **One title, in the language the author thinks in** (B-05, D-129). */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={required === "en" ? m.name : m.languageHindi}
            htmlFor={`round-title-${required}`}
            hint={m.authoredTitleHint}
            language={language}
          >
            <Input
              id={`round-title-${required}`}
              name={required === "en" ? "titleEn" : "titleHi"}
              required
              maxLength={120}
            />
          </Field>
          <Field
            label={optional === "en" ? m.name : m.languageHindi}
            htmlFor={`round-title-${optional}`}
            hint={m.authoredOptional}
            language={language}
          >
            <Input
              id={`round-title-${optional}`}
              name={optional === "en" ? "titleEn" : "titleHi"}
              maxLength={120}
            />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-muted-foreground">
            {primary(m.roundWhat, language)}
          </legend>

          <div className="space-y-2">
            {fields.map((field) => (
              <Checkbox
                key={field.id}
                id={`ask-${field.id}`}
                name="fieldIds"
                value={field.id}
                // A round narrowed to the children missing a field arrives
                // asking for that field (the returns board links here with
                // `gap=`); the office can still untick it.
                defaultChecked={audience.gapKeys.includes(field.key)}
                label={{ hi: field.label, en: field.label }}
                language={language}
              />
            ))}
          </div>
        </fieldset>

        <Field label={m.roundWhen} htmlFor="round-due" language={language}>
          <Input type="date" id="round-due" name="dueDate" />
        </Field>

        {needsReason ? (
          <Notice tone="warning" text={m.roundReasonNeeded} language={language} />
        ) : null}

        {/* Both halves, always, and pre-filled from the filters that were
            actually chosen — a teacher surface is bilingual and deriving Hindi
            from English after the fact is not a thing this app can do. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={m.roundWhy} htmlFor="round-reason-hi" language={language}>
            <Input
              id="round-reason-hi"
              name="reasonHi"
              maxLength={300}
              defaultValue={suggestedReason?.hi ?? ""}
            />
          </Field>
          <Field label={m.roundWhy} htmlFor="round-reason-en" language={language}>
            <Input
              id="round-reason-en"
              name="reasonEn"
              maxLength={300}
              defaultValue={suggestedReason?.en ?? ""}
            />
          </Field>
        </div>

        <Button type="submit" fullWidth size="lg" disabled={preview.covered === 0}>
          {primary(m.roundCreate, language)}
        </Button>

      </form>
    </div>
  );
}
