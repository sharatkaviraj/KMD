import { requirePermission } from "@/platform/auth/current-staff";
import { schoolToday } from "@/platform/dates";
import { logExport, roundExport, workbookBytes } from "@/modules/collection/data/export-repo";
import { roundWorkbook } from "@/modules/collection/domain/workbook";

export const runtime = "nodejs";

/**
 * One round as a workbook (P10d, S-13): a sheet per link with what each
 * teacher was shown, her answer and what became of it. Office work, and logged.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("collection:manage", "/collection/rounds");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found.", { status: 404 });

  const round = await roundExport(id);
  if (!round) return new Response("Not found.", { status: 404 });

  const today = schoolToday();
  const sheets = roundWorkbook({ title: round.title, sessionLabel: round.sessionLabel, generatedOn: today, links: round.links });
  const bytes = await workbookBytes(sheets);
  const rowCount = round.links.reduce((sum, link) => sum + link.members.length, 0);
  await logExport({ sessionLabel: round.sessionLabel, kind: "round", scope: id, rowCount, actorStaffId: staff.id });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="round-${today}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
