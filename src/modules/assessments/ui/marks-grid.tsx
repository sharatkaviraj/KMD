"use client";

import { useMemo, useState, useTransition } from "react";
import { CircleAlert } from "lucide-react";

import { checkMarksSaveAction, saveMarksAction } from "@/app/(app)/assessments/actions";
import { draftKey, isStringRecord } from "@/platform/drafts/policy";
import { useDurableDraft } from "@/platform/drafts/use-durable-draft";
import { DraftStatus } from "@/ui/draft-status";
import { recordPerformance } from "@/platform/performance/record";
import * as m from "@/messages/pairs";
import { checkMark, type AssessmentSubject } from "@/modules/assessments/domain/assessments";
import {
  idleMarksState,
  marksReceiptLine,
  type MarkEntryState,
  type MarksKind,
  type MarksReceipt,
  type MarksSaveState,
} from "@/modules/assessments/domain/marks-command";
import { schoolClockTime } from "@/modules/attendance/domain/attendance-receipt";
import type { RollStudent } from "@/modules/attendance/domain/attendance";
import { countOf, primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { cn } from "@/platform/utils";
import { Badge, Card, Input, Notice, Textarea } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";

type MarksDraft = { values: Record<string, string>; absent: string[]; exempt?: string[]; reason: string };
function isMarksDraft(value: unknown): value is MarksDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  const ids = (list: unknown) => Array.isArray(list) && list.every((id) => typeof id === "string");
  return (
    isStringRecord(draft.values) &&
    ids(draft.absent) &&
    (draft.exempt === undefined || ids(draft.exempt)) &&
    typeof draft.reason === "string"
  );
}

type StoredMark = { value: number | null; absent: boolean; exempt: boolean };
type Mode = "entry" | "view" | "correct";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
      );
}

/**
 * One paper's column: every child who sat it (P7).
 *
 * **Four states per cell, and the screen shows all four.** A blank is nobody
 * having entered it yet; "Absent" is a child who did not sit the paper;
 * "Exempt" is a child excused from it; a number is a number — including
 * nought, which is a real mark somebody gave.
 *
 * **Draft, then submit.** Save draft keeps what is typed, blanks and all.
 * Submit marks is the teacher saying she has finished: it is refused while
 * anybody is blank, because a blank is never a zero, and it approves nothing.
 * After that a change is a correction, with a reason, kept in the log.
 *
 * The whole column goes in one command with the revision the page showed and
 * a submission id minted once: a double press returns the first receipt, a
 * lost answer is asked about before anything is sent again, and a save on a
 * stale page is refused rather than written over somebody else's.
 */
