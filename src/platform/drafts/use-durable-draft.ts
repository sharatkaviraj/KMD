"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { readDraft, type DraftEnvelope } from './policy';
import { loadDraft, saveDraft, removeDraft } from './store';

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => { window.removeEventListener('online', callback); window.removeEventListener('offline', callback); };
}
export const onlineSnapshot = () => navigator.onLine;
export const onlineServerSnapshot = () => true;

export function useOnline() { return useSyncExternalStore(subscribeOnline, onlineSnapshot, onlineServerSnapshot); }

export function useDurableDraft<T>(key: string, baseline: string, validate: (value: unknown) => value is T) {
  const [recovered, setRecovered] = useState<DraftEnvelope<T> | null>(null);
  const [status, setStatus] = useState<'idle' | 'writing' | 'local' | 'school' | 'error'>('idle');
  const generation = useRef(0);
  const validator = useRef(validate);
  const online = useOnline();

  useEffect(() => { validator.current = validate; }, [validate]);
  useEffect(() => {
    let cancelled = false;
    const startedAt = generation.current;
    void loadDraft(key).then((raw) => {
      if (!cancelled && generation.current === startedAt) setRecovered(readDraft(raw, validator.current));
    }).catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [key]);

  const persist = useCallback((value: T) => {
    const current = ++generation.current;
    setStatus('writing');
    setRecovered(null);
    return saveDraft(key, { version: 1, baseline, value, updatedAt: Date.now() }).then(() => {
      if (generation.current === current) setStatus('local');
    }).catch(() => {
      if (generation.current === current) setStatus('error');
    });
  }, [key, baseline]);

  const clear = useCallback(async () => {
    const current = ++generation.current;
    try {
      await removeDraft(key);
      if (generation.current === current) { setStatus('school'); setRecovered(null); }
    } catch { if (generation.current === current) setStatus('error'); }
  }, [key]);

  const discard = useCallback(async () => {
    const current = ++generation.current;
    try {
      await removeDraft(key);
      if (generation.current === current) { setStatus('idle'); setRecovered(null); }
    } catch { if (generation.current === current) setStatus('error'); }
  }, [key]);

  return { recovered, status, online, persist, clear, discard, dismissRecovery: () => setRecovered(null), changedSinceDraft: recovered !== null && recovered.baseline !== baseline };
}
