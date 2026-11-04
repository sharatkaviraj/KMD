import "server-only";

import { headers } from "next/headers";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { DAYRUN, accountForAlias } from "@/platform/auth/dayrun-policy";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { approveRequest, authorizationErrorUrl as errorUrl } from "@/modules/mcp/domain/consent";
import type { ConnectionSubject } from "@/modules/mcp/domain/eligibility";
import { validateAuthorizeRequest, type AuthorizeDecision, type AuthorizeRequest } from "@/modules/mcp/domain/oauth";
import { canonicalOrigin, endpointsFor, type Endpoints } from "@/modules/mcp/domain/origin";
import { createSupabaseMcpStore } from "@/modules/mcp/data/store";

/**
 * The consent page's server half, shared by the page and its two actions so
 * an approval re-validates exactly what the page validated — from the raw
 * query, never from fields the page rendered.
 */

export type LoadedAuthorization =
  | { kind: "unknown_host" }
  | { kind: "decided"; decision: AuthorizeDecision; endpoints: Endpoints };

/** This request's own origin, as far as the headers say; `canonicalOrigin` decides whether to trust it. */
async function requestUrl(): Promise<string> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(host)) return "https://invalid.invalid/";
  const forwarded = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : local ? "http" : "https";
  return `${proto}://${host}/`;
}

/** The endpoints for the host this page was served on, or null when it is not one of this deployment's. */
export async function pageEndpoints(): Promise<Endpoints | null> {
  const origin = canonicalOrigin(await requestUrl(), process.env);
  return origin ? endpointsFor(origin) : null;
}

export async function loadAuthorization(query: URLSearchParams): Promise<LoadedAuthorization> {
  const endpoints = await pageEndpoints();
  if (!endpoints) return { kind: "unknown_host" };
  const clientId = query.get("client_id");
  const client = clientId && clientId.length <= 64 ? await createSupabaseMcpStore().getClient(clientId) : null;
  return {
    kind: "decided",
    endpoints,
    decision: validateAuthorizeRequest(query, client, { resource: endpoints.resource, allowLoopback: isConfinedDeployment() }),
  };
}

/** The signed-in staff member as the eligibility rule reads them. */
export function consentSubject(staff: CurrentStaff): ConnectionSubject {
  return {
    role: staff.role,
    isActive: staff.isActive,
    isTestAccount: staff.isTestAccount === true,
    smokeLab: staff.smokeLab === true,
    qaAccount: DAYRUN.aliases.some((alias) => accountForAlias(alias)?.userId === staff.userId),
  };
}

/** Create the connection and its single-use code; the URL to send the browser to, or null. */
export function approveAuthorization(staff: CurrentStaff, request: AuthorizeRequest, endpoints: Endpoints): Promise<string | null> {
  return approveRequest(createSupabaseMcpStore(), { staffProfileId: staff.id, authUserId: staff.userId }, request, endpoints.issuer);
}

export function authorizationErrorUrl(redirectUri: string, error: string, description: string, state: string | null, endpoints: Endpoints): string {
  return errorUrl(redirectUri, error, description, state, endpoints.issuer);
}
