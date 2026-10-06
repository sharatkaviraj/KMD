"use client";

import { memo, useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudOff } from "lucide-react";

import { checkAttendanceSaveAction, saveAttendanceAction } from "@/app/(app)/teach/actions";
import { recordPerformance } from "@/platform/performance/record";
import { m } from "@/messages";
import {
  attendanceLabels,
  attendanceStatuses,
  compareRoll,
  tally,
  type AttendanceStatus,
  type RollStudent,
} from "@/modules/attendance/domain/attendance";
import {
  idleAttendanceState,
  receiptLine,
  totalsSentence,
  type AttendanceReceipt,
  type AttendanceSaveState,
} from "@/modules/attendance/domain/attendance-receipt";
import { draftKey, isStringRecord } from "@/platform/drafts/policy";
import { useDurableDraft } from "@/platform/drafts/use-durable-draft";
import { DraftStatus } from "@/ui/draft-status";
import { counted, primary, secondary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { cn } from "@/platform/utils";
import { Panel } from "@/ui/panel";
import { Badge, Card, Notice, Textarea } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";

/*
 * One class's daily register (P6).
 *
 * Three modes, and the difference between them is the whole point:
 *
 *   take     — not recorded yet. Every child shows as present, but only as a
 *              preview: nothing is written until the person reviews the roll
 *              and presses Save. Leaving the page records nothing.
 *   view     — recorded. The receipt says who saved it, when, and which
 *              revision; the marks are read-only.
 *   correct  — the class teacher or the office changing a recorded register.
 *              The review lists exactly what changes and asks why; the old
 *              revision is kept.
 *
 * Saving sends the whole roll with the revision the page showed and a
 * submission id minted when the review opened. A lost answer is asked about
 * ("Checking whether your save completed") before anything is sent again, and
 * a retry reuses the same id, so it cannot save twice. Marks wait on the phone
 * while offline but are never sent without the person pressing Save.
 */

type Mode = "take" | "view" | "correct";

type RegisterDraft = { marks: Record<string, AttendanceStatus> };
function isRegisterDraft(value: unknown): value is RegisterDraft {
  if (!value || typeof value !== "object" || !("marks" in value) || !isStringRecord(value.marks)) return false;
  return Object.values(value.marks).every((status) => attendanceStatuses.includes(status as AttendanceStatus));
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
      );
}

