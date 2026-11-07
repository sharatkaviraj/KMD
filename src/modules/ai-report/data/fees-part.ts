import "server-only";

import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { can } from "@/platform/auth/permissions";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { getBridgeAiContextWorkbook } from "@/platform/fees-bridge/client";
import { aiContextBundleResponse } from "@/modules/exports/data/ai-context-bundle";
import { reportBaseName } from "../domain/bundle";
import { AiReportError, type AiReportRequest } from "./access";

/**
 * The AI report's money half: Fees' own "AI context bundle" workbook, the one
 * Fees → Exports gives, so the money in the report is Fees' word for it.
 *
 *  - Real staff on a real year: Fees builds it and sends it through the One
 *    bridge (Fees checks the person's own grants: reports, students, finance).
 *  - Rehearsal years (TEST-, UAT-, DEMO-): One's ported copy of the same
 *    builder, against One's TEST data, with the same fee-side permissions the
 *    ported Exports screen asks for. A real year without the live connection
 *    gets no money sheets at all, never One's copy of them.
 */

/** One response must stay under Vercel's 4.5 MB. */
export const MAX_FEES_WORKBOOK_BYTES = 4_300_000;

export type FeesWorkbook = { bytes: Uint8Array<ArrayBuffer>; asOf: string; source: "fees" | "one" };

export async function buildFeesWorkbook({ staff, sessionLabel, live }: AiReportRequest): Promise<FeesWorkbook> {
  if (!can(staff, "fees:reports")) throw new AiReportError("forbidden", "Fee reports are not open to this account.");
  if (live) {
    const { bytes, asOf } = await getBridgeAiContextWorkbook(sessionLabel);
    return { bytes, asOf, source: "fees" };
  }
  // A real year's money is Fees' word or nothing: One's own fee tables are a
  // rehearsal copy, so they never stand in when the connection is off.
  if (!isTestSessionLabel(sessionLabel)) throw new AiReportError("not_available", "The Fees connection is not available for this year here.");
  const fee = feePermissionsFor(staff.role);
  if (!fee.includes("reports:view") || !fee.includes("students:view")) {
    throw new AiReportError("forbidden", "Fee reports are not open to this account.");
  }
  const response = await aiContextBundleResponse(`${reportBaseName(sessionLabel)}-fees.xlsx`, sessionLabel, { compression: true });
  if (!response.ok) throw new AiReportError("unavailable", "The fee workbook could not be made.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_FEES_WORKBOOK_BYTES) throw new AiReportError("too_large", "The fee workbook does not fit one download.");
  return { bytes, asOf: new Date().toISOString(), source: "one" };
}
