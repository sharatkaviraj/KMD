import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FEE_SCHEMA,
  getVppsOneEnvironment,
  sanitizeRedirectPath,
  VPPSONE_SCHEMA,
} from "@/platform/env";

describe("sanitizeRedirectPath()", () => {
  it("keeps an in-app absolute path", () => {
    expect(sanitizeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/teach/attendance?class=5A")).toBe(
      "/teach/attendance?class=5A",
    );
  });

  it.each([
    ["a protocol-relative URL", "//evil.example/steal"],
    // `/\host` is protocol-relative too: URL parsing for http(s) reads a
    // backslash as a slash, so this is `//evil.example` with one character
    // changed. It survived the original check.
    ["a backslash protocol-relative URL", "/\\evil.example/steal"],
    ["a backslash anywhere", "/dashboard\\..\\evil"],
    ["a newline that could split a header", "/dashboard\nLocation: https://evil.example"],
    ["an absolute URL", "https://evil.example"],
    ["a scheme-only value", "javascript:alert(1)"],
    ["a relative path", "dashboard"],
    ["the empty string", ""],
    ["whitespace", "   "],
    ["null", null],
    ["undefined", undefined],
  ])("falls back for %s", (_label, value) => {
    // `?next=` is attacker-controlled: it is whatever was in the URL that
    // bounced off the proxy. `//evil.example` is the one that gets through a
    // naive startsWith("/") check and lands the staff member on another site.
    expect(sanitizeRedirectPath(value)).toBe("/dashboard");
  });

  it("uses the fallback it is given", () => {
    expect(sanitizeRedirectPath("//evil.example", "/login")).toBe("/login");
  });
});

describe("getVppsOneEnvironment()", () => {
  const original = process.env.VPPSONE_ENV;

  beforeEach(() => {
    delete process.env.VPPSONE_ENV;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.VPPSONE_ENV;
    } else {
      process.env.VPPSONE_ENV = original;
    }
  });

  it("reads dev and live", () => {
    process.env.VPPSONE_ENV = "dev";
    expect(getVppsOneEnvironment()).toBe("dev");

    process.env.VPPSONE_ENV = "live";
    expect(getVppsOneEnvironment()).toBe("live");
  });

  it("ignores case and surrounding space", () => {
    process.env.VPPSONE_ENV = "  LIVE ";
    expect(getVppsOneEnvironment()).toBe("live");
  });

  it("treats unset as dev, so a forgotten variable shows the loud badge", () => {
    expect(getVppsOneEnvironment()).toBe("dev");
  });

  it("throws on a value it does not understand", () => {
    process.env.VPPSONE_ENV = "staging";
    expect(() => getVppsOneEnvironment()).toThrow(/Invalid VPPSONE_ENV/);
  });
});

describe("the schema constants", () => {
  it("keeps the two schemas apart", () => {
    // Every client defaults to VPPSONE_SCHEMA, so `.from("x")` can never
    // address a fee table by accident (D-4, rule 2).
    expect(VPPSONE_SCHEMA).toBe("vppsone");
    expect(FEE_SCHEMA).toBe("public");
    expect(VPPSONE_SCHEMA).not.toBe(FEE_SCHEMA);
  });
});
