import { type ReactNode } from "react";

import { cn } from "@/platform/utils";

/**
 * One item of a settings list that opens to edit.
 *
 * Closed, it is one line: what the item is, a short summary, a badge, and
 * "Edit". Open, it shows the item's form. Screens that listed every item
 * with its form already open (twenty classes, forty teachers, every question
 * the school asks) read as a wall of inputs on a phone; this keeps the list
 * readable and puts the form one tap away.
 *
 * A native `<details>`, so it works from Server Components with no
 * JavaScript, and keeps itself open across a save. The chevron is inline SVG
 * for the reason given in `collapsible-section.tsx`: no icon import, so no
 * cost to client bundles.
 */
export function EditRow({
  title,
  subtitle,
  badge,
  editLabel,
  children,
  className,
  defaultOpen = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  /** Already in the reader's language: "Edit", "बदलें". */
  editLabel: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className={cn("group rounded-2xl border border-border bg-surface", className)}>
      <summary className="focus-ring flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-foreground">{title}</span>
          {subtitle ? <span className="block truncate text-[12px] text-subtle-foreground">{subtitle}</span> : null}
        </span>
        {badge ? <span className="flex shrink-0 items-center gap-1.5">{badge}</span> : null}
        <span className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-accent">
          <span className="group-open:hidden">{editLabel}</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>
      <div className="border-t border-border px-4 pb-4 pt-3">{children}</div>
    </details>
  );
}

/**
 * The "add one" form of a settings list, closed until asked for, and placed
 * above the list rather than below it, where a long list hid it.
 */
export function AddRow({
  label,
  children,
  className,
}: {
  /** Already in the reader's language. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group rounded-2xl border border-border bg-surface", className)}>
      <summary className="focus-ring flex min-h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-[15px] font-semibold text-primary-foreground group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-45"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        {label}
      </summary>
      <div className="px-4 pb-4 pt-3">{children}</div>
    </details>
  );
}
