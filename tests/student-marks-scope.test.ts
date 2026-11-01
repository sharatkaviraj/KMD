import { beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({queries:[] as {ids:string[];student?:string;from:number;to:number}[],rows:[] as Record<string,unknown>[],allowed:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/platform/auth/current-staff",()=>({assertPermission:state.allowed}));
vi.mock("@/platform/supabase/server",()=>({createClient:async()=>({from:()=>{
  const filter={ids:[] as string[],student:undefined as string|undefined,from:0,to:999};
  const q={select:()=>q,in:(_key:string,ids:string[])=>{filter.ids=ids;return q;},eq:(key:string,value:string)=>{if(key!=="student_id")throw new Error("Unexpected filter");filter.student=value;return q;},order:()=>q,
    range:(from:number,to:number)=>{filter.from=from;filter.to=to;return q;},returns:async()=>{
      state.queries.push({...filter});
      const rows=state.rows.filter(row=>filter.ids.includes(String(row.assessment_subject_id))&&(!filter.student||row.student_id===filter.student));
      return {data:rows.slice(filter.from,filter.to+1),error:null};
    }};return q;
} })}));
import { marksForPapers } from "@/modules/assessments/data/assessments-repo";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
beforeEach(()=>{state.queries=[];state.rows=[];state.allowed.mockReset().mockResolvedValue(undefined);});
function seed(count:number){
  const ids=Array.from({length:count},(_,i)=>`paper-${i}`);
  state.rows=ids.flatMap(paper=>["selected","other"].map(student=>({id:`${paper}-${student}`,assessment_subject_id:paper,student_id:student,value:75,absent:false,exempt:false})));
  return ids;
}
it("fetches only the selected student's marks, with bounded paper ID lists",async()=>{
  const ids=seed(IN_FILTER_CHUNK_SIZE*2+3);
  const result=await marksForPapers(ids,"selected");
  expect(result.size).toBe(ids.length);expect([...result.keys()].every(key=>key.endsWith("|selected"))).toBe(true);
  expect(state.queries.length).toBe(3);expect(state.queries.every(q=>q.student==="selected"&&q.ids.length<=IN_FILTER_CHUNK_SIZE)).toBe(true);
  expect(state.allowed).toHaveBeenCalledWith("marks:view");
});
it("preserves the whole-class mode for class reports and exports",async()=>{
  const ids=seed(4);const result=await marksForPapers(ids);
  expect(result.size).toBe(8);expect(state.queries.every(q=>q.student===undefined)).toBe(true);
});
it("never starts a marks query when permission is refused",async()=>{
  const ids=seed(1);state.allowed.mockRejectedValue(new Error("synthetic_denied"));
  await expect(marksForPapers(ids,"selected")).rejects.toThrow("synthetic_denied");expect(state.queries).toHaveLength(0);
});
