import Link from "@/vx/ui/link";
import type { CSSProperties, ReactNode } from "react";

import { Ic } from "@/vx/icons";
import { BackLink } from "@/vx/ui/back-link";

/*
 * The page frame every vx screen sits in: one `.vx` container (the 900px
 * switch is measured on it), a glass top bar for desktop and a compact one
 * for phones, then `main`. The sidebar and bottom bar belong to the shell.
 */

export function VxPage({ children, style, className = "", label }: { children: ReactNode; style?: CSSProperties; className?: string; label?: string }) {
  return (
    <div className={`vx vx-page ${className}`} style={style} aria-label={label}>
      {children}
    </div>
  );
}

export function TopBar({
  crumb,
  title,
  actions,
  mTitle,
  mSub,
  mBack,
  mAction,
  dTitleStyle,
}: {
  /** Small line above the desktop title ("Money · Receipts"). */
  crumb?: ReactNode;
  title: ReactNode;
  /** Desktop actions on the right. */
  actions?: ReactNode;
  /** Phone title; defaults to `title`. */
  mTitle?: ReactNode;
  mSub?: ReactNode;
  /** Phone back link. Omit on a role's home. */
  mBack?: string;
  /** Phone action on the right. */
  mAction?: ReactNode;
  dTitleStyle?: CSSProperties;
}) {
  return (
    <>
      <header className="only-d glass vx-top" style={{ flex: "none", height: 64, display: "flex", alignItems: "center", gap: 12, padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {crumb ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{crumb}</span> : null}
          <h1 className="serif clip" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.15, ...dTitleStyle }}>{title}</h1>
        </div>
        {actions}
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
        {mAction}
      </header>
    </>
  );
}

/** The padded content column: 22/28px on desktop, 16px gutters on phone. */
export function Section({ children, style, className = "", gap = 16 }: { children: ReactNode; style?: CSSProperties; className?: string; gap?: number }) {
  return (
    <section className={`pad ${className}`} style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap, minWidth: 0, ...style }}>
      {children}
    </section>
  );
}

/** Two panes: a list and a detail panel that is sticky on desktop and stacks on phone. */
export function Split({ list, detail, detailWidth = 420, style }: { list: ReactNode; detail?: ReactNode; detailWidth?: number; style?: CSSProperties }) {
  return (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: detail ? `minmax(0,1fr) ${detailWidth}px` : "minmax(0,1fr)", alignItems: "start", minHeight: "100%", ...style }}>
      {list}
      {detail ? (
        <aside className="unstick" style={{ position: "sticky", top: 64, height: "calc(100dvh - 64px)", overflowY: "auto", borderLeft: "1px solid var(--bd)", background: "var(--card)" }}>
          {detail}
        </aside>
      ) : null}
    </div>
  );
}

/** A grid that is N columns on desktop and fewer on phone (`.g4` → 2, `.g3`/`.g2` → 1). */
export function Grid({ cols = 4, gap = 12, children, style }: { cols?: 2 | 3 | 4; gap?: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={`g${cols}`} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap, ...style }}>
      {children}
    </div>
  );
}

export type Column<T> = {
  key: string;
  label: ReactNode;
  /** CSS grid track for the desktop table. */
  width?: string;
  align?: "left" | "right" | "center";
  cell: (row: T) => ReactNode;
  /** Hide on the phone card. */
  hideOnPhone?: boolean;
};

/**
 * One column definition, two layouts: a grid table from 900px and a card list
 * below it (DESIGN-SYSTEM.md §3). The first column is the card's title, the
 * second its sub-line, the last its trailing value.
 */
export function DataList<T>({
  rows,
  columns,
  rowKey,
  href,
  selected,
  empty,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  href?: (row: T) => string | undefined;
  selected?: (row: T) => boolean;
  empty?: ReactNode;
  caption?: string;
}) {
  if (rows.length === 0) return <>{empty ?? null}</>;
  const tracks = columns.map((c) => c.width ?? "minmax(0,1fr)").join(" ");
  const phoneCols = columns.filter((c) => !c.hideOnPhone);
  const [first, second, ...rest] = phoneCols;
  const last = rest.length ? rest[rest.length - 1] : undefined;
  const middle = rest.slice(0, -1);
  return (
    <div role="table" aria-label={caption} style={{ display: "flex", flexDirection: "column" }}>
      <div role="row" className="only-d" style={{ display: "grid", gridTemplateColumns: tracks, gap: 12, padding: "10px 16px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--mut)" }}>
        {columns.map((c) => (
          <span role="columnheader" key={c.key} style={{ textAlign: c.align ?? "left" }}>{c.label}</span>
        ))}
      </div>
      {rows.map((row, i) => {
        const link = href?.(row);
        const sel = selected?.(row) ?? false;
        const desktop = (
          <div style={{ display: "grid", gridTemplateColumns: tracks, gap: 12, alignItems: "center", padding: "10px 16px", minHeight: 56 }} className="only-d">
            {columns.map((c) => (
              <span role="cell" key={c.key} style={{ minWidth: 0, textAlign: c.align ?? "left", justifySelf: c.align === "right" ? "end" : undefined }}>{c.cell(row)}</span>
            ))}
          </div>
        );
        const phone = (
          <div className="only-m" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", minHeight: 60 }}>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              {first ? <span style={{ fontWeight: 600, minWidth: 0 }}>{first.cell(row)}</span> : null}
              {second ? <span style={{ fontSize: 13, color: "var(--mut)", minWidth: 0 }}>{second.cell(row)}</span> : null}
              {middle.length ? (
                <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", fontSize: 12, color: "var(--mut)" }}>
                  {middle.map((c) => (
                    <span key={c.key}>{c.cell(row)}</span>
                  ))}
                </span>
              ) : null}
            </span>
            {last ? <span style={{ flex: "none", textAlign: "right" }}>{last.cell(row)}</span> : null}
          </div>
        );
        const st: CSSProperties = { borderTop: "1px solid var(--bd)", display: "block", animation: i < 8 ? `xFade .18s ease ${i * 8}ms both` : undefined };
        return link ? (
          <Link key={rowKey(row)} href={link} role="row" className={`row tap${sel ? " sel" : ""}`} style={st} aria-current={sel ? "true" : undefined}>
            {desktop}
            {phone}
          </Link>
        ) : (
          <div key={rowKey(row)} role="row" className={`row${sel ? " sel" : ""}`} style={st}>
            {desktop}
            {phone}
          </div>
        );
      })}
    </div>
  );
}

/** A banner across the top of a page: offline, read-only preview, a notice. */
export function Banner({ tone = "info", children, action }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode; action?: ReactNode }) {
  const map = {
    info: ["var(--infos)", "var(--info)"],
    warn: ["var(--warns)", "var(--warnfg)"],
    bad: ["var(--bads)", "var(--bad)"],
    ok: ["var(--oks)", "var(--ok)"],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: bg, color: fg, fontSize: 14, fontWeight: 600 }}>
      <Ic n={tone === "ok" ? "checkCircle" : tone === "info" ? "info" : "alert"} size={18} />
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {action}
    </div>
  );
}
