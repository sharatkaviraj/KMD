import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DeniedScreen, deniedWords } from "@/vx/screens/system/denied";
import { permissionArea, requestAccessHref } from "@/vx/screens/system/logic";

/*
 * Smoke 20 Oct (dev.groups[16]): an Admin whose account had Settings turned
 * off read "Only Admin can open this page", and every reader saw the raw
 * permission code (settings:manage, fees:view).
 */

const ADMIN = { en: "Admin", hi: "प्रशासक" };
const ACCOUNTANT = { en: "Accountant", hi: "लेखाकार" };
const TEACHER = { en: "Teacher", hi: "शिक्षक" };

describe("access denied words", () => {
  it("does not name the reader's own role as the one allowed", () => {
    const w = deniedWords({ me: { role: ADMIN }, roles: [ADMIN], permission: "settings:manage", hasPeople: true });
    expect(w.title.en).toBe("This account is not allowed to open this page");
    expect(w.title.en).not.toMatch(/Only Admin/);
    expect(w.body.en).toMatch(/turned off for this account/);
    expect(w.area?.en).toBe("It is the page for school settings.");
  });

  it("names the roles that open it for somebody outside them, in Hindi word order", () => {
    const w = deniedWords({ me: { role: TEACHER }, roles: [ADMIN, ACCOUNTANT], permission: "fees:view", hasPeople: true });
    expect(w.title).toEqual({ en: "This page is for Admin and Accountant", hi: "यह पेज प्रशासक और लेखाकार के लिए है" });
    expect(w.area?.hi).toBe("यह फ़ीस का पेज है।");
  });

  it("knows every permission area the app has, and nothing for an unknown code", () => {
    for (const code of ["dashboard:view", "staff:manage", "timetable:view", "attendance:mark", "fees:collect", "settings:manage", "messages:send"]) {
      expect(permissionArea(code), code).not.toBeNull();
    }
    expect(permissionArea("nothing:here")).toBeNull();
    expect(permissionArea(null)).toBeNull();
  });

  it("never prints the permission code, in any language", () => {
    for (const language of ["en", "hi", "both"] as const) {
      const html = renderToStaticMarkup(
        <DeniedScreen language={language} me={{ name: "Test Admin", role: ADMIN }} roles={[ADMIN]} people={[]} permission="settings:manage" home="/" requestHref={null} />,
      );
      expect(html).not.toContain("settings:manage");
      expect(html).not.toContain("Only Admin");
    }
  });

  it("types the area in words, not the code, into the WhatsApp request", () => {
    const staff = [{ id: "a", displayName: "Test Admin", role: "admin", phone: "9000000512", whatsappPhone: null, isActive: true }];
    const text = decodeURIComponent(requestAccessHref(staff, "Test Teacher", "fees:view", "d")!.split("text=")[1]);
    expect(text).not.toContain("fees:view");
    expect(text).toContain("फ़ीस");
  });
});
