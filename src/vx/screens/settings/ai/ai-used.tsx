"use client";

import { useState } from "react";

import { laneOf } from "@/modules/assist/domain/ai-map";
import { isFreeProvider, share, type Overview, type RecentJob, type TaskRow } from "@/modules/assist/domain/overview";
import { initials, schoolToday, shortDayP, timeP } from "@/vx/format";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { cue } from "@/ui/feedback/cue";

import { box, Dot, Head, inr, ModelChip, PayTag, pv, SliceBar, Tile } from "./ai-bits";
import { LANE_WORDS, problemWords, providerName, RESULT_WORDS, taskWords, W } from "./words";
import type { Lane } from "@/modules/assist/domain/ai-map";

const RESULT_COLOR = { kept: "var(--ok)", edited: "var(--info)", unused: "var(--c4)", open: "var(--s3)", failed: "var(--bad)" } as const;

/** "What AI did": who answered, day by day, by kind of job, the latest jobs and who uses it most. */
export function UsedView({ overview, people, lanes }: { overview: Overview | null; people: { name: string; uses: number; costInr: number }[]; lanes: Lane[] }) {
  const { tx } = useVx();
  const [task, setTask] = useState<TaskRow | null>(null);

  if (!overview || overview.jobs + overview.failed === 0) {
    return (
      <div className="card" style={{ ...box, alignItems: "center", textAlign: "center", padding: "36px 18px" }}>
        <Tile icon="sparkle" tone="mut" size={52} />
        <span style={{ fontSize: 15, fontWeight: 600 }}>{tx(overview ? W.nothing : W.unread)}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <WhoWorked overview={overview} />
      <Days overview={overview} />

      <div className="card" style={box}>
        <Head title={W.byJob} sub={W.byJobSub} />
        <div className="aip-grid">
          {overview.tasks.map((row, i) => (
            <JobCard key={row.task} row={row} index={i} onOpen={() => { cue("tap"); setTask(row); }} />
          ))}
        </div>
      </div>

      <Latest jobs={overview.recent} />

      {people.length ? (
        <div className="card" style={box}>
          <Head title={W.people} sub={W.peopleSub} />
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
            {people.map((row, i) => (
              <li key={`${row.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 12, animation: `xIn .3s var(--ease) ${i * 40}ms both` }}>
                <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 99, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{initials(row.name)}</span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{row.name}</span>
                  <SliceBar height={8} delay={i * 40} slices={[{ key: "uses", value: row.uses, color: "var(--acc)" }, { key: "rest", value: Math.max(0, people[0].uses - row.uses), color: "transparent" }]} />
                </span>
                <span className="num" style={{ textAlign: "right", fontSize: 13 }}>
                  <b style={{ display: "block", fontSize: 15 }}>{row.uses}</b>
                  <span style={{ color: "var(--mut)" }}>{inr(row.costInr)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Sheet open={task !== null} onClose={() => setTask(null)} title={task ? tx(taskWords(task.task).label) : undefined} sub={task ? tx(task.kind === "builtin" ? W.photoVoice : W.written) : undefined} icon={task ? taskWords(task.task).icon : undefined}>
        {task ? <TaskDetail row={task} lanes={lanes} /> : null}
      </Sheet>
    </div>
  );
}

function WhoWorked({ overview }: { overview: Overview }) {
  const { tx } = useVx();
  const answered = overview.providers.filter((s) => s.jobs > 0);
  return (
    <div className="card" style={box}>
      <Head title={W.whoWorked} sub={W.whoWorkedSub} />
      <SliceBar height={22} slices={answered.map((s) => ({ key: s.provider ?? "none", value: s.jobs, color: pv(s.provider), title: providerName(s.provider) }))} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 8 }}>
        {answered.map((s, i) => (
          <div key={s.provider ?? "none"} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: "var(--s2)", animation: `xIn .3s var(--ease) ${i * 50}ms both` }}>
            <Dot provider={s.provider} size={14} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{providerName(s.provider)}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <PayTag provider={s.provider} />
                <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{share(s.jobs, overview.jobs)}%</span>
              </span>
            </span>
            <b className="num" style={{ fontSize: 20 }}>{s.jobs}</b>
          </div>
        ))}
      </div>
      {overview.failed ? (
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--bad)" }}>
          <Ic n="alert" size={15} />
          {tx(W.failedN(overview.failed))}
        </span>
      ) : null}
    </div>
  );
}

function Days({ overview }: { overview: Overview }) {
  const { tx } = useVx();
  const today = schoolToday();
  const [sel, setSel] = useState<string | null>(null);
  const most = Math.max(1, ...overview.days.map((d) => d.free + d.paid));
  const picked = overview.days.find((d) => d.day === (sel ?? today)) ?? overview.days.at(-1);
  return (
    <div className="card" style={box}>
      <Head
        title={W.dayByDay}
        sub={W.dayTip}
        action={
          <span style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--mut)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--ok)" }} />{tx(W.freeTag)}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--c1)" }} />{tx(W.paidTag)}</span>
          </span>
        }
      />
      <div className="aip-days" role="group" aria-label={tx(W.dayByDay)}>
        {overview.days.map((d, i) => {
          const total = d.free + d.paid;
          return (
            <button
              key={d.day}
              type="button"
              className={`tap aip-day${d.day === picked?.day ? " sel" : ""}${d.day === today ? " today" : ""}`}
              aria-label={tx(W.dayLine(shortDayP(d.day), d.free, d.paid))}
              aria-pressed={d.day === picked?.day}
              onClick={() => { cue("select"); setSel(d.day); }}
            >
              {total === 0 ? <i style={{ height: 3, background: "var(--s3)", animationDelay: `${i * 18}ms` }} /> : null}
              {d.free ? <i style={{ height: `${(d.free / most) * 100}%`, background: "var(--ok)", animationDelay: `${i * 18}ms` }} /> : null}
              {d.paid ? <i style={{ height: `${(d.paid / most) * 100}%`, background: "var(--c1)", animationDelay: `${i * 18 + 60}ms` }} /> : null}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>
        <span>{overview.days[0] ? tx(shortDayP(overview.days[0].day)) : null}</span>
        <span>{tx(p("Today", "आज"))}</span>
      </div>
      {picked ? (
        <span key={picked.day} className="num" style={{ fontSize: 14, fontWeight: 600, animation: "xFade .25s both" }}>
          {tx(W.dayLine(shortDayP(picked.day), picked.free, picked.paid))}
        </span>
      ) : null}
    </div>
  );
}

function JobCard({ row, index, onOpen }: { row: TaskRow; index: number; onOpen: () => void }) {
  const { tx } = useVx();
  const w = taskWords(row.task);
  const decided = row.results.kept + row.results.edited + row.results.unused;
  return (
    <button type="button" className="tap aip-job" onClick={onOpen} style={{ animation: `xIn .32s var(--ease) ${Math.min(index, 10) * 35}ms both` }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
        <Tile icon={w.icon} tone={row.kind === "builtin" ? "info" : "acc"} size={38} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="clip" style={{ fontSize: 14.5, fontWeight: 700 }}>{tx(w.label)}</span>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(row.kind === "builtin" ? W.photoVoice : W.written)}{row.test ? ` · ${row.test} ${tx(W.test)}` : ""}</span>
        </span>
        <b className="num" style={{ fontSize: 22 }}>{row.jobs}</b>
      </span>
      <SliceBar height={10} delay={index * 35} slices={row.providers.map((s) => ({ key: s.provider ?? "none", value: s.jobs, color: pv(s.provider), title: providerName(s.provider) }))} />
      <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 12 }}>
        {row.providers.slice(0, 3).map((s) => (
          <span key={s.provider ?? "none"} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Dot provider={s.provider} size={8} />
            <span className="num">{providerName(s.provider)} {s.jobs}</span>
          </span>
        ))}
      </span>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%", fontSize: 12, color: "var(--mut)" }}>
        <span className="num">
          {decided ? tx(W.keptPct(share(row.results.kept + row.results.edited, decided))) : null}
          {row.failed ? <span style={{ color: "var(--bad)" }}>{decided ? " · " : ""}{tx(W.failedN(row.failed))}</span> : null}
        </span>
        <span className="num" style={{ fontWeight: 600, color: "var(--fg)" }}>{inr(row.costInr)}</span>
      </span>
    </button>
  );
}

function TaskDetail({ row, lanes }: { row: TaskRow; lanes: Lane[] }) {
  const { tx } = useVx();
  const lane = lanes.find((l) => l.id === laneOf(row.task));
  const words = LANE_WORDS[laneOf(row.task)];
  const results = (Object.keys(RESULT_WORDS) as (keyof typeof RESULT_WORDS)[]).filter((k) => row.results[k] > 0);
  const all = row.jobs + row.failed;
  const stats: [Pair, string][] = [
    [W.thisMonth, String(row.jobs)],
    [W.cost, inr(row.costInr)],
    [W.perJob, row.jobs ? inr(row.costInr / row.jobs) : "—"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
        {stats.map(([label, value], i) => (
          <div key={label.en} className="aip-stat" style={{ animationDelay: `${i * 60}ms` }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(label)}</span>
            <b className="num" style={{ fontSize: 20 }}>{value}</b>
          </div>
        ))}
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="sech">{tx(W.answeredBy)}</span>
        {row.providers.map((s) => (
          <div key={s.provider ?? "none"} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Dot provider={s.provider} size={12} />
            <span style={{ flex: "0 0 120px", fontSize: 14, fontWeight: 600 }}>{providerName(s.provider)}</span>
            <span style={{ flex: 1 }}><SliceBar height={10} slices={[{ key: "n", value: s.jobs, color: pv(s.provider) }, { key: "rest", value: Math.max(0, row.jobs - s.jobs), color: "transparent" }]} /></span>
            <b className="num">{s.jobs}</b>
          </div>
        ))}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="sech">{tx(W.whatHappened)}</span>
        <SliceBar height={14} slices={results.map((k) => ({ key: k, value: row.results[k], color: RESULT_COLOR[k], title: tx(RESULT_WORDS[k].label) }))} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {results.map((k) => (
            <span key={k} className="num" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: RESULT_COLOR[k] }} />
              {tx(RESULT_WORDS[k].label)} <b>{row.results[k]}</b>
              <span style={{ color: "var(--mut)" }}>({share(row.results[k], all)}%)</span>
            </span>
          ))}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="sech">{tx(W.roadTitle)}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(words.title)} · {tx(words.rule)}</span>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {(lane?.stations ?? []).map((s, i) => (
            <span key={`${s.provider}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: s.locked ? 0.5 : 1 }}>
              {i ? <Ic n="chevRight" size={14} style={{ color: "var(--sub)" }} /> : null}
              <ModelChip provider={s.provider} model={null} note={s.locked ? "🔒" : undefined} />
            </span>
          ))}
        </span>
        <span style={{ fontSize: 13, color: "var(--mut)", lineHeight: 1.5 }}>{tx(words.why)}</span>
      </section>
    </div>
  );
}

function Latest({ jobs }: { jobs: RecentJob[] }) {
  const { tx } = useVx();
  if (!jobs.length) return null;
  const today = schoolToday();
  return (
    <div className="card" style={box}>
      <Head title={W.latest} sub={W.latestSub} />
      <ul className="aip-feed" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
        {jobs.map((job, i) => {
          const w = taskWords(job.task);
          const r = RESULT_WORDS[job.result];
          const when = schoolToday(new Date(job.at)) === today ? timeP(job.at) : shortDayP(job.at);
          return (
            <li key={`${job.at}-${i}`} style={{ display: "flex", gap: 12, padding: "12px 0", borderTop: i ? "1px solid var(--bd)" : 0, animationDelay: `${Math.min(i, 10) * 30}ms` }}>
              <Tile icon={w.icon} tone={job.kind === "builtin" ? "info" : "acc"} size={36} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {tx(w.label)}
                    {job.test ? <span className="pill" style={{ marginLeft: 6, height: 18, padding: "0 6px", fontSize: 10, background: "var(--warns)", color: "var(--warnfg)", verticalAlign: "middle" }}>{tx(W.test)}</span> : null}
                  </span>
                  <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(when)}</span>
                </span>
                <span className="aip-trail">
                  {job.trail.map((step, k) => (
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {k ? <Ic n="chevRight" size={13} style={{ color: "var(--sub)" }} /> : null}
                      <ModelChip provider={step.provider} model={step.model} failed={!step.ok} note={!step.ok && step.problem ? tx(problemWords(step.problem)) : undefined} />
                    </span>
                  ))}
                </span>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--mut)" }}>
                  <span className="clip">
                    {job.who ?? tx(W.someone)} ·{" "}
                    <span style={{ color: r.tone === "bad" ? "var(--bad)" : r.tone === "ok" ? "var(--ok)" : r.tone === "info" ? "var(--info)" : "var(--mut)", fontWeight: 600 }}>{tx(r.label)}</span>
                  </span>
                  <span className="num" style={{ color: isFreeProvider(job.provider) ? "var(--ok)" : "var(--fg)", fontWeight: 600 }}>{isFreeProvider(job.provider) && !job.costInr ? tx(W.freeTag) : inr(job.costInr)}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
