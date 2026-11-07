import { z } from "zod";
import { aiReportFailure, aiReportRequest, NO_STORE } from "@/modules/ai-report/data/access";
import { readPhotoPage } from "@/modules/ai-report/data/photos";
import { logAiReport } from "@/modules/ai-report/data/school-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One page of the AI report's photographs (reports:ai and students:view); `after` is the last page's `next`. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ask = await aiReportRequest(url);
    const after = url.searchParams.get("after");
    const page = await readPhotoPage(ask, after ? z.uuid().parse(after) : null);
    if (!after && page.source === "fees") await logAiReport(ask.staff, ask.sessionLabel, page.total ?? 0, "Student photographs");
    return Response.json(page, { headers: NO_STORE });
  } catch (error) {
    return aiReportFailure(error);
  }
}
