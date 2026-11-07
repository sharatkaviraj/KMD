"use client";

import { useEffect, useState } from "react";

import { busiestStation, laneCounts, stationCount, type Lane, type LaneId, type Station } from "@/modules/assist/domain/ai-map";
import { isFreeProvider, modelName, type Overview } from "@/modules/assist/domain/overview";
import { cue } from "@/ui/feedback/cue";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";
import { ListenButton } from "@/vx/ui/listen";
import { Sheet } from "@/vx/ui/overlays";

import { box, Dot, inr, PayTag, pv, Tile } from "./ai-bits";
import { LANE_WORDS, LOCK_WORDS, PROVIDER_WORDS, providerName, taskWords, W } from "./words";

type Mark = { lane: LaneId; at: number };

function stationName(s: Station): string {
  return s.partner ? `${providerName(s.provider)} + ${providerName(s.partner.provider)}` : providerName(s.provider);
}

/** What happens at each station, as one short sentence: the "Show me" caption and the line read aloud. */
function stationLine(stations: readonly Station[], i: number): Pair {
  const s = stations[i];
  const first = stations.findIndex((x) => !x.locked);
  if (s.locked) return W.skipped(stationName(s));
  if (s.partner) return W.voicePair(providerName(s.provider), providerName(s.partner.provider));
  return i === first ? W.tries(stationName(s)) : W.thenNext(stationName(s));
}

/**
 * "How it works": the four roads a job can take, drawn as stations from the
 * same chains the helper runs (`aiLanes`). "Show me" walks the road; "Listen"
 * reads it aloud and lights each station as it is read.
 */
