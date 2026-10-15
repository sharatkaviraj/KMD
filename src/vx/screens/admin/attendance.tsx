"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";

import { remindTeachersVx, saveRegisterVx } from "@/app/(app)/attendance/actions";
import { clock, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { BackLink } from "@/vx/ui/back-link";
import { Input, Seg } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { TopBar } from "@/vx/ui/page";
import { Btn, EmptyState, Ring } from "@/vx/ui/primitives";
import {
  boardSummary,
  classPercent,
  classState,
  filterBoard,
  initialMarks,
  markCounts,
  remindable,
  type BoardFilter,
  type ClassBoardRow,
  type MarkStatus,
} from "@/vx/screens/admin/logic";
import { TO } from "@/vx/screens/admin/ops-text";
import { T } from "@/vx/screens/admin/text";
import type { BoardData, SheetData } from "@/vx/screens/admin/types";
import type { Pair } from "@/vx/text";

/*
 * The attendance board (design F11/D04) and marking a class on the class
 * teacher's behalf (F12). On a desk the classes are cards beside a panel; on a
 * phone they are a list, and marking opens as a bottom sheet over it.
 *
 * The register opens with everyone present when nothing is saved yet
 * (RULES C, UI-22), a class counts only once it is saved, and the save is the
 * same atomic register command a teacher's screen uses.
 */

type Focus = "explicit" | "default" | null;

export function AttendanceScreen({
  board,
  sheet,
  focus,
  filter: initialFilter,
  dayLine,
  previewing,
  canMark,
}: {
  board: BoardData;
  sheet: SheetData | null;
  /** How the sheet's class was picked: by the person (`?class=`), or by the page for the desk's panel. */
  focus: Focus;
  /** `null` until the person picks one: the desk then shows every class and the phone the ones not marked. */
  filter: BoardFilter | null;
  dayLine: string;
  previewing: boolean;
  canMark: boolean;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [filter, setFilter] = useState<BoardFilter | null>(initialFilter);
  const [busy, startBusy] = useTransition();
  const summary = boardSummary(board.rows, board.halfDayCredit);
  const sendable = remindable(board.rows);
  const allowed = canMark && board.schoolOpen;

  // The desk's panel is hidden below 900px of page width; then marking is the phone's sheet.
  const deskPanel = useRef<HTMLElement>(null);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const el = deskPanel.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setPhone(entry.contentRect.width === 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const remind = (classIds: string[]) => {
    if (previewing) return toast.show({ text: tx(T.previewing), tone: "info" });
    startBusy(async () => {
      const result = await remindTeachersVx(classIds);
      toast.show({ text: result.ok ? tx(T.reminded(result.queued)) : tx(result.message ?? T.failed), tone: result.ok ? "ok" : "bad" });
      router.refresh();
    });
  };

  const keep = filter ? `f=${filter}` : "";
  const hrefFor = (classId: string) => `/attendance?class=${classId}${keep ? `&${keep}` : ""}`;
  const boardHref = `/attendance${keep ? `?${keep}` : ""}`;
  const selectedRow = sheet ? board.rows.find((row) => row.classId === sheet.classId) : undefined;

  const closed = !board.schoolOpen ? (
    <div className="card">
      <EmptyState icon="calendar" title={tx(T.schoolClosed)} body={tx(T.closedToday)} />
    </div>
  ) : null;

  /* ---------------------------------------------------------------- desk */
  const deskFilter = filter ?? "all";
  const desk = (
    <div className="only-d" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(340px, 420px)", gap: 24, padding: "22px 28px 40px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {closed}
        <div className="card" style={{ padding: "18px 20px", display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
          <Ring value={summary.marked} max={Math.max(1, summary.total)} size={92} stroke={10}>
            <RingLabel marked={summary.marked} total={summary.total} size={22} />
          </Ring>
          <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{tx(T.stillToMark(summary.notMarked, summary.total))}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <BigPill bg="var(--oks)" fg="var(--ok)">{tx(T.presentN(summary.present))}</BigPill>
              <BigPill bg="var(--bads)" fg="var(--bad)">{tx(T.absentN(summary.absent))}</BigPill>
              <BigPill bg="var(--warns)" fg="var(--warnfg)">{tx(T.halfN(summary.halfDay))}</BigPill>
              {summary.percent !== null ? <BigPill bg="var(--s3)" fg="var(--fg)">{tx(T.pctPresent(summary.percent))}</BigPill> : null}
            </div>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.countsOnlyMarked)}</span>
          </div>
          {allowed && sendable.length > 0 ? (
            <Btn variant="pri" icon="message" style={{ height: 44 }} disabled={busy} onClick={() => remind(sendable.map((row) => row.classId))}>
              {tx(T.remindN(sendable.length))}
            </Btn>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <Seg
            options={[
              { value: "all", label: tx(T.fAll(summary.total)) },
              { value: "pending", label: tx(T.fPending(summary.notMarked)) },
              { value: "marked", label: tx(T.fMarked(summary.marked)) },
            ]}
            value={deskFilter}
            onChange={setFilter}
            label={tx(T.attendanceTitle)}
            style={{ width: 420, maxWidth: "100%" }}
          />
          <Btn icon="receipt" href="/teach/register">{tx(TO.monthRegister(board.day))}</Btn>
        </div>

        {board.rows.length === 0 ? (
          <EmptyState icon="grid" title={tx(T.noClasses)} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(196px, 1fr))", gap: 12 }}>
            {filterBoard(board.rows, deskFilter).map((row, i) => (
              <ClassCard key={row.classId} row={row} href={hrefFor(row.classId)} selected={sheet?.classId === row.classId} credit={board.halfDayCredit} delay={Math.min(i * 30, 420)} />
            ))}
          </div>
        )}
      </div>

      <aside ref={deskPanel} className="card" aria-label={tx(T.attendanceTitle)} style={{ position: "sticky", top: 86, maxHeight: "calc(100dvh - 108px)", display: "flex", flexDirection: "column", overflow: "hidden", animation: "xRise .4s .1s var(--ease) both" }}>
        {sheet ? (
          <Register
            key={`${sheet.classId}:${sheet.revision}`}
            sheet={sheet}
            row={selectedRow}
            previewing={previewing}
            canMark={allowed}
            phoneOpen={phone && focus === "explicit"}
            busy={busy}
            onRemind={(classId) => remind([classId])}
            onClose={() => router.push(boardHref)}
            onDone={() => router.push(boardHref)}
          />
        ) : (
          <EmptyState icon="calCheck" title={tx(T.pickClass)} />
        )}
      </aside>
    </div>
  );

  /* --------------------------------------------------------------- phone */
  const phoneFilter = filter ?? "pending";
  const pendingRows = board.rows.filter((row) => !row.recorded);
  const markedRows = board.rows.filter((row) => row.recorded).sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
  const phoneRows = phoneFilter === "pending" ? pendingRows : phoneFilter === "marked" ? markedRows : [...pendingRows, ...markedRows];
  const tiles: [string, string, string, number][] = [
    [tx(TO.present), "var(--oks)", "var(--ok)", summary.present],
    [tx(TO.absent), "var(--bads)", "var(--bad)", summary.absent],
    [tx(TO.halfDay), "var(--warns)", "var(--warnfg)", summary.halfDay],
  ];
  const phoneView = (
    <div className="only-m">
      <div className="glass" style={{ position: "sticky", top: 0, zIndex: 5, height: 56, padding: "0 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <BackLink href="/" className="tap icon-btn" style={{ width: 44, height: 44, borderRadius: 22 }}>
          <Ic n="chevLeft" size={24} />
        </BackLink>
        <Link href="/teach/register" className="tap" style={{ height: 40, padding: "0 14px", borderRadius: 20, border: "1px solid var(--bd)", background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          <Ic n="receipt" size={16} />
          {tx(TO.monthlyRegister)}
        </Link>
      </div>
      <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h1 className="serif" style={{ margin: 0, fontSize: 30, fontWeight: 600 }}>{tx(T.attendanceTitle)}</h1>
          <span className="pill" style={{ height: 30, padding: "0 12px", fontSize: 12, background: "var(--s3)", color: "var(--fg)" }}>{tx(TO.todayIs(shortDay(board.day)))}</span>
        </div>
        {closed}
        <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
          <Ring value={summary.marked} max={Math.max(1, summary.total)} size={84} stroke={9}>
            <RingLabel marked={summary.marked} total={summary.total} size={20} />
          </Ring>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(TO.classesStillToMark(summary.notMarked))}</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
              {tiles.map(([label, bg, fg, n]) => (
                <span key={label} style={{ padding: "6px 8px", borderRadius: 10, background: bg, display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span className="clip" style={{ fontSize: 10, fontWeight: 700, color: fg, textTransform: "uppercase" }}>{label}</span>
                  <span className="num" style={{ fontSize: 16, fontWeight: 700, color: fg }}>{n}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.45, marginTop: -4 }}>{tx(T.countsOnlyMarked)}</span>
        <PhoneSeg
          value={phoneFilter}
          onChange={setFilter}
          label={tx(T.attendanceTitle)}
          options={[
            { value: "pending", label: tx(T.fPending(summary.notMarked)) },
            { value: "marked", label: tx(T.fMarked(summary.marked)) },
            { value: "all", label: tx(T.fAll(summary.total)) },
          ]}
        />
        <div className="card" style={{ overflow: "hidden" }}>
          {phoneRows.length === 0 ? (
            <div style={{ padding: "20px 16px", fontSize: 14, color: "var(--mut)", textAlign: "center" }}>{tx(board.rows.length === 0 ? T.noClasses : TO.everyClassMarked)}</div>
          ) : (
            phoneRows.map((row, i) => (
              <PhoneRow key={row.classId} row={row} href={hrefFor(row.classId)} first={i === 0} delay={Math.min(i * 30, 420)} allowed={allowed} busy={busy} onRemind={() => remind([row.classId])} />
            ))
          )}
        </div>
        {allowed && sendable.length > 0 && phoneFilter !== "marked" ? (
          <button type="button" className="tap btn pri" disabled={busy} onClick={() => remind(sendable.map((row) => row.classId))} style={{ height: "auto", minHeight: 52, padding: "8px 16px", borderRadius: 18, fontSize: 15, whiteSpace: "normal", textAlign: "center" }}>
            <Ic n="message" size={18} />
            {tx(TO.remindClassTeachers(sendable.length))}
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {/* The desk's bar; the phone draws the design's own bar and large title (above). */}
      <div className="only-d" style={{ display: "contents" }}>
        <TopBar crumb={dayLine} title={tx(T.attendanceTitle)} />
      </div>
      <div className="vx-pmain">
        {desk}
        {phoneView}
      </div>
    </>
  );
}

function RingLabel({ marked, total, size }: { marked: number; total: number; size: number }) {
  const { tx } = useVx();
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
      <span className="num" style={{ fontSize: size, fontWeight: 700, lineHeight: 1 }}>{marked}</span>
      <span style={{ fontSize: 11, fontWeight: 400, color: "var(--mut)", marginTop: 2 }}>{tx(T.ofN(total))}</span>
    </span>
  );
}

function BigPill({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) {
  return (
    <span className="pill" style={{ height: 30, padding: "0 12px", fontSize: 13, background: bg, color: fg }}>
      {children}
    </span>
  );
}

/** The phone's segmented control is a size up from the kit's (F11). */
function PhoneSeg({ options, value, onChange, label }: { options: { value: BoardFilter; label: string }[]; value: BoardFilter; onChange: (v: BoardFilter) => void; label: string }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label} style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`, padding: 4, borderRadius: 16, background: "var(--s3)" }}>
      <span aria-hidden="true" style={{ position: "absolute", top: 4, bottom: 4, left: 4, width: `calc((100% - 8px) / ${options.length})`, borderRadius: 12, background: "var(--card)", boxShadow: "var(--sh)", transform: `translateX(${idx * 100}%)`, transition: "transform .34s var(--spring)" }} />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="tap" onClick={() => onChange(o.value)} style={{ position: "relative", height: 40, border: 0, background: "transparent", color: o.value === value ? "var(--fg)" : "var(--mut)", fontSize: 13, fontWeight: 700, padding: "0 6px" }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One class on the phone's list: what state it is in, and the one thing to do about it (F11). */
function PhoneRow({ row, href, first, delay, allowed, busy, onRemind }: { row: ClassBoardRow; href: string; first: boolean; delay: number; allowed: boolean; busy: boolean; onRemind: () => void }) {
  const { tx } = useVx();
  const state = classState(row);
  const teacher = row.teacherName ?? tx(T.noClassTeacher);
  const counted = row.present + row.absent + row.halfDay;
  const sub =
    state === "marked"
      ? row.absent === 0 && row.halfDay === 0
        ? TO.allPresentAt(counted || row.roll, row.savedAt ? clock(row.savedAt) : "—")
        : TO.somePresentAt(row.present, counted || row.roll, row.halfDay, row.savedAt ? clock(row.savedAt) : "—")
      : state === "teacher_away"
        ? TO.onLeaveSub(teacher)
        : state === "reminded"
          ? TO.remindedSub(teacher, clock(row.remindedAt!))
          : row.teacherName
            ? TO.classTeacherSub(teacher)
            : T.noClassTeacher;
  const btn: CSSProperties = { flex: "none", height: 40, padding: "0 14px", fontSize: 13 };
  let action: ReactNode;
  if (state === "marked") action = <Link href={href} className="tap btn" style={{ ...btn, background: "var(--s2)", color: "var(--mut)" }}>{tx(TO.done)}</Link>;
  else if (allowed && remindable([row]).length > 0)
    action = <button type="button" className="tap btn" disabled={busy} onClick={onRemind} style={{ ...btn, background: "var(--accs)", color: "var(--accfg)" }}>{tx(T.remind)}</button>;
  else if (state === "reminded") action = <Link href={href} className="tap btn" style={{ ...btn, background: "var(--infos)", color: "var(--info)" }}>{tx(TO.markIt)}</Link>;
  else action = <Link href={href} className="tap btn pri" style={btn}>{tx(TO.markIt)}</Link>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: first ? 0 : "1px solid var(--bd)", animation: `xFade .3s var(--ease) ${delay}ms both` }}>
      <span aria-hidden="true" style={{ flex: "none", width: 10, height: 10, borderRadius: 5, background: state === "marked" ? "var(--ok)" : "var(--warn)" }} />
      <Link href={href} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{row.label}</span>
        <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(sub)}</span>
      </Link>
      {action}
    </div>
  );
}

function ClassCard({ row, href, selected, credit, delay }: { row: ClassBoardRow; href: string; selected: boolean; credit: number; delay: number }) {
  const { tx } = useVx();
  const state = classState(row);
  const counted = row.present + row.absent + row.halfDay;
  const pct = row.recorded ? classPercent(row, credit) : 0;
  const look =
    state === "marked"
      ? { dot: "var(--ok)", bg: "var(--oks)", fg: "var(--ok)", text: T.markedAt(row.savedAt ? clock(row.savedAt) : "—") }
      : state === "teacher_away"
        ? { dot: "var(--bad)", bg: "var(--bads)", fg: "var(--bad)", text: T.teacherOnLeave }
        : state === "reminded"
          ? { dot: "var(--warn)", bg: "var(--warns)", fg: "var(--warnfg)", text: T.remindedAt(clock(row.remindedAt!)) }
          : { dot: "var(--warn)", bg: "var(--warns)", fg: "var(--warnfg)", text: T.notMarked };
  // The design draws a class card as a <button>, so its text keeps the browser's normal line height.
  return (
    <Link
      href={href}
      className="card tap lift"
      aria-current={selected ? "true" : undefined}
      style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, minWidth: 0, lineHeight: "normal", color: "var(--fg)", borderColor: selected ? "var(--acc)" : "var(--bd)", boxShadow: selected ? "0 0 0 3px var(--accs), var(--sh)" : "var(--sh)", animation: `xRise .4s var(--ease) ${delay}ms both` }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span className="clip" style={{ fontSize: 15, fontWeight: 700 }}>{row.label}</span>
        <span aria-hidden="true" style={{ flex: "none", width: 10, height: 10, borderRadius: 5, background: look.dot }} />
      </span>
      <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>
        {row.teacherName ?? tx(T.noClassTeacher)}
        {row.recorded ? ` · ${tx(T.presentOf(row.present, counted || row.roll))}` : ""}
      </span>
      <span style={{ display: "block", height: 6, borderRadius: 3, background: "var(--s3)", overflow: "hidden" }}>
        <span style={{ display: "block", height: 6, width: `${pct}%`, background: pct >= 95 ? "var(--ok)" : "var(--acc)", transformOrigin: "left", animation: `xGrowX .7s var(--ease) ${delay}ms both` }} />
      </span>
      <span className="pill" style={{ alignSelf: "flex-start", background: look.bg, color: look.fg }}>{tx(look.text)}</span>
    </Link>
  );
}

const CHOICES: { status: MarkStatus; label: string; color: string; name: Pair }[] = [
  { status: "present", label: "P", color: "var(--ok)", name: TO.present },
  { status: "absent", label: "A", color: "var(--bad)", name: TO.absent },
  { status: "half_day", label: "½", color: "var(--warn)", name: TO.halfDay },
];

/**
 * One class's register, held once and drawn twice: as the desk's panel and as
 * the phone's sheet (only one shows). Before marking, a class whose teacher is
 * in school shows what is known about it, as the design's panel does.
 */
function Register({
  sheet,
  row,
  previewing,
  canMark,
  phoneOpen,
  busy,
  onRemind,
  onClose,
  onDone,
}: {
  sheet: SheetData;
  row: ClassBoardRow | undefined;
  previewing: boolean;
  canMark: boolean;
  phoneOpen: boolean;
  busy: boolean;
  onRemind: (classId: string) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [marks, setMarks] = useState(() => initialMarks(sheet.roll, sheet.saved));
  const [reason, setReason] = useState("");
  const [marking, setMarking] = useState(false);
  const [saving, startSaving] = useTransition();
  const commandId = useRef<string | null>(null);
  const counts = markCounts(marks);
  const correcting = sheet.revision >= 1;
  const readOnly = previewing || !canMark;
  const total = sheet.roll.length;

  const set = (studentId: string, status: MarkStatus | null) => {
    commandId.current = null;
    setMarks((all) => ({ ...all, [studentId]: status }));
  };
  const everyone = (status: MarkStatus | null) => {
    commandId.current = null;
    setMarks(Object.fromEntries(sheet.roll.map((s) => [s.studentId, status])));
  };

  const save = () => {
    if (previewing) return toast.show({ text: tx(T.previewing), tone: "info" });
    // One id per save, reused if the same save is retried.
    commandId.current ??= crypto.randomUUID();
    const payload = JSON.stringify({
      commandId: commandId.current,
      classId: sheet.classId,
      day: sheet.day,
      kind: correcting ? "correction" : "save",
      expectedRevision: sheet.revision,
      reason: correcting ? reason.trim() : null,
      marks: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })),
    });
    startSaving(async () => {
      const state = await saveRegisterVx(payload);
      if (state.status === "saved") {
        toast.show({ text: tx(T.saved(sheet.label)), tone: "ok" });
        onDone();
        router.refresh();
        return;
      }
      commandId.current = null;
      if (state.status === "stale") toast.show({ text: tx(T.stale), tone: "bad" });
      else if (state.status === "roster_changed") toast.show({ text: tx(T.rosterChanged(state.joined, state.left)), tone: "bad" });
      else if (state.status === "refused" || state.status === "error") toast.show({ text: tx(state.message), tone: "bad" });
      router.refresh();
    });
  };

  const canSave = !readOnly && counts.unmarked === 0 && total > 0 && (!correcting || reason.trim().length > 0);
  const label = counts.unmarked > 0 ? tx(T.stillToMarkN(counts.unmarked)) : correcting ? tx(T.correctRegister) : tx(TO.submitCounts(counts.present, counts.absent));
  const who = sheet.savedBy && sheet.savedAt ? tx(T.savedBy(sheet.savedBy, clock(sheet.savedAt))) : tx(T.markingAsAdmin(sheet.teacherName, sheet.teacherAway));
  const editable = !readOnly && total > 0;

  const quick = editable ? (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Btn variant="soft" icon="check" style={{ flex: 1 }} onClick={() => everyone("present")}>{tx(T.everyonePresent)}</Btn>
      <Btn onClick={() => everyone(null)}>{tx(T.clear)}</Btn>
    </div>
  ) : null;
  const bar = (
    <div style={{ height: 6, borderRadius: 3, background: "var(--s3)", overflow: "hidden" }} aria-hidden="true">
      <div style={{ height: 6, width: `${total ? (counts.marked / total) * 100 : 0}%`, background: "var(--acc)", transition: "width .35s var(--ease)" }} />
    </div>
  );
  const roster = (big: boolean) =>
    total === 0 ? (
      <EmptyState icon="users" title={tx(T.nobodyOnRoll)} />
    ) : (
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {sheet.roll.map((student, i) => {
          const current = marks[student.studentId];
          return (
            <li key={student.studentId} style={{ display: "flex", alignItems: "center", gap: 10, padding: big ? "7px 0" : "6px 0", borderTop: i || big ? "1px solid var(--bd)" : 0 }}>
              <span className="num" style={{ flex: "none", width: big ? 24 : 22, fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{student.rollNo ?? i + 1}</span>
              <span className="clip" style={{ flex: 1, minWidth: 0, fontSize: big ? 15 : 14, fontWeight: big ? 500 : 400 }}>{student.fullName}</span>
              <span role="radiogroup" aria-label={student.fullName} style={{ flex: "none", display: "flex", gap: 4 }}>
                {CHOICES.map((choice) => {
                  const on = current === choice.status;
                  return (
                    <button
                      key={choice.status}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={tx(choice.name)}
                      disabled={readOnly}
                      onClick={() => set(student.studentId, on ? null : choice.status)}
                      className="tap"
                      style={{ width: big ? 44 : 38, height: big ? 40 : 32, borderRadius: big ? 12 : 9, border: 0, fontSize: big ? 14 : 13, fontWeight: 700, background: on ? choice.color : "var(--s2)", color: on ? "var(--onsolid)" : "var(--mut)" }}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ol>
    );
  const footer = (big: boolean) =>
    editable ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
        {correcting ? <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx(T.correctionReason)} aria-label={tx(T.correctionReason)} maxLength={200} /> : null}
        <button type="button" className="tap btn pri" disabled={!canSave || saving} onClick={save} style={{ width: "100%", height: big ? 54 : 46, borderRadius: big ? 18 : 12, fontSize: big ? 16 : 15 }}>
          {label}
        </button>
      </div>
    ) : null;

  // Before marking: a class whose teacher is in school, or one already saved, shows what is known (D04's panel).
  const infoFirst = row !== undefined && !marking && (row.recorded || !row.teacherAway);
  let desk: ReactNode;
  if (infoFirst && row) {
    const pending = !row.recorded;
    const kv: [string, string][] = pending
      ? [
          [tx(TO.classTeacher), row.teacherName ?? tx(T.noClassTeacher)],
          [tx(TO.studentsN), String(row.roll)],
          [tx(TO.reminder), row.remindedAt ? tx(TO.sentAt(clock(row.remindedAt))) : tx(TO.notSent)],
        ]
      : [
          [tx(TO.present), String(row.present)],
          [tx(TO.absent), String(row.absent)],
          [tx(TO.halfDay), String(row.halfDay)],
          [tx(TO.classSize), String(row.roll)],
        ];
    desk = (
      <div className="fadein" style={{ padding: "22px 22px 24px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
        <span className="pill" style={{ alignSelf: "flex-start", height: 26, padding: "0 10px", background: pending ? "var(--warns)" : "var(--oks)", color: pending ? "var(--warnfg)" : "var(--ok)" }}>
          {pending ? tx(row.remindedAt ? T.remindedAt(clock(row.remindedAt)) : TO.notMarkedYet) : tx(TO.markedAtFull(row.savedAt ? clock(row.savedAt) : "—"))}
        </span>
        <span className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{row.label}</span>
        <span style={{ fontSize: 14, color: "var(--mut)", lineHeight: 1.55 }}>
          {pending ? tx(TO.hasntMarked(row.teacherName ?? tx(T.noClassTeacher))) : tx(TO.markedBy(sheet.savedBy ?? row.teacherName))}
        </span>
        <div className="card" style={{ overflow: "hidden", boxShadow: "none" }}>
          {kv.map(([k, v], i) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 14px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{k}</span>
              <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {pending && canMark && remindable([row]).length > 0 ? (
            <Btn variant="pri" disabled={busy || previewing} onClick={() => onRemind(row.classId)}>{tx(TO.remindOnWhatsApp)}</Btn>
          ) : null}
          {pending ? (
            canMark ? <Btn onClick={() => setMarking(true)}>{tx(TO.markYourself)}</Btn> : null
          ) : (
            <>
              <Btn href={`/teach/register?class=${row.classId}`}>{tx(TO.openRegister)}</Btn>
              {canMark ? <Btn onClick={() => setMarking(true)}>{tx(TO.correctIt)}</Btn> : null}
            </>
          )}
        </div>
      </div>
    );
  } else {
    desk = (
      <>
        <div style={{ flex: "none", padding: "18px 20px 12px", display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid var(--bd)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <h2 className="serif" style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{tx(T.classToday(sheet.label))}</h2>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{who}</span>
            </div>
            <span className="pill num" style={{ background: "var(--s3)", color: "var(--fg)" }}>{counts.marked} / {total}</span>
          </div>
          {bar}
          {quick}
          <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(TO.countsDesk(counts.present, counts.absent, counts.halfDay))}</span>
        </div>
        <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "4px 20px" }}>{roster(false)}</div>
        {editable ? <div style={{ flex: "none", padding: "12px 20px 16px", borderTop: "1px solid var(--bd)" }}>{footer(false)}</div> : null}
      </>
    );
  }

  return (
    <>
      {desk}
      <Sheet open={phoneOpen} onClose={onClose} title={tx(T.classToday(sheet.label))} sub={who} footer={footer(true) ?? undefined}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
            <span className="num" style={{ fontWeight: 700 }}>{tx(T.markedOf(counts.marked, total))}</span>
            <span className="num" style={{ color: "var(--mut)" }}>P {counts.present} · A {counts.absent} · H {counts.halfDay}</span>
          </div>
          {bar}
          {quick}
        </div>
        {roster(true)}
      </Sheet>
    </>
  );
}
