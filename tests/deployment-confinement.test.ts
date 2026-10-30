import { describe, expect, it, vi } from "vitest";

import * as scriptGuard from "../scripts/target-guard.mjs";
import { declaresProduction, isConfinedDeployment } from "@/platform/deployment/confinement";
import {
  effectiveEnvironment,
  environmentFromMarkerRows,
  feeWritesMode,
  toolAccessDecision,
} from "@/platform/deployment/decisions";

/**
 * D-346 (owner override T1, 30 Oct): there is no separate dev database. Any
 * deployment that is not Vercel production is confined, and QA tooling on a
 * production database is confined to test accounts and TEST-2026-27 — never
 * banned, never free. Synthetic values only; nothing is fetched.
 */

const ONE = `https://${scriptGuard.ONE_MAIN_PROJECT_REF}.supabase.co`;
const FEES = `https://${scriptGuard.FEES_SOURCE_PROJECT_REF}.supabase.co`;

describe("isConfinedDeployment — the single definition", () => {
  it("frees only an explicit Vercel production deployment", () => {
    expect(isConfinedDeployment({ VERCEL_ENV: "production" })).toBe(false);
  });

  it("confines previews, Vercel development, local next dev and anything unset", () => {
    expect(isConfinedDeployment({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isConfinedDeployment({ VERCEL_ENV: "development" })).toBe(true);
    expect(isConfinedDeployment({})).toBe(true);
    expect(isConfinedDeployment({ VERCEL_ENV: "" })).toBe(true);
    expect(isConfinedDeployment({ VERCEL_ENV: "Production" })).toBe(true);
  });

  it("reads the real process (a test run is confined)", () => {
    expect(isConfinedDeployment()).toBe(process.env.VERCEL_ENV !== "production");
  });
});

describe("the database marker fails closed", () => {
  it("is dev only when exactly one row says dev", () => {
    expect(environmentFromMarkerRows([{ environment: "dev" }])).toBe("dev");
    expect(environmentFromMarkerRows([{ environment: "production" }])).toBe("production");
    expect(environmentFromMarkerRows([])).toBe("production");
    expect(environmentFromMarkerRows(null)).toBe("production");
    expect(environmentFromMarkerRows({ message: "permission denied" })).toBe("production");
    expect(environmentFromMarkerRows([{ environment: "dev" }, { environment: "dev" }])).toBe("production");
    // The scripts' twin agrees.
    expect(scriptGuard.environmentFromRows([{ environment: "dev" }])).toBe("dev");
    expect(scriptGuard.environmentFromRows({})).toBe("production");
  });

  it("reads production when the request fails, errors or has no key", async () => {
    const throwing = vi.fn(async () => { throw new Error("offline"); });
    const failing = vi.fn(async () => new Response("nope", { status: 500 }));
    const dev = vi.fn(async () => Response.json([{ environment: "dev" }]));
    const fetchImpl = (f: typeof dev) => f as unknown as typeof fetch;

    expect(await scriptGuard.readDeploymentEnvironment({ url: ONE, serviceRoleKey: "k", fetchImpl: fetchImpl(throwing) })).toBe("production");
    expect(await scriptGuard.readDeploymentEnvironment({ url: ONE, serviceRoleKey: "k", fetchImpl: fetchImpl(failing) })).toBe("production");
    expect(await scriptGuard.readDeploymentEnvironment({ url: ONE, serviceRoleKey: "", fetchImpl: fetchImpl(dev) })).toBe("production");
    expect(await scriptGuard.readDeploymentEnvironment({ url: FEES, serviceRoleKey: "k", fetchImpl: fetchImpl(dev) })).toBe("production");
    expect(await scriptGuard.readDeploymentEnvironment({ url: ONE, serviceRoleKey: "k", fetchImpl: fetchImpl(dev) })).toBe("dev");
    // It asked the vppsone schema for row 1, with the service role.
    const [requested, init] = dev.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(requested).toBe(`${ONE}/rest/v1/deployment?select=environment&id=eq.1`);
    expect((init.headers as Record<string, string>)["Accept-Profile"]).toBe("vppsone");
  });
});

describe("QA tools are confined, not banned", () => {
  it("lets anyone through on a dev database", () => {
    expect(toolAccessDecision({ environment: "dev", isTestAccount: false })).toEqual({ ok: true });
  });

  it("lets only a test account through on production, and unknown is not a test account", () => {
    expect(toolAccessDecision({ environment: "production", isTestAccount: true })).toEqual({ ok: true });
    expect(toolAccessDecision({ environment: "production", isTestAccount: false }).ok).toBe(false);
    expect(toolAccessDecision({ environment: "production", isTestAccount: null }).ok).toBe(false);
  });

  it("scripts: read-only runs anywhere, test-scoped is confined to TEST-2026-27 on every marker, dev-only refuses production", () => {
    expect(scriptGuard.decideToolScope("dev", "dev-only")).toEqual({ ok: true, production: false, confined: false, sessionLabel: null });
    expect(scriptGuard.decideToolScope("production", "read-only")).toEqual({ ok: true, production: true, confined: false, sessionLabel: null });
    expect(scriptGuard.decideToolScope("production", "test-scoped")).toEqual({ ok: true, production: true, confined: true, sessionLabel: "TEST-2026-27" });
    // Phase 3: the QA accounts are test accounts, so dev is confined too.
    expect(scriptGuard.decideToolScope("dev", "test-scoped")).toEqual({ ok: true, production: false, confined: true, sessionLabel: "TEST-2026-27" });
    expect(scriptGuard.decideToolScope("production", "dev-only").ok).toBe(false);
    expect(scriptGuard.decideToolScope("dev", "anything").ok).toBe(false);
  });

  it("scripts: a confined sign-in needs a test account even on a dev marker (Phase 3)", async () => {
    const no = vi.fn(async () => Response.json([{ is_test_account: false }]));
    const base = { url: ONE, serviceRoleKey: "k", userId: "00000000-0000-4000-8000-000000000001", email: "qa.x@qa.vpps.local" };
    await expect(
      scriptGuard.assertTestAccountUser({ ...base, scope: { production: false, confined: true }, fetchImpl: no as unknown as typeof fetch }),
    ).rejects.toThrow(/not a test account/);
  });

  it("scripts: a sign-in script on production needs a test account, checked by user id", async () => {
    const yes = vi.fn(async () => Response.json([{ is_test_account: true }]));
    const no = vi.fn(async () => Response.json([{ is_test_account: false }]));
    const none = vi.fn(async () => Response.json([]));
    const userId = "00000000-0000-4000-8000-000000000001";
    const base = { url: ONE, serviceRoleKey: "k", userId, email: "qa.x@qa.vpps.local" };

    await expect(scriptGuard.assertTestAccountUser({ ...base, scope: { production: false }, fetchImpl: no as unknown as typeof fetch })).resolves.toBeUndefined();
    await expect(scriptGuard.assertTestAccountUser({ ...base, scope: { production: true }, fetchImpl: yes as unknown as typeof fetch })).resolves.toBeUndefined();
    await expect(scriptGuard.assertTestAccountUser({ ...base, scope: { production: true }, fetchImpl: no as unknown as typeof fetch })).rejects.toThrow(/not a test account/);
    await expect(scriptGuard.assertTestAccountUser({ ...base, scope: { production: true }, fetchImpl: none as unknown as typeof fetch })).rejects.toThrow(/not a test account/);
    await expect(scriptGuard.isTestAccountUser({ ...base, userId: "not-a-uuid", fetchImpl: yes as unknown as typeof fetch })).resolves.toBe(false);
  });
});

describe("feeWritesMode — the app half of D-345", () => {
  it("is test-only on any confined deployment, whatever the database says", () => {
    expect(feeWritesMode({ confined: true, environment: "dev", setting: "true" })).toBe("test-only");
  });

  it("follows the key: 'false' closes, production needs 'true'", () => {
    expect(feeWritesMode({ confined: false, environment: "dev", setting: null })).toBe("open");
    expect(feeWritesMode({ confined: false, environment: "dev", setting: "false" })).toBe("test-only");
    expect(feeWritesMode({ confined: false, environment: "production", setting: null })).toBe("test-only");
    expect(feeWritesMode({ confined: false, environment: "production", setting: "TRUE " })).toBe("open");
    expect(feeWritesMode({ confined: false, environment: "production", setting: "yes" })).toBe("test-only");
  });
});

describe("a production deployment is production before the marker flips (review of PR #141)", () => {
  it("declaresProduction: Vercel production or VPPSONE_ENV=live", () => {
    expect(declaresProduction({ VERCEL_ENV: "production" })).toBe(true);
    expect(declaresProduction({ VPPSONE_ENV: "live" })).toBe(true);
    expect(declaresProduction({ VERCEL_ENV: "preview", VPPSONE_ENV: "LIVE " })).toBe(true);
    expect(declaresProduction({ VERCEL_ENV: "preview", VPPSONE_ENV: "dev" })).toBe(false);
    expect(declaresProduction({})).toBe(false);
  });

  it("effectiveEnvironment: dev only when the marker says dev AND the deployment does not declare production", () => {
    expect(effectiveEnvironment({ marker: "dev", declaredProduction: false })).toBe("dev");
    expect(effectiveEnvironment({ marker: "dev", declaredProduction: true })).toBe("production");
    expect(effectiveEnvironment({ marker: "production", declaredProduction: false })).toBe("production");
  });

  it("live env + dev marker: QA tools confined to test accounts, fee writes test-only until the key is 'true'", () => {
    const environment = effectiveEnvironment({
      marker: "dev",
      declaredProduction: declaresProduction({ VERCEL_ENV: "production", VPPSONE_ENV: "live" }),
    });
    expect(toolAccessDecision({ environment, isTestAccount: false }).ok).toBe(false);
    expect(toolAccessDecision({ environment, isTestAccount: true }).ok).toBe(true);
    expect(feeWritesMode({ confined: false, environment, setting: null })).toBe("test-only");
    expect(feeWritesMode({ confined: false, environment, setting: "true" })).toBe("open");
  });
});
