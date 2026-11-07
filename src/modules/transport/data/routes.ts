import "server-only";

import { z } from "zod";

import { isSentinelNoTransportRoute } from "@/modules/fees/domain/transport-route-key";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { FEE_SCHEMA } from "@/platform/env";
import { feesBridgeEnabled, feesBridgeOrigin } from "@/platform/fees-bridge/policy";
import { createAdminClient } from "@/platform/supabase/admin";

import type { RouteInfo, RouteSource } from "../domain/board";
import { missingTable } from "./missing";

/*
 * Transport route names (D-550).
 *
 * Fees owns the route list. One keeps a copy, `vppsone.fees_bridge_routes`,
 * replaced whole by `refreshRouteCopy()`: after the nightly roster copy, after
 * an admin's "Refresh roster now", from the Transport screen's own refresh
 * button, and once when the copy is empty or more than a day old. A TEST
 * session reads the local route list instead, as every TEST fee screen does.
 *
 * Until the copy exists (its migration not yet applied) the screen asks Fees
 * directly and keeps the answer in memory for ten minutes, so the routes have
 * their names from the first day.
 */

export type { RouteSource };
export type RouteList = { routes: RouteInfo[]; source: RouteSource; refreshedAt: string | null };

const ROUTES_PATH = "/api/one/v1/sync/routes";
/** One attempt per ten minutes, whoever asks. */
const ATTEMPT_EVERY_MS = 10 * 60_000;
/** A copy older than this is refreshed when the screen next opens. */
const STALE_AFTER_MS = 26 * 60 * 60_000;

const feesAnswer = z.object({
  version: z.literal(1),
  data: z.object({
    routes: z
      .array(
        z.object({
          id: z.string().uuid(),
          name: z.string().trim().min(1),
          code: z.string().nullable(),
          isActive: z.boolean(),
          placeholder: z.boolean(),
        }),
      )
      .max(500),
    asOf: z.string(),
  }),
});

