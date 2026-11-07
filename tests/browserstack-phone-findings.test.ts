import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * What a real Galaxy M32 showed on 7 Nov 2026 (BrowserStack, QA accounts on
 * one.vpps.co.in) that a desktop Chromium at phone width did not.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("phone findings from BrowserStack, 7 Nov 2026", () => {
  it("hides the tab bar under a keyboard even though the bar sets display inline", () => {
    // bottom-bar.tsx lays the tabs out with an inline `display: grid`, and an
    // inline style beats any stylesheet rule that is not !important. Without it
    // the bar rode up on top of the keyboard and covered the screen's middle.
    expect(read("src/vx/shell/bottom-bar.tsx")).toMatch(/className="vxt glass vx-bottom"[^>]*display: "grid"/);
    expect(read("src/vx/vx.css")).toContain(":root[data-kb] .vx-bottom{display:none!important}");
  });

  it("does not open the keyboard on the accountant's home when there is no mouse", () => {
    const source = read("src/vx/screens/accounts/accounts-home.tsx");
    expect(source).not.toMatch(/<input[^>]*type="search"[^>]*autoFocus/);
    expect(source).toContain('window.matchMedia("(pointer: fine)").matches');
  });

  it("leaves session switching on Fees home to the shell's own pill", () => {
    expect(read("src/modules/dashboard/ui/mobile-dashboard-screen.tsx")).not.toContain("MobileSessionPill");
  });

  it("says one installment as one number on Fee setup", () => {
    const source = read("src/vx/screens/fee-setup/fee-setup.tsx");
    expect(source).toContain("span(next, per.length)");
    expect(source).toContain("span(unpaidFrom, n)");
    expect(source).not.toMatch(/\$\{next\}–\$\{per\.length\}/);
  });
});
