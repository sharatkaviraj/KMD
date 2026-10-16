import { expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { academicDraftScope } from "@/modules/teacher-tasks/data/draft-scope";
import { academicDraftValue, validAcademicDraft } from "@/modules/teacher-tasks/domain/academic-draft";
import type { AcademicWork } from "@/modules/teacher-tasks/data/repo";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const input={taskId:id(1),actorId:id(2),token:"synthetic-generation",session:"QA",scope:{kind:"subject",value:id(3),subjectId:id(4)},studentIds:[id(5),id(6)]};
it("derives an opaque scope isolated by actor, task, capability, session, and roster",()=>{
  const scope=academicDraftScope(input);expect(scope).toMatch(/^[a-f0-9]{64}$/);
  expect(academicDraftScope({...input,studentIds:[...input.studentIds].reverse()})).toBe(scope);
  for(const changed of [{actorId:null},{actorId:id(7)},{taskId:id(7)},{token:"rotated"},{session:"QA-next"},{studentIds:[id(5)]},{scope:{kind:"common",value:"selected"}}]) expect(academicDraftScope({...input,...changed})).not.toBe(scope);
  expect(scope).not.toContain(input.token);
});
const work:AcademicWork={kind:"marks",taskId:id(1),draftScope:"scope",session:"QA",paperId:id(2),classId:null,day:null,revision:4,submitted:true,max:100,step:1,allowExempt:false,rows:[{id:id(3),name:"Synthetic",state:"blank",value:null}]};
it("accepts only current member rows and same-paper commands, including older uncertain revisions",()=>{
  const value=academicDraftValue(work.rows,"",{payload:{commandId:id(4),paperId:work.paperId,kind:"submit",expectedRevision:2,reason:null,entries:[{studentId:id(3),state:"value",value:5}]}});
  expect(validAcademicDraft(work,value)).toBe(true);
  expect(validAcademicDraft(work,{...value,rows:[{...value.rows[0],id:id(8)}]})).toBe(false);
  expect(validAcademicDraft(work,{...value,rows:[...value.rows,...value.rows]})).toBe(false);
  expect(validAcademicDraft({...work,paperId:id(9)},value)).toBe(false);
  expect(validAcademicDraft(work,{...value,command:{payload:{commandId:id(4),paperId:work.paperId,kind:"reopen",expectedRevision:2,entries:[]}}})).toBe(false);
});
it("does not restore an attendance command into another day/class",()=>{
  const attendance={...work,kind:"attendance" as const,paperId:null,classId:id(2),day:"2026-10-16",rows:[{...work.rows[0],state:"leave"}]};
  const value=academicDraftValue(attendance.rows,"",{payload:{commandId:id(4),classId:attendance.classId,day:attendance.day,kind:"save",expectedRevision:0,marks:[{studentId:id(3),status:"leave"}]}});
  expect(validAcademicDraft(attendance,value)).toBe(true);
  expect(validAcademicDraft({...attendance,day:"2026-10-17"},value)).toBe(false);
  expect(validAcademicDraft({...attendance,classId:id(9)},value)).toBe(false);
});
