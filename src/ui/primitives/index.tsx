import * as React from "react";

import { cn } from "@/platform/utils";

/**
 * The small primitives, in one file because they are each a handful of lines
 * and splitting them across six would cost more to navigate than to read.
 * `Button` is its own file; it has real variant logic.
 */

/* -------------------------------------------------------------- surfaces */

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A titled block. `action` sits opposite the title — an "Add" button, a count,
 * a link to the full list.
 */
export function Section({
  title,
  titleEn,
  description,
  action,
  className,
  children,
}: {
  title: React.ReactNode;
  titleEn?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-foreground">
            {title}
            {titleEn ? (
              <span className="ml-2 text-[13px] font-normal text-subtle-foreground">
                {titleEn}
              </span>
            ) : null}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------- forms */

export function Label({
  className,
  hint,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: string }) {
  return (
    <label
      className={cn("block text-[15px] font-medium text-foreground", className)}
      {...props}
    >
      {children}
      {hint ? (
        <span className="ml-2 text-[13px] font-normal text-subtle-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

const FIELD_CLASSES =
  "w-full rounded-xl border border-border bg-surface px-4 text-base text-foreground " +
  "placeholder:text-subtle-foreground focus-ring focus-visible:border-accent " +
  "disabled:opacity-60 disabled:bg-surface-2 " +
  // aria-invalid rather than a prop: the browser and the server action both
  // already speak it, so the styling follows the semantics for free.
  "aria-[invalid=true]:border-destructive aria-[invalid=true]:bg-destructive-soft";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_CLASSES, "h-12", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(FIELD_CLASSES, "min-h-24 py-3", className)} {...props} />
  );
}

/** Native select on purpose — it gets the OS picker, which is the good one on a phone. */
export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(FIELD_CLASSES, "h-12 appearance-none pr-10", className)}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  error,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  htmlFor: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-[13px] text-destructive-soft-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  className,
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: React.ReactNode;
  hint?: string;
}) {
  const id = props.id;
  return (
    // The whole row is the target, not just the 20px box.
    <label
      htmlFor={id}
      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4"
    >
      <input
        type="checkbox"
        className={cn("size-5 shrink-0 accent-accent", className)}
        {...props}
      />
      <span className="text-[15px] text-foreground">
        {label}
        {hint ? (
          <span className="ml-2 text-[13px] text-subtle-foreground">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

/* ------------------------------------------------------------ indicators */

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "border-border bg-surface-2 text-muted-foreground",
  success: "border-success/25 bg-success-soft text-success-soft-foreground",
  warning: "border-warning/30 bg-warning-soft text-warning-soft-foreground",
  danger: "border-destructive/25 bg-destructive-soft text-destructive-soft-foreground",
  info: "border-info/25 bg-info-soft text-info-soft-foreground",
  accent: "border-accent/30 bg-accent-soft text-accent-soft-foreground",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/**
 * A message with a Hindi headline and an English line under it. Every
 * user-facing message in this app is bilingual, so it is a component rather
 * than a convention nobody remembers.
 */
export function Notice({
  tone = "info",
  hi,
  en,
  className,
  children,
}: {
  tone?: Tone;
  hi: React.ReactNode;
  en?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      aria-live="polite"
      className={cn("rounded-xl border px-4 py-3", TONES[tone], className)}
    >
      <p className="text-[15px] font-medium leading-6">{hi}</p>
      {en ? <p className="mt-0.5 text-[13px] leading-5 opacity-80">{en}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

/** Key/value rows. The shape most of this app's detail screens are. */
export function DetailList({
  items,
  className,
}: {
  items: { label: React.ReactNode; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-border", className)}>
      {items.map((item, index) => (
        <div
          key={index}
          className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0"
        >
          <dt className="shrink-0 text-[14px] text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-right text-[15px] font-medium text-foreground">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
