import { describe, expect, it } from "vitest";

import { canLogFamilyContact, parseContact } from "@/vx/screens/family-contact/domain";

describe("family contact (D-265)", () => {
  const today = "2026-10-11";

  it("records the three outcomes and needs a date only for an agreed follow-up", () => {
    expect(parseContact({ outcome: "attempted", agreedOn: "2026-10-20" }, today)).toEqual({ ok: true, value: { outcome: "attempted", note: null, agreedOn: null } });
    expect(parseContact({ outcome: "spoke", note: "  Will send the form  " }, today)).toEqual({ ok: true, value: { outcome: "spoke", note: "Will send the form", agreedOn: null } });
    expect(parseContact({ outcome: "follow_up_agreed", agreedOn: "2026-10-15" }, today)).toEqual({ ok: true, value: { outcome: "follow_up_agreed", note: null, agreedOn: "2026-10-15" } });
    expect(parseContact({ outcome: "follow_up_agreed" }, today).ok).toBe(false);
    expect(parseContact({ outcome: "follow_up_agreed", agreedOn: "2026-10-01" }, today).ok).toBe(false);
  });

  it("has no outcome that means a message was sent", () => {
    expect(parseContact({ outcome: "sent" }, today).ok).toBe(false);
    expect(parseContact({ outcome: "drafted" }, today).ok).toBe(false);
  });

  it("is recorded by school-wide readers and the class's own class teacher only", () => {
    const held = new Set(["class-a"]);
    expect(canLogFamilyContact({ readsEveryClass: true, heldClassIds: new Set() }, "class-b")).toBe(true);
    expect(canLogFamilyContact({ readsEveryClass: false, heldClassIds: held }, "class-a")).toBe(true);
    expect(canLogFamilyContact({ readsEveryClass: false, heldClassIds: held }, "class-b")).toBe(false);
    expect(canLogFamilyContact({ readsEveryClass: false, heldClassIds: held }, null)).toBe(false);
  });
});
