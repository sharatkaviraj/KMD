"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { Language } from "@/platform/i18n/language";
import { dayLabel } from "@/platform/dates";
import Link from "@/ui/link";
import { Ic, type IconName } from "@/vx/icons";
import { lead, under, type Pair } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { Avatar, Btn, Card, EmptyState, IconTile, Pill, Progress, type Tone } from "@/vx/ui/primitives";
import { collectCounts, groupAsks, isLate, teacherStep, type Ask, type BoardTask, type TeacherStep } from "../domain/collect";
import type { SendKind } from "../domain/send-queue";
import { AssignmentLauncher } from "./assignment-sheet";
import { CW } from "./collect-words";
import { SendQueue } from "./send-queue";

/*
 * Teachers' work on Needs you (D-520): what the office has asked teachers
 * for, who still needs a link or a nudge, and what has come back. Three big
 * next steps over the asks themselves; every teacher is one row with one
 * word for where they stand. Nothing here is a table.
 */

const STEP_TONE: Record<TeacherStep, Tone> = {
  reassign: "bad",
  check: "warn",
  "to-approve": "acc",
  "not-sent": "warn",
  sent: "info",
  opened: "info",
  started: "info",
  done: "ok",
};

const KIND_ICON: Record<BoardTask["kind"], IconName> = { collection: "clipboard", marks: "award", attendance: "calCheck" };
const KIND_WORD: Record<BoardTask["kind"], Pair> = { collection: CW.kindDetails, marks: CW.kindMarks, attendance: CW.kindAttendance };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function CollectBoard({ tasks, today, language, previewing, reviewHref = "/collection/review" }: {
  tasks: BoardTask[] | null;
  today: string;
  language: Language;
  previewing: boolean;
  reviewHref?: string;
}) {
  const router = useRouter();
  const say = (pair: Pair) => lead(pair, language);
  const [queue, setQueue] = useState<{ kind: SendKind; ids: string[] } | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const closeQueue = () => {
    setQueue(null);
    if (recorded) { setRecorded(false); router.refresh(); }
  };

  if (tasks === null) {
    return <p role="alert" className="card" style={{ margin: 0, padding: "14px 16px", color: "var(--bad)" }}>{say(CW.couldNotRead)}</p>;
  }

  const counts = collectCounts(tasks, today);
  const asks = groupAsks(tasks, today);
  const open = asks.filter((a) => !a.finished);
  const finished = asks.filter((a) => a.finished);
  const titleOf = (ask: Pick<Ask, "kind" | "title">) => (ask.kind === "attendance" && ISO.test(ask.title) ? `${say(CW.kindAttendance)} · ${say(dayLabel(ask.title))}` : ask.kind === "marks" ? `${say(CW.kindMarks)} · ${ask.title}` : ask.title);

  const dueOf = (ask: Ask) => {
    if (!ask.dueDate || !ISO.test(ask.dueDate) || ask.finished) return null;
    const late = ask.tasks.some((t) => isLate(t, today));
    if (late) return <Pill tone="bad" icon="clock">{`${say(CW.overdue)} · ${say(dayLabel(ask.dueDate))}`}</Pill>;
    if (ask.dueDate === today) return <Pill tone="warn" icon="clock">{say(CW.dueToday)}</Pill>;
    return <Pill tone="mut" icon="calendar">{say(CW.due(lead(dayLabel(ask.dueDate), language)))}</Pill>;
  };

  const openQueue = (kind: SendKind, ids: string[]) => { if (!previewing && ids.length) setQueue({ kind, ids }); };

  const steps: { key: string; icon: IconName; tone: Tone; count: number; title: Pair; sub: Pair; none: Pair; action: ReactNode }[] = [
    {
      key: "send", icon: "send", tone: "ok", count: counts.toSend.length, title: CW.toSendTitle, sub: CW.toSendSub, none: CW.toSendNone,
      action: <Btn variant="pri" icon="send" big full disabled={previewing || counts.toSend.length === 0} onClick={() => openQueue("initial", counts.toSend)}>{say(CW.sendLinks)}</Btn>,
    },
    {
      key: "remind", icon: "bell", tone: "warn", count: counts.toRemind.length, title: CW.toRemindTitle, sub: CW.toRemindSub, none: CW.toRemindNone,
      action: <Btn variant="sec" icon="bell" big full disabled={previewing || counts.toRemind.length === 0} onClick={() => openQueue("reminder", counts.toRemind)}>{say(CW.remind)}</Btn>,
    },
    {
      key: "check", icon: "checkCircle", tone: "acc", count: counts.answers, title: CW.answersTitle, sub: CW.answersSub, none: CW.answersNone,
      action: <Btn variant="sec" icon="checkCircle" big full href={reviewHref} disabled={counts.answers === 0}>{say(CW.check)}</Btn>,
    },
  ];

  const teacherRow = (t: BoardTask) => {
    const step = teacherStep(t);
    const progress = t.kind === "collection" && t.expected > 0 && step !== "done" && step !== "not-sent" ? `${t.answered}/${t.expected}` : null;
    return (
      <li key={t.id}>
        <Link href={`/inbox?view=collect&task=${t.id}`} className="tap row" scroll={false} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 16px", color: "var(--fg)", textDecoration: "none" }}>
          <Avatar text={initials(t.teacherName)} seed={t.teacherName ?? t.id} size={36} />
          <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{t.teacherName ?? "—"}</span>
            {t.group || progress ? <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{[t.group, progress].filter(Boolean).join(" · ")}</span> : null}
          </span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flex: "none" }}>
            <Pill tone={STEP_TONE[step]} icon={step === "done" ? "check" : undefined}>{say(CW.step[step])}</Pill>
            {t.told.remindedToday && step !== "done" ? <span style={{ fontSize: 11, color: "var(--mut)" }}>{say(CW.remindedToday)}</span> : null}
          </span>
          <Ic n="chevRight" size={16} style={{ color: "var(--mut)" }} />
        </Link>
      </li>
    );
  };

  const askCard = (ask: Ask, i: number) => {
    const many = ask.tasks.length > 5;
    const showAll = expanded.has(ask.key);
    const rows = many && !showAll ? ask.tasks.slice(0, 4) : ask.tasks;
    return (
      <Card key={ask.key} as="article" pad={false} aria-label={titleOf(ask)} style={{ overflow: "hidden", animation: `xRise .4s var(--ease) ${Math.min(i * 60, 360)}ms both` }}>
        <div style={{ padding: "14px 16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <IconTile icon={KIND_ICON[ask.kind]} tone={ask.finished ? "ok" : "acc"} size={40} />
            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.3, overflowWrap: "anywhere" }}>{titleOf(ask)}</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {ask.kind === "collection" ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(KIND_WORD.collection)}</span> : null}
                {dueOf(ask)}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <Progress value={ask.done} max={Math.max(ask.tasks.length, 1)} tone={ask.finished ? "var(--ok)" : "var(--acc)"} height={8} />
            <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>
              {say(CW.teachersDone(ask.done, ask.tasks.length))}{ask.kind === "collection" && ask.expected > 0 ? ` · ${say(CW.answers(ask.answered, ask.expected))}` : ""}
            </span>
          </div>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--bd)" }}>{rows.map(teacherRow)}</ul>
        {many ? (
          <button type="button" className="tap" onClick={() => setExpanded((all) => { const nextSet = new Set(all); if (nextSet.has(ask.key)) nextSet.delete(ask.key); else nextSet.add(ask.key); return nextSet; })} style={{ width: "100%", minHeight: 44, border: 0, borderTop: "1px solid var(--bd)", background: "transparent", color: "var(--acc)", fontSize: 14, fontWeight: 700 }}>
            {say(showAll ? CW.showLess : CW.showAll(ask.tasks.length))}
          </button>
        ) : null}
        {!ask.finished && !previewing && (ask.toSend.length || ask.toRemind.length) ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 16px 14px", borderTop: "1px solid var(--bd)" }}>
            {ask.toSend.length ? <Btn variant="pri" icon="send" onClick={() => openQueue("initial", ask.toSend)}>{`${say(CW.sendLinks)} · ${ask.toSend.length}`}</Btn> : null}
            {ask.toRemind.length ? <Btn variant="sec" icon="bell" onClick={() => openQueue("reminder", ask.toRemind)}>{`${say(CW.remind)} · ${ask.toRemind.length}`}</Btn> : null}
          </div>
        ) : null}
      </Card>
    );
  };

  const flow = [CW.stepAsk, CW.stepSend, CW.stepCheck];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <Card as="section" aria-label={say(CW.heroTitle)} style={{ display: "flex", flexDirection: "column", gap: 14, background: "linear-gradient(135deg, var(--accs), var(--card) 70%)", animation: "xIn .35s var(--ease) both" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <IconTile icon="users" tone="acc" size={48} />
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 className="serif" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>{say(CW.heroTitle)}</h2>
            {under(CW.heroTitle, language) ? <span lang="hi" style={{ fontSize: 13, color: "var(--mut)" }}>{under(CW.heroTitle, language)}</span> : null}
            <p style={{ margin: 0, fontSize: 14, color: "var(--mut)", lineHeight: 1.45 }}>{say(CW.heroSub)}</p>
          </div>
        </div>
        <ol aria-label={say(CW.heroTitle)} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {flow.map((pair, n) => (
            <li key={pair.en} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 5px", borderRadius: 999, background: "var(--card)", border: "1px solid var(--bd)", fontSize: 13, fontWeight: 700 }}>
                <span aria-hidden="true" className="num" style={{ width: 22, height: 22, borderRadius: 11, display: "inline-grid", placeItems: "center", background: "var(--acc)", color: "#fff", fontSize: 12 }}>{n + 1}</span>
                {say(pair)}
              </span>
              {n < flow.length - 1 ? <Ic n="arrowRight" size={14} style={{ color: "var(--mut)" }} /> : null}
            </li>
          ))}
        </ol>
        <div style={{ display: "flex" }}>
          <AssignmentLauncher language={language} variant="pri" big label={say(CW.ask)} />
        </div>
      </Card>

      {previewing ? <p role="note" className="card" style={{ margin: 0, padding: "12px 14px", fontSize: 13, color: "var(--mut)" }}>{say(CW.preview)}</p> : null}

      {tasks.length > 0 ? (
        <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
          {steps.map((s, i) => (
            <Card key={s.key} as="section" aria-label={say(s.title)} style={{ display: "flex", flexDirection: "column", gap: 10, opacity: s.count === 0 ? 0.78 : 1, animation: `xRise .4s var(--ease) ${80 + i * 70}ms both` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <IconTile icon={s.icon} tone={s.count === 0 ? "mut" : s.tone} size={44} />
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="num" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{s.count}</span>
                  <strong style={{ fontSize: 15 }}>{say(s.title)}</strong>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--mut)", lineHeight: 1.4, flex: 1 }}>{say(s.count === 0 ? s.none : s.sub)}</p>
              {s.action}
            </Card>
          ))}
        </div>
      ) : null}

      {counts.late > 0 ? (
        <div role="note" className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "var(--bads)", color: "var(--bad)", fontSize: 14, fontWeight: 600 }}>
          <Ic n="clock" size={18} />
          <span>{say(CW.late(counts.late))}</span>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <EmptyState icon="users" title={say(CW.noWorkTitle)} body={say(CW.noWorkBody)} />
      ) : null}

      {open.length > 0 ? (
        <section aria-label={say(CW.openWork)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="sech" style={{ margin: "6px 0 0" }}>{`${say(CW.openWork)} · ${open.length}`}</h2>
          {open.map(askCard)}
        </section>
      ) : null}

      {finished.length > 0 ? (
        <details className="card" style={{ padding: 0, overflow: "hidden" }}>
          <summary className="tap" style={{ listStyle: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "0 16px", fontWeight: 700 }}>
            <Ic n="checkCircle" size={18} style={{ color: "var(--ok)" }} />
            <span style={{ flex: 1 }}>{`${say(CW.finishedWork)} · ${finished.length}`}</span>
            <Ic n="chevDown" size={18} />
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 12px 12px" }}>{finished.map(askCard)}</div>
        </details>
      ) : null}

      <Sheet
        open={queue !== null}
        onClose={closeQueue}
        title={say(queue?.kind === "reminder" ? CW.remindTitle : CW.sendTitle)}
        icon={queue?.kind === "reminder" ? "bell" : "send"}
        footer={<Btn variant="sec" big full onClick={closeQueue}>{say(CW.close)}</Btn>}
      >
        {queue ? <SendQueue key={`${queue.kind}:${queue.ids.join(",")}`} kind={queue.kind} ids={queue.ids} language={language} onRecorded={() => setRecorded(true)} /> : null}
      </Sheet>
    </div>
  );
}
