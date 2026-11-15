"use client";

import { useMemo, useState, type ReactNode } from "react";

import { cue } from "@/ui/feedback/cue";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { ListenButton } from "@/vx/ui/listen";
import { Sheet } from "@/vx/ui/overlays";
import { Btn, IconTile, Pill } from "@/vx/ui/primitives";
import { VoiceNote } from "@/vx/ui/voice";

import { remindChoices } from "../domain/choices";
import { clockP, whenP } from "../domain/format";
import type { NeedBoard } from "../domain/lanes";
import { planLine } from "../domain/plan";
import type { DoneItem, NeedItem, NeedLane } from "../domain/types";
import { parseWhen } from "../domain/when";
import { inMinutes, KIND_ICON, LANE_WORDS, lateBy, NW } from "../domain/words";
import "./needs.css";

const LANE_TONE: Record<NeedLane, "bad" | "acc" | "info" | "mut"> = { now: "bad", today: "acc", later: "info", waiting: "mut" };

/** The one short fact beside a job: how late, how soon, or when it comes back. */
export function NeedPill({ item, now }: { item: NeedItem; now: Date }) {
  const { tx } = useVx();
  if (item.lane === "waiting" && item.waitingOn) return <Pill tone="mut" icon="history">{`${tx(NW.waitingOn)}: ${tx(item.waitingOn)}`}</Pill>;
  if (item.reminded) return <Pill tone="info" icon="bell">{tx(NW.remindedNow)}</Pill>;
  if (item.startsInMinutes !== null && item.startsInMinutes <= 120) return <Pill tone="warn" icon="clock">{tx(inMinutes(item.startsInMinutes))}</Pill>;
  if (item.lateMinutes > 0) return <Pill tone="bad" icon="alert">{tx(lateBy(item.lateMinutes))}</Pill>;
  if (item.remindAt) return <Pill tone="info" icon="bell">{tx(whenP(item.remindAt, now))}</Pill>;
  if (item.peopleWaiting > 0) return <Pill tone="warn" icon="users">{tx(NW.someoneWaits(item.peopleWaiting))}</Pill>;
  return null;
}

