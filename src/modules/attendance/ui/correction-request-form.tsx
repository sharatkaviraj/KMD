"use client";

import { useActionState, useState } from "react";

import { requestCorrectionAction } from "@/app/(app)/teach/actions";
import { m } from "@/messages";
import {
  attendanceLabels,
  attendanceStatuses,
  compareRoll,
  type AttendanceStatus,
  type RollStudent,
} from "@/modules/attendance/domain/attendance";
import { idleTeachState } from "@/modules/attendance/domain/teach-state";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Notice, Select, Textarea } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * Ask for a submitted mark to be changed.
 *
 * One form for the whole register rather than a control on every row: a
 * correction is rare and deliberate, and putting a button beside forty
 * children invites the tap that a locked register exists to prevent.
 *
 * The new status the child already has is left out of the list — asking to
 * change "absent" to "absent" is a request an approver has to read before
 * discovering it says nothing.
 */
export function CorrectionRequestForm({
  registerId,
  roll,
  existing,
}: {
  registerId: string;
  roll: RollStudent[];
  existing: Record<string, AttendanceStatus>;
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(
    requestCorrectionAction,
    idleTeachState,
  );

  const [studentId, setStudentId] = useState("");
  const current = existing[studentId];

  const sorted = [...roll].sort(compareRoll);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="registerId" value={registerId} />

      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      {state.status === "saved" && state.message ? (
        <Notice tone="success" text={state.message} language={language} />
      ) : null}

      <Field
        label={m.correctionChoose}
        htmlFor="correction-student"
        language={language}
      >
        <Select
          id="correction-student"
          name="studentId"
          required
          value={studentId}
          onChange={(event) => setStudentId(event.target.value)}
        >
          <option value="">—</option>
          {sorted.map((student) => (
            <option key={student.studentId} value={student.studentId}>
              {student.rollNo ? `${student.rollNo}. ` : ""}
              {student.fullName}
              {existing[student.studentId]
                ? ` — ${primary(attendanceLabels[existing[student.studentId]], language)}`
                : ""}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={m.correctionChangeTo}
        htmlFor="correction-status"
        language={language}
      >
        <Select id="correction-status" name="toStatus" required defaultValue="">
          <option value="">—</option>
          {attendanceStatuses
            .filter((status) => status !== current)
            .map((status) => (
              <option key={status} value={status}>
                {primary(attendanceLabels[status], language)}
              </option>
            ))}
        </Select>
      </Field>

      <Field
        label={m.correctionReason}
        htmlFor="correction-reason"
        language={language}
      >
        <Textarea
          id="correction-reason"
          name="reason"
          required
          minLength={3}
          maxLength={300}
          placeholder={primary(m.correctionReasonHint, language)}
        />
      </Field>

      <Button
        type="submit"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(m.correctionAsk, language)}
      </Button>
    </form>
  );
}
