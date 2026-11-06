import * as React from "react";
import type { LucideIcon } from "lucide-react";

import * as m from "@/messages/pairs";
import {
  flat,
  primary,
  secondary,
  type Language,
  type Localized,
} from "@/platform/i18n/language";
import { cn } from "@/platform/utils";

/**
 * The three states every screen has and most screens forget.
 *
 * They are components rather than a pattern to copy because the forgetting is
 * the problem: a list with no empty state renders as a blank page, and on a
 * phone in a corridor nobody can tell a blank page from a failed one.
 *
 * Each takes the reader's language, because a staff member who asked for
 * English should not be told a list is empty in Hindi.
 */

/** A list or screen with nothing in it yet — a normal state, not a fault. */
export function EmptyState({
  title,
  detail,
  language,
  action,
  className,
}: {
  title: Localized;
  detail?: Localized;
  language: Language;
  action?: React.ReactNode;
  className?: string;
}) {
  const titleUnder = secondary(title, language);
  const detailUnder = detail ? secondary(detail, language) : null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed border-border-strong bg-surface-2 px-5 py-10 text-center",
        className,
      )}
    >
      <p className="text-[15px] font-medium text-foreground">
        {primary(title, language)}
      </p>
      {titleUnder ? (
        <p className="text-[13px] text-muted-foreground">{titleUnder}</p>
      ) : null}
      {detail ? (
        <p className="mx-auto mt-2 max-w-xs text-[13px] leading-5 text-muted-foreground">
          {primary(detail, language)}
          {detailUnder ? <span className="ml-1.5 opacity-80">{detailUnder}</span> : null}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * Grey blocks in the shape of the thing that is coming.
 *
 * A spinner says "wait"; this says "a list of six rows is arriving", which on
 * a slow connection is the difference between waiting and reloading.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-lg bg-surface-3", className)}
    />
  );
}

export function SkeletonRows({
  rows = 5,
  language = "both",
}: {
  rows?: number;
  language?: Language;
}) {
  return (
    <div className="space-y-2" role="status" aria-label={flat(m.loading, language)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-[4.5rem] w-full rounded-2xl" />
      ))}
    </div>
  );
}

/** Something failed. Always offers a way on, never just the word "Error". */
export function ErrorState({
  title = m.somethingWrong,
  language,
  detail,
  help,
  action,
  className,
}: {
  title?: Localized;
  language: Language;
  detail?: string | null;
  /** What to do next, at reading size (the digest stays small and mono). */
  help?: string | null;
  action?: React.ReactNode;
  className?: string;
}) {
  const under = secondary(title, language);

  return (
    <div
      role="alert"
      className={cn(
        "rounded-2xl border border-destructive/25 bg-destructive-soft px-5 py-8 text-center",
        className,
      )}
    >
      <p className="text-[15px] font-medium text-destructive-soft-foreground">
        {primary(title, language)}
      </p>
      {under ? (
        <p className="mt-1 text-[13px] leading-5 text-destructive-soft-foreground/80">
          {under}
        </p>
      ) : null}
      {help ? (
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-6 text-destructive-soft-foreground">{help}</p>
      ) : null}
      {detail ? (
        // The digest, not the stack. It is what makes a report actionable
        // without putting internals on a teacher's screen.
        <p className="mt-3 font-mono text-[11px] text-destructive-soft-foreground/70">
          {detail}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * The atlas's empty and refusal states: a symbol, a sentence, a way on.
 *
 * `EmptyState` above is the plain version and stays — a dashed box is right
 * inside a panel that already has a heading. This is the full-page one the
 * `states` screen draws: centred, with an icon, and **always** with somewhere
 * to go, because "Every state has a next step" is the title of that screen and
 * a dead end is the one thing none of these may be.
 */
export function StateCard({
  icon: Icon,
  title,
  detail,
  language,
  action,
  tone = "neutral",
  className,
}: {
  icon: LucideIcon;
  title: Localized;
  detail?: Localized;
  language: Language;
  action?: React.ReactNode;
  tone?: "neutral" | "warning" | "danger";
  className?: string;
}) {
  const titleUnder = secondary(title, language);

  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn(
        "rounded-2xl border px-5 py-10 text-center",
        tone === "danger"
          ? "border-destructive/25 bg-destructive-soft"
          : tone === "warning"
            ? "border-warning/30 bg-warning-soft"
            : "border-border bg-surface",
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mx-auto size-7",
          tone === "danger"
            ? "text-destructive-soft-foreground/70"
            : tone === "warning"
              ? "text-warning-soft-foreground/70"
              : "text-subtle-foreground",
        )}
      />
      <p className="mt-3 text-[16px] font-semibold text-foreground">
        {primary(title, language)}
      </p>
      {titleUnder ? (
        <p className="text-[13px] text-muted-foreground">{titleUnder}</p>
      ) : null}
      {detail ? (
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-muted-foreground">
          {primary(detail, language)}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
