import { z } from "zod";
import { getBridgeStudentDocument } from "@/platform/fees-bridge/client";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store, max-age=0",Vary:"Cookie","X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"same-origin","Content-Security-Policy":"sandbox"};
export async function GET(request:Request,context:{params:Promise<{studentId:string;sendId:string}>}) {
  try {
    const {studentId,sendId}=await context.params;
    const session=z.string().regex(/^\d{4}-\d{2}$/).parse(new URL(request.url).searchParams.get("session"));
    const bytes=await getBridgeStudentDocument(z.uuid().parse(studentId),z.uuid().parse(sendId),session);
    return new Response(bytes,{headers:{...headers,"Content-Type":"application/pdf","Content-Length":String(bytes.byteLength),"Content-Disposition":"inline; filename=student-document.pdf"}});
  }catch(error){
    const status=error instanceof z.ZodError?404:error instanceof FeesBridgeError?error.code==="unauthorized"?401:error.code==="forbidden"?403:["not_found","not_available"].includes(error.code)?404:503:error instanceof Error&&error.message==="Not signed in."?401:403;
    return new Response(null,{status,headers});
  }
}
