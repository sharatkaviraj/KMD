import type { CSSProperties } from "react";

import type { Pair } from "@/vx/text";

/*
 * The card preview's subject picture and effort panel (D-612), the same
 * figures the printed card shows. The card is a bilingual document, so this
 * prints both languages, as the rest of the preview does. Every line is
 * worked out on the server (`card-insight-words.ts`); this only draws.
 */

type Trend = "up" | "steady" | "down";
type Words = { en: string; hi: string };

export type CardInsightView = {
  subjects: { subject: Pair; percent: number | null; classAvg: number | null; trend: Trend | null }[];
  journey: { name: Pair; percent: number | null; classAvg: number | null }[];
  growth: Words | null;
  trend: Trend | null;
  effort: (Words & { trend: Trend })[];
  strengths: Words | null;
  focus: Words | null;
  /** The share a subject needs (33%); a bar under it is red. */
  passLine: number;
};

const TREND_COLOUR: Record<Trend, string> = { up: "var(--ok)", steady: "var(--mut)", down: "var(--bad)" };
const TREND_MARK: Record<Trend, string> = { up: "▲", steady: "▬", down: "▼" };

const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, borderRadius: 10, border: "1px solid var(--bd)", padding: "12px 14px", minWidth: 0 };
const heading: CSSProperties = { fontSize: 13, fontWeight: 700 };
const small: CSSProperties = { fontSize: 11, color: "var(--mut)" };

function barColour(pct: number, line: number): string {
  if (pct < line) return "var(--bad)";
  if (pct >= 75) return "var(--ok)";
  return "var(--acc)";
}

function Mark({ trend }: { trend: Trend }) {
  return (
    <span aria-hidden style={{ color: TREND_COLOUR[trend], fontSize: 10, width: 12, flex: "none", textAlign: "center" }}>
      {TREND_MARK[trend]}
    </span>
  );
}

