import Link from "next/link";
import { ArrowRight, ExternalLink, Wallet } from "lucide-react";

import { m } from "@/messages";
import { environmentLabel, type SchoolApp } from "@/platform/config/apps";
import { flat, primary, type Language } from "@/platform/i18n/language";
import type { OverviewRound } from "@/modules/home/data/home-repo";
import { feeSummary, type OverviewRow } from "@/modules/home/domain/overview";
import { AuthoredText } from "@/ui/authored-text";
import { Card, Notice } from "@/ui/primitives";
import { ProgressRow } from "@/ui/task-hero";

/**
 * The three supporting panels on the administrator's home.
 *
 * They sit beside the exception queue on a desk and under it on a phone, which
 * is the design package's "exceptions first, supporting detail after" in both
 * orientations — a person deciding something should not have to scroll past
 * four progress bars to find the decision.
 */

/** "Today at school": the day's fractions, with a bar each. */
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
    <Card className="p-5">
      <h2 className="text-[16px] font-semibold text-foreground">
        {primary(m.overviewTodayAtSchool, language)}
      </h2>
      <p className="mt-0.5 text-[12px] text-subtle-foreground">{day}</p>

      <div className="mt-4 space-y-3.5">
        {rows.map((row) => (
          <div key={row.key}>
            <ProgressRow
              label={row.label}
              value={row.value}
              total={row.total}
              figure={row.figure}
              language={language}
              tone={row.tone}
            />
            {row.note ? (
              <p className="mt-1 text-[12px] leading-4 text-subtle-foreground">
                {primary(row.note, language)}
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
    <Card className="p-5">
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
            <ProgressRow
              label={m.overviewAnsweredOf}
              value={round.answered}
              total={round.members}
              figure={`${round.answered} / ${round.members}`}
              language={language}
              tone={round.answered < round.members ? "warning" : "neutral"}
            />
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
 * One does not read fee totals — R6 is where the verified handoff lands — and
 * the handoff document is explicit that a missing fee source is "unavailable"
 * with a valid next step, **never ₹0**. So this card carries no amount at all,
 * names the app that does hold the number, and opens it.
 */
export function FeeLine({
  app,
  language,
}: {
  /** Null when this account is not offered the fee app at all. */
  app: SchoolApp | null;
  language: Language;
}) {
  const summary = feeSummary();

  return (
    <Card className="p-5">
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
          {app ? (
            <a
              href={app.home.href}
              className="focus-ring mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-[13px] font-semibold text-accent-soft-foreground hover:underline"
            >
              {primary(app.name, language)}
              <ExternalLink aria-hidden className="size-4" />
            </a>
          ) : null}
          {app ? (
            <p className="text-[11px] text-subtle-foreground">
              {flat(environmentLabel(app.environment), language)} ·{" "}
              {new URL(app.home.href).host}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-[28px] font-semibold leading-none tabular-nums text-foreground">
          {summary.figure}
        </p>
      )}
    </Card>
  );
}

/**
 * The other two apps as workspaces rather than as a launcher grid.
 *
 * Same registry, same verified origins, same honest host line as `/apps` — the
 * difference is only that an administrator's home names the desk ("Collections
 * and dues") instead of listing an application.
 */
export function SchoolWorkspaces({
  apps,
  language,
}: {
  apps: SchoolApp[];
  language: Language;
}) {
  if (apps.length === 0) return null;

  return (
    <ul className="space-y-2">
      {apps.map((app) => (
        <li key={app.id}>
          <a
            href={app.home.href}
            className="focus-ring flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 truncate text-[15px] font-semibold text-foreground">
                  {primary(app.name, language)}
                </span>
                <ExternalLink
                  aria-hidden
                  className="size-4 shrink-0 text-subtle-foreground"
                />
              </span>
              <span className="block truncate text-[12px] text-subtle-foreground">
                {primary(app.purpose, language)}
              </span>
              <span className="block truncate text-[11px] text-subtle-foreground">
                {flat(environmentLabel(app.environment), language)} ·{" "}
                {new URL(app.home.href).host}
              </span>
            </span>
            <span className="shrink-0 text-[13px] font-semibold text-accent-soft-foreground">
              {primary(m.overviewOpen, language)}
            </span>
          </a>
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
