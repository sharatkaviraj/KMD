"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";

import { saveMarksAction } from "@/app/(app)/assessments/actions";
import { draftKey, isStringRecord } from "@/platform/drafts/policy";
import { useDurableDraft } from "@/platform/drafts/use-durable-draft";
import { DraftStatus } from "@/ui/draft-status";
import { recordPerformance } from "@/platform/performance/record";
import { m } from "@/messages";
import {
  checkMark,
  type AssessmentSubject,
} from "@/modules/assessments/domain/assessments";
import { idleAssessmentState } from "@/modules/assessments/domain/form-state";
import type { RollStudent } from "@/modules/attendance/domain/attendance";
import { countOf, primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { cn } from "@/platform/utils";
import { Input, Notice, Textarea } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";

type MarksDraft = { values: Record<string, string>; absent: string[]; reason: string };
function isMarksDraft(value: unknown): value is MarksDraft {
  return Boolean(value && typeof value === "object" && "values" in value && isStringRecord(value.values) && "absent" in value && Array.isArray(value.absent) && value.absent.every(id => typeof id === "string") && "reason" in value && typeof value.reason === "string");
}

/**
 * One column of the grid: a paper, and every child who sat it.
 *
 * **Three states per cell, and the screen shows all three.** A blank is
 * nobody having entered it yet, "Absent" is a child who did not sit the paper,
 * and a number is a number — including nought, which is a real mark somebody
 * gave. A grid that collapsed the first and the last would make "who has not
 * entered yet" unanswerable, which is the question this whole screen exists to
 * answer.
 *
 * The whole column saves in one request, like the attendance register and for
 * the same reason: a teacher on a bad connection must not end up with half a
 * column written.
 */
export function MarksGrid({
  paper,
  ownerId,
  sessionLabel,
  roll,
  marks,
  locked,
  lockedReason,
}: {
  paper: AssessmentSubject;
  ownerId: string;
  sessionLabel: string;
  roll: RollStudent[];
  marks: Record<string, { value: number | null; absent: boolean }>;
  locked: boolean;
  lockedReason: typeof m.marksLocked | null;
}) {
  const language = useLanguage();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      roll.map((student) => {
        const mark = marks[student.studentId];
        return [
          student.studentId,
          mark?.value === null || mark?.value === undefined ? "" : String(mark.value),
        ];
      }),
    ),
  );

  const [absent, setAbsent] = useState<Set<string>>(
    () =>
      new Set(
        roll
          .filter((student) => marks[student.studentId]?.absent)
          .map((student) => student.studentId),
      ),
  );

  const [reason, setReason] = useState("");
  const current = useRef<MarksDraft>({ values, absent: [...absent], reason: "" });
  const draft = useDurableDraft(draftKey(ownerId, sessionLabel, `marks/${paper.id}`), JSON.stringify({ marks, ids: roll.map(row => row.studentId), max: paper.maxMarks }), isMarksDraft);
  const [state, action, pending] = useActionState(async (previous: typeof idleAssessmentState, formData: FormData) => {
    try {
      const started = performance.now();
      const result = await saveMarksAction(previous, formData);
      if (result.status === "saved") recordPerformance("form_saved", performance.now() - started);
      if (result.status === "saved") await draft.clear();
      return result;
    } catch { return { ...idleAssessmentState, status: "error" as const, message: m.notSaved }; }
  }, idleAssessmentState);
  const edit = (next: MarksDraft) => {
    if (locked || pending) return;
    current.current = next;
    setValues(next.values); setAbsent(new Set(next.absent)); setReason(next.reason);
    void draft.persist(next);
  };
  const restore = () => {
    const saved = draft.recovered?.value;
    if (!saved || locked || pending) return;
    const known = new Set(roll.map(row => row.studentId));
    edit({ values: Object.fromEntries(Object.entries(saved.values).filter(([id]) => known.has(id))), absent: saved.absent.filter(id => known.has(id)), reason: saved.reason });
    draft.dismissRecovery();
  };

  const errors = useMemo(() => {
    const found: Record<string, string> = {};
    for (const student of roll) {
      if (absent.has(student.studentId)) continue;
      const checked = checkMark(values[student.studentId], paper);
      if (!checked.ok) found[student.studentId] = primary(checked.error, language);
    }
    return found;
  }, [values, absent, roll, paper, language]);

  const hasErrors = Object.keys(errors).length > 0;

  const entered = roll.filter(
    (student) =>
      absent.has(student.studentId) ||
      (values[student.studentId] ?? "").trim() !== "",
  ).length;

  // Whether anything here differs from what is stored. A teacher who opens a
  // finished column and closes it should not be told she changed nothing —
  // she should not be offered the button at all.
  const dirty = useMemo(
    () =>
      roll.some((student) => {
        const stored = marks[student.studentId];
        const wasAbsent = stored?.absent ?? false;
        const isAbsent = absent.has(student.studentId);
        if (wasAbsent !== isAbsent) return true;
        const was = stored?.value === null || stored?.value === undefined
          ? ""
          : String(stored.value);
        return (values[student.studentId] ?? "") !== was;
      }),
    [roll, marks, values, absent],
  );

  if (roll.length === 0) {
    return <EmptyState title={m.attendanceEmptyRoll} language={language} />;
  }

  return (
    <form action={action} aria-busy={pending} data-work-form="true" onSubmit={event => {
      const input = event.currentTarget.elements.namedItem("payload") as HTMLInputElement;
      const snapshot = current.current;
      input.value = JSON.stringify(roll.map(student => ({ studentId: student.studentId, value: snapshot.values[student.studentId] ?? "", absent: snapshot.absent.includes(student.studentId) })));
    }} className="space-y-4">
      <input type="hidden" name="sessionLabel" value={sessionLabel} />
      <input type="hidden" name="paperId" value={paper.id} />
      <input type="hidden" name="payload" defaultValue="" />

      <DraftStatus status={draft.status} online={draft.online} recovered={!locked && Boolean(draft.recovered)} changed={draft.changedSinceDraft} onRestore={restore} onDiscard={() => { if (!pending) void draft.discard(); }} language={language} />
      {lockedReason ? (
        <Notice tone="info" text={lockedReason} language={language} />
      ) : null}

      {state.message ? (
        <Notice
          tone={state.status === "error" ? "danger" : "success"}
          text={state.message}
          language={language}
        />
      ) : null}

      <div className="sticky top-14 z-30 -mx-4 border-b border-border bg-background px-4 py-2">
        <p className="text-[14px] text-muted-foreground">
          <span className="font-semibold text-foreground">
            {countOf(entered, roll.length, language)}
          </span>{" "}
          {primary(m.marksEntered, language)} · {primary(m.paperMax, language)}{" "}
          {paper.maxMarks}
        </p>
      </div>

      <ul className="space-y-1.5">
        {roll.map((student) => {
          const isAbsent = absent.has(student.studentId);
          const error = errors[student.studentId];

          return (
            <li
              key={student.studentId}
              className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2"
            >
              <span className="w-7 shrink-0 text-[13px] font-semibold tabular-nums text-subtle-foreground">
                {student.rollNo ?? "—"}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-foreground">
                  {student.fullName}
                </span>
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
                // without the spinner or the scroll-to-change behaviour that
                // silently rewrites a mark somebody is reading past.
                inputMode="decimal"
                value={isAbsent ? "" : (values[student.studentId] ?? "")}
                disabled={locked || pending || isAbsent}
                onChange={(event) =>
                  edit({ ...current.current, values: { ...current.current.values, [student.studentId]: event.target.value } })
                }
                aria-invalid={Boolean(error)}
                className="h-11 w-20 shrink-0 text-center"
              />

              <button
                type="button"
                disabled={locked || pending}
                onClick={() =>
                  edit({ ...current.current, absent: current.current.absent.includes(student.studentId) ? current.current.absent.filter(id => id !== student.studentId) : [...current.current.absent, student.studentId] })
                }
                aria-pressed={isAbsent}
                className={cn(
                  "focus-ring min-h-11 shrink-0 rounded-xl border px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-60",
                  isAbsent
                    ? "border-destructive bg-destructive-soft text-destructive-soft-foreground"
                    : "border-border bg-surface text-muted-foreground",
                )}
              >
                {primary(m.marksAbsent, language)}
              </button>
            </li>
          );
        })}
      </ul>

      {!locked ? (
        <>
          {/* Asked for only when something is being changed rather than
              entered: a reason on a first entry is ceremony, and a form that
              asks for one every time is a form people type "." into. */}
          <Textarea
            name="reason"
            value={reason}
            disabled={pending}
            onChange={event => edit({ ...current.current, reason: event.target.value })}
            rows={2}
            maxLength={300}
            placeholder={primary(m.marksChangeReasonHint, language)}
            className="min-h-16"
          />

          <div className="work-action safe-bottom sticky bottom-0 -mx-4 border-t border-border bg-background px-4 pt-3">
            <Button
              type="submit"
              fullWidth
              size="lg"
              loading={pending}
              loadingText={primary(m.saving, language)}
              disabled={hasErrors || !dirty || !draft.online}
            >
              {primary(m.marksSaveRow, language)}
            </Button>
            <p className="mt-1.5 pb-3 text-center text-[12px] text-subtle-foreground">
              {paper.classLabel} · {paper.subjectCode}
            </p>
          </div>
        </>
      ) : null}
    </form>
  );
}