export function FlowView({ lanes, overview }: { lanes: Lane[]; overview: Overview | null }) {
  const { tx } = useVx();
  const counts = laneCounts(overview?.tasks ?? []);
  const [walk, setWalk] = useState<Mark | null>(null);
  const [spoken, setSpoken] = useState<Mark | null>(null);
  const [open, setOpen] = useState<{ station: Station; lane: LaneId } | null>(null);

  useEffect(() => {
    if (!walk) return;
    const stations = lanes.find((l) => l.id === walk.lane)?.stations ?? [];
    if (walk.at >= stations.length) {
      cue("done");
      const t = window.setTimeout(() => setWalk(null), 2600);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setWalk({ lane: walk.lane, at: walk.at + 1 }), 1150);
    return () => window.clearTimeout(t);
  }, [walk, lanes]);

  // On a phone the road is a column taller than the screen and its buttons sit
  // below the last station: keep the lit station in view while it is walked or read.
  const litMark = walk ?? spoken;
  useEffect(() => {
    if (!litMark) return;
    const el = document.querySelector<HTMLElement>(`[data-station="${litMark.lane}-${litMark.at}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top >= 80 && r.bottom <= window.innerHeight - 90) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  }, [litMark]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card" style={{ ...box, flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
        <Tile icon="layers" tone="acc" size={44} />
        <span style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14.5, lineHeight: 1.55 }}>{tx(W.howIntro)}</span>
          <span style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: 12, background: "var(--oks)", color: "var(--ok)", fontSize: 13, lineHeight: 1.5, fontWeight: 600 }}>
            <Ic n="shield" size={18} style={{ flex: "none", marginTop: 1 }} />
            {tx(W.freeRule)}
          </span>
        </span>
      </div>

      {lanes.map((lane, li) => {
        const words = LANE_WORDS[lane.id];
        const laneCount = counts[lane.id];
        const busiest = busiestStation(lane.stations, laneCount);
        const jobs = lane.stations.reduce((sum, s) => sum + stationCount(s, laneCount), 0);
        const lit = walk?.lane === lane.id ? walk.at : spoken?.lane === lane.id ? spoken.at : null;
        const walking = walk?.lane === lane.id;
        const lines = [`${tx(words.title)}. ${tx(words.rule)}.`, ...lane.stations.map((_, i) => `${tx(stationLine(lane.stations, i))}.`)];
        return (
          <section key={lane.id} className="card" style={{ ...box, animation: `xIn .34s var(--ease) ${li * 60}ms both` }} aria-label={tx(words.title)}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <Tile icon={words.icon} tone={words.tone} size={44} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(words.title)}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: words.tone === "ok" ? "var(--ok)" : "var(--accfg)" }}>{tx(words.rule)}</span>
              </span>
              <span className="num" style={{ textAlign: "right", fontSize: 12, color: "var(--mut)" }}>
                <b style={{ display: "block", fontSize: 20, color: "var(--fg)" }}>{jobs}</b>
                {tx(W.thisMonth)}
              </span>
            </div>
            <span style={{ fontSize: 13, color: "var(--mut)", lineHeight: 1.5 }}>{tx(words.why)}</span>

            {lane.off ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--warnfg)" }}><Ic n="info" size={16} />{tx(W.laneOff)}</span>
            ) : lane.stations.length === 0 ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--warnfg)" }}><Ic n="info" size={16} />{tx(W.noStation)}</span>
            ) : (
              <>
                <div className="aip-road" role="list">
                  {lane.stations.map((s, i) => {
                    const n = stationCount(s, laneCount);
                    const cls = lit === null ? "" : lit === i ? " now" : walking && i < lit ? " past" : "";
                    return (
                      <div key={`${s.provider}-${i}`} role="listitem" style={{ display: "contents" }}>
                        {i ? (
                          <span className="aip-arrow" aria-hidden="true">
                            {walking && lit === i ? <span className="aip-walker" /> : <Ic n="arrowRight" size={18} />}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          data-station={`${lane.id}-${i}`}
                          className={`tap aip-st${s.locked ? " locked" : ""}${cls}`}
                          style={{ ["--pv" as string]: pv(s.provider) }}
                          onClick={() => { cue("tap"); setOpen({ station: s, lane: lane.id }); }}
                        >
                          {busiest === i && !s.locked && lit === null ? <span className="aip-ring" aria-hidden="true" /> : null}
                          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <span className="aip-no num" aria-hidden="true" title={tx(W.stepNo(i + 1))}>{i + 1}</span>
                            <Dot provider={s.provider} size={11} />
                            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700 }}>{stationName(s)}</span>
                            {s.locked ? <Ic n="lock" size={15} /> : <PayTag provider={s.provider} />}
                          </span>
                          <span className="aip-models">
                            {s.partner ? (
                              <>
                                <span>{modelName(s.models[0])} · {tx(W.listens)}</span>
                                <span>{modelName(s.partner.model)} · {tx(W.understands)}</span>
                              </>
                            ) : (
                              s.models.slice(0, 3).map((m) => <span key={m} className="clip">{modelName(m)}</span>)
                            )}
                          </span>
                          {s.locked ? (
                            <span style={{ fontSize: 11.5, fontWeight: 700 }}>{tx(LOCK_WORDS[s.locked])}</span>
                          ) : (
                            <span className="num" style={{ fontSize: 12, fontWeight: 600, color: busiest === i ? "var(--fg)" : "var(--mut)" }}>
                              {tx(W.answeredHere(n))}
                              {busiest === i ? <span style={{ display: "block", color: "var(--ok)" }}>★ {tx(W.busiest)}</span> : null}
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="tap btn pri"
                    disabled={walking}
                    onClick={() => { cue("select"); setSpoken(null); setWalk({ lane: lane.id, at: 0 }); }}
                    style={{ height: 44, minWidth: 130 }}
                  >
                    <Ic n="zap" size={17} />
                    {tx(W.showMe)}
                  </button>
                  <ListenButton lines={lines} onLine={(i) => setSpoken(i === null || i < 1 ? null : { lane: lane.id, at: i - 1 })} style={{ height: 44 }} />
                  {walking && walk ? (
                    <span key={walk.at} role="status" style={{ flex: "1 1 220px", fontSize: 14, fontWeight: 600, color: walk.at >= lane.stations.length ? "var(--ok)" : "var(--fg)", animation: "xFade .25s both" }}>
                      {walk.at >= lane.stations.length ? `✓ ${tx(W.walkDone)}` : `${walk.at + 1}. ${tx(stationLine(lane.stations, walk.at))}`}
                    </span>
                  ) : null}
                </div>
              </>
            )}

            <details>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accfg)", minHeight: 32, display: "flex", alignItems: "center", gap: 6 }}>
                <Ic n="list" size={15} />
                {tx(W.tasksOnRoad)} ({lane.tasks.length})
              </summary>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 8 }}>
                {lane.tasks.map((t) => (
                  <span key={t} className="pill" style={{ height: 28, padding: "0 10px", gap: 6, fontSize: 12.5, background: "var(--s2)", color: "var(--fg)" }}>
                    <Ic n={taskWords(t).icon} size={13} />
                    {tx(taskWords(t).label)}
                  </span>
                ))}
              </span>
            </details>
          </section>
        );
      })}

      <Sheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? stationName(open.station) : undefined}
        sub={open ? tx(LANE_WORDS[open.lane].title) : undefined}
        icon="sparkle"
      >
        {/* The sheet renders in the overlay layer, outside the page's `.aip`: it carries its own. */}
        {open ? <div className="aip"><StationDetail station={open.station} lanes={lanes} overview={overview} /></div> : null}
      </Sheet>
    </div>
  );
}

function StationDetail({ station, lanes, overview }: { station: Station; lanes: Lane[]; overview: Overview | null }) {
  const { tx } = useVx();
  const providers = [station.provider, ...(station.partner ? [station.partner.provider] : [])];
  const models = (overview?.models ?? []).filter((m) => m.provider && providers.includes(m.provider));
  const usedFor = lanes.filter((l) => l.stations.some((s) => providers.includes(s.provider) && !s.locked));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 8 }}>
      {providers.map((p) => (
        <div key={p} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Dot provider={p} size={14} />
          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700 }}>{PROVIDER_WORDS[p].name}<PayTag provider={p} /></span>
            <span style={{ fontSize: 13.5, color: "var(--mut)", lineHeight: 1.5 }}>{tx(PROVIDER_WORDS[p].about)}</span>
          </span>
        </div>
      ))}
      {station.locked ? (
        <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 12, background: "var(--s2)", fontSize: 13.5, fontWeight: 600 }}>
          <Ic n="lock" size={16} />
          {tx(LOCK_WORDS[station.locked])} · {tx(W.freeRule)}
        </span>
      ) : null}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="sech">{tx(W.models)} · {tx(W.thisMonth)}</span>
        {(models.length ? models : station.models.map((m) => ({ provider: station.provider, model: m, answered: 0, tries: 0, costInr: 0 }))).map((m) => (
          <div key={`${m.provider}-${m.model}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: "var(--s2)" }}>
            <Dot provider={m.provider} size={10} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{modelName(m.model)}</span>
              <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.answered(m.answered))} · {tx(W.triesN(m.tries))}</span>
            </span>
            <span className="num" style={{ fontWeight: 700, color: isFreeProvider(m.provider) ? "var(--ok)" : undefined }}>{isFreeProvider(m.provider) && !m.costInr ? tx(W.freeCost) : inr(m.costInr)}</span>
          </div>
        ))}
      </section>
      {usedFor.length ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="sech">{tx(W.usedFor)}</span>
          {usedFor.map((l) => (
            <span key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <Ic n={LANE_WORDS[l.id].icon} size={16} style={{ color: "var(--mut)" }} />
              {tx(LANE_WORDS[l.id].title)}
            </span>
          ))}
        </section>
      ) : null}
    </div>
  );
}
