import "server-only";

import { z } from "zod";
import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { canAccessSession } from "@/platform/auth/test-session-policy";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";

/**
 * Who may take the AI report, for which year, and where its money comes from.
 * Every route of the report starts here.
 */
export class AiReportError extends Error {
  constructor(public readonly code: "bad_request" | "forbidden" | "not_available" | "too_large" | "unavailable", message: string) {
    super(message);
    this.name = "AiReportError";
  }
}

/** A real year, or a rehearsal year with its prefix. */
export const SESSION_LABEL = /^(?:TEST-|UAT-|DEMO-)?\d{4}-\d{2}$/;

export type AiReportRequest = {
  staff: CurrentStaff;
  sessionLabel: string;
  /** Real staff on a real year: Fees answers for the money and the photographs. */
  live: boolean;
};

/** `reports:ai` ("Download the AI report"), and a year this person may open. */
export async function aiReportRequest(url: URL): Promise<AiReportRequest> {
  const staff = await assertPermission("reports:ai");
  const parsed = z.string().regex(SESSION_LABEL).safeParse(url.searchParams.get("session"));
  if (!parsed.success) throw new AiReportError("bad_request", "Choose a session.");
  const sessionLabel = parsed.data;
  if (!canAccessSession(staff, sessionLabel)) throw new AiReportError("forbidden", "That session is not open to this account.");
  return { staff, sessionLabel, live: /^\d{4}-\d{2}$/.test(sessionLabel) && usesCanonicalFees(staff, sessionLabel) };
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

const MESSAGES: Record<string, string> = {
  bad_request: "That request is not valid.",
  unauthorized: "Sign in again.",
  forbidden: "This account cannot take that part of the report.",
  not_found: "Nothing was found for that.",
  too_large: "That part of the report is too large to send in one piece.",
  unavailable: "That part of the report could not be read just now. Try again in a minute.",
  not_available: "That part comes from Fees, and the Fees connection is not available here.",
  not_configured: "The Fees connection is not set up.",
};
const STATUS: Record<string, number> = { bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, too_large: 413, not_available: 409, not_configured: 503 };

/** A failure as JSON the screen can say in words. Never the error's own text. */
export function aiReportFailure(error: unknown): Response {
  const code = error instanceof AiReportError || error instanceof FeesBridgeError
    ? error.code
    : error instanceof z.ZodError ? "bad_request"
    : error instanceof Error && error.message === "Not signed in." ? "unauthorized"
    : error instanceof Error && error.message.startsWith("Permission denied") ? "forbidden"
    : "unavailable";
  const status = STATUS[code] ?? 503;
  if (status >= 500) console.error("[ai-report]", error);
  return Response.json({ error: { code, message: MESSAGES[code] ?? MESSAGES.unavailable } }, { status, headers: NO_STORE });
}
