import { beforeEach, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({staff:{id:"teacher",role:"teacher"},from:vi.fn(),sign:vi.fn(),tables:[] as string[],ids:[] as string[][],scope:{everyClass:false,classIds:["class"]}}));
vi.mock("server-only",()=>({}));
vi.mock("@/platform/auth/current-staff",()=>({assertStaff:async()=>mock.staff,assertPermission:async()=>{throw Error("Teacher has no students:view");}}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({from:mock.from,storage:{from:()=>({createSignedUrls:mock.sign})}})}));
vi.mock("@/platform/supabase/server",()=>({createClient:async()=>({from:mock.from})}));
vi.mock("@/modules/attendance/data/teaching-repo",()=>({classScopeFor:async()=>mock.scope}));
vi.mock("@/modules/academics/data/academics-repo",()=>({resolveSessionLabel:async()=>"SYNTHETIC"}));
vi.mock("@/modules/collection/data/photo-link",()=>({studentPhotoLink:(student:string,photo:string)=>`link:${student}:${photo}`}));
const OWN="00000000-0000-4000-8000-0000000000a1",OTHER="00000000-0000-4000-8000-0000000000a2";
import { approvedStudentPhotos, approvedStaffPhotos } from "@/modules/collection/data/approved-photos";
beforeEach(()=>{
  vi.clearAllMocks();
  mock.staff={id:"teacher",role:"teacher"};mock.tables=[];mock.ids=[];mock.sign.mockReset().mockImplementation(async(paths:string[])=>({data:paths.map(path=>({path,signedUrl:`private:${path}`})),error:null}));
  mock.from.mockImplementation((table:string)=>{
    mock.tables.push(table);let ids:string[]=[];
    const rows=()=>table==="enrolments"?[{student_id:OWN,class_id:"class"},{student_id:OTHER,class_id:"other-class"}]:[{id:"photo-row",student_id:OWN,storage_path:"approved.jpg"}].filter(r=>ids.includes(r.student_id));
    const q={select:()=>q,eq:()=>q,is:vi.fn(()=>q),in:(_k:string,value:string[])=>{ids=value;mock.ids.push(value);return q;},then:(resolve:(v:unknown)=>void)=>Promise.resolve({data:rows(),error:null}).then(resolve)};return q;
  });
});
it("lets the teacher read only approved portraits for current classes without a directory permission",async()=>{
  const photos=await approvedStudentPhotos([OWN,OTHER]);
  // A kept link to the approved row, never a signed storage URL (owner, 8 Nov 2026).
  expect([...photos]).toEqual([[OWN,`link:${OWN}:photo-row`]]);
  expect(mock.sign).not.toHaveBeenCalled();
  expect(mock.ids.at(-1)).toEqual([OWN]);expect(mock.tables).not.toContain("photo_proposals");
});
it("denies a view-only reader before reading or signing student portraits",async()=>{
  mock.staff.role="view_only";await expect(approvedStudentPhotos([OWN])).rejects.toThrow();expect(mock.from).not.toHaveBeenCalled();expect(mock.sign).not.toHaveBeenCalled();
});
it("does not sign another staff member's photo for a teacher without staff:view",async()=>{
  await expect(approvedStaffPhotos(["other"])).rejects.toThrow("not_permitted");expect(mock.sign).not.toHaveBeenCalled();
});
