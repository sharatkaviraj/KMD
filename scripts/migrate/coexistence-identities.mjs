#!/usr/bin/env node
/** One-time owner-approved identity activation. Default: read-only plan.
 * Reuses the reviewed quarantine and promotion writers. The private manifest
 * pins 19 timetable candidates, 3 extra profiles, and 5 preserved auth tuples.
 * No password/auth-user changes, reset emails, sends, financial writes, reset,
 * cutover marker, or automatic timetable reseed. Caller reviews those separately.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, loadOneEnv, newRunId, parseArgs, runDir } from './lib/env.mjs';
import { openOneDb } from './lib/one-db.mjs';
import { ONE_MAIN_PROJECT_REF } from '../target-guard.mjs';
import { backupState, planIdentities, readBackupManifest } from './lib/quarantine-state.mjs';
import { planStaffMap, TABLES } from './lib/quarantine-rules.mjs';
import { quoteIdent, uuidArray } from './lib/quarantine-sql.mjs';
import { planAll, countOps, writeIdentities, writeTable, rewriteAppendOnly,
  restoreCoverage, runVerify, prepare, guardIn, VERIFY_SQL } from './quarantine-in-place.mjs';
import { planPromotion, writePromotion } from './promote-master-data.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QA_CHECK = 'qa.vpps.local login on a real profile';
const REHEARSAL_ONLY = new Set(['marker is not production', 'fee_writes_enabled is not false']);
const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const need = (ok, message) => { if (!ok) throw new Error(message); };

export function validateIdentityManifest(manifest) {
  need(manifest?.decision?.preserveAuthUsers === true && manifest.decision.passwordChanges === false &&
    manifest.decision.sendAccessEmails === false, 'Manifest must preserve existing logins and prohibit emails/password changes.');
  need(manifest.approvedFive?.length === 5 && manifest.prior17?.length === 17 &&
    manifest.heldTwo?.length === 2 && manifest.extra3?.length === 3 && manifest.all19TimetableIds?.length === 19,
  'Expected the explicitly approved 5 logins, 17 prior teachers, 2 held teachers, and 3 extra profiles.');
  const ids = manifest.approvedFive.map(p => p.profile_id);
  const users = manifest.approvedFive.map(p => p.auth_user_id);
  need([...ids, ...users, ...manifest.all19TimetableIds, ...manifest.extra3.map(p => p.id)].every(id => UUID.test(id)), 'Invalid identity UUID.');
  need(new Set(ids).size === 5 && new Set(users).size === 5 && new Set(manifest.all19TimetableIds).size === 19, 'Identity tuples must be unique.');
  need(sameIds(manifest.all19TimetableIds, [...manifest.prior17, ...manifest.heldTwo].map(p => p.id)), 'The 19 candidates must exactly match the prior 17 plus approved held two.');
  need(manifest.extra3.every(p => ids.includes(p.id) && !manifest.all19TimetableIds.includes(p.id)), 'Extra profiles must be approved non-timetable identities.');
  need(manifest.heldTwo.every(p => ids.includes(p.id)), 'Both held teachers require explicit login approval.');
  need(manifest.decision.approvedHeld?.length === 2 && sameIds(manifest.decision.approvedHeld, manifest.heldTwo.map(p => p.short_name)), 'Held-name approval does not match pinned profiles.');
  return manifest;
}

/** Pure adaptation: every historical staff reference goes to a TEST identity;
 * only the five specifically approved auth bindings stay on their originals. */
