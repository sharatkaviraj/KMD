"use client";

import { useState } from "react";

import { cue } from "@/ui/feedback/cue";
import { useVx } from "@/vx/i18n";
import { TopBar } from "@/vx/ui/page";
import { Btn, IconTile, Pill, Ring, SuccessTick } from "@/vx/ui/primitives";

import type { NeedsView } from "../data/board";
import { ruleReason } from "../domain/lanes";
import type { NeedItem, NeedLane } from "../domain/types";
import { KIND_ICON, NW, REASON_WORDS } from "../domain/words";
import { AddSheet, AiLine, DoneFold, LaneFold, LaneHead, NeedPill, NeedRow, RemindSheet } from "./parts";
import { useNeeds } from "./use-needs";

/**
 * Needs you, the full list (D-630): the one job to do next in a big card,
 * then Do now and Today in order, Later and Waiting on others folded away,
 * and what was finished today. Every button opens the screen that owns the
 * job; a to-do of their own and a cover to say yes to are done right here.
 */
export function NeedsBoard({ view }: { view: NeedsView }) {
  const { tx, sub } = useVx();
  const s = useNeeds(view);
  const { board, done, readOnly } = s;
  const [adding, setAdding] = useState(false);
  const [later, setLater] = useState<NeedItem | null>(null);
  const now = s.now();
  const next = board.next;
  const rest = (lane: NeedLane) => board[lane].filter((i) => i.key !== next?.key);
  const total = board.left + done.length;

  const row = (item: NeedItem, i: number) => (
    <NeedRow key={item.key} item={item} now={now} readOnly={readOnly} onQuick={(x) => void s.quickDone(x)} onLater={setLater} delay={Math.min(i * 40, 320)} />
  );
  const lane = (key: "now" | "today") => {
    const list = rest(key);
    if (!list.length) return null;
    return (
      <section aria-label={tx(NW.title)}>
        <LaneHead lane={key} count={list.length} />
        <ul className="ny-card" style={{ listStyle: "none", margin: 0, padding: 0 }}>{list.map(row)}</ul>
      </section>
    );
  };

  const reason = next ? REASON_WORDS[board.plan.reasons[next.key] ?? ruleReason(next)] : null;
  const hero = next ? (
    <section className="ny-hero" aria-label={tx(NW.next)}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: "var(--accfg)" }}>{tx(NW.next)}</span>
        {reason ? <Pill tone={board.plan.source === "ai" ? "acc" : "mut"} icon={board.plan.source === "ai" ? "sparkle" : "clock"}>{tx(reason)}</Pill> : null}
      </span>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <IconTile icon={KIND_ICON[next.kind]} tone={next.lane === "now" ? "bad" : "acc"} size={52} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2, overflowWrap: "anywhere" }}>{tx(next.title)}</span>
          {next.why ? <span className="ny-sub" style={{ fontSize: 14 }}>{tx(next.why)}</span> : null}
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <NeedPill item={next} now={now} />
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {next.quick ? (
          <Btn variant="pri" big icon="check" disabled={readOnly} onClick={() => void s.quickDone(next)}>
            {tx(next.act)}
          </Btn>
        ) : (
          <Btn variant="pri" big icon="arrowRight" href={next.href} onClick={() => cue("tap")}>
            {tx(next.act)}
          </Btn>
        )}
        {next.canSnooze && !readOnly ? (
          <Btn variant="sec" big icon="clock" onClick={() => setLater(next)}>
            {tx(NW.remindLater)}
          </Btn>
        ) : null}
      </div>
    </section>
  ) : (
    <section className="ny-hero" style={{ alignItems: "center", textAlign: "center", padding: "28px 18px" }}>
      <SuccessTick size={72} />
      <span className="serif" style={{ fontSize: 24, fontWeight: 600 }}>{tx(NW.allClear)}</span>
      <span className="ny-sub" style={{ fontSize: 15 }}>{tx(NW.allClearSub)}</span>
    </section>
  );

  const progress = (
    <div className="ny-card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
      <Ring value={done.length} max={Math.max(1, total)} size={58} stroke={7} tone="var(--ok)">
        <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>{done.length}</span>
      </Ring>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{tx(NW.left(board.left))}</span>
        <span className="ny-sub">{tx(NW.doneCount(done.length))}</span>
      </div>
    </div>
  );

  const add = readOnly ? null : (
    <Btn variant="sec" big full icon="plus" onClick={() => { cue("tap"); setAdding(true); }}>
      {tx(NW.addOwn)}
    </Btn>
  );

  return (
    <>
      <TopBar
        crumb={tx(NW.hint)}
        title={`${tx(NW.title)}${sub(NW.title) ? ` · ${sub(NW.title)}` : ""}`}
        actions={readOnly ? undefined : <Btn variant="pri" icon="plus" onClick={() => setAdding(true)}>{tx(NW.addOwn)}</Btn>}
        mSub={tx(NW.left(board.left))}
        mAction={readOnly ? undefined : <Btn variant="ghost" icon="plus" ariaLabel={tx(NW.addOwn)} onClick={() => setAdding(true)} />}
      />
      <main id="vx-main" className="pad" style={{ padding: "18px 28px 64px", maxWidth: 1120, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        {readOnly ? <div className="ny-calm">{tx(NW.viewing)}</div> : null}
        <AiLine board={board} arranging={s.arranging} />
        <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {hero}
            {lane("now")}
            {lane("today")}
            <LaneFold lane="later" items={board.later}>{board.later.map(row)}</LaneFold>
            <LaneFold lane="waiting" items={board.waiting}>{board.waiting.map(row)}</LaneFold>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {progress}
            {add}
            <DoneFold done={done} open={done.length > 0 && done.length <= 6} />
          </div>
        </div>
      </main>
      <AddSheet open={adding} now={s.now} onClose={() => setAdding(false)} onSave={s.add} />
      <RemindSheet item={later} now={s.now} onClose={() => setLater(null)} onPick={s.snooze} onRemove={(x) => void s.remove(x)} />
    </>
  );
}
