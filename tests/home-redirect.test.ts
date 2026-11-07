import { describe, expect, it } from "vitest";

import { homeHintFor, personHome, rootRedirectFor } from "@/vx/home-redirect";

/** `/` and the proxy's home hint read one rule; these pin what it says. */
describe("where / sends a viewer", () => {
  it("keeps an admin on Today", () => {
    expect(rootRedirectFor({ menu: "admin", previewing: null, staff: { role: "admin", preferredStart: null } })).toBeNull();
  });

  it("sends a teacher to their home", () => {
    expect(rootRedirectFor({ menu: "teacher", previewing: null, staff: { role: "teacher", preferredStart: null } })).toBe("/teach");
  });

  it("ignores a start screen the role cannot open", () => {
    expect(rootRedirectFor({ menu: "teacher", previewing: null, staff: { role: "teacher", preferredStart: "/settings" } })).toBe("/teach");
  });

  it("never writes a hint while an admin previews another role", () => {
    const viewer = { menu: "teacher" as const, previewing: "teacher" as const, staff: { role: "admin" as const, preferredStart: null } };
    expect(rootRedirectFor(viewer)).toBe("/teach");
    expect(homeHintFor(viewer)).toBeNull();
  });
});

/** "See One as a person" opens where the person's own One opens, without going through `/` (D-544). */
describe("where seeing One as a person opens", () => {
  it("opens a teacher's own home", () => {
    expect(personHome({ role: "teacher", preferredStart: null })).toBe("/teach");
  });

  it("opens the accountant's, the coordinators' and the exam office's own homes", () => {
    expect(personHome({ role: "accountant", preferredStart: null })).toBe("/accounts");
    expect(personHome({ role: "academic_coordinator", preferredStart: null })).toBe("/academics");
    expect(personHome({ role: "exam_coordinator", preferredStart: null })).toBe("/exam-office");
  });

  it("keeps the person's own start screen when their role can open it", () => {
    expect(personHome({ role: "teacher", preferredStart: "/timetable" })).toBe("/timetable");
    expect(personHome({ role: "teacher", preferredStart: "/settings" })).toBe("/teach");
  });

  it("stays on Today for a person who shares the admin's menu", () => {
    expect(personHome({ role: "view_only", preferredStart: null })).toBe("/");
  });
});
