import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const flow = readFileSync("src/modules/payments/ui/mobile-payment-flow-sheet.tsx", "utf8");
const desk = readFileSync("src/modules/payments/ui/payment-desk-mobile.tsx", "utf8");

describe("payment flow modal integration contract", () => {
  it("suspends ownership for every existing confirmation, receipt and posting overlay", () => {
    expect(desk).toContain("suspended={isConfirmOpen || isSuccessOpen || isDuplicateOpen || showPostingSheet}");
    expect(flow).toContain('layout="custom"');
    expect(flow).toContain("suspended={suspended}");
    expect(flow).toContain("historyDismiss={false}");
  });

  it("uses the phone breakpoint and retains keyboard-safe picker geometry and pinned Collect footer", () => {
    expect(flow).toContain('useMediaQuery("(max-width: 767px)")');
    expect(flow).toContain("if (!mounted || !isMobileView) return null;");
    expect(flow.match(/top: "max\(56px, calc\(100svh - var\(--keyboard-offset, 0px\) - 88svh\)\)"/g)).toHaveLength(2);
    expect(flow).toContain('height: "calc(100svh - 3.5rem - var(--keyboard-offset, 0px))"');
    expect(flow).toContain("paddingBottom: \"calc(var(--mobile-safe-area-bottom, 0px) + 0.75rem)\"");
    expect(flow).toContain("loading={isPosting}");
  });
});
