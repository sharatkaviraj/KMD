"use client";

import { useActionState } from "react";
import Link from "next/link";

import { m } from "@/messages";
import {
  idleAcademicsState,
  type AcademicsFormState,
} from "@/modules/academics/domain/form-state";
import type { Subject } from "@/modules/academics/domain/subjects";
import { flat, primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { Field, Input, Notice } from "@/ui/primitives";

type Action = (
  state: AcademicsFormState,
  formData: FormData,
) => Promise<AcademicsFormState>;

export function SubjectForm({
  action,
  subject,
}: {
  action: Action;
  subject?: Subject;
}) {
  const language = useLanguage();
  const [state, formAction, isPending] = useActionState<
    AcademicsFormState,
    FormData
  >(action, idleAcademicsState);

  const editing = Boolean(subject);
  const error = (field: string): Localized | null =>
    state.fieldErrors[field] ?? null;

  return (
    <form action={formAction} className="space-y-5">
      {subject ? <input type="hidden" name="id" value={subject.id} /> : null}

      {state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <Field label={m.code} htmlFor="code" error={error("code")} language={language}>
        <Input
          id="code"
          name="code"
          defaultValue={subject?.code}
          required={!editing}
          readOnly={editing}
          disabled={editing}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="MATHS"
          maxLength={16}
          className="font-mono uppercase"
          aria-invalid={Boolean(error("code")) || undefined}
          aria-describedby="code-help"
        />
        <p id="code-help" className="text-[13px] leading-5 text-muted-foreground">
          {flat(editing ? m.codeLockedHint : m.codeNewHint, language)}
        </p>
      </Field>

      <Field
        label={m.nameHindi}
        htmlFor="nameHi"
        error={error("nameHi")}
        language={language}
      >
        <Input
          id="nameHi"
          name="nameHi"
          defaultValue={subject?.nameHi}
          required
          placeholder="गणित"
          aria-invalid={Boolean(error("nameHi")) || undefined}
        />
      </Field>

      <Field
        label={m.nameEnglish}
        htmlFor="nameEn"
        error={error("nameEn")}
        language={language}
      >
        <Input
          id="nameEn"
          name="nameEn"
          defaultValue={subject?.nameEn}
          required
          placeholder="Mathematics"
          aria-invalid={Boolean(error("nameEn")) || undefined}
        />
      </Field>

      <Field
        label={m.sortOrder}
        htmlFor="sortOrder"
        error={error("sortOrder")}
        language={language}
      >
        <Input
          id="sortOrder"
          name="sortOrder"
          type="number"
          inputMode="numeric"
          min={0}
          max={999}
          defaultValue={subject?.sortOrder ?? 0}
          aria-invalid={Boolean(error("sortOrder")) || undefined}
          aria-describedby="sortOrder-help"
        />
        <p id="sortOrder-help" className="text-[13px] leading-5 text-muted-foreground">
          {flat(m.sortOrderHint, language)}
        </p>
      </Field>

      <div className="flex gap-3 pt-1">
        <Link
          href="/academics/subjects"
          className={buttonClasses({ variant: "outline" })}
        >
          {primary(m.cancel, language)}
        </Link>
        <Button
          type="submit"
          loading={isPending}
          loadingText={primary(m.saving, language)}
          fullWidth
        >
          {primary(editing ? m.save : m.add, language)}
        </Button>
      </div>
    </form>
  );
}
