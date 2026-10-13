"use client";

import Link from "next/link";

import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { type Pair } from "@/vx/text";

export type HubTool = {
  key: string;
  href: string;
  icon: IconName;
  tone: "acc" | "info" | "warn" | "ok";
  title: Pair;
  desc: Pair;
  status: Pair;
  pill?: Pair;
  /** 0–100: draws the small ring beside the status (data quality). */
  ring?: number;
};
export type HubChange = { id: string; text: string; who: string | null; when: string };

const TONE: Record<HubTool["tone"], [string, string]> = {
  acc: ["var(--accs)", "var(--accfg)"],
  info: ["var(--infos)", "var(--info)"],
  warn: ["var(--warns)", "var(--warnfg)"],
  ok: ["var(--oks)", "var(--ok)"],
};

/** Student tools state `hub`: four tool cards and the bulk-change log. */
export function ToolsHub({ tools, history, emptyHistory }: { tools: HubTool[]; history: HubChange[]; emptyHistory: Pair }) {
  const { tx } = useVx();
  return (
    <div className="pad" style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
        {tools.map((t, i) => {
          const [bg, fg] = TONE[t.tone];
          return (
            <Link key={t.key} href={t.href} className="tap lift card" style={{ display: "flex", flexDirection: "column", gap: 14, padding: 18, color: "var(--fg)", animation: `xRise .42s var(--ease) ${i * 60}ms both` }}>
              <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span aria-hidden="true" style={{ flex: "none", width: 52, height: 52, borderRadius: 16, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic n={t.icon} size={24} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 17, fontWeight: 700 }}>{tx(t.title)}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(t.desc)}</span>
                </span>
                <Ic n="chevRight" style={{ color: "var(--sub)" }} />
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 12, borderTop: "1px solid var(--bd)", width: "100%" }}>
                {t.ring !== undefined ? (
                  <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true" style={{ flex: "none", transform: "rotate(-90deg)" }}>
                    <circle cx="18" cy="18" r="15" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 4 }} />
                    <circle cx="18" cy="18" r="15" style={{ fill: "none", stroke: "var(--warn)", strokeWidth: 4, strokeLinecap: "round", strokeDasharray: `${(Math.max(1, 100 - t.ring) / 100) * 94.3} 94.3`, ["--len" as string]: "94.3", animation: "xDraw .9s .2s var(--ease) both" }} />
                  </svg>
                ) : null}
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{tx(t.status)}</span>
                {t.pill ? <span className="pill" style={{ background: "var(--s2)", color: "var(--mut)" }}>{tx(t.pill)}</span> : null}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="card" style={{ padding: "14px 16px" }}>
        <span className="sech">{tx({ en: "Recent bulk changes", hi: "हाल के बड़े बदलाव" })}</span>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
          {history.length === 0 ? <span style={{ fontSize: 12, color: "var(--mut)", padding: "7px 0" }}>{tx(emptyHistory)}</span> : null}
          {history.map((l, i) => (
            <div key={l.id} style={{ display: "grid", gridTemplateColumns: "14px minmax(0,1fr) auto", gap: 10, padding: "7px 0", animation: `xIn .3s var(--ease) ${i * 30}ms both` }}>
              <span style={{ width: 10, height: 10, marginTop: 4, borderRadius: 5, background: "var(--c4)" }} />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 13 }}>{l.text}</span>
                {l.who ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{l.who}</span> : null}
              </span>
              <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{l.when}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
