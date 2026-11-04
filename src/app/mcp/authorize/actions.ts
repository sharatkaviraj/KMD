"use server";

import { redirect } from "next/navigation";

import { assertStaff } from "@/platform/auth/current-staff";
import { aiConnectionEligibility } from "@/modules/mcp/domain/eligibility";
import { LIMITS } from "@/modules/mcp/domain/constants";
import { approveAuthorization, authorizationErrorUrl, consentSubject, loadAuthorization } from "@/modules/mcp/data/authorize";
import { readAiConnectionSwitch } from "@/modules/mcp/data/connections";
import { assertNotPreviewing } from "@/vx/view-as";

/**
 * Approve or deny an AI-connection request. Neither trusts what the page
 * rendered: both take the original authorization query and validate it again
 * — client, exact redirect URI, S256 challenge, resource, scope — then
 * eligibility and the school's switch, against the staff member signed in
 * now. A request that no longer validates goes back to the page, which says
 * why; nothing is sent to an unvalidated address.
 */

const MAX_QUERY = 8 * 1024;

function queryFrom(formData: FormData): URLSearchParams {
  const raw = String(formData.get("request") ?? "");
  return new URLSearchParams(raw.length <= MAX_QUERY ? raw : "");
}

function backToPage(query: URLSearchParams): never {
  redirect(`/mcp/authorize?${query.toString()}`);
}

export async function approveAuthorizationAction(formData: FormData): Promise<void> {
  const staff = await assertStaff();
  await assertNotPreviewing();
  const query = queryFrom(formData);
  const loaded = await loadAuthorization(query);
  if (loaded.kind !== "decided" || loaded.decision.kind !== "ok") backToPage(query);
  if (!aiConnectionEligibility(consentSubject(staff)).ok) backToPage(query);
  if ((await readAiConnectionSwitch().catch(() => null))?.enabled !== true) backToPage(query);
  if ((loaded.decision.request.state ?? "").length > LIMITS.state) backToPage(query);

  const url = await approveAuthorization(staff, loaded.decision.request, loaded.endpoints).catch(() => null);
  if (!url) backToPage(query);
  redirect(url);
}

export async function denyAuthorizationAction(formData: FormData): Promise<void> {
  await assertStaff();
  const query = queryFrom(formData);
  const loaded = await loadAuthorization(query);
  if (loaded.kind !== "decided" || loaded.decision.kind !== "ok") backToPage(query);
  const { request } = loaded.decision;
  redirect(authorizationErrorUrl(request.redirectUri, "access_denied", "The member of staff did not allow the connection.", request.state, loaded.endpoints));
}