/** One job: what it is, why it is here, and its own button (with "Later" beside it). */
export function NeedRow({
  item,
  now,
  readOnly,
  primary,
  onQuick,
  onLater,
  delay = 0,
}: {
  item: NeedItem;
  now: Date;
  readOnly: boolean;
  primary?: boolean;
  onQuick: (item: NeedItem) => void;
  onLater: (item: NeedItem) => void;
  delay?: number;
}) {
  const { tx } = useVx();
  const act = item.quick ? (
    <Btn variant={primary ? "pri" : "sec"} icon={item.quick === "own-done" ? "check" : "checkCircle"} onClick={() => onQuick(item)} disabled={readOnly}>
      {tx(item.act)}
    </Btn>
  ) : (
    <Btn variant={primary ? "pri" : "sec"} icon="arrowRight" href={item.href} onClick={() => cue("tap")}>
      {tx(item.act)}
    </Btn>
  );
  return (
    <li className="ny-row" style={{ animationDelay: `${delay}ms` }}>
      <IconTile icon={KIND_ICON[item.kind]} tone={LANE_TONE[item.lane]} size={40} />
      <div className="ny-row-main">
        <span className="ny-title">{tx(item.title)}</span>
        {item.why ? <span className="ny-sub">{tx(item.why)}</span> : null}
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
          <NeedPill item={item} now={now} />
        </span>
        {item.lane !== "waiting" ? (
          <div className="ny-acts">
            {act}
            {item.canSnooze && !readOnly ? (
              <Btn variant="ghost" icon="clock" onClick={() => onLater(item)}>
                {tx(NW.later)}
              </Btn>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** A lane's heading: its name, how many, and what it means. */
export function LaneHead({ lane, count }: { lane: NeedLane; count: number }) {
  const { tx } = useVx();
  const w = LANE_WORDS[lane];
  return (
    <div className="ny-lane">
      <IconTile icon={w.icon} tone={w.tone} size={30} />
      <h2>{tx(w.title)}</h2>
      <span className="ny-count">{count}</span>
      <span className="ny-sub hide-m" style={{ marginLeft: 4 }}>{tx(w.hint)}</span>
    </div>
  );
}

/** "Arranged by AI · First, … — it is late." with Listen; dots while the AI is at work. */
export function AiLine({ board, arranging, compact }: { board: NeedBoard; arranging: boolean; compact?: boolean }) {
  const { tx } = useVx();
  const line = planLine(board);
  if (arranging) {
    return (
      <div className="ny-ai ny-arranging" role="status" style={{ padding: "8px 12px", borderRadius: 12 }}>
        <span className="ny-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <b>{tx(NW.arranging)}</b>
      </div>
    );
  }
  if (!line) return null;
  const ai = board.plan.source === "ai";
  const lines = [tx(line), ...[...board.now, ...board.today].slice(0, 3).map((i, n) => `${n + 1}. ${tx(i.title)}`)];
  return (
    <div className="ny-ai" role="status">
      <span className={ai ? "ny-spark" : undefined} aria-hidden="true" style={{ display: "inline-flex", color: ai ? "var(--acc)" : "var(--mut)" }}>
        <Ic n={ai ? "sparkle" : "clock"} size={16} />
      </span>
      <b>{tx(ai ? NW.arrangedAi : NW.arrangedRules)}</b>
      {compact ? null : <span style={{ flex: "1 1 220px", minWidth: 0 }}>{tx(line)}</span>}
      {compact ? null : <ListenButton lines={[tx(NW.listenLine(board.left)), ...lines]} className="tap btn ghost" />}
    </div>
  );
}

/** "Done today": folded, a tick each, the latest first. */
export function DoneFold({ done, open }: { done: readonly DoneItem[]; open?: boolean }) {
  const { tx } = useVx();
  return (
    <details className="ny-card ny-fold" open={open}>
      <summary>
        <IconTile icon="checkCircle" tone="ok" size={30} />
        <span>{tx(NW.doneToday)}</span>
        <span className="ny-count" style={{ background: "var(--oks)", color: "var(--ok)" }}>{done.length}</span>
        <span className="ny-chev" aria-hidden="true">
          <Ic n="chevRight" size={18} />
        </span>
      </summary>
      {done.length === 0 ? (
        <div className="ny-done" style={{ color: "var(--mut)" }}>{tx(NW.nothingDone)}</div>
      ) : (
        done.map((d) => (
          <div key={d.key} className="ny-done">
            <span style={{ color: "var(--ok)", display: "inline-flex" }} aria-hidden="true">
              <Ic n="check" size={18} />
            </span>
            <s style={{ flex: 1, minWidth: 0 }}>{tx(d.title)}</s>
            {d.at ? <span className="num" style={{ color: "var(--mut)", fontSize: 13 }}>{tx(clockP(d.at))}</span> : null}
          </div>
        ))
      )}
    </details>
  );
}

/** A folded lane (Later, Waiting on others): out of the way until opened. */
export function LaneFold({ lane, items, children }: { lane: NeedLane; items: readonly NeedItem[]; children: ReactNode }) {
  const { tx } = useVx();
  const w = LANE_WORDS[lane];
  if (!items.length) return null;
  return (
    <details className="ny-card ny-fold">
      <summary>
        <IconTile icon={w.icon} tone={w.tone} size={30} />
        <span>{tx(w.title)}</span>
        <span className="ny-count">{items.length}</span>
        <span className="ny-chev" aria-hidden="true">
          <Ic n="chevRight" size={18} />
        </span>
      </summary>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--bd)" }}>{children}</ul>
    </details>
  );
}

/** A time from the person's words, shown back before it is used. */
function useHeard(text: string, now: () => Date) {
  return useMemo(() => (text.trim() ? parseWhen(text, now()) : null), [text, now]);
}

function Heard({ at, now }: { at: string; now: Date }) {
  const { tx } = useVx();
  return (
    <div className="ny-heard" role="status">
      <Ic n="bell" size={18} />
      <span>
        {tx(NW.heard)}: <b>{tx(whenP(at, now))}</b>
      </span>
    </div>
  );
}

/** "When should I remind you?": four taps, or a time said or typed. */
export function RemindSheet({
  item,
  now,
  onClose,
  onPick,
  onRemove,
}: {
  item: NeedItem | null;
  now: () => Date;
  onClose: () => void;
  onPick: (item: NeedItem, at: string, heard: string | null) => Promise<boolean>;
  onRemove: (item: NeedItem) => void;
}) {
  const { tx } = useVx();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const heard = useHeard(text, now);
  const choices = useMemo(() => remindChoices(now()), [now]);
  const close = () => {
    setText("");
    onClose();
  };
  const pick = async (at: string, words: string | null) => {
    if (!item || busy) return;
    setBusy(true);
    const ok = await onPick(item, at, words);
    setBusy(false);
    if (ok) close();
  };
  return (
    <Sheet open={item !== null} onClose={close} title={tx(NW.remindWhen)} sub={item ? tx(item.title) : undefined} icon="bell">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="ny-choices">
          {choices.map((c) => (
            <button key={c.key} type="button" className="tap ny-choice" disabled={busy} onClick={() => void pick(c.at, null)}>
              {tx(c.label)}
              <span>{tx(whenP(c.at, now()))}</span>
            </button>
          ))}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{tx(NW.sayTime)}</span>
          <VoiceNote value={text} onChange={setText} rows={2} placeholder={tx(p2("kal 11 baje · शाम 4 बजे · in 2 hours"))} />
        </label>
        {heard ? <Heard at={heard.at} now={now()} /> : text.trim() ? <span className="ny-sub">{tx(NW.timeUnclear)}</span> : null}
        <Btn variant="pri" big full icon="bell" disabled={!heard || busy} onClick={() => heard && void pick(heard.at, heard.heard)}>
          {busy ? tx(NW.saving) : tx(NW.remindMe)}
        </Btn>
        {item?.kind === "own" ? (
          <Btn variant="ghost" icon="trash" onClick={() => { onRemove(item); close(); }}>
            {tx(NW.remove)}
          </Btn>
        ) : null}
      </div>
    </Sheet>
  );
}

/** "Add my own": type or speak it, with a time read from the words or picked. */
export function AddSheet({ open, now, onClose, onSave }: { open: boolean; now: () => Date; onClose: () => void; onSave: (title: string, at: string | null, heard: string | null) => Promise<boolean> }) {
  const { tx } = useVx();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<{ at: string; label: Pair } | null>(null);
  const [busy, setBusy] = useState(false);
  const heard = useHeard(text, now);
  const choices = useMemo(() => (open ? remindChoices(now()) : []), [open, now]);
  const at = picked?.at ?? heard?.at ?? null;
  const title = (heard && !picked ? heard.rest : text).trim() || text.trim();
  const tooLong = title.length > 200;
  const close = () => {
    setText("");
    setPicked(null);
    onClose();
  };
  const save = async () => {
    if (!title || tooLong || busy) return;
    setBusy(true);
    const ok = await onSave(title, at, picked ? null : (heard?.heard ?? null));
    setBusy(false);
    if (ok) close();
  };
  return (
    <Sheet
      open={open}
      onClose={close}
      title={tx(NW.addTitle)}
      sub={tx(NW.addHint)}
      icon="notePen"
      footer={
        <Btn variant="pri" big full icon={busy ? undefined : "check"} disabled={!title || tooLong || busy} onClick={() => void save()}>
          {busy ? tx(NW.saving) : tx(NW.save)}
        </Btn>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <VoiceNote value={text} onChange={(v) => { setText(v); }} rows={3} placeholder={tx(NW.addPlaceholder)} />
        {tooLong ? <span style={{ color: "var(--bad)", fontSize: 14 }}>{tx(NW.tooLong)}</span> : null}
        {at ? <Heard at={at} now={now()} /> : text.trim() ? <span className="ny-sub">{tx(NW.noTimeFound)}</span> : null}
        <span style={{ fontWeight: 600 }}>{tx(NW.orPick)}</span>
        <div className="ny-choices">
          {choices.map((c) => {
            const on = picked?.at === c.at;
            return (
              <button key={c.key} type="button" className="tap ny-choice" aria-pressed={on} onClick={() => { cue("select"); setPicked(on ? null : { at: c.at, label: c.label }); }}>
                {tx(c.label)}
                <span>{tx(whenP(c.at, now()))}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

/** A placeholder in the reader's script either way. */
function p2(text: string): Pair {
  return { en: text, hi: text };
}
