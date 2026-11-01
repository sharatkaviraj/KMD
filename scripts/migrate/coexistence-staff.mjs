/** Explicitly reviewed canonical source accounts only. Caller owns transaction.
 * Auth users are created separately by Admin createUser using source bcrypt
 * hashes in memory. This module creates profiles only: no auth insert/update,
 * password changes, mail, or provider API calls.
 */
import { planAuthImport, oneRoleForFeeRole, shortNameFor } from './lib/auth-import.mjs';
import { uuidV5 } from './lib/uuid5.mjs';
import { FEES_SOURCE_PROJECT_REF, ONE_MAIN_PROJECT_REF } from '../target-guard.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const need = (ok, message) => { if (!ok) throw new Error(message); };

export function validateNewStaffManifest(manifest) {
  need(manifest?.rows?.length === 4 && typeof manifest.approvedBy === 'string', 'Exactly four reviewed new staff accounts are required.');
  const rows = manifest.rows;
  need(new Set(rows.map(r => r.sourceId)).size === 4 && new Set(rows.map(r => r.profileId)).size === 4 &&
    new Set(rows.map(r => r.auth?.email?.toLowerCase())).size === 4, 'Duplicate new staff identities.');
  for (const r of rows) {
    need(UUID.test(r.sourceId) && UUID.test(r.profileId) && r.auth?.id === r.sourceId && r.auth.email &&
      r.displayName && r.active === true && ['accountant', 'admin', 'view_only'].includes(r.role) &&
      oneRoleForFeeRole(r.role) === r.role && !String(r.auth.email).toLowerCase().endsWith('@qa.vpps.local'), 'New staff approval tuple is invalid or still QA.');
    need(!r.auth.encrypted_password && r.auth.identities?.length && r.auth.identities.every(i => i.provider === 'email'), 'Only reviewed email identities without password hashes may import.');
  }
  need(rows.filter(r => r.role === 'accountant').length === 2 && rows.filter(r => r.role === 'admin').length === 1 && rows.filter(r => r.role === 'view_only').length === 1, 'Reviewed role counts changed.');
  return rows;
}

