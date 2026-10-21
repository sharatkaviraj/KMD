import { p } from '@/vx/text';

const KEY = 'phoneops-class-followup-ledger';
type Payload = { commandId: string; marks: { studentId: string; status: string }[] };
type Register = Payload & { revision: number; alerts: boolean };
type Ledger = { attendance: Register[]; notes: Record<string, unknown>[]; attendanceAttempts: number; noteAttempts: number };
const empty = (): Ledger => ({ attendance: [], notes: [], attendanceAttempts: 0, noteAttempts: 0 });
export function snapshot(): Ledger { return JSON.parse(localStorage.getItem(KEY) ?? JSON.stringify(empty())); }
const persist = (value: Ledger) => localStorage.setItem(KEY, JSON.stringify(value));
let loseAnswer = false;
let loseNoteAnswer = false;
const receipt = () => ({ savedAt: '2026-10-11T08:00:00Z', registerId: '00000000-0000-4000-8000-000000000099', revision: 1 });
export async function saveRegisterVx(raw: string, alerts: boolean) {
  if (!navigator.onLine) throw new Error('Synthetic attendance transport is offline');
  const value = snapshot(); value.attendanceAttempts += 1;
  const payload = JSON.parse(raw) as Payload;
  if (!value.attendance.some(row => row.commandId === payload.commandId)) value.attendance.push({ ...payload, revision: 1, alerts });
  persist(value);
  if (loseAnswer) { loseAnswer = false; throw new Error('Synthetic committed answer was lost'); }
  return { status: 'saved' as const, receipt: receipt() };
}
export async function checkRegisterVx(commandId: string) {
  if (!navigator.onLine) throw new Error('Synthetic attendance readback is offline');
  return snapshot().attendance.some(row => row.commandId === commandId)
    ? { status: 'saved' as const, receipt: receipt() }
    : { status: 'error' as const, message: p('Not yet recorded', '') };
}
export async function createNoteAction(input: Record<string, unknown>) {
  const value = snapshot(); value.noteAttempts += 1; persist(value);
  // Model the framework rejecting its server-action promise before any write.
  if (!navigator.onLine) throw new Error('Synthetic note transport is offline');
  value.notes.push({ ...input, id: `qa-note-${value.notes.length + 1}` }); persist(value);
  if (loseNoteAnswer) { loseNoteAnswer = false; throw new Error('Synthetic committed note answer was lost'); }
  return { ok: true as const, id: `qa-note-${value.notes.length}` };
}
const refuse = async (...args: unknown[]) => { void args; return { ok: false as const, error: p('Synthetic unrelated action refused', '') }; };
export const addPlanStepAction = refuse;
export const closePlanAction = refuse;
export const createPlanAction = refuse;
export const removePlanStepAction = refuse;
export const replyToNoteAction = refuse;
export const setFollowUpAction = refuse;
export const setNoteStatusAction = refuse;
export const tellParentsAboutNoteAction = refuse;
export const tellParentsAboutPlanAction = refuse;
export const togglePlanStepAction = refuse;
export const undoNoteAction = refuse;
export const saveLanguageAction = refuse;
export const setViewAsAction = refuse;
export const requestLeaveVx = refuse;
// Leave preview reads the timetable; the synthetic class has none to show.
export const previewLeaveVx = async () => ({ ok: false as const });
declare global {
  interface Window { classFollowup: { snapshot: typeof snapshot; loseNextAttendanceAnswer: () => void; loseNextNoteAnswer: () => void } }
}
window.classFollowup = { snapshot, loseNextAttendanceAnswer: () => { loseAnswer = true; }, loseNextNoteAnswer: () => { loseNoteAnswer = true; } };

// Added for the 21 Oct smoke fixes: this fixture never exercises it.
export const editNoteAction = refuse;
