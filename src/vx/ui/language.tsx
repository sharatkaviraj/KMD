"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";

import { saveLanguageAction } from "@/app/(app)/preferences/actions";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { LANGUAGE_CHOICES, p } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import type { Language } from "@/platform/i18n/language";

/*
 * The reader's language, with all three of its values (PLAN §3a): English,
 * हिंदी, or both. The old EN | हि switch wrote only "en" or "hi", so a
 * teacher who tried it lost "both" for good (smoke 20 Oct, dev.groups[10]).
 * Every language control on the vx screens should be one of these.
 */

export { LANGUAGE_CHOICES };

const T = {
  language: p("Language", "भाषा"),
  choose: p("Choose how the app reads to you", "ऐप आपको किस भाषा में दिखे, चुनें"),
};

/** Writes the reader's stored language and refreshes the screen. */
export function useSetLanguage() {
  const { language } = useVx();
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (next: Language, after?: () => void) =>
    start(async () => {
      if (next !== language) {
        const fd = new FormData();
        fd.set("language", next);
        await saveLanguageAction({ status: "idle", message: null }, fd);
        router.refresh();
      }
      after?.();
    });
  return { language, set, pending };
}

/** The three choices as big rows, for a profile or settings page (or the sheet below). */
export function LanguageChoices({ onDone }: { onDone?: () => void } = {}) {
  const { tx } = useVx();
  const { language, set, pending } = useSetLanguage();
  return (
    <div role="radiogroup" aria-label={tx(T.language)} style={{ display: "flex", flexDirection: "column", gap: 8, opacity: pending ? 0.6 : 1 }}>
      {LANGUAGE_CHOICES.map((c) => {
        const on = c.value === language;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={pending}
            className="tap"
            onClick={() => set(c.value, onDone)}
            style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 56, padding: "10px 14px", borderRadius: 14, border: `1.5px solid ${on ? "var(--acc)" : "var(--bd)"}`, background: on ? "var(--accs)" : "var(--card)", color: "var(--fg)", textAlign: "left" }}
          >
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span lang={c.lang} style={{ fontSize: 16, fontWeight: 700 }}>{c.name}</span>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(c.hint)}</span>
            </span>
            {on ? <Ic n="check" size={20} style={{ color: "var(--acc)" }} /> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The top bar's language control. On a desk, three segments
 * (EN · हि · EN+हि); on a phone, one 44px button that opens the three
 * choices as big rows.
 */
export function LanguageControl({ pill, style }: { pill?: boolean; style?: CSSProperties } = {}) {
  const { tx } = useVx();
  const { language, set, pending } = useSetLanguage();
  const [open, setOpen] = useState(false);
  const idx = Math.max(0, LANGUAGE_CHOICES.findIndex((c) => c.value === language));
  const current = LANGUAGE_CHOICES[idx];
  return (
    <>
      {pill ? null : (
        <div className="seg vx-lang only-d" role="radiogroup" aria-label={tx(T.language)} style={{ opacity: pending ? 0.6 : 1, ...style }}>
          <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 3)", transform: `translateX(${idx * 100}%)` }} />
          {LANGUAGE_CHOICES.map((c) => (
            <button key={c.value} type="button" role="radio" aria-checked={c.value === language} aria-label={c.name} title={tx(c.hint)} lang={c.lang} disabled={pending} className={`tap${c.value === language ? " on" : ""}`} onClick={() => set(c.value)}>
              {c.short}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`tap vx-langb${pill ? "" : " only-m"}`}
        aria-haspopup="dialog"
        aria-label={`${tx(T.language)}: ${current.name}`}
        disabled={pending}
        onClick={() => setOpen(true)}
        style={{ opacity: pending ? 0.6 : 1, ...(pill ? style : null) }}
      >
        <Ic n="globe" size={16} />
        <span lang={current.lang}>{current.short}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={tx(T.language)} sub={tx(T.choose)} icon="globe">
        <LanguageChoices onDone={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