export function adaptIdentityPlan(base, manifest) {
  validateIdentityManifest(manifest);
  need(!base.blockers.length && !base.held.length, 'Original quarantine planner has blockers or held profiles.');
  need(sameIds(base.candidates.map(p => p.id), manifest.all19TimetableIds), 'Timetable candidate identities changed since owner review.');
  const approved = new Map(manifest.approvedFive.map(p => [p.profile_id, p]));
  for (const pin of approved.values()) {
    const profile = base.profiles.find(p => p.id === pin.profile_id);
    need(profile && profile.user_id === pin.auth_user_id && profile.role === pin.role && profile.is_active,
      'An approved profile/auth/role binding changed since owner review.');
  }
  const extras = manifest.extra3.map(pin => base.profiles.find(p => p.id === pin.id));
  const staffPlan = planStaffMap(base.profiles, [...base.candidates, ...extras]);
  for (const twin of staffPlan.twins) if (approved.has(twin.source)) twin.moveUserFrom = null;
  need(staffPlan.twins.length === 22, 'Expected exactly 22 TEST twins.');
  const existingShort = new Map(base.profiles.map(p => [p.short_name.toLowerCase(), p.id]));
  for (const p of [...staffPlan.twins, ...staffPlan.placeholders]) {
    const holder = existingShort.get(p.short_name.toLowerCase());
    need(!holder || holder === p.id, 'A TEST twin short name is owned by another profile.');
    const existing = base.profiles.find(row => row.id === p.id);
    need(!existing || (existing.is_test_account && existing.role === p.role &&
      (!approved.has(p.source) || existing.user_id === null)), 'Existing TEST twin has incompatible role, flag, or auth binding.');
  }
  return { ...base, staffPlan, maps: { ...base.maps, staffMap: staffPlan.map } };
}

function assertVerifierParity() {
  const verifier = readFileSync(VERIFY_SQL, 'utf8');
  for (const [table, rule] of Object.entries(TABLES).filter(([name]) => name.startsWith('fees_bridge_'))) {
    need(rule.bucket === 'K' && verifier.includes("'" + table + "'"), 'Bridge projection tables must be classified K in planner and verifier.');
  }
}

async function assertApprovedBindings(tx, manifest, { real = false } = {}) {
  const approved = manifest.approvedFive;
  const rows = await tx`select p.id::text, p.user_id::text, p.role::text, p.is_active, p.is_test_account,
    lower(u.email) as email from vppsone.staff_profiles p join auth.users u on u.id=p.user_id
    where p.id=any(${approved.map(p => p.profile_id)}::uuid[])`;
  need(rows.length === 5, 'An approved auth identity no longer exists.');
  for (const pin of approved) {
    const row = rows.find(r => r.id === pin.profile_id);
    need(row && row.user_id === pin.auth_user_id && row.role === pin.role && row.is_active &&
      row.email === String(pin.email).toLowerCase() && (!real || !row.is_test_account), 'Approved identity tuple drifted.');
  }
  const smoke = await tx`select count(*)::int as n from vppsone.smoke_pool
    where staff_profile_id=any(${approved.map(p => p.profile_id)}::uuid[])
       or auth_user_id=any(${approved.map(p => p.auth_user_id)}::uuid[])`;
  need(smoke[0].n === 0, 'An approved login has a Smoke Lab capability; review its removal separately.');
  return rows;
}

async function assertNoHistoricalRefs(tx, identities, promotedIds) {
  let remaining = 0;
  for (const info of Object.values(identities.catalog)) {
    const bucket = TABLES[info.table]?.bucket;
    const scope = bucket === 'B' ? 'true' : ((bucket === 'A' || bucket === 'R') && info.hasSession ? 'vppsone.is_test_session_label(t.session_label)' : null);
    if (!scope) continue;
    for (const col of info.staffCols) {
      const [row] = await tx.unsafe('select count(*)::int as n from vppsone.' + quoteIdent(info.table) +
        ' t where (' + scope + ') and t.' + quoteIdent(col) + '=any($1::uuid[])', [uuidArray(promotedIds)]);
      remaining += row.n;
    }
    for (const col of info.staffArrays) {
      const [row] = await tx.unsafe('select count(*)::int as n from vppsone.' + quoteIdent(info.table) +
        ' t where (' + scope + ') and t.' + quoteIdent(col) + ' && $1::uuid[]', [uuidArray(promotedIds)]);
      remaining += row.n;
    }
  }
  need(remaining === 0, 'Historical TEST activity still references a profile about to become REAL.');
}

