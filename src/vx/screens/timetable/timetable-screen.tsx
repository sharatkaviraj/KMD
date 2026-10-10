"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  coverAction,
  decideLeaveAction,
  discardChangeAction,
  publishChangesAction,
  requestLeaveAction,
  saveChangeAction,
  type CoverInput,
  type TimetableResult,
} from "@/app/(app)/timetable/vx-actions";
import { dayMonth, initials, rupees, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";
import { Chip, ChipRow, DateChips, Field, Input, RadioCard, Seg, Select, Switch } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, Grid, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, Btn, Card, CardHead, EmptyState, Pill, Ring, SecHead, WhatsAppPreview } from "@/vx/ui/primitives";

import type { CoverDutyView, LeaveView, TimetableData } from "./data";
import {
  affectedTeachers,
  applyChanges,
  BREAK_AFTER,
  cellKey,
  changeNotice,
  classGrid,
  clashFor,
  FAMILY_HUES,
  FAMILY_LABELS,
  freeAt,
  LEAVE_PROBLEMS,
  leaveProblems,
  periodsNeedingCover,
  PERIODS,
  schoolDays,
  SPAN_LABELS,
  spanPeriods,
  subjectFamily,
  teacherGrid,
  teacherLoad,
  teachersOf,
  WEEK,
  WEEK_SHORT,
  weekdayOf,
  type LeaveSpan,
  type PendingChange,
  type Slot,
  type SubjectFamily,
  type Weekday,
} from "./domain/timetable";

export type TimetableView = "class" | "teacher" | "subs" | "leave";
export type TimetableState = {
  view: TimetableView;
  classId: string | null;
  teacherId: string | null;
  cell: { day: Weekday; period: number } | null;
  pick: string | null;
  duty: string | null;
  sheet: "publish" | "leave" | null;
};

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

function href(s: Partial<TimetableState>): string {
  const qs = new URLSearchParams();
  if (s.view && s.view !== "class") qs.set("view", s.view);
  if (s.classId) qs.set("class", s.classId);
  if (s.teacherId) qs.set("teacher", s.teacherId);
  if (s.cell) qs.set("cell", `${s.cell.day}-${s.cell.period + 1}`);
  if (s.pick) qs.set("pick", s.pick);
  if (s.duty) qs.set("duty", s.duty);
  if (s.sheet) qs.set("sheet", s.sheet);
  return `/timetable${qs.size ? `?${qs}` : ""}`;
}

function cellStyle(family: SubjectFamily, opts: { pending?: boolean; cover?: boolean; free?: boolean } = {}): React.CSSProperties {
  const hue = FAMILY_HUES[family];
  if (opts.free) return { border: "1.5px dashed var(--bd)", background: "transparent", borderRadius: 10 };
  return {
    background: `hsl(${hue} 45% 50% / .13)`,
    borderLeft: `4px solid hsl(${hue} 45% 42%)`,
    borderRadius: 10,
    outline: opts.pending ? "2px dashed var(--acc)" : opts.cover ? "2px dashed var(--warn)" : undefined,
    outlineOffset: -2,
  };
}

