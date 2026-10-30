import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ session: 'TEST-2026-27', permitted: true, preview: false, found: true, queryError: false, filters: [] as Array<[string, unknown]>, commandStatus: 'error' as 'error' | 'saved' | 'stale' }));
const calls = vi.hoisted(() => ({ save: vi.fn(), check: vi.fn(), refresh: vi.fn() }));
// The test-session fence (Phase 3) has its own tests; here it lets everything through.
vi.mock("@/platform/auth/test-session-access", () => ({
  assertSessionWritable: async () => {},
  assertSessionVisible: async () => {},
  assertStudentVisible: async () => {},
  assertReceiptVisible: async () => {},
  assertFamilyVisible: async () => {},
  notFoundUnlessVisible: async (check: () => Promise<void>) => check(),
  refusalResponse: async () => null,
  currentSessionViewer: async () => null,
  filterVisibleStudentIds: async (_staff: unknown, ids: string[]) => ids,
}));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: calls.refresh }));
vi.mock('@/platform/auth/current-staff', () => ({ assertPermission: async () => { if (!fixture.permitted) throw Error('denied'); return { id: 'qa-coordinator' }; } }));
vi.mock('@/vx/view-as', () => ({ assertNotPreviewing: async () => { if (fixture.preview) throw Error('preview'); } }));
vi.mock('@/modules/academics/data/academics-repo', () => ({ resolveSessionLabel: async () => fixture.session, classLabelMap: vi.fn(), listSubjects: vi.fn() }));
vi.mock('@/modules/staff/data/staff-repo', () => ({ listStaff: vi.fn() }));
vi.mock('@/modules/substitutions/data/cover-repo', () => ({ coverDayRevision: vi.fn() }));
vi.mock('@/modules/timetable/data/timetable-repo', () => ({ createDraft: vi.fn(), getPublishedVersion: vi.fn(), listSlots: vi.fn(), publishVersion: vi.fn() }));
vi.mock('@/platform/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => {
  fixture.filters.push(['table', table]);
  const chain = { select: () => chain, eq: (field: string, value: unknown) => { fixture.filters.push([field, value]); return chain; }, maybeSingle: async () => ({ data: fixture.found ? { id: 'saved-command' } : null, error: fixture.queryError ? new Error('query failed') : null }) };
  return chain;
} }) }));
vi.mock('@/app/(app)/substitutions/actions', () => ({ coverCommandAction: calls.save, checkCoverCommandAction: calls.check }));
import { checkCoverAction, coverAction, type CoverInput } from '@/app/(app)/timetable/vx-actions';
const input: CoverInput = { commandId: '23456789-1234-4234-8234-123456789abc', sessionLabel: 'TEST-2026-27', day: '2026-11-03', dayRevision: 7, intent: 'release', needKey: 'class-slot-3' };
const receipt = { commandId: input.commandId, dayRevision: 8, assigned: 0, needsHelp: 0, added: 0, changed: 0, cancelled: 1, unchanged: 0, pinned: 0, skippedStarted: 0, noticesQueued: 0, noticesWithdrawn: 1, noticeRecipients: 0, recipientsWithoutPhone: 0, replayed: true };
describe('timetable cover recovery action boundary', () => {
  beforeEach(() => {
    fixture.session = input.sessionLabel; fixture.permitted = true; fixture.preview = false; fixture.found = true; fixture.queryError = false; fixture.filters = [];
    vi.clearAllMocks();
    calls.save.mockResolvedValue({ status: 'error', message: { en: 'Not saved', hi: 'नहीं' }, receipt: null });
    calls.check.mockResolvedValue({ status: 'saved', message: null, receipt });
  });
  it('keeps an uncertain commit distinct from definitive refusal', async () => { expect(await coverAction(input)).toMatchObject({ ok: false, status: 'uncertain' }); calls.save.mockResolvedValue({ status: 'stale', message: { en: 'Stale', hi: 'पुराना' }, receipt: null }); expect(await coverAction(input)).toMatchObject({ ok: false, status: 'refused' }); });
  it('forwards the original command, slot and revision without rebasing', async () => { await coverAction(input); const fd = calls.save.mock.calls[0][1] as FormData; expect(fd.get('commandId')).toBe(input.commandId); expect(fd.get('dayRevision')).toBe('7'); expect(fd.get('day')).toBe(input.day); expect(fd.get('needKey')).toBe(input.needKey); });
  it('keeps unresolved identity if the active session changes', async () => { fixture.session = 'OTHER'; expect(await coverAction(input)).toMatchObject({ status: 'uncertain' }); expect(await checkCoverAction(input)).toMatchObject({ status: 'uncertain' }); expect(calls.save).not.toHaveBeenCalled(); expect(calls.check).not.toHaveBeenCalled(); });
  it('scopes receipt lookup to command, owner, session and day', async () => { expect(await checkCoverAction(input)).toMatchObject({ ok: true, status: 'saved' }); expect(fixture.filters).toEqual([['table', 'cover_commands'], ['id', input.commandId], ['actor_staff_id', 'qa-coordinator'], ['session_label', input.sessionLabel], ['day', input.day]]); expect(calls.check).toHaveBeenCalledWith(input.commandId); expect(calls.save).not.toHaveBeenCalled(); });
  it('does not pretend a missing receipt means nothing committed', async () => { fixture.found = false; expect(await checkCoverAction(input)).toMatchObject({ ok: false, status: 'not_found' }); expect(calls.check).not.toHaveBeenCalled(); expect(calls.save).not.toHaveBeenCalled(); });
  it('a failed read does not become permission to discard or resubmit', async () => { fixture.queryError = true; await expect(checkCoverAction(input)).rejects.toThrow('Could not check'); expect(calls.check).not.toHaveBeenCalled(); expect(calls.save).not.toHaveBeenCalled(); });
  it.each(['permission', 'preview'])('rechecks %s before recovery lookup', async boundary => { if (boundary === 'permission') fixture.permitted = false; else fixture.preview = true; await expect(checkCoverAction(input)).rejects.toThrow(); expect(fixture.filters).toEqual([]); expect(calls.check).not.toHaveBeenCalled(); });
});
