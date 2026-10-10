import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import type { Language } from "@/platform/i18n/language";
import { Ic, type IconName } from "@/vx/icons";
import { lead, under, type Pair } from "@/vx/text";
import { Avatar, Pill } from "@/vx/ui/primitives";
import { initials } from "@/vx/format";

import { attendanceBand, attentionChips, BAND_STYLE, type AttentionFacts } from "./domain";

/*
 * Server-rendered pieces shared by the coordinator's three screens. Strings
 * are pairs read in the viewer's language (`lead`), never hard-coded.
 */

export type Say = (en: string, hi?: string) => string;

export function sayer(language: Language): Say {
  return (en, hi) => lead(hi ? { en, hi } : { en }, language);
}

/** Lead line with the other language small underneath, server-side. */
export function Two({ pair, language, style }: { pair: Pair; language: Language; style?: CSSProperties }) {
  const second = under(pair, language);
  return (
    <span style={{ display: "flex", flexDirection: "column", minWidth: 0, ...style }}>
      <span>{lead(pair, language)}</span>
      {second ? <span style={{ fontSize: "0.78em", fontWeight: 500, color: "var(--mut)" }}>{second}</span> : null}
    </span>
  );
}

/** Tabs that are links (`?view=`), so every state is a URL. */
export function LinkTabs({ tabs, current, label }: { tabs: { key: string; href: string; label: ReactNode; icon?: IconName; badge?: number }[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="hs" style={{ display: "flex", gap: 4, padding: 4, borderRadius: 16, background: "var(--s2)", width: "fit-content", maxWidth: "100%" }}>
      {tabs.map((t) => {
        const on = t.key === current;
        return (
          <Link
            key={t.key}
            href={t.href}
            scroll={false}
            className="tap"
            aria-current={on ? "page" : undefined}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 12, fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", background: on ? "var(--card)" : "transparent", color: on ? "var(--fg)" : "var(--mut)", boxShadow: on ? "var(--shl)" : undefined }}
          >
            {t.icon ? <Ic n={t.icon} size={17} /> : null}
            {t.label}
            {t.badge ? (
              <span className="num" style={{ minWidth: 20, height: 20, padding: "0 6px", borderRadius: 10, background: "var(--bad)", color: "var(--onsolid)", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{t.badge}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** One class's attendance tile in the heat strip. */
export function HeatCell({ label, pct, href, title }: { label: string; pct: number | null; href?: string; title?: string }) {
  const band = attendanceBand(pct);
  const s = BAND_STYLE[band];
  const body = (
    <>
      <span className="num" style={{ width: 40, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, background: s.bg, color: s.fg, border: s.border }}>
        {pct === null ? "—" : Math.round(pct)}
      </span>
      <span style={{ fontSize: 11, color: "var(--mut)", fontWeight: 600, whiteSpace: "nowrap" }}>{shortClass(label)}</span>
    </>
  );
  const st: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 4 };
  return href ? (
    <Link href={href} className="tap" style={st} title={title} aria-label={title}>
      {body}
    </Link>
  ) : (
    <span style={st} title={title}>{body}</span>
  );
}

/** "Class 11 Science" → "11 S", "Nursery" → "Nur", for the narrow strip. */
export function shortClass(label: string): string {
  const m = /^Class\s+(\d+)\s*(.*)$/i.exec(label.trim());
  if (m) return m[2] ? `${m[1]} ${m[2][0].toUpperCase()}` : m[1];
  if (/^nursery$/i.test(label)) return "Nur";
  return label.length > 4 ? label.slice(0, 4) : label;
}

export function HeatLegend({ say }: { say: Say }) {
  const items: [keyof typeof BAND_STYLE, string][] = [
    ["top", "95%+"],
    ["good", "90–95"],
    ["fair", "85–90"],
    ["low", say("Below 85", "85 से कम")],
    ["none", say("Not marked", "दर्ज नहीं")],
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12, color: "var(--mut)" }}>
      {items.map(([band, text]) => (
        <span key={band} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: BAND_STYLE[band].bg, border: BAND_STYLE[band].border ?? undefined }} />
          {text}
        </span>
      ))}
    </div>
  );
}

/** A child on the needs-attention list: avatar, name, class, the chips. */
export function AttentionRow({ child, href, language, trail, delay }: { child: AttentionFacts & { studentId: string; name: string; classLabel: string }; href: string; language: Language; trail?: ReactNode; delay?: number }) {
  const chips = attentionChips(child);
  return (
    <Link href={href} className="row tap" style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--bd)", animation: delay !== undefined ? `xIn .32s var(--ease) ${Math.min(delay, 400)}ms both` : undefined }}>
      <Avatar text={initials(child.name)} seed={child.studentId} size={40} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="clip" style={{ fontWeight: 700 }}>{child.name}</span>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{child.classLabel}</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c, i) => (
            <Pill key={i} tone={c.tone}>{lead(c.text, language)}</Pill>
          ))}
        </span>
      </span>
      {trail ?? <Ic n="chevRight" size={18} style={{ color: "var(--mut)", marginTop: 10 }} />}
    </Link>
  );
}

/** Event kinds: colour and words, one meaning everywhere (Calendar legend). */
export const EVENT_KINDS: Record<string, { label: Pair; fg: string; bg: string; dot: string }> = {
  holiday: { label: { en: "Holiday", hi: "अवकाश" }, fg: "var(--bad)", bg: "var(--bads)", dot: "var(--bad)" },
  exam: { label: { en: "Exam", hi: "परीक्षा" }, fg: "var(--info)", bg: "var(--infos)", dot: "var(--info)" },
  event: { label: { en: "Event", hi: "कार्यक्रम" }, fg: "var(--accfg)", bg: "var(--accs)", dot: "var(--acc)" },
  ptm: { label: { en: "PTM", hi: "अभिभावक बैठक" }, fg: "var(--warnfg)", bg: "var(--warns)", dot: "var(--warn)" },
  meeting: { label: { en: "Meeting", hi: "बैठक" }, fg: "var(--pri)", bg: "var(--s2)", dot: "var(--pri)" },
  fee_due: { label: { en: "Fee due", hi: "फीस देय" }, fg: "var(--mut)", bg: "var(--s3)", dot: "var(--mut)" },
  vacation: { label: { en: "Vacation", hi: "छुट्टियाँ" }, fg: "var(--bad)", bg: "var(--bads)", dot: "var(--bad)" },
};

export function kindOf(kind: string) {
  return EVENT_KINDS[kind] ?? EVENT_KINDS.event;
}

/** A small card with an icon tile, a title and a sub-line — the "Look closer" links. */
export function LinkCard({ href, icon, title, sub, tone = "acc", badge }: { href: string; icon: IconName; title: ReactNode; sub?: ReactNode; tone?: "acc" | "bad" | "warn" | "info"; badge?: ReactNode }) {
  const tones = { acc: ["var(--accs)", "var(--accfg)"], bad: ["var(--bads)", "var(--bad)"], warn: ["var(--warns)", "var(--warnfg)"], info: ["var(--infos)", "var(--info)"] } as const;
  const [bg, fg] = tones[tone];
  return (
    <Link href={href} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--bd)" }}>
      <span style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Ic n={icon} size={20} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}>{title}{badge}</span>
        {sub ? <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{sub}</span> : null}
      </span>
      <Ic n="chevRight" size={18} style={{ color: "var(--mut)" }} />
    </Link>
  );
}

/** A query string from the params that matter, dropping empty ones. */
export function qs(base: string, params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/** First value of a search param. */
export function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
