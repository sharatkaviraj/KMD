import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { isExistingFeesPath } from "./routes";

type Environment = Readonly<Record<string, string | undefined>>;
export const FEES_ORIGIN = "https://fees.vpps.co.in";

/** A separate integration, never a replacement for One's Supabase URL. */
export function feesBridgeEnabled(env: Environment = process.env): boolean {
  const value = env.FEES_BRIDGE_ENABLED?.trim();
  if (value && value !== "true" && value !== "false") {
    throw new Error("FEES_BRIDGE_ENABLED must be true or false.");
  }
  return value === "true";
}

/**
 * Fees' office reads (today's totals, pending refunds, receipt lookup). Off
 * until the Fees side has migration 20261103170000 applied: before that every
 * office read answers 503, and showing that as "could not read" would bring
 * back the false failure review T02 removed.
 */
export function feesBridgeOfficeReads(env: Environment = process.env): boolean {
  return feesBridgeEnabled(env) && env.FEES_BRIDGE_OFFICE_READS === "true";
}

export function feesBridgeWritesEnabled(env: Environment = process.env): boolean {
  return feesBridgeEnabled(env) && !isConfinedDeployment(env) && env.FEES_BRIDGE_WRITES_ENABLED === "true";
}

export type BridgeViewer = {
  isActive: boolean;
  role?:string;
  isTestAccount?: boolean;
  confined?: boolean;
};

export function usesCanonicalFees(viewer: BridgeViewer, sessionLabel?: string | null, env: Environment = process.env): boolean {
  return feesBridgeEnabled(env) && viewer.isActive && viewer.isTestAccount !== true &&
    viewer.confined !== true && !isConfinedDeployment(env) &&
    (!isTestSessionLabel(sessionLabel) || (viewer.role!==undefined && viewer.role!=="admin"));
}

export function assertBridgeSession(sessionLabel: string): void {
  if (!/^\d{4}-\d{2}$/.test(sessionLabel) || isTestSessionLabel(sessionLabel)) {
    throw new Error("The live Fees connection requires an explicit real academic session.");
  }
}

/** Only an allowlisted origin may ever receive the One token or bridge key. */
export function feesBridgeOrigin(env: Environment = process.env): string {
  const origin = env.FEES_BRIDGE_ORIGIN?.trim() || FEES_ORIGIN;
  if (origin !== FEES_ORIGIN) throw new Error("The Fees connection origin is not permitted.");
  return origin;
}

const NATIVE_FINANCE_ROUTES: Readonly<Record<string, string>> = {
  "/accounts": "/protected/finance-controls",
  "/dues": "/protected/defaulters",
  "/fee-setup": "/protected/fee-setup",
  "/receipts": "/protected/receipts",
  "/reminders": "/protected/reminders",
  "/reports": "/protected/reports",
  "/student-tools": "/protected/students",
};

/** Exact path segments, fixed origin and no tokens or untrusted query forwarding. */
export function delegatedFeesPath(pathname: string): string | null {
  if (pathname === "/fees" || pathname.startsWith("/fees/")) {
    const candidate=pathname === "/fees" ? "/protected/dashboard" : `/protected${pathname.slice(5)}`;
    return isExistingFeesPath(candidate)?candidate:"/protected/dashboard";
  }
  if(pathname==="/admissions/new")return "/protected/students/new";
  const admission=/^\/admissions\/([0-9a-f-]{36})$/.exec(pathname);
  if(admission)return `/protected/students/${admission[1]}/edit`;
  // These are One-owned homes/CRM. Their source-data adapters keep them here.
  if(pathname==="/accounts" || pathname==="/admissions" || pathname==="/admissions/seats")return null;
  // The single-receipt page validates number + source UUID + session and is
  // read-only. The receipt desk and every nested operation remain delegated.
  if (/^\/receipts\/[^/]+$/.test(pathname)) return null;
  for (const [route, destination] of Object.entries(NATIVE_FINANCE_ROUTES)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) return destination;
  }
  return null;
}

export function feesDestination(pathname: string, sessionLabel?: string | null): string | null {
  const path = delegatedFeesPath(pathname);
  if (!path) return null;
  const destination = new URL(path, FEES_ORIGIN);
  if (sessionLabel && /^\d{4}-\d{2}$/.test(sessionLabel)) destination.searchParams.set("session", sessionLabel);
  return destination.toString();
}
