import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import colors from "tailwindcss/colors";

const css = readFileSync("src/app/globals.css", "utf8");
const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("  .dark {"));
const darkStart = css.indexOf("  .dark {");
const darkBlock = css.slice(darkStart, css.indexOf("\n  body {", darkStart));
const override = css.slice(css.indexOf("/* VPPS readable metadata:"), css.indexOf("@layer utilities {", css.indexOf("/* VPPS readable metadata:")));

type Hsl = [number, number, number];
function token(block: string, name: string): Hsl {
  const match = block.match(new RegExp(`--${name}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%`));
  if (!match) throw new Error(`Missing ${name}`);
  return [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
}
function luminance([h, s, l]: Hsl) {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}
function contrast(a: Hsl, b: Hsl) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function hexLuminance(hex: string) {
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

describe("small metadata text contrast", () => {
  for (const file of ["session-pill.tsx", "shell-session-pill.tsx"]) for (const theme of ["light", "dark"] as const) {
    it(`${file}: TEST session label meets 4.5:1 in ${theme}`, () => {
      const source = readFileSync(`src/ui/shell/${file}`, "utf8");
      const shades = source.match(/text-fuchsia-(\d+) dark:text-fuchsia-(\d+)/);
      expect(shades).not.toBeNull();
      const shade = shades![theme === "light" ? 1 : 2] as keyof typeof colors.fuchsia;
      const fg = hexLuminance(colors.fuchsia[shade]);
      for (const surface of ["surface", "surface-2"]) {
        const bg = luminance(token(theme === "light" ? lightBlock : darkBlock, surface));
        expect((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  for (const theme of ["light", "dark"] as const) {
    const block = theme === "light" ? lightBlock : darkBlock;
    const overrideBlock = theme === "light" ? override : override.slice(override.indexOf("  .dark {"));
    const subtle = token(overrideBlock, "subtle-foreground");
    it.each(["background", "card", "surface", "surface-2", "surface-3"])(
      `${theme}: subtle text meets 4.5:1 against %s`, (surface) => {
        expect(contrast(subtle, token(block, surface))).toBeGreaterThanOrEqual(4.5);
      },
    );
    it(`${theme}: small navigation counts meet 4.5:1`, () => {
      expect(contrast(token(block, "destructive-soft-foreground"), token(block, "destructive-soft"))).toBeGreaterThanOrEqual(4.5);
    });
    it(`${theme}: opaque task-hero labels meet 4.5:1`, () => {
      expect(contrast(token(block, "accent-soft-foreground"), token(block, "accent-soft"))).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("uses the readable soft pair for the actual count badge", () => {
    const source = readFileSync("src/ui/shell/mobile-bottom-nav.tsx", "utf8");
    const badge = source.match(/<span className="[^"\n]*-right-2[^"\n]*"/u)?.[0];
    expect(badge).toContain("bg-destructive-soft");
    expect(badge).toContain("text-destructive-soft-foreground");
    expect(badge).not.toMatch(/bg-destructive\s/u);
  });
  it("keeps the print text override after the copied print reset", () => {
    expect(css.indexOf("/* VPPS readable metadata:")).toBeGreaterThan(css.indexOf("VPPS One additions."));
    expect(override).toContain("@media print");
    expect(override).toContain("--subtle-foreground: 222 6% 42%");
  });
});
