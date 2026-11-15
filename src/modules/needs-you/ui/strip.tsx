"use client";

import Link from "@/ui/link";
import { cue } from "@/ui/feedback/cue";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { Btn, IconTile, Pill } from "@/vx/ui/primitives";

import type { NeedsView } from "../data/board";
import { KIND_ICON, NW } from "../domain/words";
import { AiLine } from "./parts";
import { useNeeds } from "./use-needs";

/**
 * Needs you at the very top of a person's Today (D-630): how many jobs are
 * left, the one to do next with its own button, and a way into the full
 * list. With nothing left, one calm line. Nothing on Today moves for it.
 */
export function NeedsStrip({ view }: { view: NeedsView }) {
  const { tx } = useVx();
  const s = useNeeds(view);
  const { board, done } = s;
  const next = board.next;

  if (!next) {
    return (
      <Link href="/needs" className="tap ny-calm" onClick={() => cue("tap")} style={{ color: "var(--fg)", textDecoration: "none" }}>
        <IconTile icon="checkCircle" tone="ok" size={30} />
        <span style={{ flex: 1, minWidth: 0 }}>{tx(NW.stripNone)}</span>
        {done.length ? <Pill tone="ok" icon="check">{tx(NW.doneCount(done.length))}</Pill> : null}
        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--mut)" }}>
          <Ic n="chevRight" size={18} />
        </span>
      </Link>
    );
  }

  return (
    <section className="ny-strip" aria-label={tx(NW.title)}>
      <div className="ny-strip-top">
        <IconTile icon="ticks" tone="acc" size={34} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>
            {tx(NW.title)} · <span className="num">{tx(NW.left(board.left))}</span>
          </span>
          <AiLine board={board} arranging={s.arranging} compact />
        </div>
        {done.length ? (
          <span className="hide-m">
            <Pill tone="ok" icon="check">{tx(NW.doneCount(done.length))}</Pill>
          </span>
        ) : null}
        <Btn variant="ghost" href="/needs" icon="chevRight" onClick={() => cue("tap")}>
          {tx(NW.seeAll)}
        </Btn>
      </div>
      <div className="ny-strip-next">
        <IconTile icon={KIND_ICON[next.kind]} tone={next.lane === "now" ? "bad" : "acc"} size={42} />
        <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="ny-sub" style={{ fontWeight: 600 }}>{tx(NW.next)}</span>
          <span className="ny-title">{tx(next.title)}</span>
          {next.why ? <span className="ny-sub">{tx(next.why)}</span> : null}
        </div>
        {next.quick ? (
          <Btn variant="pri" icon="check" disabled={s.readOnly} onClick={() => void s.quickDone(next)}>
            {tx(next.act)}
          </Btn>
        ) : (
          <Btn variant="pri" icon="arrowRight" href={next.href} onClick={() => cue("tap")}>
            {tx(next.act)}
          </Btn>
        )}
      </div>
    </section>
  );
}
