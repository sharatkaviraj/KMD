import { describe, expect, it } from "vitest";

import { homeHintFor, rootRedirectFor } from "@/vx/home-redirect";

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
