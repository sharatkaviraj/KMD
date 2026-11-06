"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { mc } from "@/messages/collect";
import { HOLD_MS } from "@/modules/collect/domain/flow";
import { isOverdueOn, orderForSettlement, walkPayment, type DeskLedgerRow } from "@/modules/payments/vx/domain/desk";
import type { Localized } from "@/platform/i18n/language";

import { Bi, dayMonth, fill, money, useCx } from "./text";

const PATHS = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.6-3.6",
  back: "M15 5l-7 7 7 7",
  check: "M5 12.5l4.5 4.5L19 7.5",
  cash: "M4.5 6h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM6 9.5v5M18 9.5v5",
  upi: "M8.5 2.5h7A2.5 2.5 0 0 1 18 5v14a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 19V5a2.5 2.5 0 0 1 2.5-2.5zM9.5 7h2v2h-2zM12.5 10h2v2h-2zM9.5 13h2v2h-2zM11 18.5h2",
  split: "M4.3 7h7.4a1.8 1.8 0 0 1 1.8 1.8v6.4a1.8 1.8 0 0 1-1.8 1.8H4.3a1.8 1.8 0 0 1-1.8-1.8V8.8A1.8 1.8 0 0 1 4.3 7zM8 10.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM16.6 4h3.3a1.6 1.6 0 0 1 1.6 1.6v12.8a1.6 1.6 0 0 1-1.6 1.6h-3.3a1.6 1.6 0 0 1-1.6-1.6V5.6A1.6 1.6 0 0 1 16.6 4zM17.3 15.5h2",
  cheque: "M4.5 6h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6 14.5c1.5-2 2.5 1 4-1s2.5 1 4-.5M15.5 10h3",
  bank: "M3 10l9-5 9 5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18",
  cal: "M5.5 5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3.5 10h17M8 3v4M16 3v4",
  print: "M7 9V3.5h10V9M7 17H4.5V10h15v7H17M7 14h10v6.5H7z",
  alert: "M12 4l9 16H3zM12 10v4M12 17.2v.3",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8v.3",
  chev: "M9 6l6 6-6 6",
  chevl: "M15 6l-6 6 6 6",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  notes: "M4 7h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 17H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 7zM6.5 4h15v10",
  users: "M9 4.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.8a3.2 3.2 0 0 1 0 6.4M17.5 14.2c2 .8 3.5 3 3.5 5.8",
  edit: "M4 20h4L19 9l-4-4L4 16z",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2",
  next: "M5 12h14M13 6l6 6-6 6",
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="i" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}
export function avatarTone(id: string): string {
  return `a${[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 5}`;
}
export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}
export function tail(phone: string | null): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `••${d.slice(-4)}` : "";
}

export function BackButton({ onClick }: { onClick: () => void }) {
  const { f } = useCx();
  return (
    <button type="button" className="cx-btn sec icon" onClick={onClick} aria-label={f(mc.goBack)}>
      <Icon name="back" size={20} />
    </button>
  );
}

/** The card frame: eyebrow, title, a body that never scrolls, and the action row. */
export function CardShell({ eyebrow, title, children, foot, bodyRef, className, footClass }: { eyebrow: Localized; title: Localized; children: ReactNode; foot: ReactNode; bodyRef?: RefObject<HTMLDivElement | null>; className?: string; footClass?: string }) {
  const { p } = useCx();
  return (
    <>
      <header className="cx-ch">
        <div className="cx-eyebrow">{p(eyebrow)}</div>
        <h2 data-title="">
          <Bi text={title} />
        </h2>
      </header>
      <div className={`cx-body${className ? ` ${className}` : ""}`} ref={bodyRef}>
        {children}
      </div>
      <footer className={`cx-foot${footClass ? ` ${footClass}` : ""}`}>{foot}</footer>
    </>
  );
}

function instLabel(row: DeskLedgerRow, now: number, onDate: string): Localized {
  if (row.isCarryForward) return mc.oldBalance;
  if (row.feesPending <= 0) return fill(mc.instDone, { n: row.installmentNo });
  if (now > 0 && now >= row.feesPending) return fill(mc.instClears, { n: row.installmentNo });
  if (now > 0) return fill(mc.instPart, { n: row.installmentNo, a: money(now) });
  if (isOverdueOn(row, onDate)) return fill(mc.instOverdue, { n: row.installmentNo });
  return fill(mc.instDue, { n: row.installmentNo, d: dayMonth(row.dueDate) });
}

