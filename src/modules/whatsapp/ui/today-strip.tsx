import { ArrowRight, CalendarClock, PhoneCall, Sparkles } from "lucide-react";

import {
  DEFAULT_AUDIENCE_FILTERS,
  reminderQuery,
  type ReminderQuerySource,
} from "@/modules/whatsapp/domain/audience";
import type { TodaySuggestion } from "@/modules/whatsapp/domain/today-suggestions";
import { formatDdMmYyyy } from "@/platform/helpers/date";
import { cn } from "@/platform/utils";
import { NavLink } from "@/ui/shell/nav-link";

/**
 * "Today" — what is worth sending this morning, one tap from a run that is
 * already set up.
 *
 * A SERVER component of links: the send screen sits under a gzip ceiling and
 * this costs it nothing. Each card opens the screen on a clean preset — the
 * notice, the installment, the date it prints and the late-fee mode — rather
 * than layering onto whatever filters were last left on, so the card means the
 * same thing whoever taps it.
 *
 * Counts are the installment tile's own count under the screen's current
 * narrowing — "up to" because the card's preset (late fee on the ledger, not
 * already overdue) narrows further.
 */

const TONE: Record<TodaySuggestion["tone"], string> = {
  info: "border-l-info",
  warning: "border-l-warning",
  danger: "border-l-destructive",
};

export function TodayStrip({
  suggestions,
  base,
  tileCounts,
  dueCampaigns,
}: {
  suggestions: readonly TodaySuggestion[];
  /** The screen's message settings, so a card keeps the office's language and late-fee lever. */
  base: Pick<
    ReminderQuerySource,
    "language" | "lateFeeAmount" | "lateFeeBasis" | "preDueWindowDays"
  >;
  tileCounts: readonly number[];
  /** How many saved campaigns are due to run — shown as a card when any are. */
  dueCampaigns: number;
}) {
  const hrefFor = (suggestion: TodaySuggestion) =>
    `?${reminderQuery({
      ...DEFAULT_AUDIENCE_FILTERS,
      installments: [suggestion.installmentNo],
      lateFee: suggestion.lateFee,
      skipOverdue: suggestion.skipOverdue,
      situation: suggestion.situation,
      language: base.language,
      lastDate: formatDdMmYyyy(suggestion.messageDate),
      lateFeeAmount: base.lateFeeAmount,
      lateFeeBasis: base.lateFeeBasis,
      // The real figure: the waiver notices quote each family's own late fee,
      // and a forward-looking notice quotes the school's rate.
      lateFeeSource: "ledger",
      preDueWindowDays: base.preDueWindowDays,
    }).toString()}`;

  const promiseHref = `?${reminderQuery({
    ...DEFAULT_AUDIENCE_FILTERS,
    installments: [],
    installmentMatch: "any",
    promise: "due_soon",
    situation: "promise_due",
    language: base.language,
    lastDate: "",
    lateFeeAmount: base.lateFeeAmount,
    lateFeeBasis: base.lateFeeBasis,
    lateFeeSource: "ledger",
    preDueWindowDays: base.preDueWindowDays,
  }).toString()}`;

  return (
    <section aria-labelledby="reminders-today" className="flex flex-col gap-2.5">
      <h2 id="reminders-today" className="flex items-center gap-2 text-sm font-bold text-foreground">
        <Sparkles className="size-4 text-accent" aria-hidden="true" />
        Today
        <span className="text-[11.5px] font-medium text-muted-foreground">
          from the fee calendar — tap one to set the message up
        </span>
      </h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {suggestions.map((suggestion) => {
          const count = tileCounts[suggestion.installmentNo - 1] ?? 0;
          return (
            <li key={suggestion.key}>
              <NavLink
                href={hrefFor(suggestion)}
                prefetch={false}
                className={cn(
                  "tap focus-ring flex h-full min-h-11 flex-col gap-1 rounded-xl border border-l-4 border-border bg-card p-3 hover:border-border-strong",
                  TONE[suggestion.tone],
                )}
              >
                <span className="text-[13px] font-extrabold leading-tight text-foreground">
                  {suggestion.title}
                </span>
                <span className="text-[11.5px] leading-snug text-muted-foreground">{suggestion.detail}</span>
                <span className="mt-auto flex items-center justify-between gap-2 pt-1 text-[12px] font-bold text-accent">
                  <span className="tabular-nums text-foreground">
                    up to {count} {count === 1 ? "family" : "families"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    Set it up <ArrowRight className="size-3.5" aria-hidden="true" />
                  </span>
                </span>
              </NavLink>
            </li>
          );
        })}
        <li>
          <NavLink
            href={promiseHref}
            prefetch={false}
            className="tap focus-ring flex h-full min-h-11 flex-col gap-1 rounded-xl border border-l-4 border-border border-l-accent bg-card p-3 hover:border-border-strong"
          >
            <span className="text-[13px] font-extrabold leading-tight text-foreground">Promises due</span>
            <span className="text-[11.5px] leading-snug text-muted-foreground">
              Families whose own promised date is today or tomorrow.
            </span>
            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-[12px] font-bold text-accent">
              Set it up <ArrowRight className="size-3.5" aria-hidden="true" />
            </span>
          </NavLink>
        </li>
        <li>
          <NavLink
            href="/fees/defaulters"
            prefetch={false}
            className="tap focus-ring flex h-full min-h-11 flex-col gap-1 rounded-xl border border-l-4 border-border border-l-destructive bg-card p-3 hover:border-border-strong"
          >
            <span className="flex items-center gap-1.5 text-[13px] font-extrabold leading-tight text-foreground">
              <PhoneCall className="size-3.5" aria-hidden="true" />
              Read, still not paid
            </span>
            <span className="text-[11.5px] leading-snug text-muted-foreground">
              They have seen the message. Call them — another message will not help.
            </span>
            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-[12px] font-bold text-accent">
              Open the call list <ArrowRight className="size-3.5" aria-hidden="true" />
            </span>
          </NavLink>
        </li>
        {dueCampaigns > 0 ? (
          <li>
            <NavLink
              href="/fees/reminders/ladder"
              prefetch={false}
              className="tap focus-ring flex h-full min-h-11 flex-col gap-1 rounded-xl border border-l-4 border-border border-l-warning bg-card p-3 hover:border-border-strong"
            >
              <span className="flex items-center gap-1.5 text-[13px] font-extrabold leading-tight text-foreground">
                <CalendarClock className="size-3.5" aria-hidden="true" />
                {dueCampaigns} plan step{dueCampaigns === 1 ? "" : "s"} due
              </span>
              <span className="text-[11.5px] leading-snug text-muted-foreground">
                Saved steps whose day has arrived. They are listed below too.
              </span>
              <span className="mt-auto inline-flex items-center gap-1 pt-1 text-[12px] font-bold text-accent">
                Open the plan <ArrowRight className="size-3.5" aria-hidden="true" />
              </span>
            </NavLink>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