async function revokeQaCapabilities(tx, manifest) {
  const profiles = manifest.approvedFive.map(p => p.profile_id);
  const users = manifest.approvedFive.map(p => p.auth_user_id);
  const pins = await tx`select alias, staff_profile_id::text, user_id::text from vppsone.qa_dayrun_accounts
    where staff_profile_id=any(${profiles}::uuid[]) or user_id=any(${users}::uuid[])`;
  for (const pin of pins) need(manifest.approvedFive.some(p => p.profile_id === pin.staff_profile_id && p.auth_user_id === pin.user_id), 'QA day-run identity pin disagrees with approved tuple.');
  const aliases = pins.map(p => p.alias);
  const accounts = await tx`update vppsone.qa_dayrun_accounts set revoked_at=now() where alias=any(${aliases}::text[]) and revoked_at is null`;
  const pairs = await tx`update vppsone.qa_dayrun_pairs set status='revoked' where alias=any(${aliases}::text[]) and status in ('pending','authorized','consuming')`;
  const sessions = await tx`update vppsone.qa_dayrun_sessions set revoked_at=now()
    where (alias=any(${aliases}::text[]) or staff_profile_id=any(${profiles}::uuid[]) or user_id=any(${users}::uuid[])) and revoked_at is null`;
  return { accounts: accounts.count, pairs: pairs.count, sessions: sessions.count };
}

/** Exact-tuple exception in this operator adapter only. The general verifier
 * stays strict. An approved QA-domain login counts only after all shortcuts
 * are revoked; every other QA login on a REAL profile still fails. */
export async function verifyCoexistenceIdentities(tx, manifest, { rollbackOnly = false } = {}) {
  const approved = await assertApprovedBindings(tx, manifest, { real: true });
  const profiles = manifest.approvedFive.map(p => p.profile_id);
  const users = manifest.approvedFive.map(p => p.auth_user_id);
  const [cap] = await tx`select
    (select count(*) from vppsone.qa_dayrun_accounts where (staff_profile_id=any(${profiles}::uuid[]) or user_id=any(${users}::uuid[])) and revoked_at is null) +
    (select count(*) from vppsone.qa_dayrun_pairs where alias in (select alias from vppsone.qa_dayrun_accounts where staff_profile_id=any(${profiles}::uuid[]) or user_id=any(${users}::uuid[])) and status in ('pending','authorized','consuming')) +
    (select count(*) from vppsone.qa_dayrun_sessions where (staff_profile_id=any(${profiles}::uuid[]) or user_id=any(${users}::uuid[])) and revoked_at is null) as n`;
  need(Number(cap.n) === 0, 'A promoted login still has a QA day-run capability.');
  const checks = await runVerify(tx);
  need(checks.some(c => c.check_name === QA_CHECK), 'The expected QA verifier check is missing.');
  const allowedQa = approved.filter(p => p.email.endsWith('@qa.vpps.local')).length;
  const result = checks.map(c => c.check_name === QA_CHECK ? {
    ...c, check_name: 'unapproved qa.vpps.local login on a real profile', failing: c.failing - allowedQa,
    approved_exact_tuples: allowedQa, result: c.failing === allowedQa ? 'pass' : 'FAIL',
  } : c);
  const failed = result.filter(c => c.failing !== 0 && !(rollbackOnly && REHEARSAL_ONLY.has(c.check_name)));
  need(!failed.length, 'Quarantine verification failed after promotion: ' + failed.map(c => c.check_name + '=' + c.failing).join('; '));
  return result;
}

class IdentityRehearsal extends Error { constructor(outcome) { super('Identity rehearsal rolled back.'); this.outcome = outcome; } }

/** Transactions encompass quarantine + activation, so partial promotion cannot
 * persist. An optional caller-supplied connection must be the guarded One DB. */
