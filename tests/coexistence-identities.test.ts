import { describe, expect, it } from 'vitest';
import { adaptIdentityPlan, validateIdentityManifest } from '../scripts/migrate/coexistence-identities.mjs';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const teachers = Array.from({ length: 19 }, (_, i) => ({ id: id(i + 1), user_id: id(i + 101), role: 'teacher', short_name: `S${i}`, is_active: true, is_test_account: true }));
  const extras = ['admin', 'office', 'view_only'].map((role, i) => ({ id: id(i + 20), user_id: id(i + 120), role, short_name: `EX${i}`, is_active: true, is_test_account: true }));
  const approvedFive = [...teachers.slice(17), ...extras].map(p => ({ profile_id: p.id, auth_user_id: p.user_id, role: p.role }));
  const manifest = {
    decision: { preserveAuthUsers: true, passwordChanges: false, sendAccessEmails: false, approvedHeld: teachers.slice(17).map(p => p.short_name) },
    approvedFive, prior17: teachers.slice(0, 17), heldTwo: teachers.slice(17), extra3: extras, all19TimetableIds: teachers.map(p => p.id),
  };
  const owner = { id: id(50), user_id: id(150), role: 'admin', short_name: 'OWNER', is_active: true, is_test_account: false };
  const base = { profiles: [...teachers, ...extras, owner], candidates: teachers, held: [], blockers: [], maps: {} };
  return { manifest, base };
}

describe('owner-approved coexistence identity adaptation', () => {
  it('twins all 22 approved real identities while preserving exactly five original logins', () => {
    const { manifest, base } = fixture();
    const plan = adaptIdentityPlan(base, manifest);
    expect(plan.staffPlan.twins).toHaveLength(22);
    expect(plan.staffPlan.twins.filter((p: { moveUserFrom: string | null }) => p.moveUserFrom === null)).toHaveLength(5);
    expect(plan.staffPlan.twins.filter((p: { moveUserFrom: string | null }) => p.moveUserFrom !== null)).toHaveLength(17);
    for (const pin of manifest.approvedFive) expect(plan.maps.staffMap.get(pin.profile_id)).not.toBe(pin.profile_id);
  });
  it('does not redirect owner history onto an Office/Admin/Viewer identity being made real', () => {
    const { manifest, base } = fixture();
    const plan = adaptIdentityPlan(base, manifest);
    expect(manifest.approvedFive.map(p => p.profile_id)).not.toContain(plan.maps.staffMap.get(id(50)));
    expect(plan.staffPlan.placeholders).toHaveLength(1);
  });
  it('refuses a changed candidate set even when its count remains 19', () => {
    const { manifest, base } = fixture();
    base.candidates = [...base.candidates.slice(0, 18), { ...base.candidates[18], id: id(800) }];
    expect(() => adaptIdentityPlan(base, manifest)).toThrow(/changed since owner review/);
  });
  it('refuses auth reuse or role drift after review', () => {
    const { manifest, base } = fixture();
    base.profiles[17].user_id = id(999);
    expect(() => adaptIdentityPlan(base, manifest)).toThrow(/binding changed/);
  });
  it('retains all original unknown-table/reference blockers', () => {
    const { manifest, base } = fixture();
    expect(() => adaptIdentityPlan({ ...base, blockers: ['unclassified new_table'] }, manifest)).toThrow(/blockers/);
  });
  it('requires distinct approved auth tuples and explicit held-name approval', () => {
    const { manifest } = fixture();
    manifest.approvedFive[0].auth_user_id = manifest.approvedFive[1].auth_user_id;
    expect(() => validateIdentityManifest(manifest)).toThrow(/unique/);
  });
});
