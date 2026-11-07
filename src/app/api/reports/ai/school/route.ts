import { aiReportFailure, aiReportRequest, NO_STORE, XLSX_TYPE } from "@/modules/ai-report/data/access";
import { buildSchoolWorkbook, logAiReport } from "@/modules/ai-report/data/school-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// About fifty tables, four at a time; a slow morning should not cut it short.
export const maxDuration = 120;

/** The AI report's One half: One's records for the session as one workbook (reports:ai). */
export async function GET(request: Request) {
  try {
    const { staff, sessionLabel } = await aiReportRequest(new URL(request.url));
    const book = await buildSchoolWorkbook(staff, sessionLabel);
    await logAiReport(staff, sessionLabel, book.rows, "One records");
    return new Response(book.bytes, {
      headers: {
        ...NO_STORE,
        "Content-Type": XLSX_TYPE,
        "Content-Length": String(book.bytes.byteLength),
        "X-Ai-Report-Rows": String(book.rows),
        "X-Ai-Report-Students": String(book.students),
        "X-Ai-Report-Sheets": String(book.sheets),
      },
    });
  } catch (error) {
    return aiReportFailure(error);
  }
}