export async function runCoexistenceIdentities(sql, manifest, { apply = false, rollbackOnly = false, actorUserId, runId = 'coexistence-identities-' + newRunId() } = {}) {
  validateIdentityManifest(manifest);
  assertVerifierParity();
  need(!(apply && rollbackOnly), 'Choose apply or rollback-only, never both.');
  const backup = await backupState(sql);
  const base = await planIdentities(sql, { acceptHeld: manifest.decision.approvedHeld });
  const identities = adaptIdentityPlan(base, manifest);
  const groups = planAll(identities);
  const guard = await guardIn(sql, { rollbackOnly, backup, blockers: identities.blockers, held: 0 });
  if (!apply && !rollbackOnly) {
    const changes = {};
    await sql.begin('read only', async tx => {
      await assertApprovedBindings(tx, manifest);
      for (const [, entries] of groups) for (const entry of entries) changes[entry.info.table] = await countOps(tx, entry);
    });
    return { mode: 'plan', guard, backup, twins: identities.staffPlan.twins.length, preserveLogins: 5, changes };
  }
  need(guard.ok && backup.ok, 'Quarantine guard or fresh backup failed.');
  need(UUID.test(actorUserId ?? ''), 'An existing REAL admin operator auth ID is required for the audit.');
  try {
    return await sql.begin(async tx => {
      await prepare(tx);
      await tx`select pg_advisory_xact_lock(hashtext('vppsone:staff-authority'))`;
      const freshGuard = await guardIn(tx, { rollbackOnly, backup, blockers: identities.blockers, held: 0 });
      need(freshGuard.ok, 'Quarantine guard changed.');
      const [actor] = await tx`select id::text from vppsone.staff_profiles where user_id=${actorUserId}::uuid and role='admin' and is_active and not is_test_account`;
      need(actor && !manifest.approvedFive.some(p => p.profile_id === actor.id), 'Operator must be an existing REAL admin outside the promoted five.');
      const current = adaptIdentityPlan(await planIdentities(tx, { acceptHeld: manifest.decision.approvedHeld }), manifest);
      await assertApprovedBindings(tx, manifest);
      const [already] = await tx`select exists(select 1 from vppsone.migration_runs where script='coexistence-identities' and kind='run' and status='succeeded') as done`;
      need(!already.done, 'Identity activation already succeeded; use verification instead of replaying conversion.');
      // Credential comparison stays inside PostgreSQL, never returned or persisted.
      await tx.unsafe('create temporary table coexistence_auth_before on commit drop as select id,email,encrypted_password from auth.users where id=any($1::uuid[])', [uuidArray(manifest.approvedFive.map(p => p.auth_user_id))]);
      const [run] = await tx`insert into vppsone.migration_runs(script,kind,source_project,target_project,snapshot_id,note)
        values('coexistence-identities',${rollbackOnly ? 'dry_run' : 'run'},${ONE_MAIN_PROJECT_REF},${ONE_MAIN_PROJECT_REF},${runId},${'Owner approval: keep five original logins; all historical activity TEST; backup ' + backup.runId}) returning id`;
      const outcome = { mode: rollbackOnly ? 'rollback-only' : 'apply', runId, identities: await writeIdentities(tx, current, run.id), tables: {} };
      for (const [, entries] of planAll(current)) for (const entry of entries) {
        outcome.tables[entry.info.table] = await tx.savepoint(sp => entry.appendOnly ? rewriteAppendOnly(sp, entry) : writeTable(sp, entry));
      }
      const promotedIds = [...manifest.all19TimetableIds, ...manifest.extra3.map(p => p.id)];
      await assertNoHistoricalRefs(tx, current, promotedIds);
      outcome.qaRevoked = await revokeQaCapabilities(tx, manifest);
      await tx`select set_config('request.jwt.claim.sub',${actorUserId},true)`;
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: actorUserId, role: 'authenticated' })},true)`;
      for (const pin of manifest.approvedFive) {
        const [result] = await tx`select vppsone.set_test_account(${pin.profile_id}::uuid,false,'Owner confirmed REAL identity; all prior work quarantined to TEST; keep existing login, 2026-11-01') as verdict`;
        need(result.verdict?.ok === true, 'Audited profile activation refused.');
      }
      const promotion = await planPromotion(tx, { acceptHeld: manifest.decision.approvedHeld });
      need(sameIds(promotion.candidates.map(p => p.id), manifest.all19TimetableIds) && !promotion.held.length,
        'Promotion candidate identity set changed.');
      need(!promotion.testRefsToCandidates, 'Promotion found TEST references to candidates: ' + promotion.testRefsToCandidates);
      need(promotion.live.classes, 'Source class read unavailable during promotion verification.');
      need(promotion.reseed.teachers === promotion.reseed.teachersResolved && promotion.reseed.classes === promotion.reseed.classesResolved, 'Real timetable teachers/classes do not resolve.');
      outcome.promotion = await writePromotion(tx, promotion);
      for (const pin of manifest.approvedFive) {
        const updated = await tx`update vppsone.staff_profiles set user_id=${pin.auth_user_id}::uuid where id=${pin.profile_id}::uuid and (user_id is null or user_id=${pin.auth_user_id}::uuid)`;
        need(updated.count === 1, 'Could not preserve the original login binding.');
      }
      await assertNoHistoricalRefs(tx, current, promotedIds);
      const [authChanged] = await tx`select count(*)::int as n from pg_temp.coexistence_auth_before b full join auth.users u on u.id=b.id
        where b.id is not null and (u.id is null or u.email is distinct from b.email or u.encrypted_password is distinct from b.encrypted_password)`;
      need(authChanged.n === 0, 'An approved email/password changed.');
      outcome.verify = await verifyCoexistenceIdentities(tx, manifest, { rollbackOnly });
      const again = adaptIdentityPlan(await planIdentities(tx, { acceptHeld: manifest.decision.approvedHeld }), manifest);
      let left = again.studentPlan.shells.length + again.classPlan.created.length;
      for (const [, entries] of planAll(again)) for (const entry of entries) for (const count of await countOps(tx, entry)) left += count.n;
      need(left === 0, 'A repeat quarantine would still modify historical rows.');
      outcome.rerun = left;
      const written = await tx`select schemaname || '.' || relname as t from pg_stat_xact_user_tables where n_tup_ins+n_tup_upd+n_tup_del>0 and schemaname not like 'pg_temp%' order by 1`;
      outcome.restoreCoverage = restoreCoverage(written.map(r => r.t), readBackupManifest(backup.runId));
      need(!outcome.restoreCoverage.missed.length, 'Backup does not cover every changed persistent table.');
      // Keep the reviewed downstream gates truthful: these are the same writers,
      // completed atomically by this adapter with the owner's exact exceptions.
      for (const script of ['quarantine-in-place', 'promote-master-data']) {
        await tx`insert into vppsone.migration_runs(script,kind,source_project,target_project,snapshot_id,status,finished_at,summary,note)
          values(${script},${rollbackOnly ? 'dry_run' : 'run'},${ONE_MAIN_PROJECT_REF},${ONE_MAIN_PROJECT_REF},${runId},'succeeded',now(),
            ${tx.json({ adapter: 'coexistence-identities', preserved_logins: 5, test_twins: 22, rerun_changes: 0 })},
            'Reviewed original writer executed by coexistence-identities; owner-approved exact-five login retention; all historical work TEST')`;
      }
      await tx`update vppsone.migration_runs set status='succeeded',finished_at=now(),summary=${tx.json({ preserved_logins: 5, test_twins: 22, qa_revoked: outcome.qaRevoked, rerun_changes: 0 })} where id=${run.id}`;
      if (rollbackOnly) throw new IdentityRehearsal(outcome);
      return outcome;
    });
  } catch (error) {
    if (error instanceof IdentityRehearsal) return error.outcome;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  need(typeof args.manifest === 'string', 'Pass --manifest <private identity-plan.json>.');
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'));
  const sql = await openOneDb(loadOneEnv());
  try {
    const outcome = await runCoexistenceIdentities(sql, manifest, { apply: Boolean(args.apply), rollbackOnly: Boolean(args['rollback-only']), actorUserId: process.env.COEXISTENCE_OPERATOR_USER_ID });
    const reportDir = runDir(outcome.runId ?? 'coexistence-identities-plan-' + newRunId());
    writeFileSync(path.join(reportDir, 'outcome.json'), JSON.stringify(outcome, null, 2));
    console.log(JSON.stringify({ mode: outcome.mode, verified: outcome.verify?.length ?? 0, preserveLogins: 5, testTwins: 22, rerun: outcome.rerun ?? null, guard: outcome.guard?.ok }));
  } finally { await sql.end(); }
}
if (isMain(import.meta.url)) main().catch(error => { console.error('coexistence-identities: ' + error.message); process.exitCode = 2; });
