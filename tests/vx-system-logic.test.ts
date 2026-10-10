import { describe, expect, it } from "vitest";

import { expiredLoginHref, passwordStrength } from "@/vx/screens/system/logic";

describe("session expired", () => {
  it("sends you to sign in and back to the same page", () => {
    expect(expiredLoginHref("/dues", "?class=7")).toBe(`/login?reason=expired&next=${encodeURIComponent("/dues?class=7")}`);
    expect(expiredLoginHref("/teach")).toBe("/login?reason=expired&next=%2Fteach");
  });

  it("never loops back to login or leaves the site", () => {
    expect(expiredLoginHref("/login", "?next=/x")).toBe("/login?reason=expired&next=%2F");
    expect(expiredLoginHref("//evil.example")).toBe("/login?reason=expired&next=%2F");
  });
});

describe("password strength", () => {
  it("follows the server's 6-character floor and grades above it", () => {
    expect(passwordStrength("abc").ok).toBe(false);
    expect(passwordStrength("abcdef")).toMatchObject({ ok: true, label: "weak" });
    expect(passwordStrength("abcdefgh1").label).toBe("fair");
    expect(passwordStrength("Abcdefgh12!x").label).toBe("strong");
    expect(passwordStrength("111111").label).toBe("weak");
  });
});
