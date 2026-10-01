import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronDown, School } from "lucide-react";

import { m } from "@/messages";
import type { AttentionItem } from "@/modules/home/domain/attention";
import { needsAttention } from "@/modules/home/domain/attention";
import { overviewRows, type OverviewFacts } from "@/modules/home/domain/overview";
import type { OverviewRound } from "@/modules/home/data/home-repo";
import type { SchoolApp } from "@/platform/config/apps";
import type { NavItem } from "@/platform/config/navigation";
import { flat, primary, secondary, type Language, type Localized } from "@/platform/i18n/language";
import { cn } from "@/platform/utils";
import { Notice } from "@/ui/primitives";
import { MetricCard, MetricGrid } from "@/ui/task-hero";
import { FeeLine, RoundProgress, SchoolWorkspaces, TodayAtSchool } from "./overview-panels";

function Pair({ text, language }: { text: Localized; language: Language }) {
  const under = secondary(text, language);
  return <>
    <span lang={language === "en" ? "en" : "hi"}>{primary(text, language)}</span>
    {under ? <span lang="en" className="mt-0.5 block text-[12px] font-normal leading-5 text-muted-foreground">{under}</span> : null}
  </>;
}

function OverviewSection({ id, title, hint, language, children }: {
  id: string; title: Localized; hint?: Localized; language: Language; children: React.ReactNode;
}) {
  return <section aria-labelledby={id} className="min-w-0 space-y-3">
    <header>
      <h2 id={id} className="text-[17px] font-bold tracking-tight text-foreground"><Pair text={title} language={language} /></h2>
      {hint ? <p className="mt-1 text-[13px] leading-5 text-muted-foreground" lang={language === "en" ? "en" : "hi"}>{primary(hint, language)}</p> : null}
    </header>
    {children}
  </section>;
}

