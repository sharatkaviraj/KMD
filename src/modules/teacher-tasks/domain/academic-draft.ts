import { z } from "zod";
import { markEntryStates, saveMarksSchema } from "@/modules/assessments/domain/marks-command";
import { attendanceStatuses, saveRegisterSchema } from "@/modules/attendance/domain/attendance";
import type { AcademicWork } from "../data/repo";

const draftSchema = z.object({
  rows: z.array(z.object({ id: z.string(), state: z.string(), value: z.number().finite().nullable() })),
  reason: z.string().max(300),
  command: z.object({ payload: z.unknown() }).nullable(),
});
export type AcademicDraft = z.infer<typeof draftSchema>;

export function validAcademicDraft(work: AcademicWork, value: unknown): value is AcademicDraft {
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) return false;
  const draft = parsed.data;
  const expected = work.rows.map(r => r.id).sort();
  const exact = (ids: string[]) => JSON.stringify(ids.sort()) === JSON.stringify(expected);
  if (!exact(draft.rows.map(r => r.id))) return false;
  const states: readonly string[] = work.kind === "marks" ? markEntryStates : attendanceStatuses;
  if (draft.rows.some(r => !states.includes(r.state))) return false;
  if (!draft.command) return true;
  if (work.kind === "marks") {
    const command = saveMarksSchema.safeParse(draft.command.payload);
    return command.success && command.data.kind !== "reopen" && command.data.paperId === work.paperId
      && exact(command.data.entries.map(r => r.studentId));
  }
  const command = saveRegisterSchema.safeParse(draft.command.payload);
  return command.success && command.data.classId === work.classId && command.data.day === work.day
    && exact(command.data.marks.map(r => r.studentId));
}

export function academicDraftValue(rows: AcademicWork["rows"], reason: string, command: AcademicDraft["command"]): AcademicDraft {
  return { rows: rows.map(({ id, state, value }) => ({ id, state, value })), reason, command };
}
