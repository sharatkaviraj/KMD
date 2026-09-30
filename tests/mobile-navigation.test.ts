import { describe, expect, it } from "vitest";
import { mobileMoreGroupsFor, permittedFeeNavigationHrefsFor } from "../src/platform/config/mobile-navigation";
import { allowedFor, navigationFor } from "../src/platform/config/navigation";
import { can, staffRoles } from "../src/platform/auth/permissions";
import { feeRoleFor } from "../src/platform/auth/fee-roles";
import { getMobileMoreGroups, getVisibleProtectedNavigation } from "../src/modules/fees/config/navigation";

const languages = ["hi", "en", "both"] as const;

function hrefsFor(role: (typeof staffRoles)[number]) {
  return mobileMoreGroupsFor(role, "en").flatMap((group) => group.items.map((item) => item.href));
}

describe("unified phone More navigation", () => {
  it.each(staffRoles)("preserves every native non-fee destination for %s", (role) => {
    const primary = navigationFor(role).filter((item) => item.href !== "/more").slice(0, 4).map((item) => item.href);
    const more = hrefsFor(role);
    for (const item of allowedFor(role).filter((item) => !item.href.startsWith("/fees/"))) {
      expect([...primary, ...more], `${role}: missing ${item.href}`).toContain(item.href);
    }
    expect(new Set([...primary, ...more]).size).toBe(primary.length + more.length);
  });

  it.each(staffRoles)("never offers %s a fee destination outside both role maps", (role) => {
    const feeHrefs = hrefsFor(role).filter((href) => href.startsWith("/fees/"));
    if (!can({ role }, "fees:view")) {
      expect(feeHrefs).toEqual([]);
      return;
    }
    const permitted = new Set([
      ...getVisibleProtectedNavigation(feeRoleFor(role)).map((item) => item.href),
      ...getMobileMoreGroups(feeRoleFor(role)).flatMap((group) => group.items.map((item) => item.href)),
    ]);
    for (const href of feeHrefs) expect(permitted.has(href), `${role}: ${href}`).toBe(true);
  });

  it("keeps the fifth native teacher destination instead of dropping it", () => {
    expect(hrefsFor("teacher")).toContain("/dashboard");
  });

  it("filters the office fee exports link out of desktop and tablet chrome too", () => {
    expect(permittedFeeNavigationHrefsFor("office").has("/fees/exports")).toBe(false);
    expect(permittedFeeNavigationHrefsFor("accountant").has("/fees/exports")).toBe(true);
    expect(permittedFeeNavigationHrefsFor("teacher").size).toBe(0);
  });

  it("restores office academic and staff links without granting financial controls", () => {
    expect(hrefsFor("office")).toEqual(expect.arrayContaining(["/timetable", "/academics", "/staff"]));
    expect(hrefsFor("office")).not.toContain("/fees/settings");
    expect(hrefsFor("office")).not.toContain("/fees/finance-controls");
  });

  it("retains the authorized fee long tail and native platform destinations for admins", () => {
    expect(hrefsFor("admin")).toEqual(expect.arrayContaining(["/jobs", "/fees/receipts", "/fees/imports", "/fees/finance-controls"]));
  });

  it.each(languages)("passes serializable nonempty groups for %s readers", (language) => {
    for (const role of staffRoles) {
      const groups = mobileMoreGroupsFor(role, language);
      expect(JSON.parse(JSON.stringify(groups))).toEqual(groups);
      for (const group of groups) {
        expect(group.items.length).toBeGreaterThan(0);
        expect(group.label.length).toBeGreaterThan(0);
        for (const item of group.items) expect(item).not.toHaveProperty("icon");
      }
    }
  });

  it("resolves native Hindi labels independently of fee catalogue keys", () => {
    const en = mobileMoreGroupsFor("teacher", "en").flatMap((group) => group.items);
    const hi = mobileMoreGroupsFor("teacher", "hi").flatMap((group) => group.items);
    expect(hi[0].label).not.toBe(en[0].label);
  });
});
