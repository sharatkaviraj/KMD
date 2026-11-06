import Link from "@/ui/link";
import type { CSSProperties, ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { rupees, rupeesShort } from "@/vx/format";

/*
 * The design's building blocks (DESIGN-SYSTEM.md §5) that need no state, so
 * Server and Client Components can both render them. Class names are the
 * design's own (`.card`, `.btn.pri`, `.pill` …) from `src/vx/vx.css`.
 */

type Tone = "ok" | "warn" | "bad" | "info" | "acc" | "mut" | "pri";

const TONES: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: "var(--oks)", fg: "var(--ok)" },
  warn: { bg: "var(--warns)", fg: "var(--warnfg)" },
  bad: { bg: "var(--bads)", fg: "var(--bad)" },
  info: { bg: "var(--infos)", fg: "var(--info)" },
  acc: { bg: "var(--accs)", fg: "var(--accfg)" },
  mut: { bg: "var(--s3)", fg: "var(--fg)" },
  pri: { bg: "var(--pri)", fg: "var(--prifg)" },
};

export function toneColors(tone: Tone) {
  return TONES[tone];
}

export type { Tone };

export function Card({
  children,
  style,
  className = "",
  as: As = "div",
  pad = true,
  ...rest
}: {
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
  as?: "div" | "section" | "article" | "li" | "aside";
  pad?: boolean;
} & Record<`aria-${string}`, string>) {
  return (
    <As className={`card ${className}`} style={{ padding: pad ? "16px 18px" : 0, ...style }} {...rest}>
      {children}
    </As>
  );
}

export function Pill({ tone = "mut", children, icon, style }: { tone?: Tone; children: ReactNode; icon?: IconName; style?: CSSProperties }) {
  const c = TONES[tone];
  return (
    <span className="pill" style={{ background: c.bg, color: c.fg, ...style }}>
      {icon ? <Ic n={icon} size={12} stroke={2.4} /> : null}
      {children}
    </span>
  );
}

/** Section label: 12px, bold, uppercase, .06em. */
export function SecHead({ children, action, style }: { children: ReactNode; action?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, ...style }}>
      <h2 className="sech">{children}</h2>
      {action}
    </div>
  );
}

/** A card's heading row: title, optional sub-line, optional action on the right. */
export function CardHead({ title, sub, action, badge }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; badge?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          {title}
          {badge}
        </h3>
        {sub ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{sub}</span> : null}
      </div>
      {action}
    </div>
  );
}

type BtnVariant = "pri" | "sec" | "soft" | "ghost" | "danger";

export function Btn({
  children,
  variant = "sec",
  icon,
  href,
  big,
  full,
  style,
  type = "button",
  disabled,
  ariaLabel,
  onClick,
  form,
  name,
  value,
  prefetch,
  target,
  className,
}: {
  children?: ReactNode;
  variant?: BtnVariant;
  icon?: IconName;
  href?: string;
  big?: boolean;
  full?: boolean;
  style?: CSSProperties;
  type?: "button" | "submit";
  disabled?: boolean;
  ariaLabel?: string;
  onClick?: () => void;
  form?: string;
  name?: string;
  value?: string;
  prefetch?: boolean;
  target?: string;
  /** Extra kit classes, e.g. `wrap` for a button that carries a sentence. */
  className?: string;
}) {
  const cls = `tap btn ${variant}${big ? " big" : ""}${className ? ` ${className}` : ""}`;
  const st: CSSProperties = { width: full ? "100%" : undefined, ...style };
  const inner = (
    <>
      {icon ? <Ic n={icon} size={big ? 20 : 18} /> : null}
      {children}
    </>
  );
  if (href && !disabled) {
    return (
      // A button that opens another tab (an export, a PDF) is never prefetched:
      // the router cannot use the result, and Dues spent ~20 s on two failing
      // prefetches of the defaulters PDF on every open (verification N3).
      <Link href={href} className={cls} style={st} aria-label={ariaLabel} prefetch={target === "_blank" ? false : prefetch} target={target}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type={type}
      className={cls}
      style={st}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
      form={form}
      name={name}
      value={value}
    >
      {inner}
    </button>
  );
}

/** ₹1,23,400 with tabular figures. `short` gives ₹18.6 L. */
export function Money({ value, short, tone, style, sign }: { value: number | null | undefined; short?: boolean; tone?: string; style?: CSSProperties; sign?: boolean }) {
  const v = Number(value ?? 0);
  const text = short ? rupeesShort(v) : rupees(v);
  return (
    <span className="num" style={{ color: tone, ...style }}>
      {sign && v > 0 ? "+" : ""}
      {text}
    </span>
  );
}

const AVATAR_BGS = ["#81DAE4", "#F6D9A8", "#CDEFDD", "#C9D7F8", "#F3C7C7", "#E3D7F5", "#FCE1C4"];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_BGS[h % AVATAR_BGS.length];
}

