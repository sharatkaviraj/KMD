"use client";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { DestinationCard } from "@/modules/government-records/data/readiness";
import { DEFAULT_MODULE, type Destination, type ReadinessCounts } from "@/modules/government-records/domain/readiness";
import { useVx } from "@/vx/i18n";
import { Btn, Pill, StackedBar } from "@/vx/ui/primitives";
import { G, PORTAL_LABELS, R, RETURN_STATE, blockedLine, manualProgressLine, readyOf, verifiedFormat } from "./return-text";
import "./office.css";
import "./returns.css";

/*
 * School Office → Government returns: one card per destination, showing
 * progress rather than plumbing. Nothing is typed here — module, school code
 * and format live behind Destination settings, set once.
 */

export function destinationTitle(tx: (pair: { en: string; hi?: string }) => string, destination: Pick<Destination, "portal" | "module">): string {
  const portal = tx(PORTAL_LABELS[destination.portal] ?? { en: destination.portal });
  return destination.module === DEFAULT_MODULE ? portal : `${portal} · ${destination.module}`;
}

/** Ready / Needs details / Conflict as one bar, the same three colours everywhere. */
export function ReadinessBar({ counts, height = 10 }: { counts: ReadinessCounts; height?: number }) {
  const { tx } = useVx();
  return <div className="rb-bar" role="img" aria-label={`${tx(readyOf(counts.ready, counts.total))} · ${tx(blockedLine(counts.needsDetails, counts.conflict))}`}>
    <StackedBar showLegend={false} height={height} format={String} parts={[
      { label: tx(G.ready), value: counts.ready, color: "var(--ok)" },
      { label: tx(G.blocked), value: counts.needsDetails, color: "var(--warn)" },
      { label: tx(R.conflict), value: counts.conflict, color: "var(--bad)" },
    ]} />
  </div>;
}

export function ReturnsNav({ canManage }: { canManage: boolean }) {
  const { tx } = useVx();
  return <nav className="office-tools" aria-label={tx(G.title)}>
    <Link className="chip" href="/school-office">{tx(R.certificates)}</Link>
    <Link className="chip on" href="/school-office/returns" aria-current="page">{tx(G.title)}</Link>
    <span style={{ flex: 1 }} />
    {canManage ? <Btn icon="settings" href="/school-office/returns/formats">{tx(R.settings)}</Btn> : null}
  </nav>;
}

export function ReturnsBoard({ sessionLabel, cards, canManage, unavailable, sourceUnavailable }: { sessionLabel: string; cards: DestinationCard[]; canManage: boolean; unavailable: boolean; sourceUnavailable: boolean }) {
  const { tx } = useVx();
  return <>
    <ReturnsNav canManage={canManage} />
    <div className="office-note">{tx(G.outcomeHint)}</div>
    {sourceUnavailable ? <div className="office-note" role="alert">{tx(R.source)}</div> : null}
    {unavailable ? <div role="alert" className="office-note">{tx(G.checkFailed)}</div> : <div className="rb-grid">
      {cards.map((card, index) => <DestinationTile key={card.destination.key} card={card} sessionLabel={sessionLabel} canManage={canManage} index={index} />)}
    </div>}
  </>;
}

function DestinationTile({ card, sessionLabel, canManage, index }: { card: DestinationCard; sessionLabel: string; canManage: boolean; index: number }) {
  const { tx } = useVx();
  const { destination, counts } = card;
  const href = `/school-office/returns/d/${destination.key}`;
  const title = destinationTitle(tx, destination);
  return <article className="card rb-card" style={{ "--i": index } as CSSProperties} aria-label={title}>
    <div className="rb-row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "nowrap" }}>
      <div style={{ minWidth: 0 }}>
        <h2 className="serif rb-title">{title}</h2>
        <div className="rb-meta">{sessionLabel}</div>
      </div>
      <Pill tone={destination.mode === "verified_upload" ? "ok" : "mut"} style={{ flex: "none" }}>{destination.mode === "verified_upload" ? tx(verifiedFormat(destination.version)) : tx(R.referenceSheet)}</Pill>
    </div>
    {counts ? <>
      <div className="rb-count"><strong className="num">{tx(readyOf(counts.ready, counts.total))}</strong></div>
      <ReadinessBar counts={counts} />
      <div className="rb-meta">{tx(blockedLine(counts.needsDetails, counts.conflict))}</div>
    </> : <>
      <div className="rb-skel" aria-hidden="true" />
      <div className="rb-meta">{tx(R.notChecked)}</div>
    </>}
    <div className="rb-row">
      {/* No verified source carries a deadline for a return yet; never a guessed date. */}
      <Pill tone="warn" icon="calendar">{tx(R.deadlineUnverified)}</Pill>
      {card.manual ? <Pill tone="info" icon="keyboard">{tx(manualProgressLine(card.manual.entered, card.manual.total))}</Pill> : card.latest ? <Pill>{tx(RETURN_STATE[card.latest.state] ?? { en: card.latest.state })}</Pill> : null}
    </div>
    <div className="rb-actions">
      <Btn variant="pri" icon="arrowRight" href={href}>{tx(R.open)}</Btn>
      {!destination.configured && canManage ? <Btn icon="settings" href="/school-office/returns/formats">{tx(R.setUp)}</Btn> : null}
    </div>
  </article>;
}
