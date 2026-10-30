import { describe, expect, it } from "vitest";

import * as scriptGuard from "../scripts/target-guard.mjs";
import {
  assertPermittedTarget,
  FEES_SOURCE_PROJECT_REF,
  isOneMainProject,
  ONE_MAIN_PROJECT_REF,
  ProtectedTargetError,
  refusalFor,
  supabaseTargetOf,
  type TargetContext,
} from "@/platform/supabase/target-guard";

/**
 * P0 Gate A, as amended by D-338/D-346: One's main database is
 * `wtgxcptmucjerhufzjcf` (production from go-live, and the only test bed); the
 * fees app's live database is never a target of the app or of any script but
 * the sealed migration reader.
 *
 * Every URL here is synthetic. Nothing is fetched — the guard decides from the
 * string, and that is the property being tested: the refusal happens before a
 * request could leave the process.
 */

const ONE = `https://${ONE_MAIN_PROJECT_REF}.supabase.co`;
const FEES = `https://${FEES_SOURCE_PROJECT_REF}.supabase.co`;
const UNKNOWN = "https://abcdefghijklmnopqrst.supabase.co";

const dev: TargetContext = { environment: "dev", underTest: false, ci: false };
const devTest: TargetContext = { environment: "dev", underTest: true, ci: false };
const live: TargetContext = { environment: "live", underTest: false, ci: false };
const liveTest: TargetContext = { environment: "live", underTest: true, ci: false };

describe("supabaseTargetOf", () => {
  it("reads the project ref from the hostname, exactly", () => {
    expect(supabaseTargetOf(ONE)).toEqual({ kind: "project", ref: ONE_MAIN_PROJECT_REF });
    expect(supabaseTargetOf(`${FEES}/rest/v1/`)).toEqual({ kind: "project", ref: FEES_SOURCE_PROJECT_REF });
    expect(isOneMainProject(ONE)).toBe(true);
    expect(isOneMainProject(FEES)).toBe(false);
  });

  it("does not take a ref from anywhere but the host", () => {
    // The scripts' old `url.includes(ref)` passed all three of these.
    expect(supabaseTargetOf(`https://elsewhere.example/?${ONE_MAIN_PROJECT_REF}`).kind).toBe("unknown");
    expect(supabaseTargetOf(`https://${ONE_MAIN_PROJECT_REF}.evil.example`).kind).toBe("unknown");
    expect(supabaseTargetOf(`https://x.example/${ONE_MAIN_PROJECT_REF}.supabase.co`).kind).toBe("unknown");
  });

  it("knows a local Supabase and an inert placeholder", () => {
    expect(supabaseTargetOf("http://127.0.0.1:54321").kind).toBe("local");
    expect(supabaseTargetOf("http://localhost:54321").kind).toBe("local");
    expect(supabaseTargetOf("https://ci-build-only.supabase.co").kind).toBe("placeholder");
    expect(supabaseTargetOf("not a url").kind).toBe("unknown");
  });
});

describe("refusalFor — the fees app's live database", () => {
  it("is refused in every context, live included", () => {
    for (const context of [dev, devTest, live, liveTest, { ...dev, ci: true }]) {
      expect(refusalFor(FEES, context)).toMatch(/fees app's live database/);
    }
  });
});

describe("refusalFor — One's main project", () => {
  it("is the target of a live deployment", () => {
    expect(refusalFor(ONE, live)).toBeNull();
  });

  it("is also the target of previews, local development and tests (it is the only test bed)", () => {
    expect(refusalFor(ONE, dev)).toBeNull();
    expect(refusalFor(ONE, devTest)).toBeNull();
  });

  it("is refused when a test runner says VPPSONE_ENV=live", () => {
    expect(refusalFor(ONE, liveTest)).toMatch(/test is not the production deployment/);
  });
});

describe("refusalFor — everything else", () => {
  it("lets dev reach a local Supabase", () => {
    expect(refusalFor("http://127.0.0.1:54321", devTest)).toBeNull();
  });

  it("fails closed on an unknown project", () => {
    expect(refusalFor(UNKNOWN, dev)).toMatch(/not One's main project/);
    expect(refusalFor(UNKNOWN, devTest)).toMatch(/not One's main project/);
  });

  it("keeps a live deployment on One's main project only", () => {
    expect(refusalFor(UNKNOWN, live)).toMatch(/may only reach One's main project/);
    expect(refusalFor("http://127.0.0.1:54321", live)).toMatch(/may only reach One's main project/);
  });

  it("accepts the CI placeholder only on CI", () => {
    const placeholder = "https://ci-build-only.supabase.co";
    expect(refusalFor(placeholder, { ...dev, ci: true })).toBeNull();
    expect(refusalFor(placeholder, dev)).toMatch(/not One's main project/);
  });
});

describe("assertPermittedTarget", () => {
  it("throws a ProtectedTargetError before anything is made", () => {
    expect(() => assertPermittedTarget(FEES, live)).toThrow(ProtectedTargetError);
    expect(assertPermittedTarget(ONE, dev)).toBe(ONE);
  });

  it("refuses the fees database in the real (test) process", () => {
    expect(() => assertPermittedTarget(FEES)).toThrow(/fees app's live database/);
  });
});

describe("the scripts' twin agrees", () => {
  it("names the same projects", () => {
    expect(scriptGuard.ONE_MAIN_PROJECT_REF).toBe(ONE_MAIN_PROJECT_REF);
    expect(scriptGuard.FEES_SOURCE_PROJECT_REF).toBe(FEES_SOURCE_PROJECT_REF);
    expect(scriptGuard.TEST_SESSION_LABEL).toBe("TEST-2026-27");
  });

  it("accepts only an exact main-project host", () => {
    expect(scriptGuard.isOneMainProjectUrl(ONE)).toBe(true);
    expect(scriptGuard.isOneMainProjectUrl(FEES)).toBe(false);
    expect(scriptGuard.isOneMainProjectUrl(UNKNOWN)).toBe(false);
    expect(scriptGuard.isOneMainProjectUrl(`https://elsewhere.example/?${ONE_MAIN_PROJECT_REF}`)).toBe(false);
    expect(scriptGuard.projectRefOf(FEES)).toBe(FEES_SOURCE_PROJECT_REF);
  });

  it("names the fees database when it refuses it", () => {
    expect(scriptGuard.targetRefusal(FEES)).toMatch(/fees app's live database/);
    expect(scriptGuard.targetRefusal(UNKNOWN)).toMatch(/not One's main project/);
    expect(scriptGuard.targetRefusal(ONE)).toBeNull();
  });
});
