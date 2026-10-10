import type { ReactNode } from "react";

import type { Language } from "@/platform/i18n/language";
import { Ic, type IconName } from "@/vx/icons";
import { lead, under, type Pair } from "@/vx/text";

/*
 * One full-page state for the system screens (P11): a symbol, a sentence,
 * the other language under it, and somewhere to go. No hooks, so 404,
 * 403 and the root not-found can all render it on the server.
 */

const TONES = {
  info: { bg: "var(--accs)", fg: "var(--acc)" },
  warn: { bg: "var(--warns)", fg: "var(--warn)" },
  bad: { bg: "var(--bads)", fg: "var(--bad)" },
  mut: { bg: "var(--s3)", fg: "var(--mut)" },
} as const;

export function StatePanel({
  icon,
  tone = "info",
  title,
  body,
  language,
  code,
  actions,
  children,
}: {
  icon: IconName;
  tone?: keyof typeof TONES;
  title: Pair;
  body?: Pair;
  language: Language;
  /** A big faint number behind the symbol: 404, 403. */
  code?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const t = TONES[tone];
  const titleUnder = under(title, language);
  const bodyUnder = body ? under(body, language) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, padding: "40px 16px", maxWidth: 520, margin: "0 auto", width: "100%" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", height: 96 }}>
        {code ? (
          <span aria-hidden className="serif" style={{ position: "absolute", fontSize: 88, fontWeight: 700, color: "var(--s3)", letterSpacing: "-0.04em", lineHeight: 1 }}>
            {code}
          </span>
        ) : null}
        <span style={{ position: "relative", width: 64, height: 64, borderRadius: 20, background: t.bg, color: t.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Ic n={icon} size={30} />
        </span>
      </div>
      <h1 className="serif" style={{ margin: 0, fontSize: 24, fontWeight: 600, lineHeight: 1.25 }}>
        {lead(title, language)}
        {titleUnder ? <span style={{ display: "block", fontSize: 15, fontWeight: 500, color: "var(--mut)", marginTop: 4 }}>{titleUnder}</span> : null}
      </h1>
      {body ? (
        <p style={{ margin: 0, color: "var(--mut)", lineHeight: 1.5 }}>
          {lead(body, language)}
          {bodyUnder ? <span style={{ display: "block", marginTop: 4 }}>{bodyUnder}</span> : null}
        </p>
      ) : null}
      {children}
      {actions ? <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}>{actions}</div> : null}
    </div>
  );
}
