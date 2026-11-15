"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { cue } from "@/ui/feedback/cue";
import { useVx } from "@/vx/i18n";
import { Btn } from "@/vx/ui/primitives";

import type { NeedsView } from "../data/board";
import type { NeedItem } from "../domain/types";
import { NW } from "../domain/words";
import { InboxOrderContext } from "./inbox-order";
import { AddSheet, AiLine, DoneFold, NeedRow, RemindSheet } from "./parts";
import { useNeeds, type NeedsState } from "./use-needs";

/*
 * The admin's and the coordinators' Needs you is their queue at /inbox
 * (D-630). This adds what the other roles' lists have: the AI's order for
 * the queue, their own to-dos, and what left the queue today. The queue
 * draws itself twice (a desk and a phone layout), so the state lives here
 * once, around it, and the head and the queue's order read it.
 */

type Head = NeedsState & { openAdd: () => void; openLater: (item: NeedItem) => void };

const HeadContext = createContext<Head | null>(null);

export function NeedsHeadProvider({ view, children }: { view: NeedsView; children: ReactNode }) {
  const state = useNeeds(view);
  const [adding, setAdding] = useState(false);
  const [later, setLater] = useState<NeedItem | null>(null);
  const head: Head = { ...state, openAdd: () => setAdding(true), openLater: setLater };
  const plan = state.board.plan;
  // Only the AI's order changes the queue; without one it keeps its own (urgent first, then newest).
  const order = useMemo(() => {
    if (plan.source !== "ai") return null;
    const place = new Map<string, number>();
    plan.order.forEach((key, i) => {
      if (key.startsWith("inbox:")) place.set(key.slice("inbox:".length), i);
    });
    return place.size > 1 ? place : null;
  }, [plan]);
  return (
    <HeadContext.Provider value={head}>
      <InboxOrderContext.Provider value={order}>{children}</InboxOrderContext.Provider>
      {/* One of each, however many places draw the head. */}
      <AddSheet open={adding} now={state.now} onClose={() => setAdding(false)} onSave={state.add} />
      <RemindSheet item={later} now={state.now} onClose={() => setLater(null)} onPick={state.snooze} onRemove={(x) => void state.remove(x)} />
    </HeadContext.Provider>
  );
}

/**
 * Above the queue: the AI's line when it has ordered it, the person's own
 * to-dos with a big Add, and what they finished today. Quiet when there is
 * nothing of their own: one line and one button.
 */
export function InboxHead() {
  const h = useContext(HeadContext);
  const { tx } = useVx();
  if (!h) return null;
  const { board, done, readOnly } = h;
  const now = h.now();
  const own = [...board.now, ...board.today, ...board.later].filter((i) => i.kind === "own");
  const ai = h.arranging || board.plan.source === "ai";
  return (
    <section aria-label={tx(NW.title)} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      {ai ? <AiLine board={board} arranging={h.arranging} /> : null}
      <div className="ny-card">
        <div className="ny-lane" style={{ margin: 0, padding: "10px 12px 10px 16px", minHeight: 52 }}>
          <h2 style={{ fontSize: 15 }}>{tx(NW.myOwn)}</h2>
          {own.length ? <span className="ny-count">{own.length}</span> : null}
          {readOnly ? null : (
            <span style={{ marginLeft: "auto" }}>
              <Btn
                variant="sec"
                icon="plus"
                onClick={() => {
                  cue("tap");
                  h.openAdd();
                }}
              >
                {tx(NW.addOwn)}
              </Btn>
            </span>
          )}
        </div>
        {own.length ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--bd)" }}>
            {own.map((item, i) => (
              <NeedRow key={item.key} item={item} now={now} readOnly={readOnly} onQuick={(x) => void h.quickDone(x)} onLater={h.openLater} delay={Math.min(i * 40, 240)} />
            ))}
          </ul>
        ) : null}
      </div>
      {done.length ? <DoneFold done={done} /> : null}
    </section>
  );
}