export function Avatar({ text, seed, size = 40, bg, photo }: { text: string; seed?: string; size?: number; bg?: string; photo?: string | null }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "none",
        width: size,
        height: size,
        borderRadius: size / 2,
        background: bg ?? avatarColor(seed ?? text),
        color: "#082F49",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(11, Math.round(size * 0.34)),
        fontWeight: 700,
        overflow: "hidden",
      }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" width={size} height={size} loading="lazy" decoding="async" style={{ objectFit: "cover", width: "100%", height: "100%" }} />
      ) : (
        text
      )}
    </span>
  );
}

/** A square icon tile, as on every list row in the design. */
export function IconTile({ icon, tone = "acc", size = 40 }: { icon: IconName; tone?: Tone; size?: number }) {
  const c = TONES[tone];
  return (
    <span
      aria-hidden="true"
      style={{ flex: "none", width: size, height: size, borderRadius: 12, background: c.bg, color: c.fg, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    >
      <Ic n={icon} size={Math.round(size * 0.48)} />
    </span>
  );
}

/** Progress in words plus a bar ("12 of 27 done") — RULES G. */
export function Progress({ value, max, tone = "var(--acc)", height = 8, label, style }: { value: number; max: number; tone?: string; height?: number; label?: ReactNode; style?: CSSProperties }) {
  const w = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
      {label ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{label}</span> : null}
      <div role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} style={{ height, borderRadius: height / 2, background: "var(--s3)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${w}%`, background: tone, borderRadius: height / 2, transition: "width .5s var(--ease)", transformOrigin: "left", animation: "xGrowX .6s var(--ease) both" }} />
      </div>
    </div>
  );
}

/** A ring that draws itself (xDraw). */
export function Ring({ value, max = 100, size = 64, stroke = 8, tone = "var(--acc)", track = "var(--s3)", children }: { value: number; max?: number; size?: number; stroke?: number; tone?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <span style={{ position: "relative", width: size, height: size, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          style={{ ["--len" as string]: `${c * frac}`, animation: "xDraw .7s var(--ease) both" }}
        />
      </svg>
      {children ? <span style={{ position: "relative", fontSize: 13, fontWeight: 700 }} className="num">{children}</span> : null}
    </span>
  );
}

/** A small line that draws itself. Values left → right. */
export function Sparkline({ values, width = 110, height = 36, tone = "var(--acc)", dot = true }: { values: number[]; width?: number; height?: number; tone?: string; dot?: boolean }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 6) + 3, height - 4 - ((v - min) / span) * (height - 8)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ flex: "none" }}>
      <path d={d} fill="none" stroke={tone} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" style={{ ["--len" as string]: "1", animation: "xDraw .9s var(--ease) both" }} />
      {dot ? <circle cx={last[0]} cy={last[1]} r={3.5} fill={tone} style={{ animation: "xPopIn .45s var(--spring) .6s both" }} /> : null}
    </svg>
  );
}

export type Part = { label: string; value: number; color: string };

