import { describe, expect, it } from "vitest";

import * as scriptGuard from "../scripts/target-guard.mjs";
import {
  assertPermittedTarget,
  DEV_PROJECT_REFS,
  PROTECTED_LIVE_PROJECT_REF,
  ProtectedTargetError,
  refusalFor,
  supabaseTargetOf,
  type TargetContext,
} from "@/platform/supabase/target-guard";

/**
 * P0, Gate A: a client cannot be made for the live fee project except by a
 * deployment that has declared the cutover, and never by a test.
 *
 * Every URL here is synthetic. Nothing is fetched — the guard decides from the
 * string, and that is the property being tested: the refusal happens before a
 * request could leave the process, so proving it needs no request.
 */

const DEV = `https://${DEV_PROJECT_REFS[0]}.supabase.co`;
const LIVE = `https://${PROTECTED_LIVE_PROJECT_REF}.supabase.co`;
const UNKNOWN = "https://abcdefghijklmnopqrst.supabase.co";

const dev: TargetContext = { environment: "dev", underTest: false, ci: false };
const devTest: TargetContext = { environment: "dev", underTest: true, ci: false };
const live: TargetContext = { environment: "live", underTest: false, ci: false };
const liveTest: TargetContext = { environment: "live", underTest: true, ci: false };

describe("supabaseTargetOf", () => {
  it("reads the project ref from the hostname, exactly", () => {
    expect(supabaseTargetOf(DEV)).toEqual({ kind: "project", ref: DEV_PROJECT_REFS[0] });
    expect(supabaseTargetOf(`${LIVE}/rest/v1/`)).toEqual({
      kind: "project",
      ref: PROTECTED_LIVE_PROJECT_REF,
    });
  });

  it("does not take a ref from anywhere but the host", () => {
    // The scripts' old `url.includes(ref)` passed all three of these.
    expect(supabaseTargetOf(`https://elsewhere.example/?${DEV_PROJECT_REFS[0]}`).kind).toBe(
      "unknown",
    );
    expect(supabaseTargetOf(`https://${DEV_PROJECT_REFS[0]}.evil.example`).kind).toBe("unknown");
    expect(
      supabaseTargetOf(`https://x.example/${DEV_PROJECT_REFS[0]}.supabase.co`).kind,
    ).toBe("unknown");
  });

  it("knows a local Supabase and an inert placeholder", () => {
    expect(supabaseTargetOf("http://127.0.0.1:54321").kind).toBe("local");
    expect(supabaseTargetOf("http://localhost:54321").kind).toBe("local");
    expect(supabaseTargetOf("https://ci-build-only.supabase.co").kind).toBe("placeholder");
    expect(supabaseTargetOf("not a url").kind).toBe("unknown");
  });
});

describe("refusalFor — the live fee project", () => {
  it("is refused on a dev deployment", () => {
    expect(refusalFor(LIVE, dev)).toMatch(/live fee project/);
  });

  it("is refused under a test runner, even when the environment says live", () => {
    // "Environment names such as preview or test do not override the target
    // check" — and neither does a test that inherited VPPSONE_ENV=live.
    expect(refusalFor(LIVE, liveTest)).toMatch(/never a test target/);
    expect(refusalFor(LIVE, devTest)).toMatch(/never a test target/);
  });

  it("is permitted only by a live deployment that is not a test", () => {
    expect(refusalFor(LIVE, live)).toBeNull();
  });
});

describe("refusalFor — everything else", () => {
  it("lets dev reach the dev project and a local Supabase", () => {
    expect(refusalFor(DEV, dev)).toBeNull();
    expect(refusalFor(DEV, devTest)).toBeNull();
    expect(refusalFor("http://127.0.0.1:54321", devTest)).toBeNull();
  });

  it("fails closed on an unknown project", () => {
    expect(refusalFor(UNKNOWN, dev)).toMatch(/not a known dev project/);
    expect(refusalFor(UNKNOWN, devTest)).toMatch(/not a known dev project/);
  });

  it("refuses the dev project from a live deployment", () => {
    // A cutover that forgot to change the URL is a misconfiguration, not a
    // reason to write live traffic into the test database.
    expect(refusalFor(DEV, live)).toMatch(/may only reach the live fee project/);
  });

  it("accepts the CI placeholder only on CI", () => {
    const placeholder = "https://ci-build-only.supabase.co";
    expect(refusalFor(placeholder, { ...dev, ci: true })).toBeNull();
    expect(refusalFor(placeholder, dev)).toMatch(/not a known dev project/);
  });
});

describe("assertPermittedTarget", () => {
  it("throws a ProtectedTargetError before anything is made", () => {
    expect(() => assertPermittedTarget(LIVE, dev)).toThrow(ProtectedTargetError);
    expect(assertPermittedTarget(DEV, dev)).toBe(DEV);
  });

  it("reads the real process as a test run", () => {
    // Vitest sets VITEST; this is the context every unit test runs in.
    expect(() => assertPermittedTarget(LIVE)).toThrow(/never a test target/);
  });
});

describe("the scripts' twin agrees", () => {
  it("names the same projects", () => {
    expect(scriptGuard.DEV_PROJECT_REFS).toEqual([...DEV_PROJECT_REFS]);
    expect(scriptGuard.PROTECTED_LIVE_PROJECT_REF).toBe(PROTECTED_LIVE_PROJECT_REF);
  });

  it("accepts only an exact dev host", () => {
    expect(scriptGuard.isDevProjectUrl(DEV)).toBe(true);
    expect(scriptGuard.isDevProjectUrl(LIVE)).toBe(false);
    expect(scriptGuard.isDevProjectUrl(UNKNOWN)).toBe(false);
    expect(scriptGuard.isDevProjectUrl(`https://elsewhere.example/?${DEV_PROJECT_REFS[0]}`)).toBe(
      false,
    );
    expect(scriptGuard.projectRefOf(LIVE)).toBe(PROTECTED_LIVE_PROJECT_REF);
  });
});
