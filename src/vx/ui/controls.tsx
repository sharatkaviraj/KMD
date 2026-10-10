"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";

/*
 * Controls from DESIGN-SYSTEM.md §5. Every button is `type="button"`, toggles
 * are `role="switch"`, choices are `role="radio"`, chips are `aria-pressed`
 * (§7).
 */

export function Chip({
  on,
  children,
  onClick,
  icon,
  count,
  style,
  ariaLabel,
}: {
  on?: boolean;
  children: ReactNode;
  onClick?: () => void;
  icon?: IconName;
  count?: number | string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  return (
    <button type="button" className={`tap chip${on ? " on" : ""}`} aria-pressed={on ? "true" : "false"} onClick={onClick} style={style} aria-label={ariaLabel}>
      {icon ? <Ic n={icon} size={15} /> : null}
      {children}
      {count !== undefined ? (
        <span className="num" style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 9, background: on ? "rgba(255,255,255,.2)" : "var(--s3)" }}>{count}</span>
      ) : null}
    </button>
  );
}

/** A horizontally scrolling row of chips. */
export function ChipRow({ children, style, label }: { children: ReactNode; style?: CSSProperties; label?: string }) {
  return (
    <div className="hs" role="group" aria-label={label} style={{ display: "flex", gap: 8, paddingBottom: 2, ...style }}>
      {children}
    </div>
  );
}

/** Segmented control with a sliding thumb. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  style,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  style?: CSSProperties;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="seg" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))`, ...style }}>
      <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }} />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)} style={{ padding: "0 10px" }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`tap sw${on ? " on" : ""}`} onClick={() => onChange(!on)} style={{ border: 0 }}>
      <span />
    </button>
  );
}

/** A labelled switch row, as in settings lists. */
export function SwitchRow({ title, sub, on, onChange, icon }: { title: ReactNode; sub?: ReactNode; on: boolean; onChange: (next: boolean) => void; icon?: IconName }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 0" }}>
      {icon ? <Ic n={icon} size={20} style={{ color: "var(--mut)" }} /> : null}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        {sub ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{sub}</span> : null}
      </span>
      <Switch on={on} onChange={onChange} label={typeof title === "string" ? title : "Toggle"} />
    </div>
  );
}

export function RadioCard({
  checked,
  onSelect,
  title,
  sub,
  icon,
  trail,
  name,
}: {
  checked: boolean;
  onSelect: () => void;
  title: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
  trail?: ReactNode;
  name?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-name={name}
      onClick={onSelect}
      className="tap"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        textAlign: "left",
        minHeight: 56,
        padding: "10px 14px",
        borderRadius: 14,
        border: `1.5px solid ${checked ? "var(--acc)" : "var(--bd)"}`,
        background: checked ? "var(--accs)" : "var(--card)",
        color: "var(--fg)",
      }}
    >
      <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 10, border: `2px solid ${checked ? "var(--acc)" : "var(--bds)"}`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        {checked ? <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", animation: "xPopIn .3s var(--spring) both" }} /> : null}
      </span>
      {icon ? <Ic n={icon} size={20} style={{ color: checked ? "var(--accfg)" : "var(--mut)" }} /> : null}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        {sub ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{sub}</span> : null}
      </span>
      {trail}
    </button>
  );
}

export function Field({ label, hint, error, children, style }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <label className="field" style={style}>
      <span>{label}</span>
      {children}
      {error ? (
        <em role="alert" style={{ fontStyle: "normal", fontSize: 12, color: "var(--bad)", fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
          <Ic n="alert" size={14} />
          {error}
        </em>
      ) : hint ? (
        <em style={{ fontStyle: "normal", fontSize: 12, color: "var(--mut)" }}>{hint}</em>
      ) : null}
    </label>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; lead?: ReactNode };

export function Input({ invalid, lead: leading, style, className = "", ...rest }: InputProps) {
  if (leading) {
    return (
      <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <span style={{ position: "absolute", left: 14, color: "var(--mut)", display: "flex", pointerEvents: "none" }}>{leading}</span>
        <input className={`inp${invalid ? " err" : ""} ${className}`} aria-invalid={invalid || undefined} style={{ paddingLeft: 40, ...style }} {...rest} />
      </span>
    );
  }
  return <input className={`inp${invalid ? " err" : ""} ${className}`} aria-invalid={invalid || undefined} style={style} {...rest} />;
}

export function Textarea({ invalid, className = "", ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={`inp${invalid ? " err" : ""} ${className}`} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ invalid, className = "", children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={`inp${invalid ? " err" : ""} ${className}`} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

/** − value + (day close denominations, counts). */
export function Stepper({ value, onChange, min = 0, max = 9999, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--bds)", borderRadius: 12, padding: 3 }} role="group" aria-label={label}>
      <button type="button" className="tap icon-btn" style={{ width: 34, height: 34 }} aria-label={`Fewer ${label}`} onClick={() => onChange(Math.max(min, value - 1))}>
        <Ic n="minus" size={16} />
      </button>
      <input
        className="num"
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          onChange(Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0)));
        }}
        style={{ width: 44, textAlign: "center", border: 0, background: "transparent", fontWeight: 700, fontSize: 15, outline: "none" }}
      />
      <button type="button" className="tap icon-btn" style={{ width: 34, height: 34 }} aria-label={`More ${label}`} onClick={() => onChange(Math.min(max, value + 1))}>
        <Ic n="plus" size={16} />
      </button>
    </span>
  );
}

