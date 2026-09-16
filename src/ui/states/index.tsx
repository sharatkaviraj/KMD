import * as React from "react";

import { cn } from "@/platform/utils";

/**
 * The three states every screen has and most screens forget.
 *
 * They are components rather than a pattern to copy because the forgetting is
 * the problem: a list with no empty state renders as a blank page that looks
 * broken, and on a phone in a corridor nobody can tell a blank page from a
 * failed one.
 */

/** A list or screen with nothing in it yet — a normal state, not a fault. */
export function EmptyState({
  hi,
  en,
  action,
  className,
}: {
  hi: React.ReactNode;
  en?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed border-border-strong bg-surface-2 px-5 py-10 text-center",
        className,
      )}
    >
      <p className="text-[15px] font-medium text-foreground">{hi}</p>
      {en ? (
        <p className="mx-auto mt-1 max-w-xs text-[13px] leading-5 text-muted-foreground">
          {en}
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

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="लोड हो रहा है">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-[4.5rem] w-full rounded-2xl" />
      ))}
    </div>
  );
}

/** Something failed. Always offers a way on, never just the word "Error". */
export function ErrorState({
  hi = "कुछ गड़बड़ हो गई।",
  en = "Something went wrong.",
  detail,
  action,
  className,
}: {
  hi?: React.ReactNode;
  en?: React.ReactNode;
  detail?: string | null;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-2xl border border-destructive/25 bg-destructive-soft px-5 py-8 text-center",
        className,
      )}
    >
      <p className="text-[15px] font-medium text-destructive-soft-foreground">{hi}</p>
      <p className="mt-1 text-[13px] leading-5 text-destructive-soft-foreground/80">
        {en}
      </p>
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
