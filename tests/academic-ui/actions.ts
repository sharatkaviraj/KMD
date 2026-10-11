export type CoverInput = { commandId: string; day: string; dayRevision: number; intent: string; needKey?: string; coveringStaffId?: string; staffProfileId?: string; periods?: number[] };
export type TimetableResult = { ok: boolean; message: { en: string; hi: string } };
const result = { ok: true, message: { en: "Synthetic action recorded", hi: "परीक्षण दर्ज" } };
export async function coverAction(input: CoverInput) { document.getElementById("qa-command")!.textContent = JSON.stringify(input); return result; }
export async function decideLeaveAction() { return result; }
export async function discardChangeAction() { return result; }
export async function publishChangesAction() { return result; }
export async function requestLeaveAction() { return result; }
export async function saveChangeAction() { return result; }
