"use client";

import type { ReactNode } from "react";

/*
 * Small pieces the People screens share and the kit does not have: the
 * sticky action bar at the foot of a wizard (desktop: bottom of the page;
 * phone: just above the bottom navigation), and a two-column key/value row.
 */

const BAR_CSS = `
.pp-bar{position:sticky;bottom:0;z-index:15;display:flex;align-items:center;gap:12px;padding:12px 28px;border-top:1px solid var(--bd);background:var(--glass2);-webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4)}
.pp-bar .pp-hint{flex:1;min-width:0;font-size:13px;color:var(--mut)}
@container vx (max-width:899px){.pp-bar{bottom:calc(88px + env(safe-area-inset-bottom));margin:0 12px;border:1px solid var(--bd);border-radius:18px;padding:10px 12px;box-shadow:var(--shh)}.pp-bar .pp-hint{display:none}.pp-bar .btn{flex:1}}
.pp-wrap{max-width:820px;width:100%;margin:0 auto}
.pp-cols{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:start}
@container vx (max-width:899px){.pp-cols{grid-template-columns:minmax(0,1fr)}}
.pp-tiles{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}
@container vx (max-width:899px){.pp-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}
.pp-names{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
@container vx (max-width:899px){.pp-names{grid-template-columns:repeat(2,minmax(0,1fr))}}
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
