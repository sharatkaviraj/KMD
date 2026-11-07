import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Today's "Mark attendance" button on a 360 px phone (polish thread,
 * 7 Nov 2026, D-539).
 *
 * To draw the eye, the button faded to 55% every 2.4 s. On a phone that reads
 * as a button switched off, and the fade also overrode the dimming a tapped
 * link shows while its page loads (D-514). A ring now grows off the button and
 * fades, four times, and the button itself stays solid.
 */

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const css = read("src/vx/screens/teach/ui/tch.css");

describe("Mark attendance asks to be tapped without looking switched off (D-539)", () => {
  it("never fades the button itself", () => {
    const big = css.match(/\.vx \.tc-big,\.vxt \.tc-big\{[^}]*\}/)?.[0] ?? "";
    expect(big).toContain("background:var(--prifg)");
    expect(big).not.toMatch(/animation|opacity/);
  });

  it("calls with a ring that grows off it, four times, then rests", () => {
    expect(css).toContain(":where(.vx,.vxt) .tc-call{position:relative}");
    expect(css).toContain(":where(.vx,.vxt) .tc-call::after{");
    expect(css).toContain("border:2px solid var(--call,var(--prifg));pointer-events:none;opacity:0;animation:tcCall 2.4s ease-out 1s 4}");
    expect(css).toContain("@keyframes tcCall{0%{transform:scale(1);opacity:.7}70%,100%{transform:scale(1.05,1.22);opacity:0}}");
  });

  it("keeps the ring still for a reader who asked for less motion", () => {
    // vx.css's reduced-motion rule reaches elements, not their ::after.
    expect(css).toContain("@media (prefers-reduced-motion:reduce){:where(.vx,.vxt) .tc-call::after{animation:none}}");
  });

  it("is on Today's button and on the help pictures that show it", () => {
    expect(read("src/vx/screens/teach/ui/home.tsx")).toContain('className="tap btn tc-big tc-call"');
    const help = read("src/vx/screens/teach/ui/shared.tsx");
    expect(help.match(/className="tc-ib tc-call"/g)).toHaveLength(2);
    // On a card the ring takes the button's own colour.
    expect(help).toContain('"--call": "var(--pri)" } as CSSProperties}');
    expect(help).not.toContain("xPulse");
  });
});
