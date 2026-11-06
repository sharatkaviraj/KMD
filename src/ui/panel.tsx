import * as React from "react";
import Link from "@/ui/link";
import { ArrowRight, ChevronRight, type LucideIcon } from "lucide-react";

import {
  primary,
  secondary,
  type Language,
  type Localized,
} from "@/platform/i18n/language";
import { cn } from "@/platform/utils";

/**
 * The shape almost every screen in the atlas is made of.
 *
 * Look at `students`, `staff`, `attendance`, `review`, `cover`, `setup` and
 * `reports` side by side and they are one composition: a white card whose head
 * carries a title and a line of context, and whose body is a list of rows
 * separated by hairlines rather than by gaps. The role homes already had it
 * by hand; every other screen had a bare `<ul className="space-y-2">` of
 * separately-bordered cards, which is a different density and reads as a
 * different product.
 *
 * So it is a component. Not because three screens share markup — because
 * fifteen screens are supposed to look like one application, and the way that
 * stops being true is each page making its own list (DESIGN-SYSTEM §7:
 * "use shared component contracts to prevent inconsistent buttons, corner
 * radii and density").
 *
 * `Section` is still the right thing for a heading over free-form content.
 * This is for a heading over **rows**.
 */
export function Panel({
  title,
  description,
  language,
  action,
  footer,
  className,
  children,
}: {
  title: Localized;
  description?: Localized | null;
  language: Language;
  /** Opposite the title — a count, a link to the full list, a button. */
  action?: React.ReactNode;
  /** Below the rows, inside the card: a save bar, a paging row. */
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const titleUnder = secondary(title, language);
  const descriptionUnder = description ? secondary(description, language) : null;

  // The heading names the region, so a screen reader announces "Staff
  // directory" rather than "region" — the same rule `Section` follows (B-23).
  const headingId = `panel-${title.en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "overflow-hidden rounded-[18px] border border-border bg-surface shadow-[var(--sh,0_1px_2px_rgba(21,25,35,.04),0_12px_28px_-18px_rgba(21,25,35,.28))]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-[16px] font-semibold text-foreground">
            {primary(title, language)}
            {titleUnder ? (
              <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                {titleUnder}
              </span>
            ) : null}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
              {primary(description, language)}
              {descriptionUnder ? (
                <span className="ml-1.5">{descriptionUnder}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {/* A real list, not a stack of divs.
          Every panel in this app holds a list of like things — children,
          staff, classes, exams — and a screen reader that cannot say "list,
          15 items" is reading fifteen unrelated paragraphs. It is also what
          `teacher-attendance.spec.ts` counts, which is how the first version
          of this component was caught turning the register into divs. */}
      <ul className="divide-y divide-border border-t border-border">{children}</ul>

      {footer ? (
        <div className="border-t border-border bg-surface-2 px-5 py-4">{footer}</div>
      ) : null}
    </section>
  );
}

/**
 * One row inside a `Panel`.
 *
 * `href` makes the whole row the target rather than a chevron in the corner —
 * a thumb aims at a row, not at a 20px arrow. Without one it is a plain row,
 * because **a row that cannot go anywhere must not look like it can**; the
 * same rule `MetricCard` follows.
 *
 * 64px tall, which is the 44px minimum with room to breathe and what the
 * atlas draws.
 */
export function PanelRow({
  icon: Icon,
  lead,
  title,
  detail,
  trailing,
  href,
  tone = "neutral",
  className,
  children,
}: {
  /** The small tinted tile on the left. */
  icon?: LucideIcon;
  /** Used instead of an icon: a roll number, a period, initials. */
  lead?: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  /** A badge, a count, a button — whatever sits at the end of the row. */
  trailing?: React.ReactNode;
  href?: string;
  tone?: "neutral" | "warning" | "accent";
  className?: string;
  /** Below the row's own line: status controls, a diff, a nested form. */
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex min-h-16 items-center gap-3 px-5 py-3">
        {Icon ? (
          <span
            aria-hidden
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5",
              tone === "warning"
                ? "bg-warning-soft text-warning-soft-foreground"
                : tone === "accent"
                  ? "bg-accent-soft text-accent-soft-foreground"
                  : "bg-surface-2 text-muted-foreground",
            )}
          >
            <Icon />
          </span>
        ) : lead !== undefined ? (
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[13px] font-semibold tabular-nums text-muted-foreground"
          >
            {lead}
          </span>
        ) : null}

        <span className="min-w-0 flex-1">
          {/* Wrapped, not truncated: a long name is usually the thing being
              looked for, and cutting it off defeats the looking (PLAN §3a). */}
          <span className="block text-[15px] font-medium text-foreground">{title}</span>
          {detail ? (
            <span className="block text-[12px] leading-4 text-muted-foreground">
              {detail}
            </span>
          ) : null}
        </span>

        {trailing ? <span className="shrink-0">{trailing}</span> : null}
        {href ? (
          <ChevronRight aria-hidden className="size-5 shrink-0 text-subtle-foreground" />
        ) : null}
      </div>
      {children ? <div className="px-5 pb-4">{children}</div> : null}
    </>
  );

  const shell = cn(
    tone === "warning" ? "bg-warning-soft/60" : null,
    tone === "accent" ? "bg-accent-soft/60" : null,
    className,
  );

  // The `<li>` is always the row, and the link lives inside it: a list item
  // that is itself an anchor is a list a screen reader announces as links
  // rather than as items, and it is what `Panel`'s `<ul>` expects as a child.
  if (!href) return <li className={shell}>{body}</li>;

  return (
    <li className={shell}>
      <Link
        href={href}
        className="focus-ring block transition-colors hover:bg-surface-2"
      >
        {body}
      </Link>
    </li>
  );
}

/**
 * A quiet card under the content, explaining one rule.
 *
 * The atlas ends several screens with one — "A reliable search", "Keep roles
 * recognizable", "Preview the effect". It is deliberately not a `Notice`:
 * a notice is about *this* request, and a reader who sees the same alert on
 * every visit stops reading alerts.
 */
export function FootNote({
  title,
  text,
  language,
  className,
}: {
  title: Localized;
  text: Localized;
  language: Language;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface-2 px-5 py-4",
        className,
      )}
    >
      <p className="text-[14px] font-semibold text-foreground">
        {primary(title, language)}
      </p>
      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
        {primary(text, language)}
      </p>
    </div>
  );
}

/**
 * The small text link that ends a row or a panel — "Open", "Review", "Assign".
 *
 * A link rather than a button because it navigates, and 44px tall because it
 * is tapped. The arrow is the atlas's; it says the row leads somewhere without
 * needing the word to say it twice.
 */
export function RowAction({
  href,
  label,
  language,
  className,
}: {
  href: string;
  label: Localized;
  language: Language;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1",
        "text-[13px] font-semibold text-accent-soft-foreground hover:underline",
        className,
      )}
    >
      {primary(label, language)}
      <ArrowRight aria-hidden className="size-4" />
    </Link>
  );
}
