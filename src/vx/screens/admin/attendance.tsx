"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { remindTeachersVx, saveRegisterVx } from "@/app/(app)/attendance/actions";
import { clock } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { Input, Seg } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Section, Split, TopBar } from "@/vx/ui/page";
import { ATT_COLORS, Btn, Card, EmptyState, Pill, Ring } from "@/vx/ui/primitives";
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
import { T } from "@/vx/screens/admin/text";
import type { BoardData, SheetData } from "@/vx/screens/admin/types";

/*
 * The attendance board (design F11/D04) and the mark-on-behalf panel
 * (F12). The panel opens with everyone present when nothing is saved yet
 * (RULES C), and saves through the same register command a teacher uses.
 */

export function AttendanceScreen({
  board,
  sheet,
  filter: initialFilter,
  dayLine,
  previewing,
  canMark,
}: {
  board: BoardData;
  sheet: SheetData | null;
  filter: BoardFilter;
  dayLine: string;
  previewing: boolean;
  canMark: boolean;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [filter, setFilter] = useState<BoardFilter>(initialFilter);
  const [busy, startBusy] = useTransition();
  const summary = boardSummary(board.rows, board.halfDayCredit);
  const shown = filterBoard(board.rows, filter);
  const sendable = remindable(board.rows);

  const remind = (classIds: string[]) => {
    if (previewing) return toast.show({ text: tx(T.previewing), tone: "info" });
    startBusy(async () => {
      const result = await remindTeachersVx(classIds);
      toast.show({ text: result.ok ? tx(T.reminded(result.queued)) : tx(result.message ?? T.failed), tone: result.ok ? "ok" : "bad" });
      router.refresh();
    });
  };

  const hrefFor = (classId: string) => `/attendance?class=${classId}${filter !== "all" ? `&f=${filter}` : ""}`;

  const boardPane = (
    <div className={sheet ? "hide-m" : undefined} style={{ minWidth: 0 }}>
      <Section gap={16}>
        {!board.schoolOpen ? (
          <Card><EmptyState icon="calendar" title={tx(T.schoolClosed)} body={tx(T.closedToday)} /></Card>
        ) : null}
        <Card style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", padding: "20px 22px" }}>
          <Ring value={summary.marked} max={Math.max(1, summary.total)} size={92} stroke={10}>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
              <strong className="num" style={{ fontSize: 26 }}>{summary.marked}</strong>
              <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(T.ofN(summary.total))}</span>
            </span>
          </Ring>
          <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
            <strong style={{ fontSize: 18 }}>{tx(T.stillToMark(summary.notMarked, summary.total))}</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <Pill tone="ok">{tx(T.presentN(summary.present))}</Pill>
              <Pill tone="bad">{tx(T.absentN(summary.absent))}</Pill>
              <Pill tone="warn">{tx(T.halfN(summary.halfDay))}</Pill>
              {summary.percent !== null ? <Pill tone="mut">{tx(T.pctPresent(summary.percent))}</Pill> : null}
            </div>
            <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{tx(T.countsOnlyMarked)}</span>
          </div>
          {canMark && board.schoolOpen && sendable.length > 0 ? (
            <Btn variant="pri" icon="message" disabled={busy} onClick={() => remind(sendable.map((row) => row.classId))}>
              {tx(T.remindN(sendable.length))}
            </Btn>
          ) : null}
        </Card>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <Seg
            options={[
              { value: "all", label: tx(T.fAll(summary.total)) },
              { value: "pending", label: tx(T.fPending(summary.notMarked)) },
              { value: "marked", label: tx(T.fMarked(summary.marked)) },
            ]}
            value={filter}
            onChange={setFilter}
            label={tx(T.attendanceTitle)}
            style={{ minWidth: 300, flex: "1 1 300px", maxWidth: 440 }}
          />
          <Btn icon="fileText" href="/teach/register">{tx(T.monthRegister)}</Btn>
        </div>

        {board.rows.length === 0 ? (
          <EmptyState icon="grid" title={tx(T.noClasses)} />
        ) : (
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
            {shown.map((row, i) => (
              <ClassCard key={row.classId} row={row} href={hrefFor(row.classId)} selected={sheet?.classId === row.classId} credit={board.halfDayCredit} delay={i * 22} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );

  return (
    <>
      <TopBar crumb={dayLine} title={tx(T.attendanceTitle)} mTitle={sheet ? tx(T.classToday(sheet.label)) : tx(T.attendanceTitle)} mSub={dayLine} mBack={sheet ? "/attendance" : undefined} />
      <main>
        <Split
          list={boardPane}
          detail={
            sheet ? (
              <MarkPanel key={`${sheet.classId}:${sheet.revision}`} sheet={sheet} previewing={previewing} canMark={canMark && board.schoolOpen} onDone={() => router.push("/attendance")} />
            ) : (
              <div className="only-d">
                <EmptyState icon="calCheck" title={tx(T.pickClass)} />
              </div>
            )
          }
          detailWidth={440}
        />
      </main>
    </>
  );
}

function ClassCard({ row, href, selected, credit, delay }: { row: ClassBoardRow; href: string; selected: boolean; credit: number; delay: number }) {
  const { tx } = useVx();
  const state = classState(row);
  const dot = state === "marked" ? "var(--ok)" : state === "teacher_away" ? "var(--bad)" : "var(--warn)";
  const counted = row.present + row.absent + row.halfDay;
  return (
    <Link
      href={href}
      className="card tap lift rise"
      aria-current={selected ? "true" : undefined}
      style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0, animationDelay: `${Math.min(delay, 400)}ms`, boxShadow: selected ? "0 0 0 2px var(--acc)" : undefined }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong className="clip" style={{ fontSize: 16 }}>{row.label}</strong>
        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 5, background: dot }} />
      </span>
      <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>
        {row.teacherName ?? tx(T.noClassTeacher)}
        {row.recorded ? ` · ${tx(T.presentOf(row.present, counted || row.roll))}` : ""}
      </span>
      <span style={{ height: 5, borderRadius: 3, background: "var(--s3)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: row.recorded ? `${classPercent(row, credit)}%` : "0%", background: "var(--ok)" }} />
      </span>
      <span>
        {state === "marked" ? (
          <Pill tone="ok">{tx(T.markedAt(row.savedAt ? clock(row.savedAt) : "—"))}</Pill>
        ) : state === "teacher_away" ? (
          <Pill tone="bad">{tx(T.teacherOnLeave)}</Pill>
        ) : state === "reminded" ? (
          <Pill tone="info">{tx(T.remindedAt(clock(row.remindedAt!)))}</Pill>
        ) : (
          <Pill tone="warn">{tx(T.notMarked)}</Pill>
        )}
      </span>
    </Link>
  );
}

const CHOICES: { status: MarkStatus; label: string; color: keyof typeof ATT_COLORS }[] = [
  { status: "present", label: "P", color: "P" },
  { status: "absent", label: "A", color: "A" },
  { status: "half_day", label: "½", color: "H" },
];

function MarkPanel({ sheet, previewing, canMark, onDone }: { sheet: SheetData; previewing: boolean; canMark: boolean; onDone: () => void }) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [marks, setMarks] = useState(() => initialMarks(sheet.roll, sheet.saved));
  const [reason, setReason] = useState("");
  const [saving, startSaving] = useTransition();
  const commandId = useRef<string | null>(null);
  const counts = markCounts(marks);
  const correcting = sheet.revision >= 1;
  const readOnly = previewing || !canMark;

  const set = (studentId: string, status: MarkStatus | null) => {
    commandId.current = null;
    setMarks((all) => ({ ...all, [studentId]: status }));
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

  const total = sheet.roll.length;
  const canSave = !readOnly && counts.unmarked === 0 && total > 0 && (!correcting || reason.trim().length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <div style={{ padding: "20px 20px 12px", display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid var(--bd)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="serif" style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{tx(T.classToday(sheet.label))}</h2>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>
              {sheet.savedBy && sheet.savedAt ? tx(T.savedBy(sheet.savedBy, clock(sheet.savedAt))) : tx(T.markingAsAdmin(sheet.teacherName, sheet.teacherAway))}
            </span>
          </div>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Pill tone="mut">{counts.marked} / {total}</Pill>
            <Link href="/attendance" className="tap icon-btn only-d" aria-label={tx(T.close)} style={{ width: 36, height: 36 }}>
              <Ic n="x" size={18} />
            </Link>
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "var(--s3)", overflow: "hidden" }} aria-hidden="true">
          <div style={{ height: "100%", width: `${total ? (counts.marked / total) * 100 : 0}%`, background: "var(--acc)" }} />
        </div>
        {!readOnly && total > 0 ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="soft" icon="check" full onClick={() => setMarks(Object.fromEntries(sheet.roll.map((s) => [s.studentId, "present" as MarkStatus])))}>
              {tx(T.everyonePresent)}
            </Btn>
            <Btn onClick={() => setMarks(Object.fromEntries(sheet.roll.map((s) => [s.studentId, null])))}>{tx(T.clear)}</Btn>
          </div>
        ) : null}
        <span className="num" style={{ fontSize: 12.5, color: "var(--mut)" }}>
          P {counts.present} · A {counts.absent} · ½ {counts.halfDay}
        </span>
      </div>

      {total === 0 ? (
        <EmptyState icon="users" title={tx(T.nobodyOnRoll)} />
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, flex: 1 }}>
          {sheet.roll.map((student, i) => {
            const current = marks[student.studentId];
            return (
              <li key={student.studentId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderTop: i ? "1px solid var(--bd)" : 0, minHeight: 52 }}>
                <span className="num" style={{ width: 26, fontSize: 13, color: "var(--mut)" }}>{student.rollNo ?? i + 1}</span>
                <span className="clip" style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>{student.fullName}</span>
                <span role="radiogroup" aria-label={student.fullName} style={{ display: "flex", gap: 6 }}>
                  {CHOICES.map((choice) => {
                    const on = current === choice.status;
                    const c = ATT_COLORS[choice.color];
                    return (
                      <button
                        key={choice.status}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={tx({ en: c.label, hi: c.hi })}
                        disabled={readOnly}
                        onClick={() => set(student.studentId, on ? null : choice.status)}
                        className="tap"
                        style={{ width: 42, height: 38, borderRadius: 10, border: 0, fontWeight: 700, background: on ? c.fg : "var(--s2)", color: on ? "#fff" : "var(--mut)" }}
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
      )}

      {!readOnly && total > 0 ? (
        <div style={{ position: "sticky", bottom: 0, padding: "12px 16px 16px", background: "var(--card)", borderTop: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 8 }}>
          {correcting ? <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx(T.correctionReason)} aria-label={tx(T.correctionReason)} maxLength={200} /> : null}
          <Btn variant="pri" big full disabled={!canSave || saving} onClick={save}>
            {counts.unmarked > 0 ? tx(T.stillToMarkN(counts.unmarked)) : correcting ? tx(T.correctRegister) : tx(T.saveRegister)}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
