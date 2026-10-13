import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { BackLink } from "@/vx/ui/back-link";

/*
 * The Exams design's own small pieces (design/src/Exams.dc.html): its top bar
 * (a Back arrow on the desk too), its rings (a 100-unit circle of radius 42,
 * so the stroke never touches the edge), its 8px bars, the timeline/log dot
 * and the fact rows. Drawn here, exactly as the design draws them, so the
 * shared kit stays as it is for every other screen.
 */

const C = 263.9; // 2πr for r = 42

/** The design's ring: `viewBox 0 0 100 100`, r 42, stroke in those units. */
export function XRing({ pct, size, stroke, tone = "var(--acc)", track = "var(--s3)", butt, children }: { pct: number; size: number; stroke: number; tone?: string; track?: string; butt?: boolean; children?: ReactNode }) {
  const len = Math.max(0.5, (C * Math.min(100, Math.max(0, pct))) / 100);
  return (
    <div style={{ position: "relative", flex: "none", width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="42" fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap={butt ? "butt" : "round"}
          strokeDasharray={`${len.toFixed(1)} ${C}`}
          style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", ["--len" as string]: len.toFixed(1), animation: "xDraw .9s var(--ease) both", transition: "stroke-dasharray .5s var(--ease)" }}
        />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>{children}</span>
    </div>
  );
}

/** The design's bar: 8px, radius 4, `--s3` track, parts side by side. */
export function XBar({ parts, height = 8, style }: { parts: { w: number; color: string; key?: string }[]; height?: number; style?: CSSProperties }) {
  return (
    <div style={{ height, borderRadius: 4, background: "var(--s3)", overflow: "hidden", display: "flex", flex: "none", ...style }}>
      {parts.map((p, i) => (
        <span key={p.key ?? i} style={{ height: "100%", width: `${Math.max(0, Math.min(100, p.w)).toFixed(1)}%`, background: p.color, transition: "width .5s var(--ease)" }} />
      ))}
    </div>
  );
}

/** An 8px dot (`.xdt`). */
export function Dot({ color, square, pulse }: { color: string; square?: boolean; pulse?: boolean }) {
  return <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, borderRadius: square ? 3 : 4, background: color, animation: pulse ? "xPulse 1.8s ease infinite" : undefined }} />;
}

/** One line of a log (`.xlg`): a 10px dot, the text, the time on the right. */
export function LogLine({ dot, text, time }: { dot: string; text: ReactNode; time: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr) auto", gap: 10, alignItems: "start", padding: "6px 0", fontSize: 13 }}>
      <i aria-hidden="true" style={{ width: 10, height: 10, marginTop: 4, borderRadius: 5, background: dot }} />
      <span>{text}</span>
      <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{time}</span>
    </div>
  );
}

/** A fact row (`.xfa`): muted key left, value right. */
export function FactRow({ k, v, tone, last }: { k: ReactNode; v: ReactNode; tone?: string; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 0", fontSize: 13, borderBottom: last ? undefined : "1px solid var(--bd)" }}>
      <span style={{ color: "var(--mut)", whiteSpace: "nowrap" }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: "right", color: tone }}>{v}</span>
    </div>
  );
}

/** A note strip (`.xno`). */
export function Note({ icon = "info", tone = "info", children }: { icon?: IconName; tone?: "info" | "warn" | "bad"; children: ReactNode }) {
  const c = { info: ["var(--infos)", "var(--info)"], warn: ["var(--warns)", "var(--warnfg)"], bad: ["var(--bads)", "var(--bad)"] }[tone];
  return (
    <div style={{ padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, display: "flex", gap: 10, background: c[0], color: c[1] }}>
      <Ic n={icon} size={18} style={{ flex: "none", marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

export type TopAct = { label: string; icon: IconName; variant?: "pri" | "sec"; href?: string; onClick?: () => void; target?: string };

/**
 * The Exams top bar. On a desk: Back (a 40px ghost square) when the screen has
 * a parent, the crumb over a serif title, then the actions. On a phone: Back,
 * a bold title over a muted line, and soft actions.
 */
export function ExamsTop({ crumb, title, back, acts = [], mTitle, mSub, mBack, mActs = [] }: { crumb: ReactNode; title: ReactNode; back?: string; acts?: TopAct[]; mTitle?: ReactNode; mSub?: ReactNode; mBack?: string; mActs?: TopAct[] }) {
  return (
    <>
      <header className="only-d glass vx-top" style={{ flex: "none", height: 64, display: "flex", alignItems: "center", gap: 10, padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
        {back ? (
          <BackLink href={back} className="tap btn ghost" style={{ width: 40, padding: 0 }}>
            <Ic n="chevLeft" />
          </BackLink>
        ) : null}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{crumb}</span>
          <h1 className="serif clip" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{title}</h1>
        </div>
        {acts.map((a) => <ActButton key={a.label} a={a} />)}
      </header>
      <header className="only-m glass vx-top" style={{ flex: "none", minHeight: 58, display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--bd)" }}>
        {mBack ? (
          <BackLink href={mBack} className="tap icon-btn" style={{ width: 44, height: 44, borderRadius: 22 }}>
            <Ic n="chevLeft" size={24} />
          </BackLink>
        ) : (
          <span style={{ width: 8 }} />
        )}
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", paddingLeft: 2 }}>
          <span className="clip" style={{ fontSize: 17, fontWeight: 700 }}>{mTitle ?? title}</span>
          {mSub ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{mSub}</span> : null}
        </span>
        {mActs.map((a) => <ActButton key={a.label} a={{ ...a, variant: undefined }} soft />)}
      </header>
    </>
  );
}

function ActButton({ a, soft }: { a: TopAct; soft?: boolean }) {
  const cls = `tap btn ${soft ? "soft" : (a.variant ?? "sec")}`;
  const style: CSSProperties = soft ? { height: 40, padding: "0 12px", fontSize: 13 } : {};
  const inner = (
    <>
      <Ic n={a.icon} size={soft ? 16 : 18} />
      {a.label}
    </>
  );
  if (a.href && a.target) {
    return (
      <a href={a.href} className={cls} style={style} target={a.target} rel="noopener noreferrer" onClick={a.onClick}>
        {inner}
      </a>
    );
  }
  if (a.href) {
    return (
      <Link href={a.href} className={cls} style={style} onClick={a.onClick}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} style={style} onClick={a.onClick}>
      {inner}
    </button>
  );
}
