import { describe, expect, it } from "vitest";

import { deniedPeople, expiredLoginHref, maskPhone, passwordRules, passwordStrength, requestAccessHref } from "@/vx/screens/system/logic";

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

describe("password ticks", () => {
  it("only the server's 6-character rule decides; the others are advice", () => {
    expect(passwordRules("abcdef", null)).toEqual({ long: true, number: false, notPhone: true });
    expect(passwordRules("abc1", null).long).toBe(false);
    expect(passwordRules("pass90000x", "+91 90000 00512").notPhone).toBe(false);
    expect(passwordRules("", null).notPhone).toBe(false);
  });
});

describe("access denied", () => {
  const staff = [
    { id: "a", displayName: "Test Admin", role: "admin", phone: "9000000512", whatsappPhone: null, isActive: true },
    { id: "b", displayName: "Ms. Test Accountant", role: "accountant", phone: null, whatsappPhone: null, isActive: true },
    { id: "c", displayName: "Old Admin", role: "admin", phone: "9000000999", whatsappPhone: null, isActive: false },
    { id: "d", displayName: "Test Teacher", role: "teacher", phone: "9000000123", whatsappPhone: null, isActive: true },
  ];

  it("names active people in the roles that open the page, never the reader", () => {
    const people = deniedPeople(staff, ["admin", "accountant"], "d");
    expect(people.map((p) => p.name)).toEqual(["Test Admin", "Ms. Test Accountant"]);
    expect(people[0]).toMatchObject({ initials: "TA", phoneShown: "90000 ••512", callHref: "tel:+919000000512" });
    expect(people[1]).toMatchObject({ phoneShown: null, callHref: null });
  });

  it("opens the reader's own WhatsApp to an admin, Hindi first, and only with a visible number", () => {
    const href = requestAccessHref(staff, "Test Teacher", "fees:setup", "d");
    expect(href).toMatch(/^https:\/\/wa\.me\/919000000512\?text=/);
    expect(decodeURIComponent(href!.split("text=")[1]).startsWith("नमस्ते")).toBe(true);
    expect(requestAccessHref(staff.filter((s) => s.role !== "admin"), "x", null)).toBeNull();
  });

  it("masks a number to its first five and last three", () => {
    expect(maskPhone("09000000512")).toBe("90000 ••512");
    expect(maskPhone("12345")).toBeNull();
  });
});
