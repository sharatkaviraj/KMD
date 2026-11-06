"use client";

import { useActionState } from "react";

import { saveLanguageAction, type PreferencesState } from "./actions";
import * as m from "@/messages/pairs";
import { languages, primary, type Language } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { cn } from "@/platform/utils";
import { Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

const idle: PreferencesState = { status: "idle", message: null };

const LABELS: Record<Language, { label: string; under: string }> = {
  // **Each option in its own language, not in the reader's.** Somebody who has
  // ended up on a screen they cannot read needs to recognise the word for
  // their own language; translating "Hindi" into English for a Hindi reader
  // helps only the person who did not need help.
  hi: { label: "हिन्दी", under: "Hindi" },
  en: { label: "English", under: "अंग्रेज़ी" },
  both: { label: "हिन्दी + English", under: "" },
};

export function LanguageForm({ current }: { current: Language }) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(saveLanguageAction, idle);

  return (
    <form action={action} className="space-y-4">
      {state.message ? (
        <Notice
          tone={state.status === "error" ? "danger" : "success"}
          text={state.message}
          language={language}
        />
      ) : null}

      <fieldset className="space-y-2">
        <legend className="sr-only">{primary(m.language, language)}</legend>

        {languages.map((option) => (
          <label
            key={option}
            htmlFor={`language-${option}`}
            className={cn(
              "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3",
              "transition-colors",
              option === current
                ? "border-accent bg-accent-soft text-accent-soft-foreground"
                : "border-border bg-surface hover:bg-surface-2",
            )}
          >
            <input
              type="radio"
              id={`language-${option}`}
              name="language"
              value={option}
              defaultChecked={option === current}
              className="size-5 shrink-0 accent-accent"
            />
            <span className="min-w-0">
              <span className="block text-[16px] font-medium">{LABELS[option].label}</span>
              {LABELS[option].under ? (
                <span className="block text-[13px] text-subtle-foreground">
                  {LABELS[option].under}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>

      <Button type="submit" fullWidth loading={pending} loadingText={primary(m.saving, language)}>
        {primary(m.save, language)}
      </Button>
    </form>
  );
}
