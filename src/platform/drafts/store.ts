import type { DraftEnvelope } from './policy';

const operations = new Map<string, Promise<unknown>>();
let connection: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('vppsone-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
  });
  return connection.catch((error) => { connection = undefined; throw error; });
}

async function transaction(key: string, action: 'read' | 'write' | 'remove', value?: DraftEnvelope): Promise<unknown> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', action === 'read' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('drafts');
    const request = action === 'read' ? store.get(key) : action === 'write' ? store.put(value, key) : store.delete(key);
    tx.oncomplete = () => resolve(request.result ?? null);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Draft write aborted'));
  });
}

async function access(key: string, action: 'read' | 'write' | 'remove', value?: DraftEnvelope): Promise<unknown> {
  let primary: unknown = null;
  let primarySucceeded = false;
  try {
    if (typeof indexedDB !== 'undefined') {
      primary = await transaction(key, action, value);
      primarySucceeded = true;
    }
  } catch { /* Browser storage below is the fallback. */ }
  if (action === 'read') {
    let fallback: { updatedAt?: number; deleted?: boolean } | null = null;
    try {
      const raw = localStorage.getItem(key);
      fallback = raw ? JSON.parse(raw) : null;
    } catch (error) { if (!primarySucceeded) throw error; }
    const time = (primary as { updatedAt?: number } | null)?.updatedAt ?? -1;
    if (fallback && (fallback.updatedAt ?? 0) >= time) return fallback.deleted ? null : fallback;
    return primary;
  }
  if (action === 'remove') {
    // A tombstone also hides a stale IDB copy if the database is temporarily blocked.
    try { localStorage.setItem(key, JSON.stringify({ deleted: true, updatedAt: Date.now() })); }
    catch (error) { if (!primarySucceeded) throw error; }
    return null;
  }
  if (primarySucceeded) {
    try { localStorage.removeItem(key); } catch { /* Primary copy is confirmed. */ }
  } else localStorage.setItem(key, JSON.stringify(value));
  return null;
}

function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (operations.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  operations.set(key, next);
  void next.finally(() => { if (operations.get(key) === next) operations.delete(key); }).catch(() => undefined);
  return next;
}

export const loadDraft = (key: string) => serial(key, () => access(key, 'read'));
export const saveDraft = (key: string, value: DraftEnvelope) => serial(key, () => access(key, 'write', value));
export const removeDraft = (key: string) => serial(key, () => access(key, 'remove'));
export const flushDraftWrites = async () => { await Promise.all([...operations.values()]); };
