import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* D-475: Add staff asks which language the app opens in (owner, 7 Nov 2026). */

const action = readFileSync("src/app/(app)/staff/vx-actions.ts", "utf8");
const screen = readFileSync("src/vx/screens/staff/staff-screen.tsx", "utf8");

describe("Add staff language choice", () => {
  it("saves the language the admin picked, not a fixed one", () => {
    const add = action.slice(action.indexOf("export async function addStaffAction"), action.indexOf("export async function createLoginAction"));
    expect(add).toContain('preferredLanguage: input.preferredLanguage ?? "hi"');
    expect(add).not.toContain('preferredLanguage: "both"');
  });

  it("the sheet offers Hindi, English and both, Hindi first, and sends the choice", () => {
    const sheet = screen.slice(screen.indexOf("function AddStaffSheet"));
    expect(screen).toMatch(/value: "hi", label: "हिंदी"[\s\S]*value: "en", label: "English"[\s\S]*value: "both"/);
    expect(sheet).toContain('useState<StaffLanguage>("hi")');
    expect(sheet).toContain("preferredLanguage: language");
    expect(sheet).toContain("App language");
  });
});