/** One bar split into parts (how money came in, attendance mix…). */
export function StackedBar({ parts, height = 12, showLegend = true, format = (v: number) => rupees(v) }: { parts: Part[]; height?: number; showLegend?: boolean; format?: (v: number) => string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", height, borderRadius: height / 2, overflow: "hidden", background: "var(--s3)" }}>
        {parts.map((p) => (
          <span key={p.label} title={`${p.label} ${format(p.value)}`} style={{ height, width: `${total ? (p.value / total) * 100 : 0}%`, background: p.color, transition: "width .5s var(--ease)" }} />
        ))}
      </div>
      {showLegend ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          {parts.map((p) => (
            <span key={p.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />
              {p.label}
              <span className="num" style={{ fontWeight: 700 }}>{format(p.value)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type BarDatum = { label: string; value: number; highlight?: boolean; title?: string };

/** Vertical bars that grow (xGrowY), with an optional dashed average line. */
export function BarChart({ data, height = 200, avg, format = rupeesShort, tone = "var(--pri)", hiTone = "var(--acc)", labelEvery = 1 }: { data: BarDatum[]; height?: number; avg?: number; format?: (v: number) => string; tone?: string; hiTone?: string; labelEvery?: number }) {
  const max = Math.max(...data.map((d) => d.value), avg ?? 0, 1);
  const ticks = [max, (max * 2) / 3, max / 3];
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height, paddingBottom: 0, fontSize: 11, color: "var(--sub)" }} className="num hide-m">
        {ticks.map((t) => (
          <span key={t}>{format(t)}</span>
        ))}
        <span />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ position: "relative", height, display: "flex", alignItems: "flex-end", gap: 4, borderBottom: "1px solid var(--bd)" }}>
          {avg ? (
            <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(avg / max) * 100}%`, borderTop: "1.5px dashed var(--warn)", zIndex: 1 }}>
              <span className="num" style={{ position: "absolute", right: 0, top: -20, fontSize: 11, fontWeight: 700, color: "var(--warnfg)", background: "var(--warns)", padding: "1px 6px", borderRadius: 6 }}>avg {format(avg)}</span>
            </div>
          ) : null}
          {data.map((d, i) => (
            <span
              key={`${d.label}-${i}`}
              title={d.title ?? `${d.label}: ${format(d.value)}`}
              style={{
                flex: 1,
                minWidth: 3,
                height: `${(d.value / max) * 100}%`,
                background: d.highlight ? hiTone : tone,
                borderRadius: "5px 5px 2px 2px",
                transformOrigin: "bottom",
                animation: `xGrowY .6s var(--ease) ${Math.min(i * 18, 400)}ms both`,
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, fontSize: 11, color: "var(--mut)" }}>
          {data.map((d, i) => (
            <span key={`${d.label}-l-${i}`} style={{ flex: 1, minWidth: 3, textAlign: "center", whiteSpace: "nowrap", overflow: "visible", fontWeight: d.highlight ? 700 : 400, color: d.highlight ? "var(--fg)" : undefined }}>
              {i % labelEvery === 0 || d.highlight ? d.label : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Donut with a centre label. */
export function Donut({ parts, size = 150, stroke = 22, children }: { parts: Part[]; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const offsets = parts.reduce<number[]>((acc, p, i) => [...acc, (acc[i - 1] ?? 0) + (i === 0 ? 0 : (parts[i - 1].value / total) * c)], []);
  return (
    <span style={{ position: "relative", width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--s3)" strokeWidth={stroke} />
        {parts.map((p, i) => {
          const len = (p.value / total) * c;
          const offset = offsets[i];
          return (
            <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke} strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-offset} style={{ ["--len" as string]: `${len}`, animation: "xDraw .8s var(--ease) both" }}>
              <title>{p.label}</title>
            </circle>
          );
        })}
      </svg>
      <span style={{ position: "relative", textAlign: "center", display: "flex", flexDirection: "column" }}>{children}</span>
    </span>
  );
}

/** A heat table: rows × columns, darker means more. */
export function HeatGrid({
  rows,
  cols,
  cell,
  rowLabel,
  total,
  format = rupeesShort,
  hrefFor,
  caption,
}: {
  rows: string[];
  cols: string[];
  cell: (row: string, col: string) => number | null;
  rowLabel?: string;
  total?: (row: string) => number;
  format?: (v: number) => string;
  hrefFor?: (row: string, col: string) => string | null;
  caption?: string;
}) {
  const all = rows.flatMap((r) => cols.map((c) => cell(r, c) ?? 0));
  const max = Math.max(...all, 1);
  return (
    <div style={{ overflowX: "auto" }} className="hs">
      <table style={{ borderCollapse: "separate", borderSpacing: 6, width: "100%", fontSize: 13 }}>
        {caption ? <caption className="sr">{caption}</caption> : null}
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: "left", fontSize: 11, color: "var(--mut)", fontWeight: 700 }}>{rowLabel ?? ""}</th>
            {cols.map((c) => (
              <th key={c} scope="col" style={{ fontSize: 11, color: "var(--mut)", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>{c}</th>
            ))}
            {total ? <th scope="col" style={{ fontSize: 11, color: "var(--mut)", fontWeight: 700, textAlign: "right", letterSpacing: ".06em" }}>TOTAL</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th scope="row" style={{ textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", paddingRight: 8 }}>{r}</th>
              {cols.map((c) => {
                const v = cell(r, c);
                const a = v ? 0.12 + 0.68 * (v / max) : 0;
                const href = v && hrefFor ? hrefFor(r, c) : null;
                const content = v ? format(v) : "—";
                const st: CSSProperties = {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 34,
                  minWidth: 58,
                  borderRadius: 9,
                  background: v ? `rgba(var(--heat),${a.toFixed(2)})` : "transparent",
                  color: a > 0.5 ? "var(--onsolid)" : "var(--fg)",
                  fontWeight: 600,
                  fontSize: 12,
                };
                return (
                  <td key={c} style={{ padding: 0 }}>
                    {href ? (
                      <Link href={href} className="tap num" style={st}>{content}</Link>
                    ) : (
                      <span className="num" style={st}>{content}</span>
                    )}
                  </td>
                );
              })}
              {total ? <td className="num" style={{ textAlign: "right", fontWeight: 700 }}>{format(total(r))}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** KPI tile: label, value, optional delta pill, sub-line and sparkline. */
export function Kpi({
  label,
  value,
  sub,
  delta,
  deltaTone = "ok",
  spark,
  tone,
  href,
  delay = 0,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: string;
  deltaTone?: Tone;
  spark?: number[];
  tone?: string;
  href?: string;
  delay?: number;
  icon?: IconName;
}) {
  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {icon ? <Ic n={icon} size={15} /> : null}
          {label}
        </span>
        {delta ? <Pill tone={deltaTone}>{delta}</Pill> : null}
        {href && !delta ? <Ic n="chevRight" size={16} style={{ color: "var(--mut)" }} /> : null}
      </div>
      <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em", color: tone, lineHeight: 1.15 }}>{value}</span>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
        {sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span> : <span />}
        {spark ? <Sparkline values={spark} /> : null}
      </div>
    </>
  );
  const style: CSSProperties = { padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, animationDelay: `${delay}ms`, minWidth: 0 };
  if (href) {
    return (
      <Link href={href} className="card rise tap lift" style={style}>
        {body}
      </Link>
    );
  }
  return (
    <div className="card rise" style={style}>
      {body}
    </div>
  );
}

export function EmptyState({ icon = "inbox", title, body, action, style }: { icon?: IconName; title: ReactNode; body?: ReactNode; action?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, padding: "36px 20px", ...style }} className="fadein">
      <span style={{ width: 64, height: 64, borderRadius: 20, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Ic n={icon} size={30} />
      </span>
      <strong style={{ fontSize: 17 }}>{title}</strong>
      {body ? <span style={{ color: "var(--mut)", maxWidth: 420 }}>{body}</span> : null}
      {action}
    </div>
  );
}

export function Skel({ w = "100%", h = 16, r = 10, style }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties }) {
  return <span className="skel" aria-hidden="true" style={{ display: "block", width: w, height: h, borderRadius: r, ...style }} />;
}

/** A page-shaped loading skeleton: title, KPI row, two cards. */
export function PageSkeleton({ kpis = 4, rows = 6 }: { kpis?: number; rows?: number }) {
  return (
    <div className="pad" style={{ padding: "22px 28px", display: "flex", flexDirection: "column", gap: 16 }} aria-busy="true" aria-label="Loading">
      <Skel w={220} h={28} />
      <div className="g4" style={{ display: "grid", gridTemplateColumns: `repeat(${kpis}, minmax(0,1fr))`, gap: 12 }}>
        {Array.from({ length: kpis }, (_, i) => (
          <div key={i} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <Skel w="50%" h={12} />
            <Skel w="70%" h={26} />
            <Skel w="40%" h={10} />
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Skel w={40} h={40} r={20} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <Skel w="45%" h={13} />
              <Skel w="30%" h={10} />
            </div>
            <Skel w={70} h={20} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The drawn tick shown after every save (xDraw + xTick). */
export function SuccessTick({ size = 72, tone = "var(--ok)", soft = "var(--oks)" }: { size?: number; tone?: string; soft?: string }) {
  return (
    <span style={{ width: size, height: size, borderRadius: size / 2, background: soft, display: "inline-flex", alignItems: "center", justifyContent: "center", animation: "xTick .5s var(--spring) both", flex: "none" }} aria-hidden="true">
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke={tone} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} strokeDasharray="1 1" style={{ ["--len" as string]: "1", animation: "xDraw .45s var(--ease) .2s both" }} />
      </svg>
    </span>
  );
}

/** A WhatsApp bubble, Hindi first, with recipient count and cost (RULES H). */
export function WhatsAppPreview({ lines, footer, count, cost, title = "WhatsApp preview", time = "10:00" }: { lines: string[]; footer?: string; count?: number; cost?: number; title?: string; time?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ background: "var(--wabg)", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 6 }} aria-label={title}>
        <div style={{ alignSelf: "flex-start", maxWidth: "92%", background: "var(--wab)", color: "var(--wafg)", borderRadius: "4px 14px 14px 14px", padding: "9px 12px 6px", fontSize: 14, lineHeight: 1.45, boxShadow: "0 1px 1px rgba(0,0,0,.12)", whiteSpace: "pre-wrap" }}>
          {lines.map((l, i) => (
            <div key={i} style={{ marginTop: i && !l ? 6 : 0 }}>{l}</div>
          ))}
          {footer ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>{footer}</div> : null}
          <div style={{ textAlign: "right", fontSize: 11, opacity: 0.6, marginTop: 2 }}>{time} ✓✓</div>
        </div>
      </div>
      {count !== undefined ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--mut)" }}>
          <span className="num">{count} {count === 1 ? "parent" : "parents"}</span>
          {cost !== undefined ? <span className="num">about {rupees(cost)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

const WRAP_TITLE: CSSProperties = { fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" };

/** A row in a card list: leading tile/avatar, title + sub, trailing slot. Renders as a link when `href`. */
export function ListRow({
  lead: leading,
  title,
  sub,
  trail,
  href,
  selected,
  style,
  delay,
  onClickHint,
  wrap,
}: {
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  trail?: ReactNode;
  href?: string;
  selected?: boolean;
  style?: CSSProperties;
  delay?: number;
  onClickHint?: string;
  /** Let a long title run to two lines instead of being cut mid-word on a phone. */
  wrap?: boolean;
}) {
  const st: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    padding: "10px 16px",
    borderTop: "1px solid var(--bd)",
    animation: delay !== undefined ? `xIn .32s var(--ease) ${Math.min(delay, 400)}ms both` : undefined,
    ...style,
  };
  const inner = (
    <>
      {leading}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span className={wrap ? undefined : "clip"} style={wrap ? WRAP_TITLE : { fontWeight: 600 }}>{title}</span>
        {sub ? <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{sub}</span> : null}
      </span>
      {trail}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`row tap${selected ? " sel" : ""}`} style={st} aria-current={selected ? "true" : undefined} title={onClickHint}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={`row${selected ? " sel" : ""}`} style={st}>
      {inner}
    </div>
  );
}

/** Two numbers side by side: what is pending today vs not due yet — never added (RULES B). */
export function Stat({ label, value, tone, sub }: { label: ReactNode; value: ReactNode; tone?: string; sub?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: "var(--mut)", fontWeight: 600 }}>{label}</span>
      <span className="num" style={{ fontSize: 18, fontWeight: 700, color: tone }}>{value}</span>
      {sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span> : null}
    </div>
  );
}

/** Attendance colours keep one meaning everywhere (RULES G). */
export const ATT_COLORS = {
  P: { fg: "var(--ok)", bg: "var(--oks)", label: "Present", hi: "उपस्थित" },
  A: { fg: "var(--bad)", bg: "var(--bads)", label: "Absent", hi: "अनुपस्थित" },
  H: { fg: "var(--warn)", bg: "var(--warns)", label: "Half-day", hi: "आधा दिन" },
  L: { fg: "var(--warn)", bg: "var(--warns)", label: "Leave", hi: "छुट्टी" },
  N: { fg: "var(--mut)", bg: "var(--s3)", label: "Not marked", hi: "दर्ज नहीं" },
} as const;
