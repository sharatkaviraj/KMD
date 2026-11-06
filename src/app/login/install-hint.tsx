"use client";

import { Download } from "lucide-react";

import * as m from "@/messages/pairs";
import { primary } from "@/platform/i18n/language";
import { useLang } from "@/platform/locale/language-provider";
import { installPwa, usePwaState } from "@/platform/pwa/store";

/*
 * "Install on your phone or computer", drawn small under the sign-in form and
 * only when there is something to do: the browser offers the install, or an
 * iPhone needs Safari's Add to Home Screen. The design's sign-in screen has
 * no install card; the old always-on card pushed the form off-centre.
 */
export function LoginInstallHint() {
  const state = usePwaState();
  const { locale } = useLang();
  const language = locale === "en" ? "en" : locale === "hi-en" ? "both" : "hi";
  if (state.installed || !(state.installable || state.ios)) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 14, background: "var(--s2)", border: "1px solid var(--bd)", fontSize: 13 }}>
      <Download size={18} aria-hidden style={{ flex: "none", color: "var(--accfg)" }} />
      <span style={{ flex: 1, minWidth: 0, color: "var(--mut)" }}>{primary(state.installable ? m.pwaHint : m.pwaIos, language)}</span>
      {state.installable ? (
        <button type="button" className="tap btn soft" style={{ height: 36, flex: "none" }} onClick={() => void installPwa().catch(() => undefined)}>
          {primary(m.pwaInstall, language)}
        </button>
      ) : null}
    </div>
  );
}
