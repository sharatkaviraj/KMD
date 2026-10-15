import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCoverRecord, coverRecoveryKey, decodeCoverRecord, persistCoverRecord, takeAutoCheck, type CoverStorage } from '@/vx/screens/timetable/cover-recovery';
import type { CoverInput } from '@/app/(app)/timetable/vx-actions';
const scope = { owner: 'qa-coordinator', session: 'TEST-2026-27', day: '2026-11-03' };
const payload: CoverInput = { commandId: '23456789-1234-4234-8234-123456789abc', sessionLabel: scope.session, day: scope.day, dayRevision: 7, intent: 'release', needKey: 'class-slot-3' };
function memory(): CoverStorage { const values = new Map<string, string>(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }; }
describe('cover request recovery identity', () => {
  beforeEach(() => vi.stubGlobal('navigator', { locks: { request: async (_name: string, callback: () => boolean) => callback() } }));
  afterEach(() => vi.unstubAllGlobals());
  it('preserves original revision, command and slot exactly', async () => { const store = memory(); expect(await persistCoverRecord(store, scope, payload)).toBe(true); expect(decodeCoverRecord(store.getItem(coverRecoveryKey(scope))!, scope)?.payload).toEqual(payload); });
  it.each([{ ...scope, owner: 'other' }, { ...scope, session: 'OTHER' }, { ...scope, day: '2026-11-04' }])('does not restore another scope %j', other => { const raw = JSON.stringify({ version: 1, owner: scope.owner, payload }); expect(decodeCoverRecord(raw, other)).toBeNull(); expect(coverRecoveryKey(other)).not.toBe(coverRecoveryKey(scope)); });
  it('does not replace an unresolved command', async () => { const store = memory(); await persistCoverRecord(store, scope, payload); expect(await persistCoverRecord(store, scope, { ...payload, commandId: '33456789-1234-4234-8234-123456789abc' })).toBe(false); });
  it('fails closed when storage cannot preserve the command', async () => { const store = memory(); store.setItem = () => { throw Error('quota'); }; expect(await persistCoverRecord(store, scope, payload)).toBe(false); });
  it('refuses reservation and clear without scoped browser locks', async () => { vi.stubGlobal('navigator', {}); const store = memory(); expect(await persistCoverRecord(store, scope, payload)).toBe(false); store.setItem(coverRecoveryKey(scope), JSON.stringify({ version: 1, owner: scope.owner, payload })); expect(await clearCoverRecord(store, scope, payload.commandId)).toBe(false); expect(store.getItem(coverRecoveryKey(scope))).not.toBeNull(); });
  it('retains a committed request if local clearing fails', async () => { const store = memory(); await persistCoverRecord(store, scope, payload); store.removeItem = () => { throw Error('storage blocked'); }; expect(await clearCoverRecord(store, scope, payload.commandId)).toBe(false); expect(decodeCoverRecord(store.getItem(coverRecoveryKey(scope))!, scope)?.payload).toEqual(payload); });
  it('never clears a different command', async () => { const store = memory(); await persistCoverRecord(store, scope, payload); expect(await clearCoverRecord(store, scope, '33456789-1234-4234-8234-123456789abc')).toBe(false); expect(await clearCoverRecord(store, scope, payload.commandId)).toBe(true); });
  it('retains the identity if its viewer changes while clear waits for the lock', async () => {
    const store = memory(); await persistCoverRecord(store, scope, payload);
    let acquire!: () => void; let owns = true;
    vi.stubGlobal('navigator', { locks: { request: (_name: string, callback: () => boolean) => new Promise<boolean>(resolve => { acquire = () => resolve(callback()); }) } });
    const clearing = clearCoverRecord(store, scope, payload.commandId, () => owns);
    owns = false; acquire();
    expect(await clearing).toBe(false); expect(decodeCoverRecord(store.getItem(coverRecoveryKey(scope))!, scope)?.payload).toEqual(payload);
  });
  it.each(['broken', JSON.stringify({ version: 1, owner: scope.owner, payload: { ...payload, dayRevision: -1 } }), JSON.stringify({ version: 1, owner: scope.owner, payload: { ...payload, intent: 'assign' } })])('rejects invalid or incomplete persisted payload', raw => { expect(decodeCoverRecord(raw, scope)).toBeNull(); });
});
describe('cover request auto-check (school-day run B2/B9)', () => {
  it('checks an unresolved command once, by itself, when nothing else is in flight', () => {
    const checked = new Set<string>();
    expect(takeAutoCheck(checked, null, false)).toBe(false);
    expect(takeAutoCheck(checked, payload.commandId, true)).toBe(false);
    expect(takeAutoCheck(checked, payload.commandId, false)).toBe(true);
    expect(takeAutoCheck(checked, payload.commandId, false)).toBe(false);
    expect(takeAutoCheck(checked, '33456789-1234-4234-8234-123456789abc', false)).toBe(true);
  });
});
