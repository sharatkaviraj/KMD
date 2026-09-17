"use client";

import { useActionState, useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";

import { saveMarksAction } from "@/app/(app)/assessments/actions";
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
  roll,
  marks,
  locked,
  lockedReason,
}: {
  paper: AssessmentSubject;
  roll: RollStudent[];
  marks: Record<string, { value: number | null; absent: boolean }>;
  locked: boolean;
  lockedReason: typeof m.marksLocked | null;
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(
    saveMarksAction,
    idleAssessmentState,
  );

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

  const payload = roll.map((student) => ({
    studentId: student.studentId,
    value: values[student.studentId] ?? "",
    absent: absent.has(student.studentId),
  }));

  if (roll.length === 0) {
    return <EmptyState title={m.attendanceEmptyRoll} language={language} />;
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="paperId" value={paper.id} />
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

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

      <div className="sticky top-14 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
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
                disabled={locked || isAbsent}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [student.studentId]: event.target.value,
                  }))
                }
                aria-invalid={Boolean(error)}
                className="h-11 w-20 shrink-0 text-center"
              />

              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  setAbsent((current) => {
                    const next = new Set(current);
                    if (next.has(student.studentId)) next.delete(student.studentId);
                    else next.add(student.studentId);
                    return next;
                  })
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
            rows={2}
            maxLength={300}
            placeholder={primary(m.marksChangeReasonHint, language)}
            className="min-h-16"
          />

          <div className="safe-bottom sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 pt-3 backdrop-blur">
            <Button
              type="submit"
              fullWidth
              size="lg"
              loading={pending}
              loadingText={primary(m.saving, language)}
              disabled={hasErrors || !dirty}
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