export function RegisterForm({
  roll,
  ownerId,
  sessionLabel,
  classId,
  classLabel,
  day,
  dayText,
  revision,
  saved,
  receipt,
  canSave,
  canCorrect,
  onBehalf,
  closed,
}: {
  roll: RollStudent[];
  ownerId: string;
  sessionLabel: string;
  classId: string;
  classLabel: string;
  day: string;
  dayText: Localized;
  /** 0 = never saved. */
  revision: number;
  /** The recorded marks of the current revision; empty when not recorded. */
  saved: Record<string, AttendanceStatus>;
  receipt: AttendanceReceipt | null;
  canSave: boolean;
  canCorrect: boolean;
  onBehalf: boolean;
  /** A day the school was shut, or one that has not happened. */
  closed: boolean;
}) {
  const language = useLanguage();
  const router = useRouter();
  const sorted = useMemo(() => [...roll].sort(compareRoll), [roll]);

  const preview = useMemo(
    () => Object.fromEntries(sorted.map((student) => [student.studentId, "present" as AttendanceStatus])),
    [sorted],
  );

  const [mode, setMode] = useState<Mode>(revision === 0 && canSave && !closed ? "take" : "view");
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>(revision === 0 ? preview : saved);
  const [reviewing, setReviewing] = useState(false);
  const [reason, setReason] = useState("");
  const [commandId, setCommandId] = useState<string | null>(null);
  const [state, setState] = useState<AttendanceSaveState>(idleAttendanceState);
  const [checking, setChecking] = useState(false);
  const [pending, start] = useTransition();

  const editing = mode !== "view";
  const draft = useDurableDraft(
    draftKey(ownerId, sessionLabel, `attendance/${classId}/${day}`),
    JSON.stringify({ revision, ids: sorted.map((row) => row.studentId) }),
    isRegisterDraft,
  );
  const { persist, clear, online } = draft;

  const setStatus = useCallback(
    (studentId: string, status: AttendanceStatus) => {
      if (!editing || pending) return;
      const next = { ...marks, [studentId]: status };
      setMarks(next);
      void persist({ marks: next });
      setReviewing(false);
    },
    [editing, pending, persist, marks],
  );

  const restore = () => {
    if (!editing) return;
    const known = new Set(sorted.map((row) => row.studentId));
    const recovered = Object.entries(draft.recovered?.value.marks ?? {}).filter(([id]) => known.has(id));
    const next = { ...marks, ...Object.fromEntries(recovered) };
    setMarks(next);
    draft.dismissRecovery();
    void persist({ marks: next });
  };

  const counts = tally(sorted, new Map(Object.entries(marks)));
  const exceptions = sorted.filter((student) => (marks[student.studentId] ?? "present") !== "present");
  const changes =
    mode === "correct"
      ? sorted.filter((student) => saved[student.studentId] !== marks[student.studentId])
      : [];

  const openReview = () => {
    setCommandId(newId());
    setState(idleAttendanceState);
    setReviewing(true);
  };

  const settle = (result: AttendanceSaveState) => {
    setState(result);
    if (result.status === "saved") {
      setCommandId(null);
      setReviewing(false);
      setMode("view");
      void clear();
      // The page redraws with the new revision, its receipt and its history.
      router.refresh();
    }
  };

  const confirm = async (id: string) => {
    setChecking(true);
    try {
      const check = await checkAttendanceSaveAction(id);
      if (check.status === "saved") {
        settle(check);
        return;
      }
    } catch {
      // Still no connection: say so, keep the same id for the retry.
    } finally {
      setChecking(false);
    }
    setState({ status: "error", message: m.attendanceNotSavedRetry });
  };

  const send = () => {
    if (!commandId || pending) return;
    const id = commandId;
    const payload = {
      commandId: id,
      classId,
      day,
      kind: mode === "correct" ? "correction" : "save",
      expectedRevision: revision,
      reason: mode === "correct" ? reason : null,
      marks: sorted.map((student) => ({
        studentId: student.studentId,
        status: marks[student.studentId] ?? "present",
      })),
    };
    const data = new FormData();
    data.set("payload", JSON.stringify(payload));

    start(async () => {
      const started = performance.now();
      try {
        const result = await saveAttendanceAction(idleAttendanceState, data);
        if (result.status === "error") {
          await confirm(id);
          return;
        }
        if (result.status === "saved") recordPerformance("form_saved", performance.now() - started);
        settle(result);
      } catch {
        await confirm(id);
      }
    });
  };

  const startCorrection = () => {
    setMarks(saved);
    setReason("");
    setState(idleAttendanceState);
    setMode("correct");
  };

  const cancelCorrection = () => {
    setMarks(saved);
    setReviewing(false);
    setState(idleAttendanceState);
    setMode("view");
  };

  if (sorted.length === 0) {
    return <EmptyState title={m.attendanceEmptyRoll} language={language} />;
  }

  const recorded = revision >= 1;
  const totals = totalsSentence(counts);

  return (
    <div className="space-y-4" aria-busy={pending || checking} data-work-form="true">
      {editing ? (
        <DraftStatus
          status={draft.status}
          online={online}
          recovered={Boolean(draft.recovered)}
          changed={draft.changedSinceDraft}
          onRestore={restore}
          onDiscard={() => void draft.discard()}
          language={language}
        />
      ) : null}

      {/* -------------------------------------------- what this register is */}

      {recorded && receipt ? (
        <Card className="p-4" data-attendance-receipt={receipt.revision}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">{primary(m.attendanceRecorded, language)}</Badge>
            <p className="text-[14px] font-medium text-foreground">{primary(receiptLine(receipt), language)}</p>
          </div>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{primary(totalsSentence(receipt.totals), language)}</p>
          {secondary(receiptLine(receipt), language) ? (
            <p className="mt-1 text-[12px] text-subtle-foreground">{secondary(receiptLine(receipt), language)}</p>
          ) : null}
        </Card>
      ) : !recorded ? (
        <Notice
          tone={mode === "take" ? "info" : "warning"}
          text={mode === "take" ? m.attendancePreview : m.attendanceDue}
          language={language}
        />
      ) : null}

      {mode === "take" && onBehalf ? <Notice tone="warning" text={m.attendanceOnBehalf} language={language} /> : null}
      {mode === "correct" ? <Notice tone="warning" text={m.attendanceCorrecting} language={language} /> : null}
      {editing && !online ? <Notice tone="warning" text={m.attendanceOffline} language={language} /> : null}

      {/* ------------------------------------------------------- the roll */}

      {!reviewing ? (
        <>
          <div className="sticky top-14 z-30 -mx-4 border-b border-border bg-background px-4 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[14px] font-medium text-foreground">{primary(totals, language)}</p>
              {/* Keep the badge's space while the draft is first being saved,
                  so its appearance never pushes a child's row under a thumb. */}
              {editing ? (
                <Badge tone="warning" className={draft.status === "local" ? "shrink-0" : "invisible shrink-0"} aria-hidden={draft.status !== "local"}>
                  <CloudOff aria-hidden className="size-3" />
                  {primary(m.attendanceNotRecorded, language)}
                </Badge>
              ) : null}
            </div>
          </div>

          <Panel title={m.attendanceTitle} description={dayText} language={language}>
            {sorted.map((student) => (
              <AttendanceRow
                key={student.studentId}
                student={student}
                status={recorded || editing ? marks[student.studentId] : undefined}
                disabled={!editing || pending}
                language={language}
                onStatus={setStatus}
              />
            ))}
          </Panel>

          {editing ? (
            <div className="work-action safe-bottom sticky bottom-0 -mx-4 border-t border-border bg-background px-4 pt-3">
              <Button
                onClick={openReview}
                fullWidth
                size="lg"
                disabled={mode === "correct" && changes.length === 0}
              >
                {primary(mode === "correct" ? m.attendanceReviewCorrection : m.attendanceReview, language)}
              </Button>
              {mode === "correct" ? (
                <Button variant="ghost" fullWidth className="mt-1" onClick={cancelCorrection}>
                  {primary(m.attendanceCancelCorrection, language)}
                </Button>
              ) : null}
              <p className="mt-1.5 pb-3 text-center text-[12px] text-subtle-foreground">
                {classLabel} · {primary(dayText, language)}
              </p>
            </div>
          ) : recorded && canCorrect && !closed ? (
            <Button variant="outline" fullWidth onClick={startCorrection}>
              {primary(m.attendanceCorrect, language)}
            </Button>
          ) : null}
        </>
      ) : (
        /* ----------------------------------------------------- the review */
        <section aria-labelledby="attendance-review-title" className="space-y-4">
          <Card className="p-4">
            <h2 id="attendance-review-title" className="text-[16px] font-semibold text-foreground">
              {primary(m.attendanceCheckTitle, language)}
            </h2>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {classLabel} · {primary(dayText, language)} ·{" "}
              {primary(counted(sorted.length, m.childOne, m.childMany), language)}
            </p>
            <p className="mt-3 text-[15px] font-semibold text-foreground" data-attendance-totals>
              {primary(totals, language)}
            </p>

            {mode === "correct" ? (
              <>
                <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-subtle-foreground">
                  {primary(m.attendanceChanges, language)}
                </h3>
                {changes.length === 0 ? (
                  <p className="mt-1 text-[14px] text-muted-foreground">{primary(m.attendanceNoChanges, language)}</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-[14px]">
                    {changes.map((student) => (
                      <li key={student.studentId}>
                        <span className="font-medium">{student.fullName}</span>:{" "}
                        {primary(attendanceLabels[saved[student.studentId] ?? "present"], language)} →{" "}
                        <b>{primary(attendanceLabels[marks[student.studentId] ?? "present"], language)}</b>
                      </li>
                    ))}
                  </ul>
                )}
                <label htmlFor="correction-reason" className="mt-4 block text-[13px] font-medium text-muted-foreground">
                  {primary(m.attendanceCorrectReason, language)}
                </label>
                <Textarea
                  id="correction-reason"
                  rows={2}
                  maxLength={200}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </>
            ) : (
              <>
                <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-subtle-foreground">
                  {primary(m.attendanceExceptions, language)}
                </h3>
                {exceptions.length === 0 ? (
                  <p className="mt-1 text-[14px] text-muted-foreground">{primary(m.attendanceEveryonePresent, language)}</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-[14px]" data-attendance-exceptions>
                    {exceptions.map((student) => (
                      <li key={student.studentId}>
                        <span className="tabular-nums text-subtle-foreground">{student.rollNo ?? "—"}</span>{" "}
                        <span className="font-medium">{student.fullName}</span> —{" "}
                        {primary(attendanceLabels[marks[student.studentId] ?? "present"], language)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Card>

          <Outcome state={state} checking={checking} language={language} onReload={() => router.refresh()} />

          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              fullWidth
              onClick={send}
              loading={pending}
              loadingText={primary(m.attendanceSaving, language)}
              disabled={
                !online ||
                state.status === "stale" ||
                state.status === "roster_changed" ||
                (mode === "correct" && (changes.length === 0 || reason.trim() === ""))
              }
            >
              {primary(
                state.status === "error" ? m.tryAgain : mode === "correct" ? m.attendanceSaveCorrection : m.attendanceSaveConfirm,
                language,
              )}
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setReviewing(false)} disabled={pending}>
              {primary(m.attendanceBackToList, language)}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

/** Everything short of a receipt, said as what it is. */
function Outcome({
  state,
  checking,
  language,
  onReload,
}: {
  state: AttendanceSaveState;
  checking: boolean;
  language: ReturnType<typeof useLanguage>;
  onReload: () => void;
}) {
  if (checking) return <Notice tone="info" text={m.attendanceChecking} language={language} />;
  switch (state.status) {
    case "idle":
    case "saved":
      return null;
    case "stale":
      return (
        <Notice tone="warning" text={state.message} language={language}>
          {state.latest ? <p className="text-[14px]">{primary(receiptLine(state.latest), language)}</p> : null}
          <Button variant="outline" size="sm" className="mt-2" onClick={onReload}>
            {primary(m.attendanceSeeSaved, language)}
          </Button>
        </Notice>
      );
    case "roster_changed":
      return (
        <Notice tone="warning" text={state.message} language={language}>
          {state.joined.length > 0 ? (
            <p className="text-[14px]">
              {primary(m.attendanceJoined, language)}: {state.joined.join(", ")}
            </p>
          ) : null}
          {state.left.length > 0 ? (
            <p className="text-[14px]">
              {primary(m.attendanceLeft, language)}: {state.left.join(", ")}
            </p>
          ) : null}
          <Button variant="outline" size="sm" className="mt-2" onClick={onReload}>
            {primary(m.attendanceReloadList, language)}
          </Button>
        </Notice>
      );
    case "refused":
    case "error":
      return <Notice tone="danger" text={state.message} language={language} />;
  }
}

const SELECTED: Record<AttendanceStatus, string> = {
  present: "border-success bg-success-soft text-success-soft-foreground",
  absent: "border-destructive bg-destructive text-destructive-foreground",
  half_day: "border-warning bg-warning-soft text-warning-soft-foreground",
  late: "border-accent bg-accent-soft text-accent-soft-foreground",
  leave: "border-border-strong bg-surface-3 text-foreground",
};

const AttendanceRow = memo(function AttendanceRow({
  student,
  status,
  disabled,
  language,
  onStatus,
}: {
  student: RollStudent;
  status: AttendanceStatus | undefined;
  disabled: boolean;
  language: ReturnType<typeof useLanguage>;
  onStatus: (id: string, status: AttendanceStatus) => void;
}) {
  return (
    <li className="cv-row px-4 py-3 sm:flex sm:items-center sm:gap-4" data-student={student.studentId}>
      <div className="mb-2 flex items-baseline gap-2 sm:mb-0 sm:min-w-0 sm:flex-1">
        <span className="w-7 shrink-0 text-[13px] font-semibold tabular-nums text-subtle-foreground">
          {student.rollNo ?? "—"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">{student.fullName}</span>
      </div>

      {/* Five targets rather than a dropdown: a teacher marks forty children
          standing up, and a select costs two taps and a steady hand each. */}
      <div className="grid grid-cols-5 gap-1 sm:w-auto sm:shrink-0 sm:gap-1.5">
        {attendanceStatuses.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onStatus(student.studentId, option)}
            disabled={disabled}
            aria-pressed={status === option}
            className={cn(
              "focus-ring min-h-11 rounded-xl border px-1 text-[12px] font-semibold leading-tight transition-[background-color,border-color,color,transform] duration-150 ease-out motion-safe:active:scale-[0.98] motion-reduce:transition-none motion-reduce:transform-none",
              "disabled:opacity-60 sm:min-w-[4.5rem] sm:text-[13px]",
              status === option ? SELECTED[option] : "border-border bg-surface text-muted-foreground",
            )}
          >
            {primary(attendanceLabels[option], language)}
          </button>
        ))}
      </div>
    </li>
  );
});
