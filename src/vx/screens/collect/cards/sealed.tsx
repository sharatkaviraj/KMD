"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { mc } from "@/messages/collect";
import type { SavedReceipt } from "@/modules/collect/domain/types";
import { amountInWordsEn } from "@/modules/collect/domain/words";
import { schoolProfile } from "@/platform/config/school";
import { flat, type Localized } from "@/platform/i18n/language";
import { dateLabelP } from "@/vx/format";

import { printFeed, typeIn } from "../motion";
import { CardShell, Icon } from "../parts";
import { Seal } from "../seal";
import { Bi, fill, money, useCx } from "../text";

export type SealedView = {
  receipts: SavedReceipt[];
  children: Record<string, { name: string; classLabel: string; sr: string }>;
  lines: Record<string, Array<{ label: Localized; amount: number }>>;
  total: number;
  paymentDate: string;
  tenderText: Localized;
  by: string;
  sessionLabel: string;
};

/** Receipt paper is bilingual for every reader, as the school's printed receipt is. */
const paper = (pair: Localized) => flat(pair, "both");

/**
 * The sealed card (plan §3.3 card 6): only ever drawn from receipts the ledger
 * returned. The slip feeds out of the printer in steps, then the receipt
 * numbers type in, then Print and Next appear. A tap or key skips to the end.
 */
export function SealedCard(props: {
  view: SealedView;
  animate: boolean;
  nextSibling: { id: string; name: string } | null;
  onNextStudent: () => void;
  onNextSibling: () => void;
}) {
  const { p } = useCx();
  const { view } = props;
  const family = view.receipts.length > 1;
  const feed = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const slip = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(!props.animate);
  const skip = useRef(false);

  // Fit the slip into the feed window: it is scaled down, never scrolled.
  useLayoutEffect(() => {
    const fit = () => {
      if (!feed.current || !wrap.current || !slip.current) return;
      const k = Math.min(1, (feed.current.clientHeight - 12) / slip.current.offsetHeight, feed.current.clientWidth / slip.current.offsetWidth);
      wrap.current.style.transform = `scale(${k})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (feed.current) ro.observe(feed.current);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!slip.current) return;
    const numbers = [...slip.current.querySelectorAll<HTMLElement>("[data-rno]")];
    const full = numbers.map((n) => n.dataset.rno ?? "");
    if (!props.animate) {
      numbers.forEach((n, i) => (n.textContent = full[i]));
      return;
    }
    const anim = printFeed(slip.current, view.receipts.length);
    let live = true;
    const end = () => {
      skip.current = true;
      anim.finish();
    };
    const onSkip = () => end();
    window.addEventListener("pointerdown", onSkip, { once: true });
    window.addEventListener("keydown", onSkip, { once: true });
    void anim.finished
      .catch(() => undefined)
      .then(async () => {
        for (let i = 0; i < numbers.length; i += 1) await typeIn(numbers[i], full[i], () => skip.current || !live);
        if (live) setReady(true);
      });
    return () => {
      live = false;
      window.removeEventListener("pointerdown", onSkip);
      window.removeEventListener("keydown", onSkip);
    };
  }, [props.animate, view.receipts.length]);

  const date = dateLabelP(view.paymentDate);
  const first = view.receipts[0];

  return (
    <CardShell
      eyebrow={mc.stepSealed}
      title={family ? fill(mc.sealedTitleN, { n: view.receipts.length }) : mc.sealedTitle}
      footClass={ready ? undefined : "wait"}
      foot={
        <>
          {props.nextSibling ? (
            <button type="button" className="cx-btn sec" style={{ flex: 1, minWidth: 0 }} disabled={!ready} onClick={props.onNextSibling}>
              <Bi text={fill(mc.nextSibling, { name: props.nextSibling.name.split(/\s+/)[0] })} />
            </button>
          ) : null}
          <button type="button" className="cx-btn pri" disabled={!ready} onClick={props.onNextStudent} data-next-student="">
            <Bi text={mc.nextStudent} />
          </button>
        </>
      }
    >
      <div className="cx-printer" />
      <div className="cx-feed" ref={feed}>
        <div className="cx-rwrap" ref={wrap}>
          <div className="cx-receipt" ref={slip} role="img" aria-label={`${view.receipts.map((r) => r.receiptNumber).join(", ")}, ${money(view.total)}`}>
            <div className="rh">
              <div className="rs">{schoolProfile.name}</div>
              <div className="rsub">
                {paper(family ? mc.slipFamily : mc.slipReceipt)} · {paper(fill(mc.slipSession, { name: view.sessionLabel }))}
              </div>
            </div>
            <div className="rr"><span>{paper(mc.slipDate)}</span><b>{date.en}</b></div>
            <hr />
            {view.receipts.map((r, i) => {
              const child = view.children[r.studentId];
              return (
                <div key={r.receiptId}>
                  <div className="rr kid">
                    <span>{family && child ? <b style={{ color: "var(--paperfg)" }}>{child.name} · {child.classLabel}</b> : paper(mc.slipNo)}</span>
                    <b className="mono" data-rno={r.receiptNumber} style={{ whiteSpace: "nowrap" }} />
                  </div>
                  {!family && child ? (
                    <>
                      <div className="rr"><span>{paper(mc.slipStudent)}</span><b>{child.name}</b></div>
                      <div className="rr"><span>{paper(mc.classWord)} · SR</span><b>{child.classLabel} · {child.sr}</b></div>
                    </>
                  ) : null}
                  {(view.lines[r.studentId] ?? []).map((line, j) => (
                    <div className="rr" key={j}><span>{paper(line.label)}</span><b>{money(line.amount)}</b></div>
                  ))}
                  {r.lateFeeWaived > 0 ? <div className="rr mut"><span>{paper(mc.slipWaived)}</span><b>{money(r.lateFeeWaived)}</b></div> : null}
                  {family ? <div className="rr"><span>{paper(mc.slipSubtotal)}</span><b>{money(r.amount)}</b></div> : null}
                  {i < view.receipts.length - 1 ? <hr /> : null}
                </div>
              );
            })}
            <hr />
            <div className="rt"><span>{paper(mc.slipTotal)}</span><b>{money(view.total)}</b></div>
            <div className="rw">{amountInWordsEn(view.total)}</div>
            <div className="rr" style={{ marginTop: 4, paddingRight: 80 }}><span>{paper(view.tenderText)}</span></div>
            {!family && first?.remaining !== null && first?.remaining !== undefined ? (
              <div className="rr mut"><span>{paper(fill(mc.slipRemaining, { a: money(first.remaining) }))}</span></div>
            ) : null}
            <div className="rf"><span>{paper(fill(mc.slipBy, { name: view.by }))}</span><span>{paper(mc.slipThanks)}</span></div>
            <div className="rseal"><Seal date={view.paymentDate} /></div>
          </div>
        </div>
      </div>
      <div className={`cx-acts${ready ? "" : " wait"}`}>
        {view.receipts.map((r) => (
          <a key={r.receiptId} className="cx-act" href={r.printHref} target="_blank" rel="noopener noreferrer">
            <Icon name="print" />
            <span>
              {p(mc.print)}
              {family ? ` · ${r.receiptNumber.slice(-4)}` : ""}
            </span>
          </a>
        ))}
      </div>
    </CardShell>
  );
}
