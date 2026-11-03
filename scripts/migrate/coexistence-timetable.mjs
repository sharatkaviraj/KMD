/** Atomic equivalent of the approved real timetable seed. Uses the existing
 * fixture/parser and exact reviewed teacher/class identities. Never invents
 * class-teacher assignments or changes academic records/enrolments. */
import { createHash } from 'node:crypto';
import { parseTimetable, buildTeacherMap } from '../../src/modules/timetable/domain/parse-timetable.ts';
import { teacherShortNameMap, decidePromoteSeed } from './lib/quarantine-rules.mjs';
import { backupState } from './lib/quarantine-state.mjs';
const need = (ok, message) => { if (!ok) throw new Error(message); };
const sorted = ids => [...ids].sort();
const equalIds = (a,b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
export const REAL_TIMETABLE_LABEL = 'Fixture v11 (seeded)';
export function assignmentFingerprint(rows) {
  const fields=['id','staff_profile_id','class_id','subject_id','periods_per_week','version_id'];
  const reviewed=[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)))
    .map(row=>Object.fromEntries(fields.map(key=>[key,row[key]??null])));
  return createHash('sha256').update(JSON.stringify(reviewed)).digest('hex');
}

export function buildApprovedTimetablePlan({ sourceText, sessionLabel, sourceClasses, one, approvedTeacherIds }) {
  need(sessionLabel === '2026-27', 'This approved fixture is pinned to 2026-27.');
  const parsed = parseTimetable(sourceText), teacherMap = buildTeacherMap(parsed);
  need(!parsed.problems.length, 'Approved timetable fixture has parse problems.');
  const canonical = new Set(sourceClasses.filter(c => c.session_label === sessionLabel).map(c => c.id));
  need(canonical.size === 19, 'Expected the reviewed 19 canonical source classes.');
  const byClass = new Map(one.aliases.map(a => [a.timetable_label.toLowerCase(),a.class_id]));
  need(one.aliases.every(a => canonical.has(a.class_id)), 'A real timetable alias does not resolve to canonical source identity.');
  const byTeacher = teacherShortNameMap(one.staff, { realOnly: true });
  const usedTeachers = Object.keys(teacherMap).map(name => byTeacher.get(name.toLowerCase()));
  need(usedTeachers.every(Boolean) && equalIds(usedTeachers,approvedTeacherIds), 'Fixture teachers differ from the exact approved 19 profiles.');
  const bySubject = new Map(one.subjects.map(s => [s.code.toLowerCase(),s.id]));
  const slots = [];
  for (const day of parsed.days) for (const className of parsed.classNames) {
    const row = parsed.timetable[day]?.[className]; if (!row) continue;
    const classId = byClass.get(className.toLowerCase());
    need(classId && canonical.has(classId), 'Fixture class does not resolve to a canonical source class.');
    row.forEach((cell, period) => {
      if (cell.free) return;
      const pairs = cell.parallel ? cell.subjects.map((subject,index) => ({subject,teacher:cell.teachers[index]})) : cell.teachers.map(teacher => ({subject:cell.subject,teacher}));
      for (const pair of pairs) {
        const subjectId = bySubject.get(String(pair.subject).toLowerCase());
        const staffId = pair.teacher ? byTeacher.get(String(pair.teacher).toLowerCase()) : undefined;
        need(subjectId && staffId && approvedTeacherIds.includes(staffId), 'Unresolved subject or unapproved teacher.');
        slots.push({day,period,class_id:classId,class_label:className,subject_id:subjectId,subject_code:pair.subject,
          staff_profile_id:staffId,teacher_short_name:pair.teacher,parallel:Boolean(cell.parallel),shared:!cell.parallel&&cell.teachers.length>1});
      }
    });
  }
  const groups = new Map();
  for (const s of slots) { const key=[s.staff_profile_id,s.class_id,s.subject_id].join('|'); groups.set(key,(groups.get(key)??0)+1); }
  const assignments = [...groups].map(([key,n]) => { const [staff_profile_id,class_id,subject_id]=key.split('|'); return {session_label:sessionLabel,staff_profile_id,class_id,subject_id,periods_per_week:n}; });
  need(one.assignmentReferences.length === 0, 'Existing teaching assignments have dependent records; original replace operation is unsafe.');
  need(one.versions.length === 0, 'A REAL timetable version already exists; review instead of replacing history.');
  return {sessionLabel,sourceText,sourceSha256:createHash('sha256').update(sourceText).digest('hex'),cellCount:parsed.cellCount,
    slots,assignments,canonicalClassIds:[...canonical],approvedTeacherIds,existingAssignmentIds:one.realAssignments.map(a=>a.id),
    existingAssignmentFingerprint:assignmentFingerprint(one.realAssignments),
    classTeacherRowsPreserved:one.classTeachers.length,
    classesWithoutClassTeacher:sourceClasses.filter(c=>!one.classTeachers.some(t=>t.class_id===c.id)).map(c=>({id:c.id,class_name:c.class_name,section:c.section,stream_name:c.stream_name})),
    expected:{teachers:usedTeachers.length,classes:parsed.classNames.length,slots:slots.length,assignments:assignments.length,replacedMasterAssignments:one.realAssignments.length}};
}

