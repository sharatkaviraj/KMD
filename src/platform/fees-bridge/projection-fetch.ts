import "server-only";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { verifiedActorInContext } from "@/platform/auth/verified-actor-context";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { canAccessSession, isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { feesBridgeEnabled, usesCanonicalFees } from "./policy";
import { explicitSessionOf, projectionUrl } from "./projection-policy";
import { readFeesBridgeState } from "./state";
import { getServerSupabaseUrl } from "@/platform/env";

function refusal(message: string): Response {
  return Response.json({code:"ONE_CANONICAL_FEES_REQUIRED",message,details:null,hint:null},{status:409});
}

/**
 * Routes only One-local identity reads to its owned projections. Finance
 * remains an explicit domain API. There is never a source Supabase client.
 * All callers still enforce their own field/role/class permissions.
 */
export function createProjectionFetch(underlying?: typeof fetch, options:{privileged?:boolean}={}): typeof fetch {
  return async (input,init) => {
    const send = underlying ?? globalThis.fetch;
    if (!feesBridgeEnabled()) return send(input,init);
    const request = new Request(input,init);
    const url = new URL(request.url);
    const schema = request.headers.get("Accept-Profile") ?? request.headers.get("Content-Profile");
    if (schema !== "public" || !url.pathname.startsWith("/rest/v1/")) return send(input,init);
    if(url.origin!==new URL(getServerSupabaseUrl()).origin)return refusal("The roster request origin is not permitted.");

    // Inside an AI-connection read (`withVerifiedActor`,
    // src/modules/mcp/data/runtime.ts, after its whole per-call check) the
    // reader is that actor and NOTHING from cookies counts: on /api/mcp the
    // token holder writes the Cookie header, so neither the cookie's staff
    // member nor its session pill may steer this read. Otherwise the
    // cookie's staff member, as before. The rules below apply to either.
    const contextActor = verifiedActorInContext();
    const staff = contextActor ?? (await getCurrentStaff());
    if (!staff) return refusal("A verified staff account is required to read the school roster.");
    const explicitSession = explicitSessionOf(url);
    if (explicitSession && !canAccessSession(staff,explicitSession)) return refusal("That academic session is not available to this account.");
    const requested = explicitSession ?? (contextActor ? null : await getViewSessionCookie());
    // A stale TEST cookie after promotion, or a forged cookie on a real
    // non-admin, does not select the local TEST database path.
    const session = requested && canAccessSession(staff,requested) ? requested : null;
    if (!usesCanonicalFees(staff,session)) {
      // Only an explicit TEST context can use the old local engine while
      // coexistence is enabled. A missing real session never falls back.
      if (staff.isTestAccount === true || isTestSessionLabel(session)) return send(input,init);
      return refusal("The live Fees connection is not available on this deployment.");
    }
    // Never translate a write or POST RPC into a projection; old read RPCs
    // would otherwise return the masked local financial answer too.
    if (request.method !== "GET" && request.method !== "HEAD") return refusal("Use the live Fees connection for this financial operation.");
    const target = projectionUrl(url);
    const isActiveSetting = url.pathname === "/rest/v1/app_settings" && url.searchParams.get("key") === "eq.active_session_label";
    if (!target && !isActiveSetting) return refusal("Use the live Fees connection for this financial operation.");
    // Preserve the client boundary: a cookie client must not silently gain
    // service-role privileges. Supported shared readers authorize explicitly
    // before using the existing One admin client; other cookie reads refuse.
    if(target && !options.privileged)return refusal("Use an authorized shared-roster reader for this operation.");
    try {
      const state = await readFeesBridgeState();
      if (isActiveSetting) {
        if (!state.active_session_label) return refusal("The source academic session is unavailable.");
        const row = {key:"active_session_label",value:state.active_session_label};
        const single = request.headers.get("accept")?.includes("application/vnd.pgrst.object+json");
        return Response.json(single ? row : [row],{headers:{"Cache-Control":"no-store"}});
      }
      const headers = new Headers(request.headers);
      headers.set("Accept-Profile","vppsone");
      headers.delete("Content-Profile");
      // Do not rely on the worker being configured to publish real rows only.
      // Preserve every caller's ID/class filter and additionally exclude TEST
      // identities, even if a later snapshot includes rehearsal sessions.
      const conditions=["session_label.not.ilike.TEST-*","session_label.not.ilike.UAT-*","session_label.not.ilike.DEMO-*"];
      const existing=target!.searchParams.get("and");
      if(existing)conditions.push(`and${existing}`);
      target!.searchParams.set("and",`(${conditions.join(",")})`);
      return send(new Request(target!,{method:request.method,headers,cache:"no-store",signal:request.signal}));
    } catch {
      return refusal("The live school roster is not ready. Open Fees for current financial records.");
    }
  };
}
