export type CoverInput = { commandId: string; sessionLabel: string; day: string; dayRevision: number; intent: 'absence' | 'clear_absence' | 'assign' | 'release' | 'refresh'; needKey?: string; coveringStaffId?: string; staffProfileId?: string; periods?: number[] };
export type TimetableResult = { ok: boolean; message: { en: string; hi: string } };
export type CoverActionResult = TimetableResult & { status: 'saved' | 'refused' | 'uncertain' | 'not_found' };
const result = { ok: true, message: { en: "Synthetic action recorded", hi: "परीक्षण दर्ज" } };
type Ledger = { calls: CoverInput[]; committed: string[]; checks: string[]; effects: number };
function ledger(): Ledger { return JSON.parse(localStorage.getItem('qa-cover-ledger') ?? '{"calls":[],"committed":[],"checks":[],"effects":0}'); }
function saveLedger(value: Ledger) { localStorage.setItem('qa-cover-ledger', JSON.stringify(value)); document.getElementById('qa-ledger')!.textContent = JSON.stringify(value); }
export async function coverAction(input: CoverInput): Promise<CoverActionResult> {
  document.getElementById("qa-command")!.textContent = JSON.stringify(input);
  if (sessionStorage.getItem('qa-cover-delay-post') === '1') {
    const gate = window as unknown as { qaPostWaiting: boolean; qaReleasePost: () => void; qaPostSettled: boolean };
    gate.qaPostWaiting = true;
    await new Promise<void>(resolve => { gate.qaReleasePost = resolve; });
    // A later task lets the consumer's awaited result/lock continuation settle.
    window.setTimeout(() => { gate.qaPostSettled = true; }, 100);
  }
  const mode = sessionStorage.getItem('qa-cover-mode');
  if (!mode) return { ...result, status: 'saved' as const };
  const value = ledger(); value.calls.push(input);
  if (value.calls.length === 1) {
    if (mode === 'landed') { value.committed.push(input.commandId); value.effects++; }
    saveLedger(value);
    return { ok: false, status: 'uncertain' as const, message: { en: 'Synthetic response lost; result uncertain', hi: 'अनिश्चित' } };
  }
  if (!value.committed.includes(input.commandId)) { value.committed.push(input.commandId); value.effects++; }
  saveLedger(value);
  return { ...result, status: 'saved' as const };
}
export async function checkCoverAction(input: CoverInput): Promise<CoverActionResult> {
  if (sessionStorage.getItem('qa-cover-delay-check') === '1') {
    const gate = window as unknown as { qaCheckWaiting: boolean; qaReleaseCheck: () => void };
    gate.qaCheckWaiting = true;
    await new Promise<void>(resolve => { gate.qaReleaseCheck = resolve; });
  }
  const value = ledger(); value.checks.push(input.commandId); saveLedger(value);
  return value.committed.includes(input.commandId) ? { ...result, status: 'saved' as const } : { ok: false, status: 'not_found' as const, message: { en: 'No receipt found yet; retry the same save', hi: 'फिर जाँचें' } };
}
export async function decideLeaveAction() { return result; }
export async function discardChangeAction() { return result; }
export async function publishChangesAction() { return result; }
export async function requestLeaveAction() { return result; }
export async function saveChangeAction() { return result; }

// Added for the 21 Oct smoke fixes: this fixture never exercises it.
export async function lateCoverAction(..._args: unknown[]): Promise<never> { throw new Error("Not available in this fixture."); }
