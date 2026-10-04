import { requirePermission } from "@/platform/auth/current-staff";
import { schoolToday } from "@/platform/dates";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { logExport, studentExport, workbookBytes } from "@/modules/collection/data/export-repo";
import { studentWorkbook } from "@/modules/collection/domain/workbook";

export const runtime = "nodejs";

/**
 * Everything this app holds about the roll, as a workbook (P10d, S-13): one
 * row per enrolled child with each collected value, the provenance beside it,
 * and an About sheet with the counts. Office work, and logged.
 */
export async function GET() {
  const staff = await requirePermission("collection:manage", "/collection");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return new Response("No session.", { status: 409 });

  const today = schoolToday();
  const data = await studentExport(sessionLabel);
  const sheets = studentWorkbook({ sessionLabel, generatedOn: today, fields: data.fields, rows: data.rows });
  const bytes = await workbookBytes(sheets);
  await logExport({ sessionLabel, kind: "students", scope: "school", rowCount: data.rows.length, actorStaffId: staff.id });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="students-${sessionLabel}-${today}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
