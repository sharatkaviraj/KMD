import type { CSSProperties, ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";

/*
 * Two pieces the Dues sheets share, drawn as the design's `.zrc` radio card
 * and `.zin` inset note.
 */

/** A radio card: 20px ring, a label and a sub-line. */
export function Choice({ on, onPick, label, sub }: { on: boolean; onPick: () => void; label: string; sub?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} className="tap" onClick={onPick} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "10px 14px", borderRadius: 14, border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)", color: "var(--fg)", textAlign: "left", width: "100%" }}>
      <span aria-hidden="true" style={{ flex: "none", width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
        {sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span> : null}
      </span>
    </button>
  );
}

/** An inset note: an icon and a sentence on a soft fill. */
export function Inset({ icon, bg, fg, children, style }: { icon: IconName; bg: string; fg: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, display: "flex", gap: 10, background: bg, color: fg, ...style }}>
      <Ic n={icon} style={{ marginTop: 2 }} />
      <span>{children}</span>
    </div>
  );
}
