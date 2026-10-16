import { NextResponse } from "next/server";
import { clientIp, limitByIp, limitByToken, limitUnknownToken } from "@/modules/collection/data/rate-limit";
import { resolveTaskToken } from "@/modules/teacher-tasks/data/repo";
import { resolveAssignedRequest } from "@/modules/collection/data/requests-repo";
import { submitCollectionPayload } from "@/modules/teacher-tasks/data/collection-save";
import { saveTaskAcademicWork } from "@/modules/teacher-tasks/data/save";
export const runtime="nodejs";
export async function POST(request:Request,ctx:{params:Promise<{token:string}>}) {
  const {token}=await ctx.params;const ip=await clientIp();
  if(!(await limitByIp(ip)).allowed||!(await limitByToken(token)).allowed)return NextResponse.json({ok:false,reason:"rate_limit"},{status:429});
  const task=await resolveTaskToken(token);
  if(!task){await limitUnknownToken(ip);return NextResponse.json({ok:false,reason:"not_permitted"},{status:404});}
  let body:{payload?:unknown};try{body=await request.json();}catch{return NextResponse.json({ok:false,reason:"bad_request"},{status:400});}
  if(!body||typeof body!=="object"||Array.isArray(body))return NextResponse.json({ok:false,reason:"bad_request"},{status:400});
  if(task.kind==="collection") {
    const r=await resolveAssignedRequest(task.request_id!,task.assigned_staff_id);
    if(!r)return NextResponse.json({ok:false,reason:"not_permitted"},{status:404});
    return NextResponse.json(await submitCollectionPayload(r,body.payload));
  }
  const result=await saveTaskAcademicWork({id:task.id,token},{kind:task.kind,session:task.session_label,payload:body.payload});
  return NextResponse.json(result,{status:result.ok?200:409});
}
