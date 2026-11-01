import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTimetable, buildTeacherMap } from '../src/modules/timetable/domain/parse-timetable';
import { buildApprovedTimetablePlan, assignmentFingerprint } from '../scripts/migrate/coexistence-timetable.mjs';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture() {
  const sourceText=readFileSync(new URL('./fixtures/timetable-2026-27.csv',import.meta.url),'utf8');
  const parsed=parseTimetable(sourceText);
  const names=Object.keys(buildTeacherMap(parsed));
  const staff=names.map((short_name,i)=>({id:id(i+100),short_name,role:'teacher',is_test_account:false,is_active:true}));
  const codes=new Set<string>();
  for(const day of parsed.days)for(const name of parsed.classNames)for(const cell of parsed.timetable[day]?.[name]??[]) {
    if(!cell.free)for(const code of cell.parallel?cell.subjects:[cell.subject])codes.add(code);
  }
  const sourceClasses=Array.from({length:19},(_,i)=>({id:id(i+1),session_label:'2026-27',class_name:parsed.classNames[i]??`Unscheduled${i}`}));
  return {sourceText,sessionLabel:'2026-27',sourceClasses,approvedTeacherIds:staff.map(p=>p.id),one:{
    staff,aliases:parsed.classNames.map((timetable_label,i)=>({timetable_label,class_id:id(i+1)})),
    subjects:[...codes].map((code,i)=>({id:id(i+200),code})),assignmentReferences:[],versions:[],realAssignments:[],classTeachers:[],
  }};
}

describe('approved coexistence timetable',()=>{
  it('resolves the existing school fixture without inventing class teachers',()=>{
    const plan=buildApprovedTimetablePlan(fixture());
    expect(plan.expected).toMatchObject({teachers:19,classes:16,slots:1038,assignments:172});
    expect(plan.classTeacherRowsPreserved).toBe(0);
    expect(plan.classesWithoutClassTeacher).toHaveLength(19);
  });
  it('rejects a TEST teacher even when the short name matches',()=>{
    const input=fixture();input.one.staff[0].is_test_account=true;
    expect(()=>buildApprovedTimetablePlan(input)).toThrow(/exact approved/);
  });
  it('rejects an alias pointing to a noncanonical class',()=>{
    const input=fixture();input.one.aliases[0].class_id=id(999);
    expect(()=>buildApprovedTimetablePlan(input)).toThrow(/canonical/);
  });
  it('refuses to replace a live timetable or assignments with historical dependents',()=>{
    const input=fixture();
    expect(()=>buildApprovedTimetablePlan({...input,one:{...input.one,versions:[{id:id(900)}]}})).toThrow(/already exists/);
    expect(()=>buildApprovedTimetablePlan({...input,one:{...input.one,assignmentReferences:[{table:'historical_marks'}]}})).toThrow(/dependent/);
  });
  it('detects an edited assignment even when its id is unchanged',()=>{
    const original=[{id:id(700),staff_profile_id:id(100),class_id:id(1),subject_id:id(200),periods_per_week:3,version_id:null}];
    expect(assignmentFingerprint(original)).not.toBe(assignmentFingerprint([{...original[0],periods_per_week:4}]));
    expect(assignmentFingerprint(original)).not.toBe(assignmentFingerprint([{...original[0],staff_profile_id:id(101)}]));
  });
});