export function TimetableScreen({ data, state }: { data: TimetableData; state: TimetableState }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const planned = useMemo(() => applyChanges(data.slots, data.changes), [data.slots, data.changes]);
  const subjectName = useMemo(() => {
    const m = new Map(data.subjects.map((s) => [s.code, s.name]));
    return (code: string) => m.get(code) ?? code;
  }, [data.subjects]);
  const teacherName = useMemo(() => new Map(data.teachers.map((t) => [t.id, t.name])), [data.teachers]);
  const todayName = weekdayOf(data.today);

  const go = (next: Partial<TimetableState>, replace = false) => {
    const url = href({ ...next });
    if (replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  };
  const done = (result: TimetableResult, after?: () => void) => {
    toast.show({ text: tx(result.message), tone: result.ok ? "ok" : "bad" });
    if (result.ok) {
      after?.();
      router.refresh();
    }
  };
  const cover = (input: Omit<CoverInput, "commandId" | "day" | "dayRevision">, after?: () => void) => {
    if (!data.cover) return;
    const c = data.cover;
    start(async () => done(await coverAction({ ...input, commandId: uuid(), day: c.day, dayRevision: c.dayRevision }), after));
  };

  const classId = state.classId ?? data.classes[0]?.id ?? null;
  const teacherId = state.teacherId ?? data.teachers[0]?.id ?? null;
  const awayToday = data.cover?.absences ?? [];
  const needCover = (data.cover?.duties ?? []).filter((d) => d.status === "needs_help");
  const covered = (data.cover?.duties ?? []).filter((d) => d.status === "assigned");

  const tabs = (
    <Seg<TimetableView>
      label="Timetable view"
      value={state.view}
      onChange={(v) => go({ view: v, classId: v === "class" ? classId : null, teacherId: v === "teacher" ? teacherId : null })}
      options={[
        { value: "class", label: tx(p("Class", "कक्षा")) },
        { value: "teacher", label: tx(p("Teacher", "शिक्षक")) },
        ...(data.me.mayViewCover
          ? [
              { value: "subs" as const, label: tx(p("Substitutions", "व्यवस्था")) },
              { value: "leave" as const, label: tx(p("Leave", "छुट्टी")) },
            ]
          : []),
      ]}
      style={{ maxWidth: 560 }}
    />
  );

  const titles: Record<TimetableView, string> = { class: "Timetable", teacher: "Teacher timetable", subs: "Substitutions", leave: "Teacher leave" };
  const header = (
    <TopBar
      crumb={state.view === "subs" ? `Timetable · today ${shortDay(data.today)}` : `Academics · Session ${data.sessionLabel ?? "—"}`}
      title={titles[state.view]}
      mSub={state.view === "subs" ? `${covered.length} of ${covered.length + needCover.length} periods covered` : data.version ? data.version.label : "No timetable published"}
      mBack={state.view === "class" ? "/menu" : "/timetable"}
      actions={
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {state.view === "subs" || state.view === "leave" ? <Btn variant="sec" icon="calendar" href={href({ view: "leave", sheet: "leave" })}>Teacher leave</Btn> : null}
          {data.me.mayEdit && data.changes.length ? (
            <Btn variant="pri" icon="upload" href={href({ view: state.view, classId: state.classId, teacherId: state.teacherId, sheet: "publish" })}>Publish changes ({data.changes.length})</Btn>
          ) : null}
          {data.me.mayEdit ? <Btn variant="ghost" icon="upload" href="/timetable/import">Import</Btn> : null}
          <HelpButton
            title="Timetable"
            steps={[
              { icon: "calendar", title: "The week", body: "Pick a class or a teacher to see their week. Today's row is highlighted." },
              { icon: "edit", title: "Change a period", body: "Tap a period to change it. Changes wait until you publish; teachers still see the old timetable." },
              { icon: "swap", title: "Cover", body: "Substitutions shows who is away today and who covers. Assigning a teacher queues their WhatsApp notice." },
            ]}
          />
        </span>
      }
      mAction={data.me.mayEdit && data.changes.length ? <Btn variant="soft" icon="upload" href={href({ view: state.view, classId: state.classId, teacherId: state.teacherId, sheet: "publish" })}>{data.changes.length}</Btn> : undefined}
    />
  );

  let body: React.ReactNode;
  if (!data.version && (state.view === "class" || state.view === "teacher")) {
    body = (
      <EmptyState
        icon="calendar"
        title="No timetable is published"
        body="Import the timetable sheet and publish it. The week grids, cover and teacher loads all come from it."
        action={data.me.mayEdit ? <Btn variant="pri" icon="upload" href="/timetable/import">Import timetable</Btn> : undefined}
      />
    );
  } else if (state.view === "class" && classId) {
    const cls = data.classes.find((c) => c.id === classId);
    const grid = classGrid(planned, classId);
    const changedHere = new Set(data.changes.filter((c) => c.classId === classId).map((c) => cellKey(c.day, c.period)));
    const coverHere = new Map<number, CoverDutyView>();
    for (const d of data.cover?.duties ?? []) if (cls && d.classLabels.includes(cls.label)) coverHere.set(d.period, d);
    body = (
      <>
        <ChipRow label="Classes">
          {data.classes.map((c) => (
            <Chip key={c.id} on={c.id === classId} onClick={() => go({ view: "class", classId: c.id }, true)}>{c.label}</Chip>
          ))}
        </ChipRow>
        {needCover.length && data.me.mayViewCover ? (
          <Banner tone="warn" action={<Btn variant="ghost" href={href({ view: "subs" })}>Substitutions</Btn>}>
            Today {needCover.map((d) => `P${d.period + 1}`).join(", ")} need cover · {awayToday.map((a) => a.name).join(", ") || "a teacher"} away · {covered.length} of {covered.length + needCover.length} covered
          </Banner>
        ) : null}
        {data.changes.length ? (
          <Banner tone="info" action={data.me.mayEdit ? <Btn variant="ghost" href={href({ view: "class", classId, sheet: "publish" })}>Review</Btn> : undefined}>
            {data.changes.length} {data.changes.length === 1 ? "change is" : "changes are"} not published yet · teachers still see the old timetable
          </Banner>
        ) : null}
        <WeekGrid
          data={data}
          title={<><b>{cls?.label}</b>{cls?.classTeacher ? ` · Class teacher ${cls.classTeacher}` : ""}{data.me.mayEdit ? " · tap a period to change it" : ""}</>}
          todayName={todayName}
          cell={(day, period) => {
            const list = grid.get(cellKey(day, period)) ?? [];
            const key = cellKey(day, period);
            const duty = day === todayName ? coverHere.get(period) : undefined;
            if (list.length === 0) return { body: <span style={{ color: "var(--mut)" }}>—</span>, style: cellStyle("other", { free: true }), onClick: data.me.mayEdit ? () => go({ view: "class", classId, cell: { day, period } }) : undefined };
            const first = list[0];
            return {
              body: (
                <>
                  <b className="clip" style={{ display: "block" }}>{list.length > 1 ? list.map((s) => subjectName(s.subjectCode)).join(" / ") : subjectName(first.subjectCode)}</b>
                  <span className="clip" style={{ display: "block", fontSize: 12, color: "var(--mut)" }}>
                    {duty ? (duty.status === "assigned" ? `Sub: ${duty.coveringName ?? "—"}` : "Needs cover") : list.map((s) => teacherName.get(s.staffProfileId) ?? s.teacherShortName).join(", ")}
                  </span>
                </>
              ),
              style: cellStyle(subjectFamily(first.subjectCode), { pending: changedHere.has(key), cover: Boolean(duty) }),
              dot: changedHere.has(key),
              onClick: data.me.mayEdit ? () => go({ view: "class", classId, cell: { day, period } }) : undefined,
            };
          }}
          legend
          subjectsUsed={[...new Set([...grid.values()].flat().map((s) => subjectFamily(s.subjectCode)))]}
        />
      </>
    );
  } else if (state.view === "teacher" && teacherId) {
    const grid = teacherGrid(planned, teacherId);
    const load = teacherLoad(planned, teacherId);
    const t = data.teachers.find((x) => x.id === teacherId);
    const onLeave = data.leave.find((l) => l.staffId === teacherId && l.status === "approved" && l.to >= data.today);
    const subjects = [...new Set([...grid.values()].flat().map((s) => subjectName(s.subjectCode)))];
    const coverToday = new Map((data.cover?.duties ?? []).filter((d) => d.coveringStaffId === teacherId).map((d) => [d.period, d]));
    body = (
      <>
        <ChipRow label="Teachers">
          {data.teachers.map((x) => (
            <Chip key={x.id} on={x.id === teacherId} onClick={() => go({ view: "teacher", teacherId: x.id }, true)}>{x.name}</Chip>
          ))}
        </ChipRow>
        {onLeave ? (
          <Banner tone="warn" action={data.me.mayViewCover ? <Btn variant="ghost" href={href({ view: "subs" })}>Cover today</Btn> : undefined}>
            {onLeave.name} is on leave {dayMonth(onLeave.from)} – {dayMonth(onLeave.to)}{onLeave.note ? ` · ${onLeave.note}` : ""}
          </Banner>
        ) : null}
        <Grid cols={2}>
          <Card style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Ring value={load.total} max={48} size={72} stroke={8}>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
                <span style={{ fontSize: 20 }}>{load.total}</span>
                <span style={{ fontSize: 10, color: "var(--mut)" }}>of 48</span>
              </span>
            </Ring>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <b>{load.total} periods a week · {load.free} free</b>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>Free periods are dashed below. Most in a day: {load.most}.</span>
              <span style={{ display: "flex", gap: 10, alignItems: "flex-end", height: 44 }}>
                {WEEK.map((d, i) => (
                  <span key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
                    <span style={{ width: "100%", maxWidth: 28, height: `${Math.max(4, (load.perDay[i] / 8) * 32)}px`, borderRadius: 4, background: d === todayName ? "var(--acc)" : "hsl(180 40% 45% / .7)" }} title={`${load.perDay[i]} periods`} />
                    <span style={{ fontSize: 11, color: "var(--mut)" }}>{WEEK_SHORT[d].slice(0, 2)}</span>
                  </span>
                ))}
              </span>
            </span>
          </Card>
          <Card>
            <CardHead title={`Subs taken this week · ${data.subsThisWeek[teacherId] ?? 0}`} sub={(data.subsThisWeek[teacherId] ?? 0) ? "Cover periods assigned to them since Monday." : "No cover periods taken this week."} />
          </Card>
        </Grid>
        <WeekGrid
          data={data}
          title={<><b>{t?.name}</b>{subjects.length ? ` · Teaches ${subjects.slice(0, 3).join(", ")}` : ""} · {load.total} periods a week</>}
          todayName={todayName}
          cell={(day, period) => {
            const list = grid.get(cellKey(day, period)) ?? [];
            const duty = day === todayName ? coverToday.get(period) : undefined;
            if (duty) {
              return { body: <><b className="clip" style={{ display: "block" }}>{duty.classLabels.join(", ")}</b><span style={{ fontSize: 12, color: "var(--mut)" }}>Covering · {subjectName(duty.subjectCode)}</span></>, style: cellStyle(subjectFamily(duty.subjectCode), { cover: true }) };
            }
            if (list.length === 0) return { body: <><b style={{ display: "block" }}>Free</b><span style={{ fontSize: 12, color: "var(--mut)" }}>{WEEK_SHORT[day]} P{period + 1}</span></>, style: cellStyle("other", { free: true }) };
            return {
              body: (
                <>
                  <b className="clip" style={{ display: "block" }}>{[...new Set(list.map((s) => s.classLabel))].join(", ")}</b>
                  <span className="clip" style={{ display: "block", fontSize: 12, color: "var(--mut)" }}>{subjectName(list[0].subjectCode)}</span>
                </>
              ),
              style: cellStyle(subjectFamily(list[0].subjectCode)),
              onClick: data.me.mayEdit ? () => go({ view: "class", classId: list[0].classId, cell: { day, period } }) : undefined,
            };
          }}
        />
      </>
    );
  } else if (state.view === "subs") {
    body = <Subs data={data} pending={pending} subjectName={subjectName} onCover={cover} onAssign={(needKey) => go({ view: "subs", duty: needKey })} />;
  } else if (state.view === "leave") {
    body = <Leave data={data} pending={pending} onAdd={() => go({ view: "leave", sheet: "leave" })} onDecide={(id, approve) => start(async () => done(await decideLeaveAction({ id, approve })))} />;
  } else {
    body = <EmptyState icon="calendar" title="Nothing to show" body="No classes or teachers in this session's timetable yet." />;
  }

  // Sheets: edit (with clash), assign, leave, publish.
  const editCell = state.cell && classId && state.view === "class" ? state.cell : null;
  const duty = state.duty ? (data.cover?.duties ?? []).find((d) => d.needKey === state.duty) ?? null : null;
  const close = () => go({ view: state.view, classId: state.classId, teacherId: state.teacherId }, true);

  return (
    <VxPage>
      {header}
      <main>
        <Section>
          {tabs}
          {body}
        </Section>
      </main>
      {editCell && classId ? (
        <EditSheet
          key={`${editCell.day}-${editCell.period}-${state.pick ?? ""}`}
          data={data}
          planned={planned}
          classId={classId}
          day={editCell.day}
          period={editCell.period}
          initialPick={state.pick}
          subjectName={subjectName}
          pending={pending}
          onClose={close}
          onSave={(subjectId, staffProfileId) => start(async () => done(await saveChangeAction({ day: editCell.day, period: editCell.period, classId, subjectId, staffProfileId }), close))}
        />
      ) : null}
      <AssignSheet
        duty={duty}
        pending={pending}
        subjectName={subjectName}
        onClose={() => go({ view: "subs" }, true)}
        onAssign={(needKey, staffId) => cover({ intent: "assign", needKey, coveringStaffId: staffId }, () => go({ view: "subs" }, true))}
      />
      {data.me.mayViewCover ? (
        <LeaveSheet
          open={state.sheet === "leave"}
          data={data}
          pending={pending}
          onClose={() => go({ view: "leave" }, true)}
          onSave={(input) => start(async () => done(await requestLeaveAction(input), () => go({ view: "leave" }, true)))}
        />
      ) : null}
      {data.me.mayEdit ? (
        <PublishSheet
          open={state.sheet === "publish"}
          changes={data.changes}
          slots={data.slots}
          teacherName={teacherName}
          subjectName={subjectName}
          version={data.version}
          pending={pending}
          onClose={close}
          onRemove={(id) => start(async () => done(await discardChangeAction(id)))}
          onPublish={(notify) => start(async () => done(await publishChangesAction({ notify }), close))}
        />
      ) : null}
    </VxPage>
  );
}

/* ---------------------------------------------------------------- week grid */

type CellView = { body: React.ReactNode; style: React.CSSProperties; dot?: boolean; onClick?: () => void };

function WeekGrid({
  data,
  title,
  todayName,
  cell,
  legend,
  subjectsUsed = [],
}: {
  data: TimetableData;
  title: React.ReactNode;
  todayName: Weekday | null;
  cell: (day: Weekday, period: number) => CellView;
  legend?: boolean;
  subjectsUsed?: SubjectFamily[];
}) {
  const { tx } = useVx();
  const [phoneDay, setPhoneDay] = useState<Weekday>(todayName ?? "Monday");
  const bell = (i: number) => data.bells.find((b) => b.index === i);
  const tile = (c: CellView, key: string) => {
    const inner = (
      <>
        {c.body}
        {c.dot ? <span style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: 4, background: "var(--acc)" }} /> : null}
      </>
    );
    const st: React.CSSProperties = { ...c.style, position: "relative", minHeight: 56, padding: "8px 10px", textAlign: "left", minWidth: 0, color: "var(--fg)", fontSize: 13 };
    return c.onClick ? (
      <button key={key} type="button" className="tap" onClick={c.onClick} style={{ ...st, border: c.style.border ?? 0, cursor: "pointer" }}>{inner}</button>
    ) : (
      <div key={key} style={st}>{inner}</div>
    );
  };

  return (
    <Card pad={false} style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "14px 16px", flexWrap: "wrap", fontSize: 13 }}>
        <span>{title}</span>
        {legend ? (
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap", color: "var(--mut)" }} className="hide-m">
            {subjectsUsed.map((f) => (
              <span key={f} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: `hsl(${FAMILY_HUES[f]} 45% 42%)` }} />
                {tx(FAMILY_LABELS[f])}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <div className="only-d" style={{ overflowX: "auto", padding: "0 12px 14px" }}>
        <div role="grid" style={{ display: "grid", gridTemplateColumns: `64px repeat(${BREAK_AFTER + 1}, minmax(96px,1fr)) 18px repeat(${PERIODS.length - BREAK_AFTER - 1}, minmax(96px,1fr))`, gap: 6, minWidth: 900 }}>
          <span />
          {PERIODS.map((i) => (
            <span key={`h${i}`} style={{ display: "contents" }}>
              <span role="columnheader" style={{ textAlign: "center", fontSize: 12 }}>
                <b>P{i + 1}</b>
                <span style={{ display: "block", color: "var(--mut)" }}>{bell(i)?.starts ?? ""}</span>
              </span>
              {i === BREAK_AFTER ? <span style={{ writingMode: "vertical-rl", fontSize: 10, color: "var(--mut)", alignSelf: "center" }}>Lunch</span> : null}
            </span>
          ))}
          {WEEK.map((day, di) => (
            <span key={day} style={{ display: "contents" }}>
              <span role="rowheader" style={{ display: "flex", flexDirection: "column", justifyContent: "center", fontSize: 13, color: day === todayName ? "var(--accfg)" : undefined, fontWeight: day === todayName ? 700 : 500 }}>
                {WEEK_SHORT[day]}
                <span style={{ fontSize: 11, color: "var(--mut)", fontWeight: 400 }}>{dayMonth(data.week[di])}</span>
              </span>
              {PERIODS.map((period) => (
                <span key={period} style={{ display: "contents" }}>
                  {tile(cell(day, period), `${day}${period}`)}
                  {period === BREAK_AFTER ? <span aria-hidden="true" style={{ borderRadius: 6, background: "repeating-linear-gradient(135deg, var(--s3) 0 4px, transparent 4px 8px)" }} /> : null}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
      <div className="only-m" style={{ padding: "0 12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <DateChips days={WEEK.map((d, i) => ({ value: d, label: WEEK_SHORT[d], sub: dayMonth(data.week[i]) }))} value={phoneDay} onChange={(v) => setPhoneDay(v as Weekday)} />
        {PERIODS.map((period) => (
          <div key={period} style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1fr)", gap: 8, alignItems: "stretch" }}>
            <span style={{ display: "flex", flexDirection: "column", justifyContent: "center", fontSize: 12 }}>
              <b>P{period + 1}</b>
              <span style={{ color: "var(--mut)" }}>{bell(period)?.starts}</span>
            </span>
            {tile(cell(phoneDay, period), `m${period}`)}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- edit sheet */

function EditSheet({
  data,
  planned,
  classId,
  day,
  period,
  initialPick,
  subjectName,
  pending,
  onClose,
  onSave,
}: {
  data: TimetableData;
  planned: Slot[];
  classId: string;
  day: Weekday;
  period: number;
  initialPick: string | null;
  subjectName: (code: string) => string;
  pending: boolean;
  onClose: () => void;
  onSave: (subjectId: string, staffId: string) => void;
}) {
  const cls = data.classes.find((c) => c.id === classId);
  const now = planned.filter((s) => s.classId === classId && s.day === day && s.period === period);
  const classSubjects = useMemo(() => {
    const ids = new Set(planned.filter((s) => s.classId === classId).map((s) => s.subjectId));
    return data.subjects.filter((s) => ids.has(s.id));
  }, [planned, classId, data.subjects]);
  const [subjectId, setSubjectId] = useState<string>(now[0]?.subjectId ?? classSubjects[0]?.id ?? data.subjects[0]?.id ?? "");
  const [staffId, setStaffId] = useState<string>(initialPick ?? now[0]?.staffProfileId ?? "");
  const [showAll, setShowAll] = useState(false);
  const subjectTeachers = teachersOf(planned, subjectId);
  const others = planned.filter((s) => !(s.classId === classId && s.day === day && s.period === period));
  const free = new Set(freeAt(others, data.teachers.map((t) => t.id), day, period));
  const ordered = [...data.teachers].sort((a, b) => Number(subjectTeachers.has(b.id)) - Number(subjectTeachers.has(a.id)) || Number(free.has(b.id)) - Number(free.has(a.id)) || a.name.localeCompare(b.name));
  const shown = showAll ? ordered : ordered.filter((t) => subjectTeachers.has(t.id) || t.id === staffId).slice(0, 8);
  const clash = staffId ? clashFor(others, { day, period, classId, staffProfileId: staffId }) : null;
  const firstFree = ordered.find((t) => subjectTeachers.has(t.id) && free.has(t.id) && t.id !== staffId);
  const nameOf = (id: string) => data.teachers.find((t) => t.id === id)?.name ?? "—";
  const bell = data.bells.find((b) => b.index === period);
  const unchanged = now.length === 1 && now[0].subjectId === subjectId && now[0].staffProfileId === staffId;

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={`${cls?.label ?? "Class"} · ${WEEK_SHORT[day]} · P${period + 1}`}
      sub={`${bell ? `${bell.starts}–${bell.ends}` : ""} · now: ${now.length ? now.map((s) => `${subjectName(s.subjectCode)} · ${s.teacherShortName}`).join(", ") : "free"}`}
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="sec" full onClick={onClose}>Cancel</Btn>
          <Btn variant="pri" full icon="check" disabled={pending || !subjectId || !staffId || Boolean(clash) || unchanged} onClick={() => onSave(subjectId, staffId)}>Save change</Btn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Subject">
          <ChipRow label="Subject" style={{ flexWrap: "wrap" }}>
            {(classSubjects.length ? classSubjects : data.subjects).map((s) => (
              <Chip key={s.id} on={s.id === subjectId} onClick={() => setSubjectId(s.id)}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: `hsl(${FAMILY_HUES[subjectFamily(s.code)]} 45% 42%)` }} />
                {s.name}
              </Chip>
            ))}
          </ChipRow>
        </Field>
        <Field label="Teacher">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }} role="radiogroup">
            {shown.map((t) => {
              const busy = clashFor(others, { day, period, classId, staffProfileId: t.id });
              return (
                <RadioCard
                  key={t.id}
                  checked={staffId === t.id}
                  onSelect={() => setStaffId(t.id)}
                  title={t.name}
                  sub={subjectTeachers.has(t.id) ? `Teaches ${subjectName(data.subjects.find((s) => s.id === subjectId)?.code ?? "")}` : "Another subject"}
                  trail={busy ? <Pill tone="warn">Busy · {busy.classLabel}</Pill> : <Pill tone="ok">Free</Pill>}
                />
              );
            })}
            {!showAll ? <Btn variant="ghost" onClick={() => setShowAll(true)}>Show every teacher</Btn> : null}
          </div>
        </Field>
        {clash ? (
          <div style={{ background: "var(--warns)", color: "var(--warnfg)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <b><Ic n="alert" size={16} /> {nameOf(staffId)} already teaches {clash.classLabel} in P{period + 1} on {WEEK_SHORT[day]}</b>
            <span>Pick a free teacher, or keep the period as it was.</span>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {firstFree ? <Btn variant="sec" onClick={() => setStaffId(firstFree.id)}>Use {firstFree.name} · free</Btn> : null}
              {now[0] ? (
                <Btn variant="sec" onClick={() => { setSubjectId(now[0].subjectId); setStaffId(now[0].staffProfileId); }}>
                  Keep {subjectName(now[0].subjectCode)} · {nameOf(now[0].staffProfileId)}
                </Btn>
              ) : null}
            </span>
          </div>
        ) : null}
        <span style={{ fontSize: 12, color: "var(--mut)" }}>Rooms are not kept in the timetable yet, so a period keeps its class&apos;s room.</span>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- substitutions */

function Subs({
  data,
  pending,
  subjectName,
  onCover,
  onAssign,
}: {
  data: TimetableData;
  pending: boolean;
  subjectName: (code: string) => string;
  onCover: (input: Omit<CoverInput, "commandId" | "day" | "dayRevision">, after?: () => void) => void;
  onAssign: (needKey: string) => void;
}) {
  const c = data.cover;
  const [awayId, setAwayId] = useState("");
  const [awaySpan, setAwaySpan] = useState<LeaveSpan>("full");
  const [choice, setChoice] = useState<Record<string, string>>({});
  if (!c) return <EmptyState icon="swap" title="Cover is not open to you" body="Ask the office who is covering." />;
  const live = c.duties;
  const assigned = live.filter((d) => d.status === "assigned").length;
  const nowPeriod = (() => {
    const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    return data.bells.find((b) => b.starts <= t && t < b.ends)?.index ?? -1;
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!c.hasTimetable ? <Banner tone="warn">No published timetable covers {shortDay(c.day)}, so there is nothing to arrange.</Banner> : null}
      <Grid cols={2}>
        <Card>
          <SecHead>Away today · {shortDay(c.day)}</SecHead>
          {c.absences.length === 0 ? <p style={{ color: "var(--mut)", margin: "8px 0 0" }}>Nobody is marked away.</p> : null}
          {c.absences.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
              <Avatar text={initials(a.name)} seed={a.name} size={36} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <b>{a.name}</b>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{a.periods.length >= 8 ? "Whole day" : `P${a.periods.map((x) => x + 1).join(", P")}`}{a.reason ? ` · ${a.reason}` : ""}</span>
              </span>
              <Pill tone="warn">{live.filter((d) => d.absentNames.includes(a.name)).length} periods</Pill>
              {c.canCommand ? <Btn variant="ghost" disabled={pending} onClick={() => onCover({ intent: "clear_absence", staffProfileId: a.staffId })}>Back</Btn> : null}
            </div>
          ))}
          {c.canCommand ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--bd)", paddingTop: 10, marginTop: 4 }}>
              <Select value={awayId} onChange={(e) => setAwayId(e.target.value)} style={{ flex: 1, minWidth: 160 }} aria-label="Teacher away">
                <option value="">Mark a teacher away…</option>
                {c.staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
              <Select value={awaySpan} onChange={(e) => setAwaySpan(e.target.value as LeaveSpan)} aria-label="Which periods">
                <option value="full">Whole day</option>
                <option value="first_half">P1–P4</option>
                <option value="second_half">P5–P8</option>
              </Select>
              <Btn variant="pri" icon="check" disabled={pending || !awayId} onClick={() => onCover({ intent: "absence", staffProfileId: awayId, periods: spanPeriods(awaySpan) }, () => setAwayId(""))}>Save & arrange</Btn>
            </div>
          ) : null}
        </Card>
        <Card style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Ring value={assigned} max={Math.max(1, live.length)} size={80} stroke={9} tone="var(--ok)">
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.1 }}>
              <span style={{ fontSize: 18 }}>{assigned}/{live.length}</span>
              <span style={{ fontSize: 10, color: "var(--mut)" }}>covered</span>
            </span>
          </Ring>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <b>{assigned} of {live.length} periods covered</b>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{live.length - assigned ? `${live.length - assigned} still need a teacher · best matches are first` : live.length ? "Everyone has a teacher" : "No period needs cover"}</span>
          </span>
        </Card>
      </Grid>
      {live.map((d) => {
        const bell = data.bells.find((b) => b.index === d.period);
        const best = d.candidates.find((x) => !x.blocked);
        const picked = choice[d.needKey] ?? (d.status === "assigned" ? d.coveringStaffId : best?.id) ?? "";
        const pickedName = d.candidates.find((x) => x.id === picked)?.name;
        return (
          <Card key={d.id} pad={false} style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 16px" }}>
              <span style={{ width: 52, height: 52, borderRadius: 12, background: d.status === "assigned" ? "var(--oks)" : "var(--warns)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <b>P{d.period + 1}</b>
                <span style={{ fontSize: 11 }}>{bell?.starts}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <b className="clip">{d.classLabels.join(", ")} · {subjectName(d.subjectCode)}</b>
                <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{d.absentNames.join(", ")} away</span>
              </span>
              {d.period === nowPeriod ? <Pill tone="ok">Now</Pill> : null}
              {d.status === "assigned" ? <span style={{ color: "var(--ok)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}><Ic n="check" size={16} /> Covered by {d.coveringName}</span> : null}
            </div>
            {d.status === "assigned" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderTop: "1px solid var(--bd)", fontSize: 13, color: "var(--mut)", flexWrap: "wrap" }}>
                <span style={{ flex: 1 }}>{d.coveringName} — {d.notice === "read" ? "read the WhatsApp notice" : d.notice === "delivered" || d.notice === "accepted" ? "told on WhatsApp" : d.notice === "failed" ? "the notice failed — call them" : d.notice ? "notice queued" : "no notice yet"}</span>
                {c.canCommand ? (
                  <>
                    <Btn variant="ghost" onClick={() => onAssign(d.needKey)}>Change</Btn>
                    <Btn variant="ghost" disabled={pending} onClick={() => onCover({ intent: "release", needKey: d.needKey })}>Release</Btn>
                  </>
                ) : null}
              </div>
            ) : (
              <div style={{ borderTop: "1px solid var(--bd)", padding: "8px 16px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                {d.reason ? <span style={{ fontSize: 13, color: "var(--warnfg)", padding: "4px 0" }}>{d.reason.en}</span> : null}
                {c.canCommand ? (
                  <>
                    <div role="radiogroup" style={{ display: "flex", flexDirection: "column" }}>
                      {d.candidates.filter((x) => !x.blocked).slice(0, 3).map((x, i) => (
                        <label key={x.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: i ? "1px solid var(--bd)" : 0, cursor: "pointer" }}>
                          <input type="radio" name={`c-${d.id}`} checked={picked === x.id} onChange={() => setChoice((m) => ({ ...m, [d.needKey]: x.id }))} />
                          <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                            <b>{x.name}</b>
                            <span style={{ fontSize: 12, color: "var(--mut)" }}>Free in P{d.period + 1} · {x.detail} · {x.subsThisWeek} subs this week</span>
                          </span>
                          {i === 0 ? <Pill tone="ok">Best match</Pill> : null}
                        </label>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                      <Btn variant="pri" icon="send" disabled={pending || !picked} onClick={() => onCover({ intent: "assign", needKey: d.needKey, coveringStaffId: picked })}>Assign {pickedName ?? ""}</Btn>
                      <Btn variant="ghost" onClick={() => onAssign(d.needKey)}>See all {d.candidates.filter((x) => !x.blocked).length} free teachers</Btn>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>1 WhatsApp · {rupees(0.88)}</span>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </Card>
        );
      })}
      {live.length === 0 && c.hasTimetable ? <EmptyState icon="checkCircle" title="No cover needed today" body="Mark a teacher away above and the periods they leave appear here with the best teachers to cover." /> : null}
      <Link href={`/substitutions?day=${c.day}`} style={{ fontSize: 13, color: "var(--mut)" }}>Open the classic cover screen →</Link>
    </div>
  );
}

function AssignSheet({ duty, pending, subjectName, onClose, onAssign }: { duty: CoverDutyView | null; pending: boolean; subjectName: (code: string) => string; onClose: () => void; onAssign: (needKey: string, staffId: string) => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  if ((duty?.needKey ?? null) !== seen) {
    setSeen(duty?.needKey ?? null);
    setPick(duty?.coveringStaffId ?? duty?.candidates.find((c) => !c.blocked)?.id ?? null);
  }
  const name = duty?.candidates.find((c) => c.id === pick)?.name;
  return (
    <Sheet
      open={Boolean(duty)}
      onClose={onClose}
      title={duty ? `Cover P${duty.period + 1} · ${duty.classLabels.join(", ")}` : "Cover"}
      sub={duty ? `${subjectName(duty.subjectCode)} · ${duty.absentNames.join(", ")} is away` : undefined}
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="sec" full onClick={onClose}>Cancel</Btn>
          <Btn variant="pri" full icon="check" disabled={pending || !pick || !duty} onClick={() => duty && pick && onAssign(duty.needKey, pick)}>Assign {name ?? ""}</Btn>
        </div>
      }
    >
      {duty ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="radiogroup">
          <SecHead>Free in P{duty.period + 1} · best first</SecHead>
          {duty.candidates.length === 0 ? <EmptyState icon="users" title="Nobody to offer" body="Cover is managed by the coordinator." /> : null}
          {duty.candidates.map((c, i) => (
            <RadioCard
              key={c.id}
              checked={pick === c.id}
              onSelect={() => !c.blocked && setPick(c.id)}
              title={c.name}
              sub={`${c.blocked ? "Not available" : `Free in P${duty.period + 1}`} · ${c.detail} · ${c.subsThisWeek} subs this week`}
              trail={i === 0 && !c.blocked ? <Pill tone="ok">Best match</Pill> : c.blocked ? <Pill tone="mut">Busy</Pill> : undefined}
            />
          ))}
        </div>
      ) : null}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- leave */

function Leave({ data, pending, onAdd, onDecide }: { data: TimetableData; pending: boolean; onAdd: () => void; onDecide: (id: string, approve: boolean) => void }) {
  const waiting = data.leave.filter((l) => l.status === "asked");
  const approved = data.leave.filter((l) => l.status === "approved");
  const awayOn = (day: string) => data.leave.filter((l) => l.from <= day && day <= l.to);
  const row = (l: LeaveView, actions: boolean) => {
    const periods = periodsNeedingCover(data.slots, l.staffId, l.from, l.to, l.span);
    const days = schoolDays(l.from, l.to).length;
    return (
      <Card key={l.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <Avatar text={initials(l.name)} seed={l.name} size={40} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <b>{l.name} · {l.from === l.to ? shortDay(l.from) : `${shortDay(l.from)} – ${shortDay(l.to)}`}</b>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{days} {l.span === "full" ? `full ${days === 1 ? "day" : "days"}` : SPAN_LABELS[l.span].en.toLowerCase()}{l.note ? ` · ${l.note}` : ""} · asked {dayMonth(l.createdAt)}</span>
            <span style={{ fontSize: 13, color: "var(--warnfg)" }}>{periods} {periods === 1 ? "period" : "periods"} will need cover</span>
          </span>
          {!actions ? <Pill tone="ok">Approved</Pill> : null}
        </div>
        {actions && data.me.mayCover ? (
          <div style={{ display: "flex", gap: 10 }}>
            <Btn variant="ghost" full disabled={pending} onClick={() => onDecide(l.id, false)}>Decline</Btn>
            <Btn variant="pri" full icon="check" disabled={pending} onClick={() => onDecide(l.id, true)}>Approve</Btn>
          </div>
        ) : null}
      </Card>
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <CardHead title={`Who is away · ${dayMonth(data.week[0])}–${dayMonth(data.week[5])}`} action={<Btn variant="soft" icon="plus" onClick={onAdd}>Add</Btn>} />
        <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 8, marginTop: 10 }}>
          {data.week.map((day) => {
            const list = awayOn(day);
            const isToday = day === data.today;
            return (
              <div key={day} style={{ border: `1.5px solid ${isToday ? "var(--acc)" : "var(--bd)"}`, background: isToday ? "var(--accs)" : "transparent", borderRadius: 12, padding: 8, minHeight: 84, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{WEEK_SHORT[weekdayOf(day) ?? "Monday"]}</span>
                <b style={{ fontSize: 18 }}>{Number(day.slice(8))}</b>
                <span style={{ display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center" }}>
                  {list.map((l) => (
                    <span key={l.id} title={`${l.name} · ${l.status}`} style={{ opacity: l.status === "asked" ? 0.6 : 1, outline: l.status === "asked" ? "1.5px dashed var(--warn)" : undefined, borderRadius: 12 }}>
                      <Avatar text={initials(l.name)} seed={l.name} size={24} />
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
        <span style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--mut)", marginTop: 8 }}>
          <span>● Approved</span>
          <span>◌ Asked</span>
        </span>
      </Card>
      <SecHead>{data.me.mayCover ? `Waiting for you · ${waiting.length}` : `Asked · ${waiting.length}`}</SecHead>
      {waiting.length === 0 ? <EmptyState icon="calendar" title="Nothing waiting" body="Leave a teacher asks for shows up here to approve." /> : null}
      {waiting.map((l) => row(l, true))}
      {approved.length ? <SecHead>Approved</SecHead> : null}
      {approved.map((l) => row(l, false))}
    </div>
  );
}

function LeaveSheet({ open, data, pending, onClose, onSave }: { open: boolean; data: TimetableData; pending: boolean; onClose: () => void; onSave: (input: { staffId: string; from: string; to: string; span: string; note?: string }) => void }) {
  const { tx } = useVx();
  const [staffId, setStaffId] = useState(data.me.mayCover ? "" : data.me.id);
  const [from, setFrom] = useState(data.today);
  const [to, setTo] = useState(data.today);
  const [span, setSpan] = useState<LeaveSpan>("full");
  const [note, setNote] = useState("");
  const problems = leaveProblems({ staffId, from, to });
  const periods = staffId && !problems.length ? periodsNeedingCover(data.slots, staffId, from, to, span) : 0;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Teacher leave"
      sub="Approved leave marks the teacher away and arranges cover for each day."
      icon="calendar"
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="sec" full onClick={onClose}>Cancel</Btn>
          <Btn variant="pri" full icon="check" disabled={pending || problems.length > 0} onClick={() => onSave({ staffId, from, to, span, note })}>Ask for leave</Btn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data.me.mayCover ? (
          <Field label="Teacher">
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Pick a teacher…</option>
              {data.teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Grid cols={2}>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </Grid>
        <Field label="Which periods">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }} role="radiogroup">
            {(["full", "first_half", "second_half"] as LeaveSpan[]).map((s) => (
              <RadioCard key={s} checked={span === s} onSelect={() => setSpan(s)} title={tx(SPAN_LABELS[s])} />
            ))}
          </div>
        </Field>
        <Field label="Note (optional)" hint="Kept for the office. Never sent in a notice.">
          <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Family wedding" />
        </Field>
        {problems.length ? <span style={{ fontSize: 13, color: "var(--warnfg)" }}>{tx(LEAVE_PROBLEMS[problems[0]])}</span> : <span style={{ fontSize: 13, color: "var(--mut)" }}>{periods} {periods === 1 ? "period" : "periods"} will need cover.</span>}
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- publish */

function PublishSheet({
  open,
  changes,
  slots,
  teacherName,
  subjectName,
  version,
  pending,
  onClose,
  onRemove,
  onPublish,
}: {
  open: boolean;
  changes: PendingChange[];
  slots: Slot[];
  teacherName: Map<string, string>;
  subjectName: (code: string) => string;
  version: { id: string; label: string } | null;
  pending: boolean;
  onClose: () => void;
  onRemove: (id: string) => void;
  onPublish: (notify: boolean) => void;
}) {
  const [notify, setNotify] = useState(true);
  const affected = affectedTeachers(changes, slots);
  const [firstId, firstList] = [...affected.entries()][0] ?? [null, []];
  const preview = firstId ? changeNotice(teacherName.get(firstId) ?? "teacher", firstList, subjectName) : null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Publish changes"
      sub={`${changes.length} waiting · ${version ? `${version.label} is live` : "no live version"}`}
      icon="upload"
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="sec" full onClick={onClose}>Not yet</Btn>
          <Btn variant="pri" full icon="upload" disabled={pending || changes.length === 0} onClick={() => onPublish(notify)}>{pending ? "Publishing…" : `Publish ${changes.length} ${changes.length === 1 ? "change" : "changes"}`}</Btn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card pad={false} style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", gap: 8 }}>
            <SecHead>Changes not published · {changes.length}</SecHead>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>Teachers still see the old timetable</span>
          </div>
          {changes.length === 0 ? <EmptyState icon="checkCircle" title="Nothing waiting" /> : null}
          {changes.map((c) => (
            <div key={c.id} style={{ padding: "12px 16px", borderTop: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 6 }}>
              <b>{c.classLabel} · {WEEK_SHORT[c.day as Weekday] ?? c.day} P{c.period + 1}</b>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                <span style={{ textDecoration: "line-through", color: "var(--mut)", padding: "2px 8px", borderRadius: 8, background: "var(--s2)" }}>{c.fromSubjectCode ? `${subjectName(c.fromSubjectCode)} · ${c.fromTeacher}` : "Free"}</span>
                <Ic n="arrowRight" size={14} />
                <span style={{ fontWeight: 600, padding: "2px 8px", borderRadius: 8, background: "var(--accs)" }}>{subjectName(c.subjectCode)} · {teacherName.get(c.staffProfileId) ?? c.teacherShortName}</span>
              </span>
              <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--mut)" }}>
                <span>{c.createdBy ?? ""} · {shortDay(c.createdAt)}</span>
                <button type="button" className="tap icon-btn" aria-label="Remove this change" disabled={pending} onClick={() => onRemove(c.id)} style={{ width: 32, height: 32, borderRadius: 16 }}>
                  <Ic n="x" size={16} />
                </button>
              </span>
            </div>
          ))}
        </Card>
        <Card>
          <SecHead>Starts from</SecHead>
          <p style={{ margin: "6px 0 0", fontSize: 14 }}>As soon as you publish. The new version replaces the live one and today&apos;s cover is worked out against it.</p>
        </Card>
        <Card style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <b>Tell affected teachers on WhatsApp</b>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{affected.size} teachers · {affected.size} messages · {rupees(affected.size * 0.88)} · queued in the staff outbox</span>
          </span>
          <Switch on={notify} onChange={setNotify} label="Tell teachers" />
        </Card>
        {notify && preview ? (
          <div>
            <SecHead>Preview · to {teacherName.get(firstId as string) ?? "teacher"}</SecHead>
            <WhatsAppPreview lines={[preview.hi, "", preview.en]} />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
