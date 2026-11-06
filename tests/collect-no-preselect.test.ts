import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// UX review, 6 Nov 2026: the counter opened with the first "likely today"
// child already highlighted, so "Open child" or Enter opened somebody nobody
// tapped. Nothing is chosen until a tap, an arrow key or a typed search.
describe("collect: nobody is chosen until someone is picked", () => {
  const collect = readFileSync("src/vx/screens/collect/collect.tsx", "utf8");
  const who = readFileSync("src/vx/screens/collect/cards/who.tsx", "utf8");

  it("starts and resets with no highlight", () => {
    expect(collect).toContain("const [hl, setHl] = useState(-1);");
    expect(collect).toContain("setHl(v.trim() ? 0 : -1)");
    expect(collect).toMatch(/hl < 0 \? undefined/);
  });

  it("keeps Open child disabled until a row is highlighted", () => {
    expect(who).toMatch(/props\.highlight >= 0/);
    expect(who).toMatch(/disabled=\{hl < 0/);
  });
});
