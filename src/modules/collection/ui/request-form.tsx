"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { Check, CircleAlert } from "lucide-react";

import { submitAnswersAction } from "@/app/r/[token]/actions";
import { draftKey, isStringRecord } from "@/platform/drafts/policy";
import { useDurableDraft } from "@/platform/drafts/use-durable-draft";
import { DraftStatus } from "@/ui/draft-status";
import { recordPerformance } from "@/platform/performance/record";
import { m } from "@/messages";
import {
  validateField,
  type CollectionField,
} from "@/modules/collection/domain/fields";
import { idleLinkState } from "@/modules/collection/domain/link-state";
import type { RollRow } from "@/modules/collection/domain/requests";
import { primary, secondary, type Language } from "@/platform/i18n/language";
import { cn } from "@/platform/utils";
import { Notice } from "@/ui/primitives";
import { ProfilePhotoControl } from "./profile-photo-editor";
import type { PhotoCredential } from "../domain/profile-photo";
import { Button } from "@/ui/primitives/button";

type RequestDraft = { values: Record<string, string>; confirmed: string[] };
function isRequestDraft(value: unknown): value is RequestDraft {
  return Boolean(value && typeof value === "object" && "values" in value && isStringRecord(value.values) && "confirmed" in value && Array.isArray(value.confirmed) && value.confirmed.every(key => typeof key === "string"));
}

/**
 * The form a teacher fills in from a WhatsApp link.
 *
 * She is standing in a corridor with a phone, has never signed in, and may
 * never open this app again. So: one card per child, the school's own answer
 * already in the box, and a "this is right" button that is one tap — because
 * confirming forty numbers has to cost forty taps and not forty minutes.
 *
 * **Blank means no change, never erase.** A child she skips is a child she has
 * not answered for, and a form that read a skipped box as a deletion would
 * empty a register on the first pass.
 *
 * Validation runs here for instant feedback and again on the server, which is
 * the half that counts — see the action.
 */
