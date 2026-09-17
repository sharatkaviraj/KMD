"use client";

import { useActionState } from "react";

import { writeNoteAction } from "@/app/(app)/teach/actions";
import { m } from "@/messages";
import {
  activeKinds,
  type NoteKind,
} from "@/modules/notes/domain/notes";
import { idleTeachState } from "@/modules/attendance/domain/teach-state";
import { primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Notice, Select, Textarea } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * Write a note about a child or a class.
 *
 * The kind comes first and the text second, which is the order the school
 * already uses in a register margin — and it means a note can be found later
 * by what it was about rather than by reading every one.
 */
export function NoteComposer({
  kinds,
  studentId = "",
  classId = "",
  label = m.notesWrite,
}: {
  kinds: NoteKind[];
  studentId?: string;
  classId?: string;
  label?: Localized;
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(writeNoteAction, idleTeachState);
  const available = activeKinds(kinds);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="classId" value={classId} />

      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      {state.status === "saved" && state.message ? (
        <Notice tone="success" text={state.message} language={language} />
      ) : null}

      <Field label={m.notesKind} htmlFor="note-kind" language={language}>
        <Select id="note-kind" name="kindId" required defaultValue="">
          <option value="">—</option>
          {available.map((kind) => (
            <option key={kind.id} value={kind.id}>
              {language === "en" ? kind.labelEn : kind.labelHi}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={m.notesBody} htmlFor="note-body" language={language}>
        <Textarea
          id="note-body"
          name="body"
          required
          minLength={3}
          maxLength={1000}
          rows={3}
        />
      </Field>

      <Button
        type="submit"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(label, language)}
      </Button>
    </form>
  );
}
