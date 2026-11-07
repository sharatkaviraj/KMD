import { aiReportFailure, aiReportRequest, NO_STORE, XLSX_TYPE } from "@/modules/ai-report/data/access";
import { buildFeesWorkbook } from "@/modules/ai-report/data/fees-part";
import { logAiReport } from "@/modules/ai-report/data/school-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Fees builds its whole-year workbook (up to 115 s through the bridge).
export const maxDuration = 120;

/** The AI report's money half: Fees' AI context workbook for the session (reports:ai and fees:reports). */
export async function GET(request: Request) {
  try {
    const ask = await aiReportRequest(new URL(request.url));
    const book = await buildFeesWorkbook(ask);
    await logAiReport(ask.staff, ask.sessionLabel, 0, book.source === "fees" ? "Fees records" : "Fees records (rehearsal copy)");
    return new Response(book.bytes, {
      headers: {
        ...NO_STORE,
        "Content-Type": XLSX_TYPE,
        "Content-Length": String(book.bytes.byteLength),
        "X-Ai-Report-As-Of": book.asOf,
        "X-Ai-Report-Source": book.source,
      },
    });
  } catch (error) {
    return aiReportFailure(error);
  }
}
