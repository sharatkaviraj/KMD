import Link from "@/ui/link";
import type { CSSProperties, ReactNode } from "react";

import type { Language } from "@/platform/i18n/language";
import { Ic, type IconName } from "@/vx/icons";
import { lead, under, type Pair } from "@/vx/text";
import { LangButton } from "@/vx/shell/sidebar";
import { BackLink } from "@/vx/ui/back-link";
import { Pill } from "@/vx/ui/primitives";
import { shortDay, shortDayHi } from "@/vx/format";
import { subjectPair } from "@/vx/screens/exams/domain/groups";

import { attendanceBand, attentionChips, BAND_STYLE, classPair, subjectName, type AttentionFacts, type Chip } from "./domain";

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

/** One class's attendance tile in the heat strip: a full-width tile in its grid cell. */
export function HeatCell({ label, pct, href, title }: { label: string; pct: number | null; href?: string; title?: string }) {
  const band = attendanceBand(pct);
  const s = BAND_STYLE[band];
  const body = (
    <>
      <span className="num" style={{ width: "100%", height: 46, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, background: s.bg, color: s.fg, border: s.border ?? 0 }}>
        {pct === null ? "—" : Math.round(pct)}
      </span>
      <span className="clip" style={{ width: "100%", textAlign: "center", fontSize: 11, color: "var(--mut)", fontWeight: 600 }}>{shortClass(label)}</span>
    </>
  );
  const st: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0, color: "var(--fg)" };
  return href ? (
    <Link href={href} className="tap" style={st} title={title} aria-label={title}>
      {body}
    </Link>
  ) : (
    <span style={st} title={title}>{body}</span>
  );
}

/** The heat strip's grid: one column per class on desktop (`--n`), seven to a row on a phone. */
export function HeatStrip({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div className="acad-heat" style={{ display: "grid", gap: 6, ["--n" as string]: String(Math.max(1, count)) }}>
      {/* Never narrower than a 44px tap target (coordinators U13): with
          nineteen classes the strip wraps rather than shrinking each tile. */}
      <style>{`.acad-heat{grid-template-columns:repeat(auto-fill,minmax(44px,1fr))}`}</style>
      {children}
    </div>
  );
}

/* ------------------------------------------------- the design's small parts */

const AV_TONES = [
  ["var(--accs)", "var(--accfg)"],
  ["var(--infos)", "var(--info)"],
  ["var(--oks)", "var(--ok)"],
  ["var(--warns)", "var(--warnfg)"],
  ["var(--s3)", "var(--fg)"],
] as const;

/** The design's avatar tone: a hash of the name picks one of five soft tones. */
export function toneOf(seed: string): { bg: string; fg: string } {
  let h = 7;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const [bg, fg] = AV_TONES[h % AV_TONES.length];
  return { bg, fg };
}

/** "Ms. Kavita Bhati" → "KB", "Mr. Choudhary" → "C" (the design's initials). */
export function nameInitials(name: string): string {
  return name
    .replace(/^(mr|mrs|ms|dr|shri|smt)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** A round initials avatar in the design's soft tones. */
export function ToneAvatar({ name, size = 36, tone }: { name: string; size?: number; tone?: { bg: string; fg: string } }) {
  const t = tone ?? toneOf(name);
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size, height: size, borderRadius: size / 2, background: t.bg, color: t.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size >= 48 ? 18 : 12, fontWeight: 700 }}>
      {nameInitials(name) || "?"}
    </span>
  );
}

