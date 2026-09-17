import * as React from "react";
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

import { flat, primary, secondary, type Language, type Localized } from "@/platform/i18n/language";
import { cn } from "@/platform/utils";
import { buttonClasses } from "@/ui/primitives/button";

/**
 * The one thing to do next, above everything else on the screen.
 *
 * PLAN §1: "one prominent next action". Not a list of three — a screen that
 * offers three equally-weighted next steps has not decided anything, and the
 * deciding is exactly the part a teacher standing in a corridor at 7:40 cannot
 * do. One action, with the number that makes it concrete ("32 children"), and
 * a button big enough to hit without looking.
 *
 * It is also the only accent-coloured block on the screen, so "what do I do
 * now" is answered by colour before it is answered by reading.
 */
export function TaskHero({
  eyebrow,
  title,
  detail,
  href,
  action,
  icon: Icon,
  language,
}: {
  /** "First things first" — the same words every time, so it is recognised. */
  eyebrow: Localized;
  title: Localized;
  detail?: Localized | null;
  href: string;
  action: Localized;
  icon?: LucideIcon;
  language: Language;
}) {
  const titleUnder = secondary(title, language);

  return (
    <section
      aria-labelledby="task-hero-title"
      className="rounded-2xl border border-accent/25 bg-accent-soft p-5"
    >
      <p className="text-[12px] font-semibold uppercase tracking-wide text-accent-soft-foreground/75">
        {flat(eyebrow, language)}
      </p>

      <h2
        id="task-hero-title"
        className="mt-1.5 text-[22px] font-semibold leading-tight text-accent-soft-foreground"
      >
        {primary(title, language)}
      </h2>
      {titleUnder ? (
        <p className="text-[14px] text-accent-soft-foreground/80">{titleUnder}</p>
      ) : null}

      {detail ? (
        <p className="mt-2 text-[15px] leading-6 text-accent-soft-foreground/90">
          {primary(detail, language)}
        </p>
      ) : null}

      <Link
        href={href}
        className={buttonClasses({ size: "lg", className: "mt-4 w-full sm:w-auto" })}
      >
        {Icon ? <Icon aria-hidden /> : null}
        {primary(action, language)}
        <ArrowRight aria-hidden />
      </Link>
    </section>
  );
}

/**
 * A number and what it counts.
 *
 * Deliberately plain: a figure, a label, and one line of context. PLAN §3a
 * rules out decorative charts, and a sparkline over "4 lessons today" would be
 * decoration pretending to be information.
 *
 * `href` is optional because **a card that cannot drill anywhere must not look
 * like it can**. When it is set the whole card is the target, not a chevron in
 * the corner.
 */
export function MetricCard({
  label,
  value,
  detail,
  href,
  icon: Icon,
  language,
  tone = "neutral",
}: {
  label: Localized;
  /** Already formatted — a count, a percentage, or a dash for "unavailable". */
  value: string;
  detail?: Localized | null;
  href?: string;
  icon?: LucideIcon;
  language: Language;
  tone?: "neutral" | "warning";
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">
          {primary(label, language)}
        </span>
        {Icon ? (
          <Icon aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
        ) : null}
      </div>
      <p
        className={cn(
          "mt-1 text-[28px] font-semibold leading-none tabular-nums",
          tone === "warning" ? "text-warning-soft-foreground" : "text-foreground",
        )}
      >
        {value}
      </p>
      {detail ? (
        <p className="mt-1.5 text-[12px] leading-4 text-subtle-foreground">
          {primary(detail, language)}
        </p>
      ) : null}
    </>
  );

  const shell = cn(
    "block rounded-2xl border p-4",
    tone === "warning"
      ? "border-warning/30 bg-warning-soft"
      : "border-border bg-surface",
  );

  if (!href) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link
      href={href}
      className={cn(shell, "focus-ring transition-colors hover:bg-surface-2")}
    >
      {body}
    </Link>
  );
}

/** Two across on a phone, four on a desk. */
export function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">{children}</div>;
}

/**
 * The desktop home: one task column, one supporting column.
 *
 * DESIGN-SYSTEM §3 — "main task plus 320–360 px supporting column" from
 * 1151 px, one column below it. The breakpoint is `lg` (1024 px) rather than a
 * custom one because that is where this app's sidebar plus two columns first
 * has room, and adding a breakpoint to match a number in a document would be
 * the document deciding the layout rather than the content.
 *
 * `items-start` matters: without it the two columns stretch to the taller
 * one's height and a short supporting panel grows a long empty box under it.
 */
export function HomeColumns({
  main,
  aside,
}: {
  main: React.ReactNode;
  /** Dropped entirely when there is nothing to put beside the work. */
  aside?: React.ReactNode;
}) {
  /**
   * **The wrapper never changes shape, even when the aside goes away.**
   *
   * The first version returned a bare fragment when there was no aside and a
   * grid when there was. On a page whose aside depends on state — the register,
   * where it disappears the moment the register locks — that swaps the element
   * type at `main`'s position, so React unmounts and remounts everything under
   * it. The register's client state went with it: a teacher pressed Save,
   * the form remounted, and the "Saved" acknowledgement she was waiting for
   * never appeared (B-43).
   *
   * So `main` is always the first child of the same `div`. Only the column
   * track and the second child are conditional, and neither can remount the
   * work.
   */
  return (
    <div
      className={cn(
        "grid items-start gap-5",
        aside ? "lg:grid-cols-[minmax(0,1fr)_340px]" : null,
      )}
    >
      {/* The task column keeps whatever spacing its own sections carry, so a
          page can be moved into these columns without every margin changing.
          The supporting column is a stack of cards and gets one rhythm. */}
      <div className="min-w-0">{main}</div>
      {aside ? <div className="min-w-0 space-y-5">{aside}</div> : null}
    </div>
  );
}

/**
 * A small labelled bar. Two numbers and how far between them things are.
 *
 * Not a chart library, and not a chart: PLAN §3a rules out decorative charts,
 * and this is a single fact — "28 of 30 registers are in" — drawn so it can be
 * read without reading. The figure is beside it in words, because colour and
 * length are not information to everybody (DESIGN-SYSTEM §5).
 *
 * A null `value` renders an empty track and the caller's "unavailable" text.
 * A count that could not be read must not draw a full bar or an empty one that
 * looks like nought (D-93).
 */
export function ProgressRow({
  label,
  value,
  total,
  figure,
  language,
  tone = "neutral",
}: {
  label: Localized;
  /** Null when the count could not be read. */
  value: number | null;
  total: number | null;
  /** Already formatted — "28 / 30", or a dash. */
  figure: string;
  language: Language;
  tone?: "neutral" | "warning";
}) {
  const complete =
    value !== null && total !== null && total > 0
      ? Math.min(100, Math.max(0, Math.round((value / total) * 100)))
      : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[14px] font-medium text-foreground">
          {primary(label, language)}
        </span>
        <span className="shrink-0 text-[14px] font-semibold tabular-nums text-muted-foreground">
          {figure}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
        // The figure beside the label is the accessible value; the bar is a
        // second rendering of it and would be read out twice.
        aria-hidden
      >
        {complete === null ? null : (
          <div
            className={cn(
              "h-full rounded-full",
              tone === "warning" ? "bg-warning" : "bg-success",
            )}
            style={{ width: `${complete}%` }}
          />
        )}
      </div>
    </div>
  );
}
