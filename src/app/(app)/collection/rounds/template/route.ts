import { requirePermission } from "@/platform/auth/current-staff";
import { templateCsv } from "@/modules/collection/domain/ask-list";

export const runtime = "nodejs";

/**
 * The sheet the office fills in, as a download.
 *
 * **CSV, not `.xlsx`.** SOURCES.md records that SamPark's `excel.ts` was not
 * ported: a spreadsheet library to write a file Excel already opens is a
 * dependency bought for nothing. The BOM and CRLF are the part that was kept —
 * without them Excel opens the Hindi in the notes column as mojibake, and a
 * template whose notes cannot hold Hindi is a template for one language.
 *
 * Guarded, because the header row is this app's own agreement with itself:
 * the download and the upload are two halves of one contract, and the matcher
 * reads the column names this writes.
 */
export async function GET() {
  await requirePermission("collection:manage", "/collection/rounds");

  return new Response(templateCsv(), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="ask-list.csv"',
      // Never cached: the header row is a contract, and a stale template is a
      // sheet whose columns the matcher cannot see.
      "cache-control": "no-store",
    },
  });
}
