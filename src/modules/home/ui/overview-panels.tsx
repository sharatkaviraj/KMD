import * as React from "react";
import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";

import * as m from "@/messages/pairs";
import type { NavItem } from "@/platform/config/navigation";
import { primary, secondary, type Language, type Localized } from "@/platform/i18n/language";
import type { OverviewRound } from "@/modules/home/data/home-repo";
import { feeSummary, type OverviewRow } from "@/modules/home/domain/overview";
import { AuthoredText } from "@/ui/authored-text";
import { Card, Notice } from "@/ui/primitives";
import { ProgressRow } from "@/ui/task-hero";

function SummaryText({ text, language }: { text: Localized; language: Language }) {
  const under = secondary(text, language);
  return <><span lang={language === "en" ? "en" : "hi"}>{primary(text, language)}</span>{under ? <span lang="en" className="mt-0.5 block text-[12px] font-normal leading-5 text-muted-foreground">{under}</span> : null}</>;
}

/**
 * The three supporting panels on the administrator's home.
 *
 * They sit beside the exception queue on a desk and under it on a phone, which
 * is the design package's "exceptions first, supporting detail after" in both
 * orientations — a person deciding something should not have to scroll past
 * four progress bars to find the decision.
 */

/** The day's facts; only a known fraction with a denominator draws a bar. */
export function TodayAtSchool({
  rows,
  day,
  language,
}: {
  rows: OverviewRow[];
  /** Already formatted — the weekday and date. */
  day: string;
  language: Language;
}) {
  return (
    <Card className="min-w-0 rounded-2xl p-4 md:p-5">
      <h2 className="text-[16px] font-semibold text-foreground">
        {primary(m.overviewTodayAtSchool, language)}
      </h2>
      <p className="mt-0.5 text-[12px] text-subtle-foreground">{day}</p>

      <div className="mt-4 space-y-3.5">
        {rows.map((row) => (
          <div key={row.key} data-overview-row={row.key}>
            {row.value !== null && row.total !== null && row.total > 0 ? <ProgressRow
              label={row.label}
              value={row.value}
              total={row.total}
              figure={row.figure}
              language={language}
              tone={row.tone}
            /> : <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-[14px] font-medium text-foreground"><SummaryText text={row.label} language={language} /></span>
              <span className="shrink-0 text-[14px] font-semibold tabular-nums text-muted-foreground">{row.figure}</span>
            </div>}
            {row.note ? (
              <p className="mt-1 text-[12px] leading-4 text-subtle-foreground">
                <SummaryText text={row.note} language={language} />
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * How far the current information round has got.
 *
 * Three states, and the middle one is the reason this is a component rather
 * than a bar: **no round open** is ordinary news, **the round could not be
 * read** is not, and a single "0%" would render both as a failure.
 */
export function RoundProgress({
  round,
  unavailable,
  language,
}: {
  round: OverviewRound | null;
  unavailable: boolean;
  language: Language;
}) {
  return (
    <Card className={round || unavailable ? "min-w-0 rounded-2xl p-4 md:p-5" : "min-w-0 rounded-2xl px-4 py-3 md:px-5"}>
      <h2 className="text-[16px] font-semibold text-foreground">
        {primary(m.overviewRoundProgress, language)}
      </h2>

      {unavailable ? (
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          {primary(m.homeUnavailable, language)}
        </p>
      ) : !round ? (
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          {primary(m.overviewRoundNone, language)}
        </p>
      ) : (
        <>
          <p className="mt-1 text-[14px] font-medium text-foreground">
            <AuthoredText
              value={{ hi: round.titleHi, en: round.titleEn }}
              language={language}
            />
          </p>
          <div className="mt-3">
            {round.members > 0 ? <ProgressRow
              label={m.overviewAnsweredOf}
              value={round.answered}
              total={round.members}
              figure={`${round.answered} / ${round.members}`}
              language={language}
              tone={round.answered < round.members ? "warning" : "neutral"}
            /> : <p className="text-[14px] text-muted-foreground"><SummaryText text={m.overviewAnsweredOf} language={language} /> <span className="font-semibold tabular-nums">{round.answered} / {round.members}</span></p>}
          </div>
          <Link
            href={`/collection/rounds/${round.id}`}
            className="focus-ring mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-[13px] font-semibold text-accent-soft-foreground hover:underline"
          >
            {primary(m.overviewOpen, language)}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </>
      )}
    </Card>
  );
}

/**
 * The fee line, said honestly.
 *
 * The design's administrator home carries "Collected today · ₹48,500". VPPS
 * One does not read fee totals — R6 is where that lands — and a missing fee
 * source is "unavailable" with a valid next step, **never ₹0**. So this card
 * carries no amount at all and opens the screen that does hold the number.
 *
 * It used to take a `SchoolApp` and link out to the School Fees deployment.
 * The fee desk is inside this app now, so the link is internal and the prop
 * is gone — sending somebody out of the building to stand in the room they
 * just left is worse than saying nothing.
 */
export function FeeLine({
  language,
}: {
  language: Language;
}) {
  const summary = feeSummary();

  return (
    <Card className="min-w-0 rounded-2xl p-4 md:p-5">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[16px] font-semibold text-foreground">
          {primary(m.overviewFeeSummary, language)}
        </h2>
        <Wallet aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
      </div>

      {summary.kind === "unavailable" ? (
        <>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
            {primary(summary.reason, language)}
          </p>
          {/* Inside this app now, so an internal link and no external
              marker. It used to point at the School Fees deployment, which
              after the port sends somebody out of the building to stand in
              the room they just left. */}
          <Link
            href="/fees/dashboard"
            className="focus-ring mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-[13px] font-semibold text-accent-soft-foreground hover:underline"
          >
            {primary(m.overviewFeeDesk, language)}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </>
      ) : (
        <p className="mt-1 text-[28px] font-semibold leading-none tabular-nums text-foreground">
          {summary.figure}
        </p>
      )}
    </Card>
  );
}

/** Every workspace stays inside the current account, session and dataset. */
export function SchoolWorkspaces({ workspaces, language }: {
  workspaces: readonly NavItem[];
  language: Language;
}) {
  if (workspaces.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {workspaces.map(({ href, label, icon: Icon }) => (
        <li key={href} className="min-w-0">
          <Link href={href} className="focus-ring flex h-full min-h-20 items-start gap-3 rounded-2xl border border-border bg-surface p-4 transition-colors duration-150 hover:bg-surface-2 motion-reduce:transition-none">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-soft-foreground"><Icon aria-hidden className="size-5" /></span>
            <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-6 text-foreground"><SummaryText text={label} language={language} /></span>
            <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-accent-soft-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The dev-data reminder, so the overview page stays about the school. */
export function TestDataNotice({ language }: { language: Language }) {
  return (
    <Notice className="mt-6" tone="warning" text={m.testDataNotice} language={language} />
  );
}