export function RequestForm({
  token,
  draftScope,
  sessionLabel,
  fields: allFields,
  photoCredential,
  roll,
  language,
  submitAction = submitAnswersAction,
}: {
  token: string;
  draftScope: string;
  sessionLabel: string;
  fields: CollectionField[];
  photoCredential?: PhotoCredential;
  roll: RollRow[];
  language: Language;
  submitAction?: typeof submitAnswersAction;
}) {
  const fields = useMemo(() => allFields.filter(f => f.key !== "student_photo"), [allFields]);

  // Seeded from what the link already received, so reopening it shows her
  // where she actually stopped rather than an untouched list.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const row of roll) {
      for (const field of fields) {
        const answered = row.answered[field.key];
        if (answered !== undefined && answered !== null) {
          seed[`${row.studentId}|${field.key}`] = answered;
        }
      }
    }
    return seed;
  });

  const [confirmed, setConfirmed] = useState<Set<string>>(() => {
    const seed = new Set<string>();
    for (const row of roll) {
      for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(row.answered, field.key)) {
          seed.add(`${row.studentId}|${field.key}`);
        }
      }
    }
    return seed;
  });

  const current = useRef<RequestDraft>({ values, confirmed: [...confirmed] });
  const draft = useDurableDraft(draftKey(`request/${draftScope}`, sessionLabel, "answers"), JSON.stringify({ roll: roll.map(row => ({ id: row.studentId, answered: row.answered, current: row.current })), fields }), isRequestDraft);
  const [state, action, pending] = useActionState(async (previous: typeof idleLinkState, formData: FormData) => {
    try {
      const started = performance.now();
      const result = await submitAction(previous, formData);
      if (result.status === "saved") recordPerformance("form_saved", performance.now() - started);
      if (result.status === "saved") await draft.clear();
      return result;
    } catch { return { ...idleLinkState, status: "error" as const, message: m.notSaved }; }
  }, idleLinkState);
  const edit = (next: RequestDraft) => {
    if (pending) return;
    current.current = next;
    setValues(next.values); setConfirmed(new Set(next.confirmed));
    void draft.persist(next);
  };
  const restore = () => {
    const saved = draft.recovered?.value;
    if (!saved || pending) return;
    const known = new Set(roll.flatMap(row => fields.map(field => `${row.studentId}|${field.key}`)));
    edit({ values: Object.fromEntries(Object.entries(saved.values).filter(([key]) => known.has(key))), confirmed: saved.confirmed.filter(key => known.has(key)) });
    draft.dismissRecovery();
  };

  const errors = useMemo(() => {
    const found: Record<string, string> = {};
    for (const row of roll) {
      for (const field of fields) {
        const key = `${row.studentId}|${field.key}`;
        const raw = values[key];
        if (raw === undefined || raw === "") continue;
        const checked = validateField(field, raw);
        if (!checked.ok) found[key] = primary(checked.error, language);
      }
    }
    return found;
  }, [values, roll, fields, language]);

  const touched = Object.keys(values).length + confirmed.size;
  const hasErrors = Object.keys(errors).length > 0;

  const payload = useMemo(() => {
    const out: { studentId: string; key: string; value: string }[] = [];

    for (const row of roll) {
      for (const field of fields) {
        const key = `${row.studentId}|${field.key}`;
        const typed = values[key];

        if (typed !== undefined && typed !== "") {
          out.push({ studentId: row.studentId, key: field.key, value: typed });
        } else if (confirmed.has(key)) {
          // "This is right" is a real answer and has to reach the server, or
          // the office cannot tell a confirmed row from an untouched one. It
          // carries an empty value, which the review queue reads as unchanged.
          out.push({ studentId: row.studentId, key: field.key, value: "" });
        }
      }
    }

    return out;
  }, [values, confirmed, roll, fields]);

  const set = (key: string, value: string) => edit({ values: { ...current.current.values, [key]: value }, confirmed: current.current.confirmed.filter(id => id !== key) });
  const confirm = (key: string) => {
    const next = { ...current.current.values };
    delete next[key];
    edit({ values: next, confirmed: [...new Set([...current.current.confirmed, key])] });
  };

  if (roll.length === 0) {
    return <Notice tone="warning" text={m.linkRollEmpty} language={language} />;
  }

  return (
    <form action={action} aria-busy={pending} data-work-form="true" onSubmit={event => {
      (event.currentTarget.elements.namedItem("payload") as HTMLInputElement).value = JSON.stringify(payload);
    }} className="space-y-3 pb-28">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="payload" defaultValue="" />

      <DraftStatus status={draft.status} online={draft.online} recovered={Boolean(draft.recovered)} changed={draft.changedSinceDraft} onRestore={restore} onDiscard={() => { if (!pending) void draft.discard(); }} language={language} />
      {state.message ? (
        <Notice
          tone={state.status === "error" ? "danger" : "success"}
          text={state.message}
          language={language}
        />
      ) : null}

      <fieldset disabled={pending} className="min-w-0"><ul className="space-y-2">
        {roll.map((row) => (
          <li
            key={row.studentId}
            className="rounded-2xl border border-border bg-surface p-3"
          >
            <div className="mb-2 flex items-baseline gap-2">
              <span className="w-7 shrink-0 text-[13px] font-semibold tabular-nums text-subtle-foreground">
                {row.rollNo ?? "—"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-foreground">
                  {row.fullName}
                </span>
                {row.fatherName ? (
                  <span className="block truncate text-[12px] text-subtle-foreground">
                    {row.fatherName}
                  </span>
                ) : null}
              </span>
            </div>

            <div className="space-y-2.5">
              {allFields.map((field) => {
                if (field.key === "student_photo") return <ProfilePhotoControl key={field.id} credential={photoCredential ?? {kind:"request",token}} studentId={row.studentId} language={language} />;
                const key = `${row.studentId}|${field.key}`;
                const held = row.current[field.key] ?? "";
                const typed = values[key];
                const isConfirmed = confirmed.has(key);
                const error = errors[key];
                const under = secondary({ hi: field.labelHi, en: field.labelEn }, language);

                return (
                  <div key={field.key}>
                    <label
                      htmlFor={key}
                      className="mb-1 block text-[13px] font-medium text-muted-foreground"
                    >
                      {language === "en" ? field.labelEn : field.labelHi}
                      {under ? (
                        <span className="ml-1.5 text-subtle-foreground">{under}</span>
                      ) : null}
                    </label>

                    {/* A `confirm` field leads with what the school holds and
                        one button to say it is right. Typing is still there,
                        under it, for the times it is not. */}
                    {field.mode === "confirm" && held && typed === undefined ? (
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate rounded-xl border border-border bg-surface-2 px-3 py-2 text-[15px] text-foreground">
                          {held}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            isConfirmed ? set(key, "") : confirm(key)
                          }
                          aria-pressed={isConfirmed}
                          className={cn(
                            "focus-ring min-h-11 shrink-0 rounded-xl border px-3 text-[13px] font-semibold transition-colors",
                            isConfirmed
                              ? "border-success bg-success-soft text-success-soft-foreground"
                              : "border-border bg-surface text-muted-foreground",
                          )}
                        >
                          {isConfirmed ? (
                            <Check aria-hidden className="size-4" />
                          ) : (
                            primary(m.linkUnchanged, language)
                          )}
                        </button>
                      </div>
                    ) : null}

                    {field.mode === "collect" || !held || typed !== undefined ? (
                      <Input
                        id={key}
                        field={field}
                        language={language}
                        value={typed ?? ""}
                        onChange={(next) => set(key, next)}
                        invalid={Boolean(error)}
                      />
                    ) : null}

                    {field.mode === "confirm" && held && typed === undefined ? (
                      <button
                        type="button"
                        onClick={() => set(key, "")}
                        className="focus-ring mt-1 rounded text-[12px] font-medium text-accent"
                      >
                        {primary(m.linkChange, language)}
                      </button>
                    ) : null}

                    {error ? (
                      <p className="mt-1 flex items-center gap-1 text-[12px] text-destructive-soft-foreground">
                        <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                        {error}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul></fieldset>

      {fields.length > 0 ? <div className="work-action safe-bottom fixed inset-x-0 bottom-0 border-t border-border bg-background px-4 pt-3">
        <div className="mx-auto max-w-md">
          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={pending}
            loadingText={primary(m.saving, language)}
            disabled={touched === 0 || hasErrors || !draft.online}
          >
            {primary(m.linkSaveAll, language)}
            {touched > 0 ? ` (${payload.length})` : ""}
          </Button>
          <p className="mt-1.5 pb-3 text-center text-[12px] text-subtle-foreground">
            {hasErrors
              ? primary(m.somethingWrong, language)
              : primary(m.linkSaved, language)}
          </p>
        </div>
      </div> : null}
    </form>
  );
}

/** The right input for the field's own type, so the phone shows the right keyboard. */
function Input({
  id,
  field,
  value,
  onChange,
  invalid,
  language,
}: {
  id: string;
  field: CollectionField;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  language: Language;
}) {
  const shared =
    "focus-ring w-full rounded-xl border bg-surface px-3 py-2 text-base text-foreground " +
    (invalid ? "border-destructive" : "border-border");

  if (field.inputType === "select") {
    return (
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${shared} h-12 appearance-none pr-9`}
      >
        <option value="">—</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.inputType === "boolean") {
    return (
      <div className="grid grid-cols-2 gap-2">
        {[
          { value: "yes", label: m.yes },
          { value: "no", label: m.no },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(value === option.value ? "" : option.value)}
            aria-pressed={value === option.value}
            className={cn(
              "focus-ring min-h-11 rounded-xl border text-[14px] font-semibold transition-colors",
              value === option.value
                ? "border-accent bg-accent-soft text-accent-soft-foreground"
                : "border-border bg-surface text-muted-foreground",
            )}
          >
            {primary(option.label, language)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <input
      id={id}
      // `inputMode` rather than `type="number"`: a numeric keyboard without the
      // spinner, the scroll-to-change behaviour, or the silent truncation of a
      // leading zero that `type="number"` does to a phone number.
      inputMode={
        field.inputType === "tel" || field.inputType === "number"
          ? "numeric"
          : "text"
      }
      type={field.inputType === "date" ? "date" : "text"}
      maxLength={field.exactLen ?? undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={invalid}
      className={`${shared} h-12`}
    />
  );
}
