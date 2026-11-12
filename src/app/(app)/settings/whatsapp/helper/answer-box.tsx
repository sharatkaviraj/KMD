"use client";

import { useState } from "react";

import { VoiceNote } from "@/vx/ui/voice";

/**
 * The school's answer to one question: type it, or speak it in Hindi or
 * English with the big microphone. The words go with the form as `answer`;
 * the count turns red past what Veer Patta AI may keep (D-589).
 */
export function AnswerBox({
  initial,
  placeholder,
  max,
  countLabel,
}: {
  initial: string;
  placeholder: string;
  max: number;
  /** "12 / 600 letters", in the reader's language, with {n} for the count. */
  countLabel: string;
}) {
  const [value, setValue] = useState(initial);
  const [lang, setLang] = useState<"hi-IN" | "en-IN">("hi-IN");
  const over = value.trim().length > max;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <VoiceNote value={value} onChange={setValue} name="answer" rows={3} placeholder={placeholder} lang={lang} onLangChange={setLang} />
      <span aria-live="polite" style={{ alignSelf: "flex-end", fontSize: 12, fontWeight: over ? 700 : 500, color: over ? "var(--bad)" : "var(--mut)" }}>
        {countLabel.replace("{n}", String(value.trim().length))}
      </span>
    </div>
  );
}
