import { describe, expect, it } from "vitest";

import { checkoutAudienceAllows } from "@/modules/payments/domain/online/pay-scope";

describe("who sees the one-tap page while it is a pilot", () => {
  it("offers it to test sessions only", () => {
    expect(checkoutAudienceAllows("TEST-2026-27", false)).toBe(true);
    expect(checkoutAudienceAllows("UAT-2026-27", false)).toBe(true);
    expect(checkoutAudienceAllows("DEMO-2026-27", false)).toBe(true);
    expect(checkoutAudienceAllows("2026-27", false)).toBe(false);
  });

  it("offers it to every family once the school says so", () => {
    expect(checkoutAudienceAllows("2026-27", true)).toBe(true);
  });

  it("never offers it on a send whose session it cannot read", () => {
    expect(checkoutAudienceAllows(null, false)).toBe(false);
    expect(checkoutAudienceAllows("", false)).toBe(false);
    expect(checkoutAudienceAllows("not-a-session", false)).toBe(false);
  });
});
