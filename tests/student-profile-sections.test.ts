import { describe, expect, it } from "vitest";
import { STUDENT_TABS, tabsFor } from "@/vx/screens/admin/logic";
import { profileSection, profileSections } from "@/vx/screens/admin/profile-sections";

describe("student profile sections", () => {
  it("groups all nine legacy deep links into four primary sections", () => {
    expect(STUDENT_TABS.map(profileSection)).toEqual(["overview", "fees", "learning", "learning", "more", "more", "more", "more", "more"]);
    expect(profileSections(STUDENT_TABS)).toEqual([
      { section: "overview", tab: "overview" }, { section: "learning", tab: "attendance" },
      { section: "fees", tab: "fees" }, { section: "more", tab: "info" },
    ]);
  });
  it("does not offer financial sections when the permission is absent", () => {
    const tabs = tabsFor({ fees: false, notes: true, documents: false, history: false, marks: true });
    expect(profileSections(tabs).map(s => s.section)).toEqual(["overview", "learning", "more"]);
    expect(tabs).not.toContain("family");
  });
  it("uses an allowed destination for restricted models", () => {
    expect(profileSections(["overview", "marks", "notes"])).toEqual([
      { section: "overview", tab: "overview" }, { section: "learning", tab: "marks" }, { section: "more", tab: "notes" },
    ]);
  });
});
