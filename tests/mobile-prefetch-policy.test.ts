import { describe, expect, it } from "vitest";
import { mayPrefetchRoutes } from "@/ui/hooks/prefetch-policy";

describe("mobile background prefetch policy", () => {
  it.each([
    { online: false, visible: true },
    { online: true, visible: false },
    { online: true, visible: true, connection: { saveData: true } },
    { online: true, visible: true, connection: { effectiveType: "2g" } },
    { online: true, visible: true, connection: { effectiveType: "slow-2g" } },
  ])("does not spend bandwidth for %j", (state) => {
    expect(mayPrefetchRoutes(state)).toBe(false);
  });
  it.each([undefined, { effectiveType: "4g" }, { effectiveType: "3g" }])(
    "warms visible online routes when connection allows it (%j)", (connection) => {
      expect(mayPrefetchRoutes({ online: true, visible: true, connection })).toBe(true);
    },
  );
});
