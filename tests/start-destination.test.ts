import { describe, expect, it } from "vitest";
import { staffRoles, type StaffRole } from "@/platform/auth/permissions";
import { allowedFor, homeFor } from "@/platform/config/navigation";
import { landingFor, resolveStart, startHref, startOptionsFor } from "@/platform/config/start";

describe("native start destinations", () => {
  it.each(staffRoles)("%s only chooses permitted internal screens", role => {
    const allowed = new Set(allowedFor(role).map(item => item.href));
    const options = startOptionsFor(role);
    expect(new Set(options.map(option => option.value)).size).toBe(options.length);
    for (const option of options) {
      expect(option.kind).toBe("route");
      expect(option.href.startsWith("/")).toBe(true);
      expect(option.href.startsWith("//")).toBe(false);
      expect(allowed.has(option.value)).toBe(true);
    }
    expect(options.map(option => option.href)).not.toContain("/apps");
  });
  it.each(["admin", "office", "accountant", "fee_collector"] as StaffRole[])("normalizes %s's old fee start to the native fee workspace", role => {
    expect(resolveStart(role, " app:schoolfees ")?.value).toBe("/fees");
    expect(startHref(role, "app:schoolfees")).toBe("/fees");
  });
  it.each(["admin", "office"] as StaffRole[])("normalizes %s's old SamPark start", role => {
    expect(resolveStart(role, "app:sampark")?.href).toBe("/collection");
  });
  it("ignores legacy choices when the account has lost permission", () => {
    expect(resolveStart("teacher", "app:schoolfees")).toBeNull();
    expect(startHref("teacher", "app:schoolfees")).toBe("/teach");
    expect(resolveStart("view_only", "app:sampark")).toBeNull();
    expect(resolveStart("accountant", "app:sampark")).toBeNull();
  });
  it.each(staffRoles)("keeps %s's role home when no valid preference exists", role => {
    for (const value of [null, "", " ", "/apps", "app:nothing", "app:vppsone", "https://evil.example", "//evil.example", "/students/../jobs"]) {
      expect(resolveStart(role, value)).toBeNull();
      expect(startHref(role, value)).toBe(homeFor(role));
    }
  });
});

describe("sign-in destinations", () => {
  const accounts = { role: "office" as const, preferredStart: "app:schoolfees" };
  it("preserves a valid deep link and its query", () => {
    const requested = "/students?q=Test";
    expect(landingFor({ ...accounts, requested })).toBe(requested);
  });
  it("uses the native preference when no link is provided", () => {
    expect(landingFor({ ...accounts, requested: null })).toBe("/fees");
  });
  it.each(["//evil.example", "/\\\\evil.example", "https://evil.example", "javascript:alert(1)", "dashboard", "/dashboard\nLocation: https://evil.example"])("refuses unsafe redirect %s", requested => {
    expect(landingFor({ ...accounts, requested })).toBe("/fees");
    expect(landingFor({ role: "teacher", preferredStart: null, requested })).toBe("/teach");
  });
  it.each(staffRoles)("sends %s's bookmarked Apps link to their role home", role => {
    expect(landingFor({ role, preferredStart: "app:schoolfees", requested: "/apps?from=bookmark" })).toBe(homeFor(role));
  });
});
