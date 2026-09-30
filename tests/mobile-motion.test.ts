import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
describe("mobile motion budget", () => {
  it.each(["workspace-enter", "sheet-enter", "panel-enter"])("keeps %s transform/opacity only and optional", (name) => {
    const keyframes = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1];
    expect(keyframes).toBeDefined();
    expect(keyframes).not.toMatch(/\b(width|height|top|left|margin|padding|box-shadow|filter)\s*:/);
    if (name !== "workspace-enter") expect(keyframes).toContain("transform:");
    else expect(keyframes).not.toContain("transform:");
    expect(keyframes).toContain("opacity:");
  });
  it("silences every new motion class under reduced motion", () => {
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    for (const name of ["anim-workspace-enter", "anim-sheet-enter", "anim-panel-enter"]) expect(reduced).toContain(name);
    expect(reduced).toContain("animation: none !important");
  });
});