/** Native admin composition; data, permissions and destinations stay with the page. */
export function AdminOverview({ attention, overview, apps, destinations, day, language, testData, schoolName, overviewCounts }: {
  overviewCounts?: { children: number | null; classes: number | null; registers: number | null };
  attention: AttentionItem[];
  overview: { facts: OverviewFacts; round: OverviewRound | null } | null;
  apps: SchoolApp[];
  destinations: NavItem[];
  day: Localized;
  language: Language;
  testData: boolean;
  schoolName: string;
}) {
  // Presentation only: every original count, owner and destination remains.
  const pending = attention.filter(item => item.count === null || item.count > 0);
  const clear = attention.filter(item => item.count === 0);
  const actions = {
    registers: m.overviewOpenRegisters, absences: m.overviewOpenCover,
    review: m.overviewReviewChanges, corrections: m.overviewReviewCorrections,
    jobs: m.overviewOpenJobs,
  };
  const attentionLink = (item: AttentionItem, index: number, compact: boolean) => <li key={item.key} className={!compact && index === 0 ? "col-span-2" : "min-w-0"}>
    <Link href={item.href} data-attention-key={item.key} data-attention-state={compact ? "clear" : "pending"} className={cn(
      "focus-ring flex h-full gap-3 rounded-2xl border transition-colors duration-150 motion-reduce:transition-none",
      compact ? "min-h-11 items-start px-3 py-2.5" : "min-h-24 items-start p-3.5 md:p-4",
      !compact && index > 0 ? "flex-col" : null,
      !compact && (item.tone === "warning" || item.count === null) ? "border-warning/30 bg-warning-soft hover:border-warning/60" : "border-border bg-surface hover:bg-surface-2",
    )}>
      <span className={cn("shrink-0 font-bold leading-none tabular-nums", compact ? "min-w-5 pt-1 text-[18px]" : "min-w-9 text-[30px]", !compact ? "text-warning-soft-foreground" : "text-foreground")} data-attention-count>{item.count ?? "-"}</span>
      <span className="w-full min-w-0 flex-1 break-words">
        <span className="block break-words text-[14px] font-bold leading-5 text-foreground"><Pair text={item.label} language={language} /></span>
        {item.detail ? <span className="mt-1 block text-[12px] leading-5 text-muted-foreground">{primary(item.detail, language)}</span> : null}
        <span className="mt-1 block break-words text-[12px] leading-5 text-muted-foreground">{primary(m.homeOwner, language)}: {primary(item.owner, language)}</span>
        {item.count === null ? <span className="mt-1 block text-[12px] leading-5 text-muted-foreground"><Pair text={m.homeUnavailable} language={language} /></span> : null}
        <span className={cn("flex items-start gap-1.5 text-[12px] font-semibold leading-5 text-accent-soft-foreground", compact ? "mt-1" : "mt-2")}><span className="min-w-0 flex-1 break-words">{compact ? primary(actions[item.key], language) : <Pair text={actions[item.key]} language={language} />}</span><ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0" /></span>
      </span>
    </Link>
  </li>;
  return <div className="min-w-0 space-y-5 md:space-y-6" data-admin-overview>
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-border pb-4 md:pb-5">
      <div className="min-w-0 flex-1 basis-52">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground" lang={language === "en" ? "en" : "hi"}>{primary(m.overviewEyebrow, language)}</p>
        <h1 className="text-[25px] font-bold leading-tight tracking-tight text-foreground md:text-[32px]"><Pair text={m.overviewTitle} language={language} /></h1>
        <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-5 text-muted-foreground"><School aria-hidden className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 break-words">{schoolName}</span></p>
      </div>
      <div className="flex max-w-full items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-[12px] font-medium leading-5 text-foreground">
        <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0"><Pair text={day} language={language} /></span>
      </div>
    </header>

    {overviewCounts ? <MetricGrid>
      <MetricCard label={m.homeChildrenOnRoll} value={overviewCounts.children?.toString() ?? "—"} language={language} />
      <MetricCard label={m.homeClasses} value={overviewCounts.classes?.toString() ?? "—"} language={language} />
      <MetricCard label={m.homeRegistersIn} value={overviewCounts.registers?.toString() ?? "—"} language={language} />
    </MetricGrid> : null}

    <div className="grid min-w-0 items-start gap-5 md:gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
      {attention.length ? <OverviewSection id="admin-attention" title={m.homeNeedsAttention} hint={m.homeNeedsAttentionHint} language={language}>
        {!needsAttention(attention) ? <Notice tone="success" text={m.homeAllClear} language={language} /> : null}
        {pending.length ? <ul className="grid min-w-0 grid-cols-2 gap-2.5 md:gap-3">{pending.map((item, index) => attentionLink(item, index, false))}</ul> : null}
        {clear.length ? <ul className="grid min-w-0 grid-cols-2 gap-2">{clear.map((item, index) => attentionLink(item, index, true))}</ul> : null}
      </OverviewSection> : null}

      {/* DOM and focus order put support before the long navigation list on phones. */}
      {overview ? <div data-admin-support className="grid min-w-0 gap-3 md:grid-cols-2 lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:grid-cols-1 md:gap-4">
        <div className="min-w-0 md:col-span-2 lg:col-span-1"><TodayAtSchool rows={overviewRows(overview.facts)} day={flat(day, language)} language={language} /></div>
        <RoundProgress round={overview.round} unavailable={overview.facts.roundUnavailable} language={language} />
        <FeeLine language={language} />
      </div> : null}

      {apps.length ? <OverviewSection id="admin-workspaces" title={m.overviewWorkspaces} hint={m.overviewWorkspacesHint} language={language}>
        <SchoolWorkspaces apps={apps} language={language} />
      </OverviewSection> : null}

      {destinations.length ? <details data-all-screens className="group min-w-0 rounded-2xl border border-border bg-surface">
        <summary id="admin-destinations" className="focus-ring flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-4 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 text-[17px] font-bold text-foreground"><Pair text={m.overviewAllScreens} language={language} /></span>
          <ChevronDown aria-hidden className="size-5 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <p className="px-4 pb-3 text-[13px] leading-5 text-muted-foreground"><Pair text={m.openToYouHint} language={language} /></p>
        <ul aria-labelledby="admin-destinations" className="grid grid-cols-2 gap-2.5 px-3 pb-3 md:gap-3">
          {destinations.map(({ href, label, icon: Icon }) => <li key={href} className="min-w-0">
            <Link href={href} className="focus-ring flex h-full min-h-[76px] items-start gap-2 rounded-2xl border border-border bg-surface px-3 py-3.5 transition-colors duration-150 hover:bg-surface-2 motion-reduce:transition-none md:gap-3 md:p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-foreground"><Icon aria-hidden className="size-4" /></span>
              <span className="min-w-0 break-words text-[13px] font-semibold leading-5 text-foreground"><Pair text={label} language={language} /></span>
            </Link>
          </li>)}
        </ul>
      </details> : null}
    </div>
    {testData ? <Notice tone="warning" text={m.testDataNotice} language={language} /> : null}
  </div>;
}