/** The route list from Fees, under the machine sync credential. Throws a `transport_routes_*` code. */
export async function fetchFeesRoutes(): Promise<{ routes: RouteInfo[]; asOf: string }> {
  if (isConfinedDeployment() || !feesBridgeEnabled()) throw new Error("transport_routes_disabled");
  const key = process.env.FEES_BRIDGE_SYNC_KEY;
  if (!key || key.length < 32) throw new Error("transport_routes_unconfigured");
  let response: Response;
  try {
    response = await fetch(`${feesBridgeOrigin()}${ROUTES_PATH}`, {
      method: "GET",
      headers: { Accept: "application/json", "X-One-Sync-Key": key },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new Error("transport_routes_unreachable");
  }
  if (!response.ok) throw new Error(`transport_routes_${response.status}`);
  const text = await response.text();
  if (text.length > 500_000) throw new Error("transport_routes_oversized");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("transport_routes_invalid");
  }
  const parsed = feesAnswer.safeParse(body);
  if (!parsed.success) throw new Error("transport_routes_invalid");
  const ids = new Set(parsed.data.data.routes.map((r) => r.id));
  if (ids.size !== parsed.data.data.routes.length) throw new Error("transport_routes_invalid");
  return {
    routes: parsed.data.data.routes.map((r) => ({
      id: r.id,
      name: r.name.slice(0, 200),
      code: r.code?.trim().slice(0, 50) || null,
      isActive: r.isActive,
      placeholder: r.placeholder,
    })),
    asOf: parsed.data.data.asOf,
  };
}

let remembered: { at: number; value: { routes: RouteInfo[]; asOf: string } } | null = null;

async function feesRoutesRemembered(): Promise<{ routes: RouteInfo[]; asOf: string }> {
  if (remembered && Date.now() - remembered.at < ATTEMPT_EVERY_MS) return remembered.value;
  const value = await fetchFeesRoutes();
  remembered = { at: Date.now(), value };
  return value;
}

export type RefreshOutcome = { ok: true; count: number } | { ok: false; code: string } | { ok: false; code: "recent"; waitMinutes: number };

const codeOf = (error: unknown) =>
  error instanceof Error && /^transport_[a-z0-9_]{1,50}$/.test(error.message) ? error.message : "transport_routes_failed";

/**
 * Replace One's copy of the route names with Fees' list. `force` skips the
 * ten-minute spacing (the nightly job and an admin's refresh); without it a
 * refresh within ten minutes of the last attempt is not repeated.
 */
export async function refreshRouteCopy(options: { force?: boolean } = {}): Promise<RefreshOutcome> {
  const db = createAdminClient();
  const state = await db.from("fees_bridge_route_sync").select("last_attempt_at").eq("id", true)
    .maybeSingle<{ last_attempt_at: string | null }>();
  if (state.error) return { ok: false, code: missingTable(state.error) ? "transport_not_set_up" : "transport_routes_state_failed" };
  const last = Date.parse(state.data?.last_attempt_at ?? "");
  if (!options.force && Number.isFinite(last) && Date.now() - last < ATTEMPT_EVERY_MS) {
    return { ok: false, code: "recent", waitMinutes: Math.max(1, Math.ceil((ATTEMPT_EVERY_MS - (Date.now() - last)) / 60_000)) };
  }
  await db.from("fees_bridge_route_sync").update({ last_attempt_at: new Date().toISOString() }).eq("id", true);
  try {
    const { routes } = await fetchFeesRoutes();
    const { data, error } = await db.rpc("fees_bridge_replace_routes", { p_routes: routes });
    if (error) throw new Error("transport_routes_apply_failed");
    remembered = { at: Date.now(), value: { routes, asOf: new Date().toISOString() } };
    return { ok: true, count: Number(data ?? routes.length) };
  } catch (error) {
    const code = codeOf(error);
    // Never the upstream body or a URL: only the code.
    await db.from("fees_bridge_route_sync").update({ last_error_code: code }).eq("id", true);
    return { ok: false, code };
  }
}

type CopyRow = { id: string; name: string; code: string | null; is_active: boolean; placeholder: boolean };

async function readCopy(): Promise<{ state: "missing" } | { state: "ok"; routes: RouteInfo[]; refreshedAt: string | null }> {
  const db = createAdminClient();
  const [routes, sync] = await Promise.all([
    db.from("fees_bridge_routes").select("id,name,code,is_active,placeholder").order("name").limit(1000).returns<CopyRow[]>(),
    db.from("fees_bridge_route_sync").select("last_success_at").eq("id", true).maybeSingle<{ last_success_at: string | null }>(),
  ]);
  if (missingTable(routes.error) || missingTable(sync.error)) return { state: "missing" };
  if (routes.error || sync.error) throw new Error("transport_routes_unreadable");
  return {
    state: "ok",
    routes: routes.data.map((r) => ({ id: r.id, name: r.name, code: r.code, isActive: r.is_active, placeholder: r.placeholder })),
    refreshedAt: sync.data?.last_success_at ?? null,
  };
}

type LocalRow = { id: string; route_name: string | null; route_code: string | null; is_active: boolean | null };

/** A TEST session's routes: the local list, as the TEST fee screens read it. */
async function readLocalRoutes(): Promise<RouteList> {
  const { data, error } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("transport_routes")
    .select("id,route_name,route_code,is_active")
    .order("route_name")
    .limit(1000)
    .returns<LocalRow[]>();
  if (error) throw new Error("transport_routes_unreadable");
  return {
    routes: data.map((r) => ({
      id: r.id,
      name: (r.route_name ?? "").trim(),
      code: r.route_code?.trim() || null,
      isActive: r.is_active !== false,
      placeholder: isSentinelNoTransportRoute(r.route_name),
    })),
    source: "local",
    refreshedAt: null,
  };
}

/**
 * The routes this screen names. `canonical` is `usesCanonicalFees()` for the
 * reader and the session: the real year reads Fees' names, a TEST session the
 * local list. `later` runs work after the page is sent (`after()`).
 */
export async function readRoutes(canonical: boolean, later: (task: () => Promise<unknown>) => void): Promise<RouteList> {
  if (!canonical) return readLocalRoutes();
  const copy = await readCopy().catch(() => null);
  if (copy?.state === "ok" && copy.routes.length > 0) {
    const age = Date.now() - Date.parse(copy.refreshedAt ?? "");
    if (!Number.isFinite(age) || age > STALE_AFTER_MS) later(() => refreshRouteCopy());
    return { routes: copy.routes, source: "copy", refreshedAt: copy.refreshedAt };
  }
  if (copy?.state === "ok") {
    // An empty copy: fill it now, once, then read it back.
    const outcome = await refreshRouteCopy();
    if (outcome.ok) {
      const again = await readCopy().catch(() => null);
      if (again?.state === "ok" && again.routes.length > 0) return { routes: again.routes, source: "copy", refreshedAt: again.refreshedAt };
    }
  }
  try {
    const live = await feesRoutesRemembered();
    return { routes: live.routes, source: "fees", refreshedAt: live.asOf };
  } catch {
    return { routes: copy?.state === "ok" ? copy.routes : [], source: "none", refreshedAt: null };
  }
}
