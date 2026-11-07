"use client";

import { rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { T } from "@/vx/screens/admin/text";
import { TD } from "@/vx/screens/admin/today-text";
import { catchUp } from "@/vx/screens/admin/today-logic";

/* The year's pace bar and its words: on the phone's session card (today.tsx) and the desk's pace card (today-money.tsx). */

export function PaceBar({ pace }: { pace: { percent: number; shouldPercent: number } }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pace.percent} style={{ position: "relative", height: 12, borderRadius: 6, background: "var(--s3)" }}>
      <div style={{ height: 12, borderRadius: 6, width: `${Math.min(100, pace.percent)}%`, background: "var(--acc)", transformOrigin: "left", animation: "xGrowX .9s var(--ease) both", transition: "width .6s var(--ease)" }} />
      <span aria-hidden="true" style={{ position: "absolute", top: -4, bottom: -4, left: `${Math.min(100, pace.shouldPercent)}%`, width: 2, borderRadius: 1, background: "var(--fg)" }} />
    </div>
  );
}

export function PaceWords({ pace, today, size }: { pace: { behind: number }; today: string; size: number }) {
  const { tx } = useVx();
  const more = catchUp(pace.behind, today);
  return (
    <>
      <span style={{ fontSize: 13, lineHeight: 1.45, fontWeight: 600, color: pace.behind > 0 ? "var(--warnfg)" : "var(--ok)" }}>
        {pace.behind > 0 ? tx(T.behindBy(rupees(pace.behind))) : tx(T.onPace)}
      </span>
      {more ? <span style={{ fontSize: size, lineHeight: 1.5, color: "var(--mut)" }}>{tx(TD.catchUp(rupees(more.perDay), more.daysLeft, TD.month[more.month]))}</span> : null}
    </>
  );
}
