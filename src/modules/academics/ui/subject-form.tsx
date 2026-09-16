"use client";

import { useActionState } from "react";
import Link from "next/link";

import {
  idleAcademicsState,
  type AcademicsFormState,
} from "@/modules/academics/domain/form-state";
import type { Subject } from "@/modules/academics/domain/subjects";
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
  const [state, formAction, isPending] = useActionState<
    AcademicsFormState,
    FormData
  >(action, idleAcademicsState);

  const editing = Boolean(subject);
  const error = (field: string) => state.fieldErrors[field] ?? null;

  return (
    <form action={formAction} className="space-y-5">
      {subject ? <input type="hidden" name="id" value={subject.id} /> : null}

      {state.message ? (
        <Notice tone="danger" hi={state.message} en={state.messageEn ?? undefined} />
      ) : null}

      <Field label="कोड" hint="Code" htmlFor="code" error={error("code")}>
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
          {editing
            ? "कोड बदला नहीं जा सकता · The code cannot be changed"
            : "समय-सारिणी की शीट में यह विषय जिस नाम से लिखा है। · Exactly as the timetable sheet writes it."}
        </p>
      </Field>

      <Field label="हिन्दी नाम" hint="Hindi name" htmlFor="nameHi" error={error("nameHi")}>
        <Input
          id="nameHi"
          name="nameHi"
          defaultValue={subject?.nameHi}
          required
          placeholder="गणित"
          aria-invalid={Boolean(error("nameHi")) || undefined}
        />
      </Field>

      <Field label="English name" hint="" htmlFor="nameEn" error={error("nameEn")}>
        <Input
          id="nameEn"
          name="nameEn"
          defaultValue={subject?.nameEn}
          required
          placeholder="Mathematics"
          aria-invalid={Boolean(error("nameEn")) || undefined}
        />
      </Field>

      <Field label="क्रम" hint="Order" htmlFor="sortOrder" error={error("sortOrder")}>
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
          छोटा नंबर पहले दिखेगा। · Lower numbers come first in lists and report cards.
        </p>
      </Field>

      <div className="flex gap-3 pt-1">
        <Link
          href="/academics/subjects"
          className={buttonClasses({ variant: "outline" })}
        >
          रद्द करें
        </Link>
        <Button type="submit" loading={isPending} loadingText="सहेजा जा रहा है…" fullWidth>
          {editing ? "बदलाव सहेजें" : "जोड़ें"}
        </Button>
      </div>
    </form>
  );
}
