"use client";

import type { ReactNode } from "react";

import { mc } from "@/messages/collect";
import { CHECK_OVER, type Card, type CheckReason } from "@/modules/collect/domain/flow";
import { amountInWords } from "@/modules/collect/domain/words";
import type { Localized } from "@/platform/i18n/language";

import { BackButton, CardShell, HoldButton, Icon } from "../parts";
import { Bi, fill, money, useCx } from "../text";

export const REASON_LABEL: Record<CheckReason, Localized> = {
  family: mc.whyFamily,
  split: mc.whySplit,
  cheque: mc.whyCheque,
  bank: mc.whyBank,
  backdated: mc.whyBackdated,
  paid_today: mc.whyPaidToday,
  over_limit: fill(mc.whyOver, { a: money(CHECK_OVER) }),
  waiver_reason: mc.whyReason,
};

export type TicketLine = { label: Localized; value: ReactNode; goto: Card | null; key: string };

export function CheckCard(props: {
  reasons: CheckReason[];
  lines: TicketLine[];
  total: number;
  saved: boolean;
  ack: { needed: boolean; receipt: string | null; ticked: boolean } | null;
  near: { receipt: string | null; allowed: boolean; ticked: boolean } | null;
  ready: boolean;
  canPost: boolean;
  holdRef: React.RefObject<{ start: () => void; stop: () => void } | null>;
  overlay: ReactNode;
  onAck: (ticked: boolean) => void;
  onNear: (ticked: boolean) => void;
  onGoto: (card: Card) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const { p } = useCx();
  const blocked = (props.ack?.needed && !props.ack.ticked) || (props.near !== null && (!props.near.allowed || !props.near.ticked));
  return (
    <CardShell
      eyebrow={mc.stepCheck}
      title={mc.checkTitle}
      foot={
        <>
          <BackButton onClick={props.onBack} />
          <HoldButton label={props.canPost ? fill(mc.holdSave, { a: money(props.total) }) : mc.savingClosed} disabled={!props.ready || !props.canPost || Boolean(blocked)} onDone={props.onSave} holdRef={props.holdRef} />
        </>
      }
    >
      {props.reasons.length ? (
        <div className="cx-why">
          {p(mc.checkingBecause)}:
          {props.reasons.map((r) => (
            <span key={r} className="cx-tag warn" style={{ margin: 0 }}>{p(REASON_LABEL[r])}</span>
          ))}
        </div>
      ) : null}
      <div className="cx-ticket" data-ticket="">
        <span className={`cx-draft${props.saved ? " saved" : ""}`}>{p(props.saved ? mc.savedTag : mc.draft)}</span>
        {props.lines.map((line) => (
          <button type="button" key={line.key} className="cx-tl" disabled={!line.goto} onClick={() => line.goto && props.onGoto(line.goto)}>
            <span className="lab"><Bi text={line.label} /></span>
            <span className="val">{line.value}</span>
            {line.goto ? <Icon name="edit" size={14} /> : <span />}
          </button>
        ))}
        <div className="cx-ttotal">
          <b>{money(props.total)}</b>
          <span><Bi text={amountInWords(props.total)} /></span>
        </div>
        {props.overlay}
      </div>
      {props.ack?.needed ? (
        <label className="cx-ack">
          <input type="checkbox" checked={props.ack.ticked} onChange={(e) => props.onAck(e.target.checked)} />
          <span>{p(fill(mc.ackDaily, { name: props.ack.receipt ?? "" }))}</span>
        </label>
      ) : null}
      {props.near ? (
        props.near.allowed ? (
          <label className="cx-ack">
            <input type="checkbox" checked={props.near.ticked} onChange={(e) => props.onNear(e.target.checked)} />
            <span>{p(fill(mc.ackNear, { name: props.near.receipt ?? "" }))}</span>
          </label>
        ) : (
          <div className="cx-ack">{p(fill(mc.ackNearAdmin, { name: props.near.receipt ?? "" }))}</div>
        )
      ) : null}
    </CardShell>
  );
}
