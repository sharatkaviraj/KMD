"use client";

import Link from "@/ui/link";
import { useState } from "react";

import type { AiPageData } from "@/modules/assist/data/panel";
import { share } from "@/modules/assist/domain/overview";
import { cue } from "@/ui/feedback/cue";
import { dayMonthP } from "@/vx/format";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";
import { CountUp } from "@/vx/ui/controls";

import { AI_CSS, box, inr, Tile } from "./ai-bits";
import { CostView } from "./ai-cost";
import { FlowView } from "./ai-flow";
import { SwitchesView } from "./ai-switches";
import { UsedView } from "./ai-used";
import { AI_VIEWS, VIEW_WORDS, W, type AiView } from "./words";

/**
 * Settings → AI helper (D-501): the one page for every AI job inside One —
 * written drafts, photos read and voice requests. Four views: what AI did,
 * how each job is routed, what it cost, and the switches. The Claude /
 * ChatGPT connector (MCP) is a different thing and keeps its own page; the
 * hero links to it and says so.
 *
 * The view lives in the address (`?s=ai&v=cost`) so it survives a refresh
 * and can be shared, but switching is instant: client state, with the
 * address updated in place.
 */
export function AiPage({ data, view: initial }: { data: AiPageData; view: AiView }) {
  const { tx } = useVx();
  const [view, setView] = useState<AiView>(initial);
  const o = data.overview;
  const decided = o ? o.tasks.reduce((sum, t) => sum + t.results.kept + t.results.edited + t.results.unused, 0) : 0;
  const kept = o ? o.tasks.reduce((sum, t) => sum + t.results.kept + t.results.edited, 0) : 0;
  const helperOn = data.settings?.enabled ?? false;
  const mode = data.builtin.mode;

  const pick = (next: AiView) => {
    if (next === view) return;
    cue("select");
    setView(next);
    try {
      window.history.replaceState(window.history.state, "", `/settings?s=ai&v=${next}`);
    } catch {
      // The address is a convenience; the view has already changed.
    }
  };

  const stats: { label: Pair; value: number; format?: (v: number) => string; sub?: string; tone?: string }[] = [
    { label: W.jobs, value: o?.jobs ?? 0, sub: o?.failed ? tx(W.failedN(o.failed)) : undefined },
    { label: W.free, value: o?.freeJobs ?? 0, sub: o ? `${share(o.freeJobs, o.jobs)}%` : undefined, tone: "var(--ok)" },
    { label: W.cost, value: o?.costInr ?? 0, format: inr },
    { label: W.kept, value: decided ? share(kept, decided) : 0, format: (v) => `${Math.round(v)}%` },
  ];

  return (
    <div className="aip" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1040 }}>
      <style>{AI_CSS}</style>

      <div className="card" style={{ ...box, gap: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <span style={{ position: "relative", flex: "none" }}>
            <Tile icon="sparkle" tone="acc" size={48} />
            {helperOn ? <span aria-hidden="true" style={{ position: "absolute", inset: -3, borderRadius: 17, border: "2px solid var(--acc)", animation: "xRipple 2.4s ease-out infinite" }} /> : null}
          </span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.25 }}>{tx(W.heroTitle)}</span>
            <span style={{ fontSize: 13.5, color: "var(--mut)", lineHeight: 1.5 }}>{tx(W.heroSub)}</span>
          </span>
        </div>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <StatePill on={helperOn} label={helperOn ? W.writtenOn : W.writtenOff} />
          <StatePill on={mode === "live"} warn={mode === "test"} label={mode === "live" ? W.pvLive : mode === "test" ? W.pvTest : W.pvOff} />
          {!data.configured ? <StatePill on={false} warn label={W.noKey} /> : null}
          <span className="pill" style={{ height: 28, padding: "0 10px", fontSize: 12, background: "var(--s2)", color: "var(--mut)" }}>
            <Ic n="calendar" size={13} />
            {tx(W.monthFrom(dayMonthP(data.from)))}
          </span>
        </span>
        <div className="aip-stats">
          {stats.map((s, i) => (
            <div key={s.label.en} className="aip-stat" style={{ animationDelay: `${i * 70}ms` }}>
              <span style={{ fontSize: 12.5, color: "var(--mut)", fontWeight: 600 }}>{tx(s.label)}</span>
              <b style={{ color: s.tone }}><CountUp value={s.value} format={s.format} /></b>
              {s.sub ? <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{s.sub}</span> : null}
            </div>
          ))}
        </div>
        {data.error && data.error !== "settings" ? (
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--warnfg)" }}><Ic n="alert" size={15} />{tx(W.unread)}</span>
        ) : null}
        <Link href="/settings/ai-connection" className="tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, border: "1px dashed var(--bds)", color: "var(--fg)", textDecoration: "none" }}>
          <Tile icon="link" tone="info" size={36} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{tx(W.connectorTitle)} <span className="pill" style={{ height: 18, padding: "0 6px", fontSize: 10, background: "var(--infos)", color: "var(--info)", verticalAlign: "middle" }}>MCP</span></span>
            <span style={{ fontSize: 12.5, color: "var(--mut)", lineHeight: 1.45 }}>{tx(W.connectorSub)}</span>
          </span>
          <Ic n="arrowRight" size={18} style={{ color: "var(--sub)" }} />
        </Link>
      </div>

      <div className="aip-tabs" role="tablist" aria-label={tx(W.heroTitle)}>
        {AI_VIEWS.map((v) => (
          <button key={v} type="button" role="tab" id={`aip-tab-${v}`} aria-selected={v === view} aria-controls="aip-panel" className="tap aip-tab" onClick={() => pick(v)}>
            <Ic n={VIEW_WORDS[v].icon} size={19} />
            <span>{tx(VIEW_WORDS[v].label)}</span>
          </button>
        ))}
      </div>

      <div key={view} id="aip-panel" role="tabpanel" aria-labelledby={`aip-tab-${view}`} className="aip-view">
        {view === "used" ? <UsedView overview={o} people={data.people} lanes={data.lanes} /> : null}
        {view === "how" ? <FlowView lanes={data.lanes} overview={o} /> : null}
        {view === "cost" ? <CostView data={data} /> : null}
        {view === "switches" ? <SwitchesView key={data.settings?.updatedAt ?? "new"} data={data} /> : null}
      </div>
    </div>
  );
}

function StatePill({ on, warn, label }: { on: boolean; warn?: boolean; label: Pair }) {
  const { tx } = useVx();
  const bg = on ? "var(--oks)" : warn ? "var(--warns)" : "var(--s3)";
  const fg = on ? "var(--ok)" : warn ? "var(--warnfg)" : "var(--mut)";
  return (
    <span className="pill" style={{ height: 28, padding: "0 10px", fontSize: 12, fontWeight: 700, background: bg, color: fg }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 9, background: "currentColor", animation: on ? "xPulse 1.8s ease-in-out infinite" : undefined }} />
      {tx(label)}
    </span>
  );
}