export async function writeApprovedTimetable(tx, plan, {runId}) {
  need(typeof runId === 'string', 'Audit run ID required.');
  await tx.unsafe("set local lock_timeout='10s'");
  await tx`select pg_advisory_xact_lock(hashtext('vppsone:coexistence-timetable'))`;
  const backup = await backupState(tx); need(backup.ok, 'Fresh One backup required.');
  const [state] = await tx`select (select environment from vppsone.deployment where id=1) as environment,
    (select value from public.app_settings where key='fee_writes_enabled') as fee,
    (select count(*)::int from vppsone.migration_runs where script='promote-master-data' and kind='run' and status='succeeded') as promoted,
    exists(select 1 from vppsone.migration_runs where kind='cutover') as cutover`;
  need(decidePromoteSeed({environment:state.environment,feeWritesEnabled:state.fee,promoteRuns:state.promoted,hasCutover:state.cutover}).ok, 'Original real seed guard refused.');
  const [bridge] = await tx`select snapshot_id,last_error_code,
    last_checked_at>=clock_timestamp()-interval '5 minutes' and as_of_date=vppsone.school_today() as fresh
    from vppsone.fees_bridge_state where id for share`;
  need(bridge?.snapshot_id && !bridge.last_error_code && bridge.fresh, 'A validated fresh canonical live snapshot must exist before seeding.');
  const classes = await tx`select id::text from vppsone.fees_bridge_classes where session_label=${plan.sessionLabel}`;
  need(equalIds(classes.map(c=>c.id),plan.canonicalClassIds), 'Canonical live class set changed.');
  const staff = await tx`select id::text from vppsone.staff_profiles where id=any(${plan.approvedTeacherIds}::uuid[])
    and is_active and not is_test_account and (role='teacher' or is_teaching) for share`;
  need(equalIds(staff.map(p=>p.id),plan.approvedTeacherIds), 'Approved teacher flags or identities changed.');
  await tx.unsafe('lock table vppsone.timetable_versions,vppsone.timetable_slots,vppsone.teaching_assignments in share row exclusive mode');
  const versions = await tx`select id from vppsone.timetable_versions where session_label=${plan.sessionLabel}`;
  need(versions.length === 0, 'REAL timetable appeared after planning; refusing to replace it.');
  const previous = await tx`select id::text,staff_profile_id::text,class_id::text,subject_id::text,periods_per_week,version_id::text
    from vppsone.teaching_assignments where session_label=${plan.sessionLabel} for update`;
  need(equalIds(previous.map(r=>r.id),plan.existingAssignmentIds), 'Master teaching assignments changed since review.');
  need(assignmentFingerprint(previous)===plan.existingAssignmentFingerprint, 'Reviewed teaching-assignment contents changed; refusing to overwrite them.');
  const [dependencies] = await tx`select count(*)::int as n from pg_constraint where contype='f' and confrelid='vppsone.teaching_assignments'::regclass`;
  need(dependencies.n===0, 'Teaching assignments gained dependent records; replacement refused.');
  const [version] = await tx`insert into vppsone.timetable_versions(session_label,label,status,source_text,notes,cell_count,slot_count)
    values(${plan.sessionLabel},${REAL_TIMETABLE_LABEL},'draft',${plan.sourceText},'Original approved fixture published atomically for coexistence; historical TEST timetable preserved',${plan.cellCount},${plan.slots.length}) returning id`;
  const slots=plan.slots.map(s=>({...s,version_id:version.id}));
  for(let i=0;i<slots.length;i+=500) await tx`insert into vppsone.timetable_slots ${tx(slots.slice(i,i+500))}`;
  await tx`delete from vppsone.teaching_assignments where session_label=${plan.sessionLabel} and id=any(${plan.existingAssignmentIds}::uuid[])`;
  const assignments=plan.assignments.map(a=>({...a,version_id:version.id}));
  for(let i=0;i<assignments.length;i+=500) await tx`insert into vppsone.teaching_assignments ${tx(assignments.slice(i,i+500))}`;
  await tx`update vppsone.timetable_versions set status='published',published_at=now() where id=${version.id}`;
  const [proof] = await tx`select (select count(*)::int from vppsone.timetable_slots where version_id=${version.id}) as slots,
    (select count(*)::int from vppsone.teaching_assignments where session_label=${plan.sessionLabel} and version_id=${version.id}) as assignments,
    (select count(*)::int from vppsone.class_teachers where session_label=${plan.sessionLabel}) as class_teachers`;
  need(proof.slots===plan.slots.length && proof.assignments===plan.assignments.length && proof.class_teachers===plan.classTeacherRowsPreserved, 'Timetable count or preserved class-teacher proof failed.');
  await tx`insert into vppsone.migration_runs(script,kind,source_project,target_project,snapshot_id,status,finished_at,summary,note)
    values('coexistence-timetable','run','wtgxcptmucjerhufzjcf','wtgxcptmucjerhufzjcf',${runId},'succeeded',now(),
      ${tx.json({sourceSha256:plan.sourceSha256,...plan.expected,classTeachersPreserved:proof.class_teachers,backup:backup.runId})},'Same approved fixture/parser/teachers and canonical source classes; no class-teacher assignments invented')`;
  return {versionId:version.id,...proof,sourceSha256:plan.sourceSha256,unassignedClasses:plan.classesWithoutClassTeacher.length};
}
