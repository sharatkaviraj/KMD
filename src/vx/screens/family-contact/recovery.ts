import { contactCommand, contactRequest, CONTACT_UUID, type ContactCommand, type ContactRequest, type ContactScope } from "./domain";
export const CONTACT_RECOVERY_EVENT = "vx-contact-recovery";
export type ContactStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function validContactScope(scope: ContactScope | null): scope is ContactScope { return !!scope && CONTACT_UUID.test(scope.owner) && CONTACT_UUID.test(scope.studentId) && !!scope.sessionLabel && scope.sessionLabel.length <= 128; }
export const contactRecoveryKey = (scope: ContactScope) => `vx-contact:v1:${[scope.owner, scope.sessionLabel, scope.studentId].map(encodeURIComponent).join(":")}`;
export function decodeContactRecord(raw: string, scope: ContactScope): ContactRequest | null {
  if (!raw || raw.length > 6000) return null;
  try {
    const record = JSON.parse(raw), command = contactCommand(record.payload);
    if (record.version !== 1 || !command || command.owner !== scope.owner || command.sessionLabel !== scope.sessionLabel || command.studentId !== scope.studentId || JSON.stringify(command) !== JSON.stringify(record.payload)) return null;
    return contactRequest({ ...command, ...(record.dateCorrections === undefined ? {} : { dateCorrections: record.dateCorrections }) });
  } catch { return null; }
}
/** Compare the full reservation, append one date candidate, verify before send. */
export async function correctContactDate(storage: ContactStorage, scope: ContactScope, expectedRaw: string, agreedOn: string, stillOwns: () => boolean): Promise<ContactRequest | null> {
  try {
    if (!navigator.locks?.request) return null;
    return await navigator.locks.request(`vx-contact-lock:${contactRecoveryKey(scope)}`, () => {
      if (!stillOwns() || storage.getItem(contactRecoveryKey(scope)) !== expectedRaw) return null;
      const original = decodeContactRecord(expectedRaw, scope);
      if (!original) return null;
      const payload = contactRequest({ ...original, dateCorrections: [...(original.dateCorrections ?? []), agreedOn] });
      if (!payload) return null;
      const raw = JSON.stringify({ version: 1, payload: contactCommand(payload), dateCorrections: payload.dateCorrections });
      storage.setItem(contactRecoveryKey(scope), raw);
      return storage.getItem(contactRecoveryKey(scope)) === raw ? payload : null;
    });
  } catch { return null; }
}
export function contactSnapshot(scope: ContactScope | null): string {
  if (!validContactScope(scope) || typeof window === "undefined") return "unavailable";
  try { if (!navigator.locks?.request) return "unsupported"; return localStorage.getItem(contactRecoveryKey(scope)) ?? ""; } catch { return "unavailable"; }
}
export function contactStorage(): Storage | null { try { return window.localStorage; } catch { return null; } }
export async function reserveContact(storage: ContactStorage, scope: ContactScope, payload: ContactCommand, stillOwns: () => boolean): Promise<boolean> {
  const raw = JSON.stringify({ version: 1, payload });
  if (!decodeContactRecord(raw, scope)) return false;
  try {
    if (!navigator.locks?.request) return false;
    return await navigator.locks.request(`vx-contact-lock:${contactRecoveryKey(scope)}`, () => {
      if (!stillOwns() || storage.getItem(contactRecoveryKey(scope)) !== null) return false;
      storage.setItem(contactRecoveryKey(scope), raw);
      return storage.getItem(contactRecoveryKey(scope)) === raw;
    });
  } catch { return false; }
}
export async function clearContact(storage: ContactStorage, scope: ContactScope, attemptId: string, stillOwns: () => boolean): Promise<boolean> {
  try {
    if (!navigator.locks?.request) return false;
    return await navigator.locks.request(`vx-contact-lock:${contactRecoveryKey(scope)}`, () => {
      if (!stillOwns()) return false;
      const key = contactRecoveryKey(scope), raw = storage.getItem(key);
      if (raw === null) return true;
      if (decodeContactRecord(raw, scope)?.attemptId !== attemptId) return false;
      storage.removeItem(key);
      return storage.getItem(key) === null;
    });
  } catch { return false; }
}
export function notifyContactRecovery() { window.dispatchEvent(new Event(CONTACT_RECOVERY_EVENT)); }
export function subscribeContactRecovery(listener: () => void) {
  window.addEventListener("storage", listener); window.addEventListener(CONTACT_RECOVERY_EVENT, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(CONTACT_RECOVERY_EVENT, listener); };
}
