import type { ReactNode } from "react";
import { Monitor } from "lucide-react";

import { formatInr } from "@/platform/helpers/currency";
import { cn } from "@/platform/utils";

/**
 * Phone-app kit — "VPPS Mobile App v2".
 *
 * Every piece here is presentational and token-only (no raw HSL, no hex): the
 * design was authored against the Ledger Calm token set, so `--nav` is the ink
 * band, `--accent` is the saffron, and `--radius-*` carries the geometry.
 *
 * These primitives render inside the `md:hidden` branch of each module. The
 * desktop tree is untouched — a phone screen is a different information
 * architecture, not a narrower table.
 *
 * Scope note: this is a card/row/label kit, NOT a screen shell. The design's
 * full-height screen model (page never scrolls, body region does) is
 * implemented once on `<main>` via `.mobile-app-main` in `app/globals.css`,
 * with the takeover back bar in `components/admin/mobile-takeover-bar.tsx` —
 * not per screen. An earlier draft of this file carried `MobileAppScreen` /
 * `MobileAppHeader` for a per-screen version that was never wired up; they
 * were removed rather than left as dead code claiming otherwise.
 */

/* ------------------------------------------------------------------ screen */

export function MobileScreen({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mobile-workspace-screen anim-workspace-enter mx-auto flex w-full min-w-0 max-w-xl flex-col gap-4 pb-4", className)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------- cards */

export function MobileCard({
  children,
  className,
  as: Tag = "div",
  animate = false,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "li";
  /**
   * Opt-in mount animation. Off by default on purpose: `MobileCard` is also
   * the list row, and a card that settles in on every filter keystroke reads
   * as jitter, not polish. Turn it on for cards that genuinely *arrive* — the
   * review card, the QR panel, the import step panel.
   */
  animate?: boolean;
}) {
  return (
    <Tag
      className={cn(
        "rounded-2xl border border-border bg-card p-4",
        animate && "anim-settle-in",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Ink hero band — the dark card the day's money sits on. */
export function InkCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Always animates: this is the one hero card per screen, so it is the
        // arrival the design's `card-in` is describing.
        "relative overflow-hidden rounded-2xl bg-nav p-5 text-nav-foreground",
        className,
      )}
    >
      {/* saffron bloom, top-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-8 size-36 rounded-full bg-accent/20"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

/**
 * Hero money. Serif display face, reserved for one amount per screen — the
 * day total, the composer amount, the receipt amount. Row money stays Inter
 * via `<Money>`.
 */
export function HeroMoney({
  value,
  className,
  suffix,
  compact = false,
}: {
  value: number | null | undefined;
  className?: string;
  suffix?: ReactNode;
  compact?: boolean;
}) {
  return (
    <p className={cn("font-display-money break-words text-[clamp(1.75rem,8vw,2.5rem)] leading-tight", className)}>
      {formatInr(value, { compact })}
      {suffix ? <span className="text-base font-semibold">{suffix}</span> : null}
    </p>
  );
}

export function MobileLabel({
  children,
  className,
  tone = "muted",
}: {
  children: ReactNode;
  className?: string;
  tone?: "muted" | "ink" | "accent";
}) {
  return (
    <p
      className={cn(
        "mobile-eyebrow",
        tone === "muted" && "text-muted-foreground",
        tone === "ink" && "text-nav-muted",
        tone === "accent" && "text-accent",
        className,
      )}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------- three-up stat strip */

export type MobileStat = {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: "neutral" | "warning" | "danger" | "success";
};

const statToneClass = {
  neutral: "text-foreground",
  warning: "text-warning",
  danger: "text-destructive",
  success: "text-success",
} as const;

/** The Pending / Overdue / Old-balance strip. Divided, not gapped. */
export function MobileStatStrip({ stats }: { stats: MobileStat[] }) {
  return (
    <div
      className="grid overflow-hidden rounded-xl border border-border bg-card"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={cn(
            "min-w-0 px-2 py-4 text-center",
            index < stats.length - 1 && "border-r border-border/60",
          )}
        >
          <p className="flex min-h-10 items-center justify-center break-words text-xs font-semibold leading-5 text-muted-foreground">
            {stat.label}
          </p>
          <p
            className={cn(
              "tabular mt-1 break-words text-lg font-bold leading-tight",
              statToneClass[stat.tone ?? "neutral"],
            )}
          >
            {stat.value}
          </p>
          {stat.meta ? (
            <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{stat.meta}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- list rows */

/** Icon tile used by the More hub, Settings rows and Admin Tools cards. */
export function IconTile({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "accent" | "info" | "success" | "warning" | "danger" | "neutral";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-grid size-9 shrink-0 place-items-center rounded-xl text-base",
        tone === "accent" && "tone-accent",
        tone === "info" && "tone-info",
        tone === "success" && "tone-success",
        tone === "warning" && "tone-warning",
        tone === "danger" && "tone-danger",
        tone === "neutral" && "tone-neutral",
        className,
      )}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

/**
 * The standard tappable row: icon tile, title + description, trailing value.
 * Used by More, Settings, Master data, Reports, Admin tools.
 */
export function MobileRow({
  icon,
  title,
  description,
  value,
  trailing,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-[3.25rem] items-center gap-3", className)}>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="mobile-row-title block break-words text-foreground">{title}</span>
        {description ? (
          <span className="mobile-row-meta mt-0.5 block break-words text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {value ? (
        <span className="tabular break-words text-sm font-semibold text-foreground">
          {value}
        </span>
      ) : null}
      {trailing}
    </div>
  );
}

/* ------------------------------------------------------------------- bars */

/** Single-track progress bar. */
export function MobileBar({
  percent,
  tone = "accent",
  className,
}: {
  percent: number;
  tone?: "accent" | "warning" | "success" | "danger";
  className?: string;
}) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div className={cn("h-[7px] overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className={cn(
          "h-full rounded-full",
          tone === "accent" && "bg-accent",
          tone === "warning" && "bg-warning",
          tone === "success" && "bg-success",
          tone === "danger" && "bg-destructive",
        )}
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}

/** Multi-segment bar — collected / pending / not-due, or the mode split. */
export function MobileSplitBar({
  segments,
  className,
}: {
  segments: { key: string; percent: number; tone: "success" | "danger" | "warning" | "neutral" | "accent" | "info" }[];
  className?: string;
}) {
  return (
    <div className={cn("flex h-2.5 overflow-hidden rounded-full bg-surface-2", className)}>
      {segments.map((segment) => (
        <div
          key={segment.key}
          className={cn(
            segment.tone === "success" && "bg-success",
            segment.tone === "danger" && "bg-destructive",
            segment.tone === "warning" && "bg-warning",
            segment.tone === "accent" && "bg-accent",
            segment.tone === "info" && "bg-info",
            segment.tone === "neutral" && "bg-border-strong",
          )}
          style={{ width: `${Math.max(0, Math.min(100, segment.percent))}%` }}
        />
      ))}
    </div>
  );
}

/** Dashed "how this works" note — the calm reassurance blocks. */
export function MobileNote({
  icon = "💡",
  children,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-dashed border-border-strong bg-surface-2 p-3.5",
        className,
      )}
    >
      <span aria-hidden="true" className="text-base leading-tight">
        {icon}
      </span>
      <p className="text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ misc */

export function MobileSectionCard({
  title,
  action,
  children,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <MobileCard className={className}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-bold leading-6 text-foreground">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </MobileCard>
  );
}

/**
 * Collect wizard step rail (mobile v2). Four segments: who → amount → mode →
 * review. It exists so a clerk mid-flow can tell how much is left before the
 * money is recorded — the wizard's whole promise is "nothing is saved yet".
 */
export function MobileStepRail({
  step,
  total = 4,
  label,
  ariaLabel,
  className,
}: {
  /** 1-based current step. */
  step: number;
  total?: number;
  /** Already-translated caption. The kit stays server-safe, so callers translate. */
  label?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      ) : null}
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-label={ariaLabel ?? `Step ${step} of ${total}`}
      >
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-[5px] flex-1 rounded-full",
              index < step ? "bg-accent" : "bg-border",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Record card — the phone stand-in for one row of a wide desk table.
 *
 * A 1600px-wide table inside a horizontal scroller technically "works" on a
 * 375px screen, but reading one refund means scrubbing sideways through
 * twelve columns and losing the row. This puts the identity on top, the money
 * on the right, the rest as labelled pairs, and the row's actions at the
 * bottom where a thumb already is.
 */
export function MobileRecordCard({
  title,
  subtitle,
  amount,
  status,
  fields,
  actions,
  footnote,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  amount?: ReactNode;
  status?: ReactNode;
  /** Label/value pairs. Rows with an empty value are dropped, not shown as "-". */
  fields?: Array<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
  footnote?: ReactNode;
  className?: string;
}) {
  const shown = (fields ?? []).filter(
    (field) => field.value !== null && field.value !== undefined && field.value !== "" && field.value !== "-",
  );

  return (
    <li className={cn("min-w-0 rounded-2xl border border-border bg-card p-4", className)}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-40">
          <p className="break-words text-base font-bold leading-6 text-foreground">
            {title}
          </p>
          {subtitle ? (
            <p className="mt-1 break-words text-sm leading-5 text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 max-w-full text-right [overflow-wrap:anywhere]">
          {amount ? (
            <p className="tabular break-words text-base font-bold text-foreground">{amount}</p>
          ) : null}
          {status ? <div className="mt-1 flex justify-end">{status}</div> : null}
        </div>
      </div>

      {shown.length > 0 ? (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border pt-2.5">
          {shown.map((field) => (
            <div key={field.label} className="min-w-0">
              <dt className="break-words text-xs font-semibold leading-5 text-muted-foreground">
                {field.label}
              </dt>
              <dd className="break-words text-sm font-medium leading-6 text-foreground">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {footnote ? (
        <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">{footnote}</p>
      ) : null}

      {actions ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
          {actions}
        </div>
      ) : null}
    </li>
  );
}

/** Empty state for a phone card list. */
export function MobileEmptyRows({ children }: { children: ReactNode }) {
  return (
    <li className="rounded-xl border border-dashed border-border-strong bg-surface-2 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
      {children}
    </li>
  );
}

/**
 * Shown on phones for the handful of admin surfaces that genuinely need a
 * keyboard and a wide screen — bulk payment upload, class promotion, session
 * health, fee-setup time travel. Being honest that a task belongs on a computer
 * beats shipping a cramped form that invites a mistake on live money.
 */
export function MobileDesktopOnlyNotice({
  title,
  reason,
  className,
}: {
  title: ReactNode;
  reason: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-border-strong bg-surface-2 p-4 md:hidden",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Monitor className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-base font-bold leading-6 text-foreground">{title}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{reason}</p>
        </div>
      </div>
    </div>
  );
}