export function MarksGrid({
  paper,
  ownerId,
  sessionLabel,
  roll,
  marks,
  canEnter,
  canReopen,
  examOpen,
  lockedReason,
  receipt: initialReceipt,
}: {
  paper: AssessmentSubject;
  ownerId: string;
  sessionLabel: string;
  roll: RollStudent[];
  marks: Record<string, StoredMark>;
  canEnter: boolean;
  canReopen: boolean;
  examOpen: boolean;
  lockedReason: Localized | null;
  receipt: MarksReceipt | null;
}) {
  const language = useLanguage();

  // What the server last said about this paper. Kept here rather than read
  // back from props so a confirmed save can be shown without a remount.
  const [stored, setStored] = useState(marks);
  const [revision, setRevision] = useState(paper.entryRevision);
  const [entryStatus, setEntryStatus] = useState(paper.entryStatus);
  const [receipt, setReceipt] = useState(initialReceipt);

  const editable = canEnter && examOpen;
  const [mode, setMode] = useState<Mode>(editable && paper.entryStatus === "open" ? "entry" : "view");

  const fromStored = (source: Record<string, StoredMark>): MarksDraft => ({
    values: Object.fromEntries(
      roll.map((student) => {
        const mark = source[student.studentId];
        return [student.studentId, mark?.value === null || mark?.value === undefined ? "" : String(mark.value)];
      }),
    ),
    absent: roll.filter((student) => source[student.studentId]?.absent).map((student) => student.studentId),
    exempt: roll.filter((student) => source[student.studentId]?.exempt).map((student) => student.studentId),
    reason: "",
  });

  const [form, setForm] = useState<MarksDraft>(() => fromStored(marks));
  const [reviewing, setReviewing] = useState(false);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [state, setState] = useState<MarksSaveState>(idleMarksState);
  const [checking, setChecking] = useState(false);
  const [pending, start] = useTransition();

  const draft = useDurableDraft(
    draftKey(ownerId, sessionLabel, `marks/${paper.id}`),
    JSON.stringify({ revision, ids: roll.map((row) => row.studentId), max: paper.maxMarks }),
    isMarksDraft,
  );

  const editing = mode !== "view";
  const absent = useMemo(() => new Set(form.absent), [form.absent]);
  const exempt = useMemo(() => new Set(form.exempt ?? []), [form.exempt]);

  const edit = (next: MarksDraft) => {
    if (!editing || pending) return;
    setForm(next);
    setReviewing(false);
    // A changed column is a different save: a retry id belongs to the old one.
    setCommandId(null);
    void draft.persist(next);
  };

  const restore = () => {
    const saved = draft.recovered?.value;
    if (!saved || !editing || pending) return;
    const known = new Set(roll.map((row) => row.studentId));
    edit({
      values: { ...form.values, ...Object.fromEntries(Object.entries(saved.values).filter(([id]) => known.has(id))) },
      absent: saved.absent.filter((id) => known.has(id)),
      exempt: (saved.exempt ?? []).filter((id) => known.has(id)),
      reason: saved.reason,
    });
    draft.dismissRecovery();
  };

  const stateOf = (studentId: string): MarkEntryState => {
    if (exempt.has(studentId)) return "exempt";
    if (absent.has(studentId)) return "absent";
    return (form.values[studentId] ?? "").trim() === "" ? "blank" : "value";
  };

  const errors = useMemo(() => {
    const found: Record<string, string> = {};
    for (const student of roll) {
      if (absent.has(student.studentId) || exempt.has(student.studentId)) continue;
      const checked = checkMark(form.values[student.studentId], paper);
      if (!checked.ok) found[student.studentId] = primary(checked.error, language);
    }
    return found;
  }, [form.values, absent, exempt, roll, paper, language]);
  const hasErrors = Object.keys(errors).length > 0;

  const storedState = (studentId: string): MarkEntryState => {
    const mark = stored[studentId];
    if (!mark) return "blank";
    if (mark.exempt) return "exempt";
    if (mark.absent) return "absent";
    return mark.value === null ? "blank" : "value";
  };

  const changed = roll.filter((student) => {
    const now = stateOf(student.studentId);
    const was = storedState(student.studentId);
    if (now !== was) return true;
    return now === "value" && Number(form.values[student.studentId]) !== stored[student.studentId]?.value;
  });
  const blanks = roll.filter((student) => stateOf(student.studentId) === "blank");
  const entered = roll.length - blanks.length;

  /* ------------------------------------------------------------ sending */

  const settle = (result: MarksSaveState) => {
    setState(result);
    // Any definite answer ends this submission; only "no answer" keeps its id.
    if (result.status !== "error") setCommandId(null);
    if (result.status !== "saved") return;
    const saved = result.receipt;
    setReceipt(saved);
    setRevision(saved.revision);
    setEntryStatus(saved.entryStatus);
    setCommandId(null);
    setReviewing(false);
    if (saved.kind !== "reopen") {
      setStored(
        Object.fromEntries(
          roll.map((student) => {
            const now = stateOf(student.studentId);
            return [
              student.studentId,
              {
                value: now === "value" ? Number(form.values[student.studentId]) : null,
                absent: now === "absent",
                exempt: now === "exempt",
              },
            ];
          }),
        ),
      );
      setForm((current) => ({ ...current, reason: "" }));
    }
    setMode(editable && saved.entryStatus === "open" ? "entry" : "view");
    void draft.clear();
  };

  const confirm = async (id: string) => {
    setChecking(true);
    try {
      const check = await checkMarksSaveAction(id);
      if (check.status === "saved") {
        settle(check);
        return;
      }
    } catch {
      // Still no connection: keep the same id for the retry.
    } finally {
      setChecking(false);
    }
    setState({ status: "error", message: m.marksNotSavedRetry });
  };

  const send = (kind: MarksKind, id: string) => {
    if (pending) return;
    const payload = {
      commandId: id,
      paperId: paper.id,
      kind,
      expectedRevision: revision,
      reason: kind === "correction" ? form.reason : null,
      entries:
        kind === "reopen"
          ? []
          : roll.map((student) => {
              const entry = stateOf(student.studentId);
              return {
                studentId: student.studentId,
                state: entry,
                value: entry === "value" ? Number(form.values[student.studentId]) : null,
              };
            }),
    };
    const data = new FormData();
    data.set("payload", JSON.stringify(payload));

    start(async () => {
      const started = performance.now();
      try {
        const result = await saveMarksAction(idleMarksState, data);
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

  // One id per intended save, kept across retries of that save.
  const sendNew = (kind: MarksKind) => {
    const id = commandId ?? newId();
    setCommandId(id);
    send(kind, id);
  };

  if (roll.length === 0) {
    return <EmptyState title={m.attendanceEmptyRoll} language={language} />;
  }

  const time = receipt ? schoolClockTime(receipt.savedAt) : "";
  const submitted = entryStatus === "submitted";

  return (
    <div aria-busy={pending || checking} data-work-form="true" className="space-y-4">
      {editing ? (
        <DraftStatus
          status={draft.status}
          online={draft.online}
          recovered={Boolean(draft.recovered)}
          changed={draft.changedSinceDraft}
          onRestore={restore}
          onDiscard={() => {
            if (!pending) void draft.discard();
          }}
          language={language}
        />
      ) : null}

      {lockedReason ? <Notice tone="info" text={lockedReason} language={language} /> : null}

      <Card className="p-4" data-marks-status={entryStatus}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={submitted ? "success" : "warning"}>
            {primary(submitted ? m.marksSubmittedStatus : m.marksDraftStatus, language)}
          </Badge>
          {receipt ? (
            <p className="text-[14px] text-foreground" data-marks-receipt={receipt.kind}>
              {primary(marksReceiptLine(receipt, time), language)}
            </p>
          ) : null}
        </div>
        {!submitted ? (
          <p className="mt-1.5 text-[12px] text-subtle-foreground">{primary(m.marksBlankNeverZero, language)}</p>
        ) : null}
      </Card>

      {mode === "correct" ? <Notice tone="warning" text={m.marksCorrecting} language={language} /> : null}

      <Outcome state={state} checking={checking} language={language} />

      <div className="sticky top-[var(--vx-ctop-h,3.5rem)] z-30 -mx-4 border-b border-border bg-background px-4 py-2">
        <p className="text-[14px] text-muted-foreground">
          <span className="font-semibold text-foreground">{countOf(entered, roll.length, language)}</span>{" "}
          {primary(m.marksEntered, language)} · {primary(m.paperMax, language)} {paper.maxMarks}
        </p>
      </div>

      {!reviewing ? (
        <ul className="space-y-1.5">
          {roll.map((student) => {
            const cell = stateOf(student.studentId);
            const error = errors[student.studentId];
            const toggle = (which: "absent" | "exempt") => {
              const on = which === "absent" ? absent.has(student.studentId) : exempt.has(student.studentId);
              const without = (list: string[]) => list.filter((id) => id !== student.studentId);
              edit({
                ...form,
                absent: which === "absent" && !on ? [...without(form.absent), student.studentId] : without(form.absent),
                exempt:
                  which === "exempt" && !on
                    ? [...without(form.exempt ?? []), student.studentId]
                    : without(form.exempt ?? []),
              });
            };

            return (
              <li
                key={student.studentId}
                data-student={student.studentId}
                data-cell={cell}
                className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2"
              >
                <span className="w-7 shrink-0 text-[13px] font-semibold tabular-nums text-subtle-foreground">
                  {student.rollNo ?? "—"}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-foreground">{student.fullName}</span>
                  {error ? (
                    <span className="mt-0.5 flex items-center gap-1 text-[12px] text-destructive-soft-foreground">
                      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                      {error}
                    </span>
                  ) : null}
                </span>

                <Input
                  aria-label={`${student.fullName} — ${paper.subjectCode}`}
                  // `inputMode` rather than `type="number"`: a numeric keyboard
                  // without the spinner that silently rewrites a mark somebody
                  // is reading past.
                  inputMode="decimal"
                  value={cell === "absent" || cell === "exempt" ? "" : (form.values[student.studentId] ?? "")}
                  disabled={!editing || pending || cell === "absent" || cell === "exempt"}
                  onChange={(event) =>
                    edit({ ...form, values: { ...form.values, [student.studentId]: event.target.value } })
                  }
                  aria-invalid={Boolean(error)}
                  className="h-11 w-20 shrink-0 text-center"
                />

                <button
                  type="button"
                  disabled={!editing || pending}
                  onClick={() => toggle("absent")}
                  aria-pressed={cell === "absent"}
                  className={cn(
                    "focus-ring min-h-11 shrink-0 rounded-xl border px-2 text-[12px] font-semibold transition-colors disabled:opacity-60",
                    cell === "absent"
                      ? "border-destructive bg-destructive-soft text-destructive-soft-foreground"
                      : "border-border bg-surface text-muted-foreground",
                  )}
                >
                  {primary(m.marksAbsent, language)}
                </button>

                {paper.allowExempt ? (
                  <button
                    type="button"
                    disabled={!editing || pending}
                    onClick={() => toggle("exempt")}
                    aria-pressed={cell === "exempt"}
                    className={cn(
                      "focus-ring min-h-11 shrink-0 rounded-xl border px-2 text-[12px] font-semibold transition-colors disabled:opacity-60",
                      cell === "exempt"
                        ? "border-border-strong bg-surface-3 text-foreground"
                        : "border-border bg-surface text-muted-foreground",
                    )}
                  >
                    {primary(m.marksExempt, language)}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        /* ------------------------------------------- check before submitting */
        <section aria-labelledby="marks-review" className="space-y-3">
          <Card className="p-4">
            <h2 id="marks-review" className="text-[16px] font-semibold text-foreground">
              {primary(m.marksSubmitCheck, language)}
            </h2>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {paper.classLabel} · {paper.subjectCode} · {countOf(entered, roll.length, language)}{" "}
              {primary(m.marksEntered, language)}
            </p>
            {blanks.length > 0 ? (
              <>
                <h3 className="mt-3 text-[13px] font-semibold uppercase tracking-wide text-subtle-foreground">
                  {primary(m.marksStillBlank, language)}
                </h3>
                <ul className="mt-1 text-[14px]" data-marks-blank>
                  {blanks.map((student) => (
                    <li key={student.studentId}>{student.fullName}</li>
                  ))}
                </ul>
                <p className="mt-2 text-[13px] text-muted-foreground">{primary(m.marksBlankNeverZero, language)}</p>
              </>
            ) : null}
            <p className="mt-3 text-[13px] text-muted-foreground">{primary(m.marksSubmitMeans, language)}</p>
          </Card>
          <Button
            size="lg"
            fullWidth
            loading={pending}
            loadingText={primary(m.saving, language)}
            disabled={blanks.length > 0 || hasErrors || !draft.online}
            onClick={() => sendNew("submit")}
          >
            {primary(state.status === "error" ? m.tryAgain : m.marksSubmitConfirm, language)}
          </Button>
          <Button variant="ghost" fullWidth disabled={pending} onClick={() => setReviewing(false)}>
            {primary(m.marksBack, language)}
          </Button>
        </section>
      )}

      {/* ----------------------------------------------------- the actions */}

      {mode === "entry" && !reviewing ? (
        <div className="work-action safe-bottom sticky bottom-0 -mx-4 space-y-2 border-t border-border bg-background px-4 pt-3">
          <Button
            type="button"
            variant="outline"
            fullWidth
            loading={pending}
            loadingText={primary(m.saving, language)}
            disabled={hasErrors || changed.length === 0 || !draft.online}
            onClick={() => sendNew("draft")}
          >
            {primary(state.status === "error" ? m.tryAgain : m.marksSaveRow, language)}
          </Button>
          <Button
            type="button"
            fullWidth
            size="lg"
            disabled={hasErrors || pending}
            onClick={() => {
              setCommandId(null);
              setState(idleMarksState);
              setReviewing(true);
            }}
          >
            {primary(m.marksSubmit, language)}
          </Button>
          <p className="pb-3 text-center text-[12px] text-subtle-foreground">
            {paper.classLabel} · {paper.subjectCode}
          </p>
        </div>
      ) : null}

      {mode === "correct" ? (
        <div className="space-y-2">
          <label htmlFor="marks-correction-reason" className="block text-[13px] font-medium text-muted-foreground">
            {primary(m.marksCorrectReason, language)}
          </label>
          <Textarea
            id="marks-correction-reason"
            value={form.reason}
            disabled={pending}
            onChange={(event) => edit({ ...form, reason: event.target.value })}
            rows={2}
            maxLength={300}
            className="min-h-16"
          />
          <Button
            fullWidth
            size="lg"
            loading={pending}
            loadingText={primary(m.saving, language)}
            disabled={hasErrors || changed.length === 0 || form.reason.trim() === "" || blanks.length > 0 || !draft.online}
            onClick={() => sendNew("correction")}
          >
            {primary(state.status === "error" ? m.tryAgain : m.marksSaveCorrection, language)}
          </Button>
          <Button
            variant="ghost"
            fullWidth
            disabled={pending}
            onClick={() => {
              setForm(fromStored(stored));
              setState(idleMarksState);
              setMode("view");
            }}
          >
            {primary(m.marksLeaveAsIs, language)}
          </Button>
        </div>
      ) : null}

      {mode === "view" && submitted && examOpen ? (
        <div className="flex flex-col gap-2">
          {canEnter ? (
            <Button
              variant="outline"
              fullWidth
              onClick={() => {
                setForm(fromStored(stored));
                setState(idleMarksState);
                setCommandId(null);
                setMode("correct");
              }}
            >
              {primary(m.marksCorrect, language)}
            </Button>
          ) : null}
          {canReopen ? (
            <Button variant="ghost" fullWidth loading={pending} onClick={() => sendNew("reopen")}>
              {primary(m.marksReopen, language)}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Everything short of a receipt, said as what it is. */
function Outcome({
  state,
  checking,
  language,
}: {
  state: MarksSaveState;
  checking: boolean;
  language: ReturnType<typeof useLanguage>;
}) {
  if (checking) return <Notice tone="info" text={m.marksChecking} language={language} />;
  switch (state.status) {
    case "idle":
      return null;
    case "saved":
      return <Notice tone="success" text={m.marksSaved} language={language} />;
    case "stale":
      return (
        <Notice tone="warning" text={state.message} language={language}>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => window.location.reload()}>
            {primary(m.marksReload, language)}
          </Button>
        </Notice>
      );
    case "incomplete":
      return (
        <Notice tone="warning" text={state.message} language={language}>
          <p className="text-[14px]">
            {primary(m.marksStillBlank, language)}: {state.blank.join(", ")}
          </p>
        </Notice>
      );
    case "invalid":
      return (
        <Notice tone="danger" text={state.message} language={language}>
          {state.who ? <p className="text-[14px]">{state.who}</p> : null}
        </Notice>
      );
    case "refused":
    case "error":
      return <Notice tone="danger" text={state.message} language={language} />;
  }
}
