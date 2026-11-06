import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Admissions, New admission, Student tools and Fee reports threw "That
 * academic session is not available to this account" for every test account
 * on live (6 Nov 2026): each read the policy's or app_settings' live year and
 * asked the fees bridge for it, and a test account is fenced to TEST-2026-27.
 * They must read the viewer's own session instead.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("screens a test account opens read the viewer's session, not the live year", () => {
  it("the admissions fee context asks for the resolved view session", () => {
    const src = read("src/modules/students-fees/vx/admissions.ts");
    const body = src.slice(src.indexOf("export async function loadAdmissionsFeeContext"), src.indexOf("export async function loadAdmissionsRosterContext"));
    expect(body).toContain("resolveViewSession(");
    expect(body).toContain("getStudentFormOptions({ sessionLabel: view.sessionLabel })");
  });

  it("student tools never take the active session label", () => {
    const src = read("src/app/(app)/student-tools/page.tsx");
    expect(src).not.toContain("getActiveSessionLabel");
    expect(src).toContain("resolveViewSession(");
  });

  it("promotion starts from the viewer's default session", () => {
    const src = read("src/modules/promotion/vx/promote.ts");
    expect(src).toContain("defaultSessionFor(viewer, await getActiveSessionLabel())");
  });

  it("reports default to the viewer's session and drop a forbidden one from the link", () => {
    const queries = read("src/modules/reports/data/queries.ts");
    expect(queries).not.toContain("filters.sessionLabel || policy.academicSessionLabel");
    expect(queries).toContain("resolveViewSession({ cookieSession: await getViewSessionCookie() })");
    const page = read("src/app/(app)/fees/reports/page.tsx");
    expect(page).toContain('view.source !== "url"');
  });
});
