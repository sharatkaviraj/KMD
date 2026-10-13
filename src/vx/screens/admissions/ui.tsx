"use client";

import type { CSSProperties, ReactNode } from "react";

import { initials } from "@/vx/format";

/*
 * Small pieces the People screens share and the kit does not have: the
 * sticky action bar at the foot of a wizard (the design's `.bar`: full width
 * on a desk, just above the bottom navigation on a phone), a two-column
 * key/value row, and the design's tinted initials avatar.
 */

const BAR_CSS = `
.pp-bar{position:sticky;bottom:0;z-index:15;margin-top:auto;display:flex;align-items:center;gap:10px;padding:12px 28px;border-top:1px solid var(--bd);background:var(--glass);-webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4)}
.pp-bar .pp-hint{flex:1;min-width:0;font-size:12px;color:var(--mut)}
@container vx (max-width:899px){.pp-bar{bottom:calc(76px + env(safe-area-inset-bottom));padding:10px 16px}.pp-bar .pp-hint{display:none}.pp-bar .btn{flex:1;min-width:0!important}}
.pp-wrap{max-width:860px;width:100%;margin:0 auto}
.pp-page{display:flex;flex-direction:column;min-height:calc(100dvh - 64px)}
@container vx (max-width:899px){.pp-page{min-height:calc(100dvh - 58px - 96px)}}
.pp-cols{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:start}
@container vx (max-width:899px){.pp-cols{grid-template-columns:minmax(0,1fr)}.pp-cols>.pp-off{display:none}}
.pp-pcol{padding:10px;border-radius:18px;background:var(--s2);border:1px solid var(--bd);min-height:236px;display:flex;flex-direction:column;gap:8px}
@container vx (max-width:899px){.pp-pcol{min-height:0}}
.pp-rrow{display:grid;grid-template-columns:minmax(170px,2fr) 64px minmax(110px,1fr) 92px 92px 92px 20px;gap:8px;align-items:center;min-height:56px;padding:0 16px}
@container vx (max-width:899px){.pp-rrow{grid-template-columns:auto auto auto 1fr;padding:12px 14px;gap:8px 6px}.pp-rrow>:first-child{grid-column:1/-1}}
.pp-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px}
.pp-names{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
@container vx (max-width:899px){.pp-names{grid-template-columns:repeat(2,minmax(0,1fr))}}
.pp-g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@container vx (max-width:899px){.pp-g2{grid-template-columns:minmax(0,1fr)}}
.pp-side{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px;align-items:start}
.pp-half{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:start}
@container vx (max-width:899px){.pp-side,.pp-half{grid-template-columns:minmax(0,1fr)}.pp-sticky{position:static!important}}
@media print{.pp-bar{display:none!important}}
`;

export function PeopleStyles() {
  return <style>{BAR_CSS}</style>;
}

export function ActionBar({ hint, hintTone, children }: { hint?: ReactNode; hintTone?: "bad" | "mut"; children: ReactNode }) {
  return (
    <div className="pp-bar">
      <span className="pp-hint" style={hintTone === "bad" ? { color: "var(--bad)", fontWeight: 600 } : undefined} role={hintTone === "bad" ? "alert" : undefined}>
        {hint}
      </span>
      {children}
    </div>
  );
}

export function KV({ k, v, sub }: { k: ReactNode; v: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 12, padding: "10px 0", borderTop: "1px solid var(--bd)", alignItems: "start" }}>
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{k}</span>
        {sub ? <span style={{ fontSize: 11, color: "var(--sub)" }}>{sub}</span> : null}
      </span>
      <span style={{ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}

const TONES: [string, string][] = [
  ["var(--accs)", "var(--accfg)"],
  ["var(--infos)", "var(--info)"],
  ["var(--oks)", "var(--ok)"],
  ["var(--warns)", "var(--warnfg)"],
  ["var(--s3)", "var(--fg)"],
];

/** The design's avatar tint: one of five soft tones, picked by the name. */
export function toneFor(seed: string): [string, string] {
  return TONES[String(seed ?? "").length % TONES.length];
}

export function Av({ name, size = 34, font = 12, serif, style }: { name: string; size?: number; font?: number; serif?: boolean; style?: CSSProperties }) {
  const [bg, fg] = toneFor(name);
  return (
    <span aria-hidden="true" className={serif ? "serif" : undefined} style={{ flex: "none", width: size, height: size, borderRadius: size / 2, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: font, fontWeight: 700, ...style }}>
      {initials(name)}
    </span>
  );
}

/** The design's switch row (`.swr`): label and sub on the left, a switch on the right. */
export function SwitchRow({ label, sub, on, onToggle, border, pill, disabled }: { label: ReactNode; sub?: ReactNode; on: boolean; onToggle: () => void; border?: boolean; pill?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={disabled || undefined}
      onClick={onToggle}
      className="tap"
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 54, padding: "10px 2px", border: 0, borderTop: border ? "1px solid var(--bd)" : 0, background: "transparent", color: "var(--fg)", textAlign: "left" }}
    >
      <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600 }}>
          {label}
          {pill}
        </span>
        {sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span> : null}
      </span>
      <span className={`sw${on ? " on" : ""}`} style={{ opacity: disabled ? 0.45 : 1 }}>
        <span />
      </span>
    </button>
  );
}

/** A radio card (`.rc`): ring, label and an optional sub-line. */
export function RadioTile({ on, onPick, title, sub, children, style }: { on: boolean; onPick: () => void; title?: ReactNode; sub?: ReactNode; children?: ReactNode; style?: CSSProperties }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className="tap"
      style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "10px 14px", borderRadius: 14, border: `1px solid ${on ? "var(--acc)" : "var(--bd)"}`, background: on ? "var(--accs)" : "var(--card)", boxShadow: on ? "inset 0 0 0 1px var(--acc)" : "none", color: "var(--fg)", textAlign: "left", width: "100%", ...style }}
    >
      <span aria-hidden="true" style={{ flex: "none", width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
      </span>
      {children ?? (
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          {sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span> : null}
        </span>
      )}
    </button>
  );
}