/** The phone number pad (marks entry, amounts). */
export function NumberPad({ onKey, extra }: { onKey: (key: string) => void; extra?: { key: string; label: ReactNode } }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", extra?.key ?? ".", "0", "del"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          className="tap"
          onClick={() => onKey(k)}
          aria-label={k === "del" ? "Delete" : k === extra?.key && extra ? String(extra.key) : k}
          style={{ height: 56, borderRadius: 14, border: "1px solid var(--bd)", background: "var(--card)", color: "var(--fg)", fontSize: 22, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {k === "del" ? <Ic n="del" size={22} /> : k === extra?.key && extra ? extra.label : k}
        </button>
      ))}
    </div>
  );
}

/** Wizard progress: 1 — 2 — 3 — 4 with labels. */
export function WizardSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol aria-label="Steps" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", alignItems: "center", gap: 8 }}>
      {steps.map((s, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <li key={s} aria-current={on ? "step" : undefined} style={{ display: "flex", alignItems: "center", gap: 8, flex: i < steps.length - 1 ? 1 : "none", minWidth: 0 }}>
            <span style={{ flex: "none", width: 28, height: 28, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, background: done ? "var(--ok)" : on ? "var(--pri)" : "var(--s3)", color: done || on ? "var(--onsolid)" : "var(--mut)", transition: "background-color .2s ease" }}>
              {done ? <Ic n="check" size={15} stroke={3} /> : i + 1}
            </span>
            <span className="clip hide-m" style={{ fontSize: 13, fontWeight: on ? 700 : 500, color: on ? "var(--fg)" : "var(--mut)" }}>{s}</span>
            {i < steps.length - 1 ? <span style={{ flex: 1, height: 2, minWidth: 12, borderRadius: 1, background: done ? "var(--ok)" : "var(--bd)" }} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** A row of date chips (Today, Yesterday, …). */
export function DateChips({ days, value, onChange }: { days: { value: string; label: string; sub?: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <ChipRow label="Pick a day">
      {days.map((d) => (
        <Chip key={d.value} on={d.value === value} onClick={() => onChange(d.value)}>
          {d.label}
          {d.sub ? <span style={{ fontWeight: 500, opacity: 0.75 }}>{d.sub}</span> : null}
        </Chip>
      ))}
    </ChipRow>
  );
}

/** Search box with the design's look; debounced `onSearch`. */
export function SearchBox({
  value,
  onChange,
  placeholder = "Search",
  autoFocus,
  style,
  kbd,
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: CSSProperties;
  kbd?: string;
  name?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} style={{ position: "relative", height: 44, borderRadius: 12, border: "1px solid var(--bds)", background: "var(--card)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", color: "var(--mut)", ...style }}>
      <Ic n="search" />
      <span className="sr">{placeholder}</span>
      <input
        id={id}
        name={name}
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        style={{ flex: 1, minWidth: 0, height: "100%", border: 0, background: "transparent", outline: "none", fontSize: 15, color: "var(--fg)" }}
      />
      {value ? (
        <button type="button" className="tap icon-btn" style={{ width: 30, height: 30 }} aria-label="Clear search" onClick={() => onChange("")}>
          <Ic n="x" size={16} />
        </button>
      ) : kbd ? (
        <span className="k">{kbd}</span>
      ) : null}
    </label>
  );
}

/** A value that counts up when it first appears (respects reduced motion). */
export function CountUp({ value, format = (v: number) => String(Math.round(v)), duration = 700 }: { value: number; format?: (v: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const r = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(r);
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="num" aria-live="polite">{format(shown)}</span>;
}
