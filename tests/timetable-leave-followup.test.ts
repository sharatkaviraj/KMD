import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  expectedReads: 1,
  readers: [] as Array<() => void>,
  row: { id: '23456789-1234-4234-8234-123456789abc', session_label: 'QA-FOLLOWUP', staff_profile_id: '33456789-1234-4234-8234-123456789abc', from_day: '2026-11-02', to_day: '2026-11-03', span: 'full', status: 'asked' },
  decisions: [] as Array<{ status: string; affected: number }>,
  error: false,
}));
const calls = vi.hoisted(() => ({ cover: vi.fn(), revision: vi.fn(), refresh: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: calls.refresh }));
vi.mock('@/platform/auth/current-staff', () => ({ assertPermission: async () => ({ id: 'qa-coordinator' }) }));
vi.mock('@/vx/view-as', () => ({ assertNotPreviewing: async () => {} }));
vi.mock('@/platform/dates', () => ({ schoolToday: () => '2026-11-02' }));
vi.mock('@/modules/academics/data/academics-repo', () => ({ resolveSessionLabel: async () => 'QA-FOLLOWUP', classLabelMap: vi.fn(), listSubjects: vi.fn() }));
vi.mock('@/modules/staff/data/staff-repo', () => ({ listStaff: vi.fn() }));
vi.mock('@/modules/substitutions/data/cover-repo', () => ({ coverDayRevision: calls.revision }));
vi.mock('@/modules/timetable/data/timetable-repo', () => ({ createDraft: vi.fn(), getPublishedVersion: vi.fn(), listSlots: vi.fn(), publishVersion: vi.fn() }));
vi.mock('@/app/(app)/substitutions/actions', () => ({ coverCommandAction: calls.cover, checkCoverCommandAction: vi.fn() }));
vi.mock('@/platform/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => {
  if (table !== 'teacher_leave') throw Error(`Unexpected table ${table}`);
  let change: { status: string } | null = null;
  const filters: Record<string, unknown> = {};
  let settled: { data: { id: string } | null; error: Error | null; count: number } | null = null;
  // Independent state oracle models the database's conditional update.
  // Successful SQL with no matching asked row returns zero affected rows.
  const update = () => {
    if (settled) return settled;
    const affected = !fixture.error && filters.id === fixture.row.id && filters.status === fixture.row.status ? 1 : 0;
    if (affected && change) fixture.row.status = change.status;
    fixture.decisions.push({ status: change!.status, affected });
    return settled = { data: affected ? { id: fixture.row.id } : null, error: fixture.error ? Error('Synthetic SQL error') : null, count: affected };
  };
  const chain = {
    select: () => chain,
    update: (value: { status: string }) => { change = value; return chain; },
    eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
    maybeSingle: async () => {
      if (change) return update();
      const snapshot = { ...fixture.row };
      await new Promise<void>(resolve => {
        fixture.readers.push(resolve);
        if (fixture.readers.length === fixture.expectedReads) for (const release of fixture.readers) release();
      });
      return { data: snapshot, error: null };
    },
    then: (resolve: (value: ReturnType<typeof update>) => unknown) => Promise.resolve(update()).then(resolve),
  };
  return chain;
} }) }));

import { decideLeaveAction } from '@/app/(app)/timetable/vx-actions';
import { schoolDays } from '@/vx/screens/timetable/domain/timetable';

describe('academic leave follow-up independent conditional-update oracle', () => {
  beforeEach(() => {
    fixture.expectedReads = 1; fixture.readers = []; fixture.decisions = []; fixture.error = false;
    fixture.row.status = 'asked'; fixture.row.to_day = '2026-11-03';
    vi.clearAllMocks(); calls.revision.mockResolvedValue(1); calls.cover.mockResolvedValue({ status: 'saved', receipt: null });
  });

  it('an approval that loses to a concurrent decline never arranges cover or claims approval', async () => {
    fixture.expectedReads = 2;
    const [declined, approved] = await Promise.all([
      decideLeaveAction({ id: fixture.row.id, approve: false }),
      decideLeaveAction({ id: fixture.row.id, approve: true }),
    ]);
    expect(fixture.row.status).toBe('declined');
    expect(fixture.decisions).toEqual([{ status: 'declined', affected: 1 }, { status: 'approved', affected: 0 }]);
    expect(declined.ok).toBe(true);
    expect(calls.cover).not.toHaveBeenCalled();
    expect(approved.ok).toBe(false);
  });

  it('two concurrent approvals produce cover commands only for the winning update', async () => {
    fixture.expectedReads = 2;
    const results = await Promise.all([decideLeaveAction({ id: fixture.row.id, approve: true }), decideLeaveAction({ id: fixture.row.id, approve: true })]);
    const days = schoolDays(fixture.row.from_day, fixture.row.to_day);
    expect(fixture.decisions.map(item => item.affected)).toEqual([1, 0]);
    expect(fixture.row.status).toBe('approved');
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(calls.cover.mock.calls.map(call => (call[1] as FormData).get('day'))).toEqual(days);
  });

  it('a database error never arranges cover', async () => {
    fixture.error = true;
    expect((await decideLeaveAction({ id: fixture.row.id, approve: true })).ok).toBe(false);
    expect(fixture.row.status).toBe('asked'); expect(calls.cover).not.toHaveBeenCalled();
  });

  it('reports every eligible day left manual after the bounded fourteen-day arrangement', async () => {
    fixture.row.to_day = '2026-12-02';
    const days = schoolDays(fixture.row.from_day, fixture.row.to_day);
    expect(days.length).toBeGreaterThan(14);
    const result = await decideLeaveAction({ id: fixture.row.id, approve: true });
    expect(fixture.row.status).toBe('approved');
    expect(calls.cover.mock.calls.map(call => (call[1] as FormData).get('day'))).toEqual(days.slice(0, 14));
    expect(result.message.en).toContain(`${days.length - 14} to arrange by hand`);
    expect(result.message.hi).toContain(String(days.length - 14));
  });

  it('manual count includes failed attempted days as well as capped remaining days', async () => {
    fixture.row.to_day = '2026-12-02';
    calls.cover.mockResolvedValueOnce({ status: 'refused', receipt: null }).mockResolvedValueOnce({ status: 'error', receipt: null });
    const days = schoolDays(fixture.row.from_day, fixture.row.to_day);
    const result = await decideLeaveAction({ id: fixture.row.id, approve: true });
    expect(calls.cover).toHaveBeenCalledTimes(14);
    expect(result.message.en).toContain('cover arranged for 12 days');
    expect(result.message.en).toContain(`${days.length - 12} to arrange by hand`);
    expect(result.message.hi).toContain(String(days.length - 12));
  });
});