function Journey({ points }: { points: CardInsightView["journey"] }) {
  const values = points.flatMap((p) => [p.percent, p.classAvg]).filter((v): v is number => v !== null);
  if (!points.some((p) => p.percent !== null)) return null;
  let lo = Math.max(0, Math.floor((Math.min(...values) - 8) / 10) * 10);
  let hi = Math.min(100, Math.ceil((Math.max(...values) + 8) / 10) * 10);
  if (hi - lo < 30) [lo, hi] = [Math.max(0, hi - 30), Math.max(hi, 30)];
  const W = 300;
  const H = 84;
  const pad = 26;
  const x = (i: number) => (points.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (points.length - 1));
  const y = (v: number) => H - 6 - ((H - 12) * (Math.max(lo, Math.min(hi, v)) - lo)) / (hi - lo);
  const line = (key: "percent" | "classAvg") =>
    points
      .map((p, i) => (p[key] === null ? null : `${x(i)},${y(p[key] as number)}`))
      .filter(Boolean)
      .join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Term, exam by exam: the child beside the class average">
        {[lo, (lo + hi) / 2, hi].map((g) => (
          <line key={g} x1={pad - 10} x2={W - pad + 10} y1={y(g)} y2={y(g)} stroke="var(--bd)" strokeWidth={1} />
        ))}
        <polyline points={line("classAvg")} fill="none" stroke="var(--warn)" strokeWidth={2} strokeDasharray="5 4" />
        <polyline points={line("percent")} fill="none" stroke="var(--acc)" strokeWidth={2.5} />
        {points.map((p, i) => (p.percent === null ? null : <circle key={i} cx={x(i)} cy={y(p.percent)} r={4} fill="var(--acc)" />))}
      </svg>
      <div style={{ position: "relative", height: 46 }}>
        {points.map((p, i) => (
          <span key={i} style={{ position: "absolute", left: `${(x(i) / W) * 100}%`, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", whiteSpace: "nowrap" }}>
            <span style={small}>{p.name.en}</span>
            <span className="num" style={{ fontWeight: 700, fontSize: 13 }}>{p.percent === null ? "—" : `${Math.round(p.percent)}%`}</span>
            <span className="num" style={{ ...small, color: "var(--warnfg)" }}>{p.classAvg === null ? "" : `class ${Math.round(p.classAvg)}%`}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function CardInsightPanel({ insight }: { insight: CardInsightView }) {
  return (
    <>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
        <div style={box}>
          <span style={heading}>
            <span lang="hi">विषयवार</span> · Subject by subject
          </span>
          <span style={{ ...small, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>
              <span aria-hidden style={{ display: "inline-block", width: 12, height: 6, borderRadius: 3, background: "var(--acc)", marginRight: 4 }} />
              your child · <span lang="hi">आपका बच्चा</span>
            </span>
            <span>
              <span aria-hidden style={{ display: "inline-block", width: 2, height: 10, background: "var(--warn)", marginRight: 4, verticalAlign: "middle" }} />
              class average · <span lang="hi">कक्षा औसत</span>
            </span>
          </span>
          {insight.subjects.map((s) => {
            const pct = s.percent ?? 0;
            return (
              <div key={s.subject.en} style={{ display: "grid", gridTemplateColumns: "minmax(0,92px) minmax(0,1fr) 40px", alignItems: "center", gap: 8 }}>
                <span className="clip" style={{ fontSize: 12, fontWeight: 600 }} title={s.subject.hi ? `${s.subject.en} · ${s.subject.hi}` : s.subject.en}>
                  {s.subject.en}
                </span>
                <span style={{ position: "relative", height: 10, borderRadius: 5, background: "var(--s2)" }}>
                  {s.percent !== null ? <span style={{ position: "absolute", inset: "0 auto 0 0", width: `${Math.max(2, Math.min(100, pct))}%`, borderRadius: 5, background: barColour(pct, insight.passLine) }} /> : null}
                  {s.classAvg !== null ? <span title={`class ${Math.round(s.classAvg)}%`} style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${Math.min(100, s.classAvg)}% - 1px)`, width: 2, background: "var(--warn)" }} /> : null}
                </span>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, textAlign: "right" }}>{s.percent === null ? "—" : `${Math.round(pct)}%`}</span>
              </div>
            );
          })}
        </div>
        <div style={box}>
          <span style={heading}>
            <span lang="hi">प्रयास विश्लेषण</span> · Effort analysis
          </span>
          <span style={{ ...small, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>
              <span aria-hidden style={{ display: "inline-block", width: 14, height: 3, background: "var(--acc)", marginRight: 4, verticalAlign: "middle" }} />
              your child · <span lang="hi">आपका बच्चा</span>
            </span>
            <span>
              <span aria-hidden style={{ display: "inline-block", width: 14, borderTop: "2px dashed var(--warn)", marginRight: 4, verticalAlign: "middle" }} />
              class average · <span lang="hi">कक्षा औसत</span>
            </span>
          </span>
          <Journey points={insight.journey} />
          {insight.growth ? (
            <span style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
              {insight.trend ? <Mark trend={insight.trend} /> : null}
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: insight.trend ? TREND_COLOUR[insight.trend] : undefined }}>{insight.growth.en}</span>
                <span lang="hi" style={small}>{insight.growth.hi}</span>
              </span>
            </span>
          ) : null}
          {insight.effort.map((l) => (
            <span key={l.trend} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
              <Mark trend={l.trend} />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 12 }}>{l.en}</span>
                <span lang="hi" style={small}>{l.hi}</span>
              </span>
            </span>
          ))}
          {!insight.effort.length ? <span style={small}>Shown once the child has sat two exams of the term · <span lang="hi">दो परीक्षाओं के बाद दिखेगा</span></span> : null}
        </div>
      </div>
      {insight.strengths || insight.focus ? (
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
          {insight.strengths ? (
            <span style={{ display: "flex", flexDirection: "column", borderRadius: 10, padding: "10px 12px", background: "var(--oks)", color: "var(--ok)" }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{insight.strengths.en}</span>
              <span lang="hi" style={{ fontSize: 12 }}>{insight.strengths.hi}</span>
            </span>
          ) : null}
          {insight.focus ? (
            <span style={{ display: "flex", flexDirection: "column", borderRadius: 10, padding: "10px 12px", background: "var(--warns)", color: "var(--warnfg)" }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{insight.focus.en}</span>
              <span lang="hi" style={{ fontSize: 12 }}>{insight.focus.hi}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
