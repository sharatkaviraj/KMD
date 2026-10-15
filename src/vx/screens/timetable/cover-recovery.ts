import type { CoverInput } from '@/app/(app)/timetable/vx-actions';

export type CoverScope = { owner: string; session: string; day: string };
export type CoverRecord = { version: 1; owner: string; payload: CoverInput };
export type CoverStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const COVER_RECOVERY_EVENT = 'vx-cover-recovery';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function coverRecoveryKey(scope: CoverScope) {
  return `vx-cover:v1:${encodeURIComponent(scope.owner)}:${encodeURIComponent(scope.session)}:${scope.day}`;
}

/** A local draft cannot change which owner, session, day or slot is retried. */
export function decodeCoverRecord(raw: string, scope: CoverScope): CoverRecord | null {
  if (!raw || raw.length > 16000) return null;
  try {
    const value = JSON.parse(raw) as CoverRecord;
    const payload = value?.payload;
    if (value.version !== 1 || value.owner !== scope.owner || !payload || payload.sessionLabel !== scope.session || payload.day !== scope.day || !UUID.test(payload.commandId) || !Number.isInteger(payload.dayRevision) || payload.dayRevision < 0) return null;
    if (!['absence', 'clear_absence', 'assign', 'release', 'refresh'].includes(payload.intent)) return null;
    if (payload.intent === 'absence' || payload.intent === 'clear_absence') {
      if (!payload.staffProfileId || !UUID.test(payload.staffProfileId)) return null;
    }
    if (payload.intent === 'absence' && (!Array.isArray(payload.periods) || payload.periods.length === 0 || payload.periods.some(period => !Number.isInteger(period) || period < 0 || period > 7) || new Set(payload.periods).size !== payload.periods.length)) return null;
    if ((payload.intent === 'release' || payload.intent === 'assign') && (typeof payload.needKey !== 'string' || payload.needKey.length === 0 || payload.needKey.length > 500)) return null;
    if (payload.intent === 'assign' && (!payload.coveringStaffId || !UUID.test(payload.coveringStaffId))) return null;
    return value;
  } catch { return null; }
}

export function readCoverSnapshot(scope: CoverScope | null): string {
  if (!scope || typeof window === 'undefined') return 'loading';
  try { if (!navigator.locks?.request) return 'unsupported'; return localStorage.getItem(coverRecoveryKey(scope)) ?? ''; }
  catch { return 'unavailable'; }
}

export function browserCoverStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Do not send unless the identity can survive a reload. Never overwrite one. */
export async function persistCoverRecord(storage: CoverStorage, scope: CoverScope, payload: CoverInput): Promise<boolean> {
  const raw = JSON.stringify({ version: 1, owner: scope.owner, payload });
  if (!decodeCoverRecord(raw, scope)) return false;
  try {
    if (!navigator.locks?.request) return false;
    return await navigator.locks.request(`vx-cover-lock:${coverRecoveryKey(scope)}`, () => {
      const key = coverRecoveryKey(scope);
      if (storage.getItem(key) !== null) return false;
      storage.setItem(key, raw);
      return storage.getItem(key) === raw;
    });
  } catch { return false; }
}

/** Clear only this command, after a definite server answer; failure retains it. */
export async function clearCoverRecord(storage: CoverStorage, scope: CoverScope, commandId: string, mayClear: () => boolean = () => true): Promise<boolean> {
  try {
    if (!navigator.locks?.request) return false;
    return await navigator.locks.request(`vx-cover-lock:${coverRecoveryKey(scope)}`, () => {
      if (!mayClear()) return false;
      const key = coverRecoveryKey(scope);
      const raw = storage.getItem(key);
      if (raw === null) return true;
      if (decodeCoverRecord(raw, scope)?.payload.commandId !== commandId) return false;
      storage.removeItem(key);
      return storage.getItem(key) === null;
    });
  } catch { return false; }
}

export function subscribeCoverRecovery(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(COVER_RECOVERY_EVENT, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(COVER_RECOVERY_EVENT, listener); };
}

export function notifyCoverRecovery() { window.dispatchEvent(new Event(COVER_RECOVERY_EVENT)); }

/**
 * Whether the screen should check an unresolved command by itself now: once
 * per command, and never while another cover request is in flight. A saved
 * command then clears and unblocks the screen without anybody finding "Check
 * saved result" (school-day run B2/B9); a check that fails leaves the buttons.
 */
export function takeAutoCheck(checked: Set<string>, commandId: string | null | undefined, busy: boolean): boolean {
  if (!commandId || busy || checked.has(commandId)) return false;
  checked.add(commandId);
  return true;
}