export async function provisionApprovedSourceStaff(tx, manifest, { actorUserId, runId }) {
  const rows = validateNewStaffManifest(manifest);
  need(UUID.test(actorUserId ?? '') && typeof runId === 'string', 'REAL admin operator and run ID required.');
  await tx`select pg_advisory_xact_lock(hashtext('vppsone:staff-authority'))`;
  const [actor] = await tx`select id from vppsone.staff_profiles where user_id=${actorUserId}::uuid and role='admin' and is_active and not is_test_account`;
  need(actor, 'Operator must be an existing REAL admin.');
  const ids = rows.map(r => r.sourceId), profileIds = rows.map(r => r.profileId), emails = rows.map(r => r.auth.email.toLowerCase());
  const target = await tx`select id::text,email from auth.users where id=any(${ids}::uuid[]) or lower(email)=any(${emails}::text[])`;
  const authPlan = planAuthImport(rows.map(r => r.auth), target);
  need(!authPlan.clashes.length && !authPlan.remap.length, 'Auth identity/email collision requires a new explicit mapping review.');
  need(authPlan.insert.length === 0 && target.length === 4, 'Create the four reviewed auth identities through Admin createUser first.');
  for (const existing of target) need(rows.some(r => r.sourceId === existing.id && r.auth.email.toLowerCase() === existing.email.toLowerCase()), 'Existing auth tuple differs; refusing to overwrite it.');
  const [qa] = await tx`select
    (select count(*) from vppsone.smoke_pool where auth_user_id=any(${ids}::uuid[]) or staff_profile_id=any(${profileIds}::uuid[])) +
    (select count(*) from vppsone.qa_dayrun_accounts where user_id=any(${ids}::uuid[]) or staff_profile_id=any(${profileIds}::uuid[])) as n`;
  need(Number(qa.n) === 0, 'A new staff identity has a QA capability.');
  const profiles = await tx`select id::text,user_id::text,role::text,is_active,is_test_account from vppsone.staff_profiles
    where user_id=any(${ids}::uuid[]) or id=any(${profileIds}::uuid[])`;
  for (const p of profiles) need(rows.some(r => r.profileId === p.id && r.sourceId === p.user_id && r.role === p.role && p.is_active && !p.is_test_account), 'Existing One profile precedence or identity conflicts; no automatic override.');
  // Keep every auth record entirely unchanged, even on an idempotent rerun.
  const taken = new Set((await tx`select short_name from vppsone.staff_profiles`).map(p => p.short_name));
  let inserted = 0;
  for (const r of rows) {
    if (profiles.some(p => p.id === r.profileId)) continue;
    const short = shortNameFor(r.displayName, taken); taken.add(short);
    const result = await tx`insert into vppsone.staff_profiles
      (id,user_id,display_name,short_name,role,is_active,is_teaching,preferred_language,is_test_account)
      values(${r.profileId}::uuid,${r.sourceId}::uuid,${r.displayName},${short},${r.role}::vppsone.staff_role,true,false,'hi',false)`;
    inserted += result.count;
  }
  const [proof] = await tx`select count(*)::int as n from vppsone.staff_profiles p join auth.users u on u.id=p.user_id
    join public.users f on f.id=p.user_id where p.id=any(${profileIds}::uuid[]) and not p.is_test_account and p.is_active and f.role::text=p.role::text`;
  need(proof.n === 4, 'New staff projection proof failed.');
  const [audit] = await tx`insert into vppsone.migration_runs
    (script,kind,source_project,target_project,snapshot_id,status,finished_at,summary,note)
    values('coexistence-staff','run',${FEES_SOURCE_PROJECT_REF},${ONE_MAIN_PROJECT_REF},${runId},'succeeded',now(),
      ${tx.json({ authInserted: 0, profilesInserted: inserted, existingPasswordsChanged: 0, emailsSent: 0 })},
      'Four source mappings reviewed; auth created via Admin password_hash import; profile-only step; no emails or existing password changes') returning id`;
  for (const r of rows) await tx`insert into vppsone.migration_id_map(source_project,source_table,source_id,target_id,batch_id)
    values(${FEES_SOURCE_PROJECT_REF},'auth.users',${r.sourceId},${r.sourceId},${audit.id}) on conflict do nothing`;
  return { authInserted: 0, profilesInserted: inserted, verified: 4, existingPasswordsChanged: 0, emailsSent: 0 };
}

/** Owner explicitly kept this pre-existing QA login TEST. It receives no real
 * bridge grant and no auth/credential/QA-tool changes. */
export async function ensureTestFeeCollector(tx, mapping) {
  need(mapping?.fees_role === 'fee_collector' && UUID.test(mapping.one_user_id ?? '') && !mapping.one_profile_id,
    'Expected the reviewed existing auth/missing profile fee collector.');
  const id = uuidV5('coexistence:test-staff:' + mapping.one_user_id);
  const [auth] = await tx`select id::text,lower(email) as email from auth.users where id=${mapping.one_user_id}::uuid`;
  need(auth?.email === mapping.source.email.toLowerCase(), 'TEST fee collector auth tuple drifted.');
  const existing = await tx`select id::text,user_id::text,role::text,is_test_account from vppsone.staff_profiles where user_id=${mapping.one_user_id}::uuid or id=${id}::uuid`;
  if (existing.length) {
    need(existing.length === 1 && existing[0].id === id && existing[0].user_id === mapping.one_user_id && existing[0].role === 'fee_collector' && existing[0].is_test_account,
      'Existing fee collector profile conflicts with TEST decision.');
    return { inserted: 0, isTest: true };
  }
  const taken = new Set((await tx`select short_name from vppsone.staff_profiles`).map(p => p.short_name));
  const short = shortNameFor('TEST Fee Collector', taken);
  await tx`insert into vppsone.staff_profiles(id,user_id,display_name,short_name,role,is_active,is_teaching,preferred_language,is_test_account)
    values(${id}::uuid,${mapping.one_user_id}::uuid,${mapping.source.full_name},${short},'fee_collector',true,false,'hi',true)`;
  return { inserted: 1, isTest: true };
}
