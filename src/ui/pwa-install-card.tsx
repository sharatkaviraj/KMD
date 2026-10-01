"use client";
import { m } from "@/messages";
import { primary } from "@/platform/i18n/language";
import { useLang } from "@/platform/locale/language-provider";
import { installPwa, usePwaState } from "@/platform/pwa/store";
export function PwaInstallCard() {
  const state = usePwaState();
  const { locale } = useLang();
  const language = locale === "en" ? "en" : locale === "hi-en" ? "both" : "hi";
  return <section className="mt-7 rounded-2xl border border-border bg-surface p-4">
    <h2 className="font-semibold">{primary(m.pwaTitle, language)}</h2>
    <p className="mt-2 text-sm text-muted-foreground">{primary(state.installed ? m.pwaInstalled : state.ios ? m.pwaIos : state.installable ? m.pwaHint : m.pwaManual, language)}</p>
    {state.installable && !state.installed ? <button type="button" onClick={() => void installPwa().catch(() => undefined)} className="focus-ring mt-3 min-h-12 rounded-xl bg-accent px-5 font-semibold text-accent-foreground">{primary(m.pwaInstall, language)}</button> : null}
  </section>;
}
