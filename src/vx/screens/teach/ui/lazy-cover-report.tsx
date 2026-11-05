"use client";

import dynamic from "next/dynamic";

import type { AwayReport } from "./cover-report";

/** The covered period's report form, fetched when the duty sheet shows it (D-419). */
export const LazyCoverReportForm = dynamic(() => import("./cover-report").then((m) => m.CoverReportForm), { ssr: false });

const Away = dynamic(() => import("./cover-report").then((m) => m.AwayReportsCard), { ssr: false });

/** "While you were away", fetched only when there is something to read. */
export function LazyAwayReports({ reports, today }: { reports: readonly AwayReport[]; today: string }) {
  return reports.length ? <Away reports={reports} today={today} /> : null;
}
