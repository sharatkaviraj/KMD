import { describe, expect, it } from "vitest";
import { parseContact } from "@/vx/screens/family-contact/domain";
describe("contact follow-up calendar guard", () => {
  it("refuses impossible future days before an append attempt", () => {
    expect(parseContact({ outcome: "follow_up_agreed", agreedOn: "2026-11-31" }, "2026-10-11").ok).toBe(false);
    expect(parseContact({ outcome: "follow_up_agreed", agreedOn: "2027-02-29" }, "2026-10-11").ok).toBe(false);
  });
  it("permits an actual future leap day and today", () => {
    expect(parseContact({ outcome: "follow_up_agreed", agreedOn: "2028-02-29" }, "2026-10-11").ok).toBe(true);
    expect(parseContact({ outcome: "follow_up_agreed", agreedOn: "2026-10-11" }, "2026-10-11").ok).toBe(true);
  });
});