/** The year, one segment per installment: paid, being paid now (striped), overdue. */
export function YearBar({ rows, pay = 0, takeLate, onDate, slim = false }: { rows: readonly DeskLedgerRow[]; pay?: number; takeLate: boolean; onDate: string; slim?: boolean }) {
  const { p } = useCx();
  const ordered = orderForSettlement(rows);
  const walk = pay > 0 ? walkPayment(ordered, pay, { paymentDate: onDate, today: onDate, waiveLate: !takeLate, authoritative: true }) : null;
  return (
    <div className={`cx-yb${slim ? " slim" : ""}`}>
      {ordered.map((row) => {
        const line = walk?.lines.find((l) => l.row.id === row.id);
        const now = line ? line.feesPaid : 0;
        const charge = Math.max(1, row.charge || row.feesPaid + row.feesPending);
        const paid = Math.max(0, charge - row.feesPending);
        const overdue = isOverdueOn(row, onDate) && row.feesPending > now;
        const tone = row.feesPending <= 0 ? "ok" : now > 0 && now >= row.feesPending ? "n" : isOverdueOn(row, onDate) ? "od" : "";
        return (
          <div className="cx-ys" key={row.id} style={{ flex: `${charge} 1 0` }}>
            <div className={`cx-bar${overdue ? " od" : ""}`}>
              <i className="p" style={{ width: `${(paid / charge) * 100}%` }} />
              <i className="n" style={{ width: `${(now / charge) * 100}%` }} />
            </div>
            <div className={`cx-sl ${tone}`}>{p(instLabel(row, now, onDate))}</div>
          </div>
        );
      })}
    </div>
  );
}

/** The late fee this share actually pays, walked the same way as allocText (0 when the late fee is not taken). */
export function lateTaken(rows: readonly DeskLedgerRow[], amount: number, takeLate: boolean, onDate: string): number {
  if (!amount || !takeLate) return 0;
  return walkPayment(rows, amount, { paymentDate: onDate, today: onDate, waiveLate: false, authoritative: true }).lines.reduce((s, l) => s + l.lateFeePaid, 0);
}

/** "Inst 1 ✓ · Inst 2 ₹1,200 + late · leaves ₹6,400" for one child's share. */
export function allocText(rows: readonly DeskLedgerRow[], amount: number, takeLate: boolean, onDate: string): Localized {
  if (!amount) return mc.allocNothing;
  const walk = walkPayment(rows, amount, { paymentDate: onDate, today: onDate, waiveLate: !takeLate, authoritative: true });
  const parts = walk.lines
    .filter((l) => l.feesPaid + l.lateFeePaid > 0)
    .map((l) => {
      const base = l.feesAfter === 0 ? fill(mc.allocDone, { n: l.row.installmentNo }) : fill(mc.allocPart, { n: l.row.installmentNo, a: money(l.feesPaid) });
      return l.lateFeePaid ? { hi: `${base.hi} ${mc.allocLate.hi}`, en: `${base.en} ${mc.allocLate.en}` } : base;
    });
  const left = walk.after.pendingToday + walk.after.dueToday + walk.after.notDueYet;
  const end = left ? fill(mc.allocLeaves, { a: money(left) }) : mc.allocYearClear;
  return { hi: [...parts.map((x) => x.hi), end.hi].join(" · "), en: [...parts.map((x) => x.en), end.en].join(" · ") };
}

/**
 * Hide the rows of a list that do not fit its box (rule: nothing scrolls).
 * Rows stay in the DOM, so a taller screen shows them again; a cut row is
 * invisible and out of the accessibility tree. Returns how many are cut.
 */
export function useFit(box: RefObject<HTMLElement | null>, selector: string, deps: readonly unknown[]): number {
  const [cut, setCut] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const rows = [...el.querySelectorAll<HTMLElement>(selector)];
      rows.forEach((r) => {
        r.removeAttribute("data-cut");
        r.removeAttribute("aria-hidden");
      });
      const limit = el.clientHeight + 1;
      let n = 0;
      rows.forEach((r, i) => {
        if (i > 0 && r.offsetTop - el.offsetTop + r.offsetHeight > limit) {
          r.setAttribute("data-cut", "");
          r.setAttribute("aria-hidden", "true");
          n += 1;
        }
      });
      setCut(n);
    };
    // Measured in the next frame (and on every resize), so the count is never set during the effect itself.
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return cut;
}

/** In development, outline anything inside the card that would have to scroll. */
export function useOverflowCheck(root: RefObject<HTMLElement | null>, deps: readonly unknown[]) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const frame = requestAnimationFrame(() => {
      const el = root.current;
      if (!el) return;
      el.querySelectorAll<HTMLElement>(".cx-card:not(.leaving) .cx-body,.cx-card:not(.leaving) .cx-foot,.cx-detail,.cx-ticket").forEach((node) => {
        node.toggleAttribute("data-overflow", node.scrollHeight > node.clientHeight + 1);
      });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Hold to save (D2): 0.6 s of pointer, Enter or Space. Releasing early
 * cancels. `armed` false greys it out. The keyboard hold is wired by the
 * screen through `holdRef`.
 */
export function HoldButton({ label, disabled, onDone, holdRef }: { label: Localized; disabled: boolean; onDone: () => void; holdRef: RefObject<{ start: () => void; stop: () => void } | null> }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const start = () => {
    if (disabled || timer.current !== null) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onDone();
    }, HOLD_MS);
  };
  const stop = () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(() => {
    holdRef.current = { start, stop };
    return () => {
      holdRef.current = null;
    };
  });
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return (
    <button
      type="button"
      className={`cx-btn pri cx-hold${holding ? " holding" : ""}`}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="fill" />
      <span>
        <Bi text={holding ? mc.keepHolding : label} />
      </span>
    </button>
  );
}
