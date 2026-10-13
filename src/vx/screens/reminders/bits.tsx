"use client";

import type { CSSProperties, ReactNode } from "react";

import { Ic } from "@/vx/icons";

/* Small pieces of the design's Reminders markup (`.zrc`, `.chip`, `.seg`, `.sw`) shared by the list and the wizard. */

const V = (x: string) => `var(--${x})`;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Tue 22 Sep" in the school's day, as the design writes it (the shared `shortDay` says "Tue, 22 Sept"). */
export function dayShort(value: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
  const ist = new Date(d.getTime() + 330 * 60_000);
  return `${DOW[ist.getUTCDay()]} ${ist.getUTCDate()} ${MON[ist.getUTCMonth()]}`;
}

/** The design's switch drawn inside a larger tap target. */
export function SwitchKnob({ on }: { on: boolean }) {
  return (
    <span className={`sw${on ? " on" : ""}`}>
      <span />
    </span>
  );
}

/** A radio row (design `.zrc`): ring, label, sub. */
export function RadioRow({ on, onPick, label, sub, trail }: { on: boolean; onPick: () => void; label: ReactNode; sub?: ReactNode; trail?: ReactNode }) {
  return (
    <button
      type="button"
      className="tap rm-rc"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      style={{ border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? V("accs") : V("card") }}
    >
      <i style={{ borderColor: on ? V("acc") : V("bds") }}>
        <b style={{ transform: `scale(${on ? 1 : 0})` }} />
      </i>
      <span className="rm-c" style={{ flex: 1 }}>
        <span className="rm-b">{label}</span>
        {sub ? <span className="rm-m">{sub}</span> : null}
      </span>
      {trail}
    </button>
  );
}

/** A chip (design `.chip`), optionally with a leading clock. */
export function ChipBtn({ on, onClick, children, clock, style }: { on: boolean; onClick: () => void; children: ReactNode; clock?: boolean; style?: CSSProperties }) {
  return (
    <button type="button" className={`tap chip${on ? " on" : ""}`} aria-pressed={on} onClick={onClick} style={style}>
      {clock ? <Ic n="clock" size={15} /> : null}
      {children}
    </button>
  );
}

/** Segmented control (design `.seg`) with a sliding thumb. */
export function SegRow<T extends string>({ value, options, onPick, label }: { value: T; options: { value: T; label: string }[]; onPick: (v: T) => void; label: string }) {
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div className="seg" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }} />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={`tap${o.value === value ? " on" : ""}`} onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
