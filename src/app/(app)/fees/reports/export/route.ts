import type { NextRequest } from "next/server";

import { withDownloadToken } from "@/platform/helpers/download-token";
import {
  getReportCsvData,
  normalizeReportFilters,
  serializeCsv,
} from "@/modules/reports/data/queries";
import {
  getAuthenticatedStaff,
  hasStaffPermission,
} from "@/modules/fees/platform/session";
import { visibleSessionForRoute } from "@/modules/fees/platform/session-context/route-session";
import { assertStudentVisible, refusalResponse } from "@/platform/auth/test-session-access";

// Full-session CSV exports can overrun Vercel's default function timeout.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const staff = await getAuthenticatedStaff();

  if (!staff) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!hasStaffPermission(staff, "reports:view")) {
    return new Response("Forbidden", { status: 403 });
  }

  const filters = normalizeReportFilters(request.nextUrl.searchParams);
  // A named session must be one this viewer may open; none means their own,
  // and a single student must be visible too (Phase 3).
  const routeSession = await visibleSessionForRoute(filters.sessionLabel);
  if (!routeSession.ok) return routeSession.response;
  if (filters.studentId) {
    const refused = await refusalResponse(() => assertStudentVisible(null, filters.studentId));
    if (refused) return refused;
  }
  const csvData = await getReportCsvData({ ...filters, sessionLabel: routeSession.sessionLabel });

  return withDownloadToken(
    request,
    new Response(serializeCsv(csvData), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${csvData.filename}"`,
        "cache-control": "no-store",
      },
    }),
  );
}