/** How the greeting addresses someone: "Ms. Asha Purohit" → "Ms. Purohit" / "Asha जी". */
export function formalName(name: string): Pair {
  const m = /^(mr|mrs|ms|dr)\.?\s+(.+)$/i.exec(name.trim());
  const words = (m ? m[2] : name).split(/\s+/).filter(Boolean);
  if (!m || words.length < 2) return { en: name, hi: `${words[0] ?? name} जी` };
  return { en: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}. ${words[words.length - 1]}`, hi: `${words[0]} जी` };
}

/** "Thu, 8 Oct" → "Thu 8 Oct", as the design writes days. */
export function dayName(day: string): string {
  return shortDay(day).replace(/,/g, "");
}

/** "Thu 8 Oct 2026". */
export function dayNameYear(day: string): string {
  return `${dayName(day)} ${day.slice(0, 4)}`;
}

/** "गुरु 8 अक्टूबर" — `dayName` for a Hindi reader. */
export function dayNameHi(day: string): string {
  return shortDayHi(day);
}

/** "गुरु 8 अक्टूबर 2026" — `dayNameYear` for a Hindi reader. */
export function dayNameYearHi(day: string): string {
  return `${shortDayHi(day)} ${day.slice(0, 4)}`;
}

/** A subject as a Hindi reader says it ("गणित"), else as the school writes it. */
export function subjectHi(code: string): string {
  return subjectPair(code).hi ?? subjectName(code);
}

/** A child's attention chips, with Hindi subject names for a Hindi reader. */
export function chipsFor(row: AttentionFacts): Chip[] {
  return attentionChips(row, subjectHi);
}

/** "A", "A and B", "A, B and C". */
export function joinAnd(items: string[], and = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

/** The design's card heading: 15px bold title, 12px sub-line, an action on the right. */
export function CardTitle({ title, sub, action, style }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, ...style }}>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
        {sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span> : null}
      </span>
      {action}
    </div>
  );
}

/** A small ghost link with a chevron ("Open ›", "Calendar ›"). */
export function GhostLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="tap btn ghost" style={{ fontSize: 13, flex: "none" }}>
      {children}
      <Ic n="chevRight" size={18} />
    </Link>
  );
}

/**
 * The design's segmented control (`.seg` with a sliding thumb) whose options
 * are links, so each state stays a URL.
 */
export function LinkSeg({ tabs, current, label, style }: { tabs: { key: string; href: string; label: ReactNode }[]; current: string; label: string; style?: CSSProperties }) {
  const n = Math.max(1, tabs.length);
  const at = Math.max(0, tabs.findIndex((t) => t.key === current));
  return (
    <nav aria-label={label} className="seg" style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))`, ...style }}>
      <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${n})`, transform: `translateX(${at * 100}%)` }} />
      {tabs.map((t) => {
        const on = t.key === current;
        return (
          <Link
            key={t.key}
            href={t.href}
            scroll={false}
            replace
            className="tap"
            aria-current={on ? "page" : undefined}
            style={{ position: "relative", height: 34, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 10px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", color: on ? "var(--fg)" : "var(--mut)", transition: "color .2s ease" }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The design's KPI card: label and an icon tile (or a ring), the figure, a pill and a sub-line. */
export function CoordKpi({
  label,
  value,
  href,
  icon,
  tone = "acc",
  ring,
  pill,
  sub,
  delay = 0,
}: {
  label: ReactNode;
  value: ReactNode;
  href?: string;
  icon?: IconName;
  tone?: "ok" | "info" | "acc" | "warn" | "bad" | "mut";
  /** Draw a progress ring (0–100) in place of the icon. */
  ring?: number;
  pill?: { text: ReactNode; tone: "ok" | "info" | "acc" | "warn" | "bad" | "mut" } | null;
  sub?: ReactNode;
  delay?: number;
}) {
  const tones = { ok: ["var(--oks)", "var(--ok)"], info: ["var(--infos)", "var(--info)"], acc: ["var(--accs)", "var(--accfg)"], warn: ["var(--warns)", "var(--warnfg)"], bad: ["var(--bads)", "var(--bad)"], mut: ["var(--s2)", "var(--fg)"] } as const;
  const [bg, fg] = tones[tone];
  const L = ring === undefined ? 0 : Math.max(0.5, (263.9 * Math.min(100, Math.max(0, ring))) / 100);
  const body = (
    <>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--mut)", lineHeight: 1.3 }}>{label}</span>
        {ring !== undefined ? (
          <svg width={40} height={40} viewBox="0 0 100 100" aria-hidden="true" style={{ flex: "none" }}>
            <circle cx={50} cy={50} r={42} fill="none" stroke="var(--s3)" strokeWidth={13} />
            <circle cx={50} cy={50} r={42} fill="none" stroke="var(--acc)" strokeWidth={13} strokeLinecap="round" strokeDasharray={`${L.toFixed(1)} 263.9`} style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", ["--len" as string]: L.toFixed(1), animation: "xDraw .9s var(--ease) both" }} />
          </svg>
        ) : icon ? (
          <span aria-hidden="true" style={{ flex: "none", width: 34, height: 34, borderRadius: 11, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic n={icon} size={17} />
          </span>
        ) : null}
      </span>
      <span className="num" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-.02em" }}>{value}</span>
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {pill ? <Pill tone={pill.tone === "mut" ? "mut" : pill.tone}>{pill.text}</Pill> : null}
        {sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span> : null}
      </span>
    </>
  );
  const style: CSSProperties = { padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0, animationDelay: `${delay}ms`, color: "var(--fg)" };
  return href ? (
    <Link href={href} className="card lift rise tap" style={style}>
      {body}
    </Link>
  ) : (
    <div className="card lift rise" style={style}>
      {body}
    </div>
  );
}

/**
 * The page's top bar, as the design draws it: TopBar's desktop bar with an
 * optional back arrow and the EN | हि switch (the shell's own LangButton),
 * and a phone bar that can open with the reader's avatar on a role's home.
 */
export function CoordTop({
  crumb,
  title,
  actions,
  dBack,
  mTitle,
  mSub,
  mBack,
  mAvatar,
  mAction,
}: {
  crumb?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  dBack?: string;
  mTitle?: ReactNode;
  mSub?: ReactNode;
  mBack?: string;
  mAvatar?: string;
  mAction?: ReactNode;
}) {
  return (
    <>
      <header className="only-d glass vx-top" style={{ flex: "none", height: 64, display: "flex", alignItems: "center", gap: 10, padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
        {dBack ? (
          <BackLink href={dBack} className="tap btn ghost" style={{ width: 40, padding: 0 }}>
            <Ic n="chevLeft" size={20} />
          </BackLink>
        ) : null}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {crumb ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{crumb}</span> : null}
          <h1 className="serif clip" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{title}</h1>
        </div>
        <LangButton tone="page" />
        {actions}
      </header>
      <header className="only-m glass vx-top" style={{ flex: "none", minHeight: 58, display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--bd)" }}>
        {mBack ? (
          <BackLink href={mBack} className="tap icon-btn" style={{ width: 44, height: 44, borderRadius: 22 }}>
            <Ic n="chevLeft" size={24} />
          </BackLink>
        ) : mAvatar ? (
          <span aria-hidden="true" style={{ flex: "none", width: 40, height: 40, borderRadius: 20, margin: "0 4px", background: "#C9D7F8", color: "#082F49", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{mAvatar}</span>
        ) : (
          <span style={{ width: 8 }} />
        )}
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", paddingLeft: 2 }}>
          <span className="clip" style={{ fontSize: 17, fontWeight: 700 }}>{mTitle ?? title}</span>
          {mSub ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{mSub}</span> : null}
        </span>
        <LangButton tone="page" />
        {mAction}
      </header>
    </>
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
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", fontSize: 12, color: "var(--mut)" }}>
      {items.map(([band, text]) => (
        <span key={band} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: BAND_STYLE[band].bg, border: BAND_STYLE[band].border ?? 0, boxSizing: "border-box" }} />
          {text}
        </span>
      ))}
    </div>
  );
}

/**
 * A child on the needs-attention list, as the design draws it: avatar, name
 * and class with a chevron, and the reasons as chips under the name. Rows are
 * separated by a rule (`first` has none).
 */
export function AttentionRow({ child, href, language, trail, delay, first }: { child: AttentionFacts & { studentId: string; name: string; classLabel: string }; href: string; language: Language; trail?: ReactNode; delay?: number; first?: boolean }) {
  const chips = chipsFor(child);
  return (
    <Link href={href} className="row tap" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 6px", borderTop: first ? undefined : "1px solid var(--bd)", color: "var(--fg)", animation: delay !== undefined ? `xIn .3s var(--ease) ${Math.min(delay, 200)}ms both` : undefined }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ToneAvatar name={child.name} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="clip" style={{ fontWeight: 600 }}>{child.name}</span>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{lead(classPair(child.classLabel), language)}</span>
        </span>
        {trail ?? <Ic n="chevRight" size={18} style={{ color: "var(--sub)" }} />}
      </span>
      {chips.length ? (
        <span style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingLeft: 46 }}>
          {chips.map((c, i) => (
            <Pill key={i} tone={c.tone}>{lead(c.text, language)}</Pill>
          ))}
        </span>
      ) : null}
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
