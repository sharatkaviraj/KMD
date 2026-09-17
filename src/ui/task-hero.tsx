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
