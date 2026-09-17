"use client";

import { useActionState } from "react";
import { Check, Download, TriangleAlert } from "lucide-react";

import {
  checkAskListAction,
  createFromAskListAction,
} from "@/app/(app)/collection/rounds/upload/actions";
import { m } from "@/messages";
import { idleAskList } from "@/modules/collection/domain/form-state";
import type { MissReason } from "@/modules/collection/domain/ask-list";
import { optionalHalf, requiredHalf } from "@/platform/i18n/authored";
import { primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Card, Checkbox, Field, Input, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { buttonClasses } from "@/ui/primitives/button";

/**
 * A list of specific children the office typed out.
 *
 * **Two steps, and the first one creates nothing.** A list of thirty-five that
 * quietly becomes a round of thirty-one is the worst thing this can do — the
 * office believes it asked about everyone, and the four it dropped are the
 * four whose rows were already wrong. So the sheet is matched, what did not
 * match is named by row number, and only then is there a button.
 */

const MISS_LABELS: Record<MissReason, Localized> = {
  "no-identifier": m.askListMissNoIdentifier,
  "not-found": m.askListMissNotFound,
  "not-enrolled": m.askListMissNotEnrolled,
  "already-listed": m.askListMissAlreadyListed,
};

export function AskListForm({
  fields,
}: {
  fields: { id: string; label: string }[];
}) {
  const language = useLanguage();
  const required = requiredHalf(language);
  const optional = optionalHalf(language);
  const [state, check, checking] = useActionState(checkAskListAction, idleAskList);

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------- 1. the template */}

      <Card className="p-4">
        <p className="text-[14px] leading-6 text-muted-foreground">
          {primary(m.askListHint, language)}
        </p>
        <a
          href="/collection/rounds/template"
          download
          className={buttonClasses({ variant: "outline", className: "mt-3 w-full" })}
        >
          <Download aria-hidden />
          {primary(m.askListTemplate, language)}
        </a>
      </Card>

      {/* ------------------------------------------------ 2. the check */}

      <form action={check} className="space-y-3">
        {state.status === "error" && state.message ? (
          <Notice tone="danger" text={state.message} language={language} />
        ) : null}

        <Field label={m.askListChoose} htmlFor="ask-file" language={language}>
          <input
            type="file"
            id="ask-file"
            name="file"
            accept=".csv,text/csv"
            required
            className="focus-ring block min-h-12 w-full rounded-xl border border-border bg-surface px-3 py-2 text-[14px]"
          />
        </Field>

        <Button type="submit" variant="outline" fullWidth loading={checking}>
          {primary(m.askListCheck, language)}
        </Button>
      </form>

      {/* ------------------------------------- 3. what did and did not match */}

      {state.status === "matched" ? (
        <>
          {state.unmatched.length > 0 ? (
            <Card className="p-4">
              <p className="flex items-center gap-2 text-[15px] font-medium text-foreground">
                <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
                {primary(m.askListUnmatched, language)}: {state.unmatched.length}
              </p>

              {/* By row number, because that is the number Excel shows down
                  the left and the only one the office can act on. */}
              <ul className="mt-3 space-y-2">
                {state.unmatched.map((miss) => (
                  <li key={miss.rowNumber} className="text-[13px] leading-5">
                    <span className="font-mono text-subtle-foreground">
                      {primary(m.askListRow, language)} {miss.rowNumber}
                    </span>
                    {/* Real spaces, not margins. A margin separates pixels; a
                        screen reader and a copy-paste into the message to
                        whoever fixes the sheet both read the text, and that
                        ran together as "Row 4NOPE-404Somebody Missing". */}
                    {miss.admissionNo ? (
                      <>
                        {" "}
                        <span className="font-mono">{miss.admissionNo}</span>
                      </>
                    ) : null}
                    {miss.name ? (
                      <>
                        {" "}
                        <span>{miss.name}</span>
                      </>
                    ) : null}
                    <span className="block text-muted-foreground">
                      {primary(MISS_LABELS[miss.reason], language)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Notice tone="success" text={m.askListAllMatched} language={language} />
          )}

          {state.matched.length > 0 ? (
            <form action={createFromAskListAction} className="space-y-4">
              <Card className="p-4">
                <p className="flex items-center gap-2 text-[15px] font-medium text-foreground">
                  <Check aria-hidden className="size-4 shrink-0 text-success" />
                  {primary(m.askListMatched, language)}: {state.matched.length}
                </p>

                <ul className="mt-3 space-y-1">
                  {state.matched.map((row) => (
                    <li key={row.studentId} className="text-[13px] leading-5">
                      <span>{row.fullName}</span>
                      {row.admissionNo ? (
                        <>
                          {" "}
                          <span className="font-mono text-subtle-foreground">
                            {row.admissionNo}
                          </span>
                        </>
                      ) : null}
                      {row.note ? (
                        <span className="block text-muted-foreground">{row.note}</span>
                      ) : null}

                      {/* The ids and the notes travel in the form, not in a
                          second parse of the file: the office has now *seen*
                          this list, and re-reading the upload would let
                          another tab decide who was asked about. */}
                      <input type="hidden" name="studentIds" value={row.studentId} />
                      {row.note ? (
                        <input
                          type="hidden"
                          name={`note:${row.studentId}`}
                          value={row.note}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={required === "en" ? m.name : m.languageHindi}
                  htmlFor={`ask-title-${required}`}
                  hint={m.authoredTitleHint}
                  language={language}
                >
                  <Input
                    id={`ask-title-${required}`}
                    name={required === "en" ? "titleEn" : "titleHi"}
                    required
                    maxLength={120}
                  />
                </Field>
                <Field
                  label={optional === "en" ? m.name : m.languageHindi}
                  htmlFor={`ask-title-${optional}`}
                  hint={m.authoredOptional}
                  language={language}
                >
                  <Input
                    id={`ask-title-${optional}`}
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
                      id={`ask-field-${field.id}`}
                      name="fieldIds"
                      value={field.id}
                      label={{ hi: field.label, en: field.label }}
                      language={language}
                    />
                  ))}
                </div>
              </fieldset>

              <Field label={m.roundWhen} htmlFor="ask-due" language={language}>
                <Input type="date" id="ask-due" name="dueDate" />
              </Field>

              {/* An uploaded list always narrows, so it always needs a reason:
                  a teacher handed nine of her forty-six with no explanation
                  assumes the link is broken (S-03). */}
              <Notice tone="warning" text={m.roundReasonNeeded} language={language} />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={m.roundWhy} htmlFor="ask-reason-hi" language={language}>
                  <Input id="ask-reason-hi" name="reasonHi" maxLength={300} />
                </Field>
                <Field label={m.roundWhy} htmlFor="ask-reason-en" language={language}>
                  <Input id="ask-reason-en" name="reasonEn" maxLength={300} />
                </Field>
              </div>

              <Button type="submit" fullWidth size="lg">
                {primary(m.roundCreate, language)}
              </Button>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
