import { writeFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_CHECKLIST, type Toilet } from "@/modules/toilets/domain/checks";
import { renderToiletChartsPdf, weekTitle } from "@/modules/toilets/ui/chart-pdf";

import { fontsNotEmbedded } from "./support/pdf-fonts";

/*
 * The printed toilet chart (D-652): one A4 page per toilet, every font
 * carried in the file (D-640), and the week named on it.
 */

const toilet = (n: number): Toilet => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, name: `Test toilet ${n}`, place: "Near the library", usedBy: n === 1 ? "boys" : "girls",
  position: n, createdAt: "2026-10-01T04:00:00Z", removedAt: null, updatedAt: "2026-10-01T04:00:00Z",
});

describe("the printed chart", () => {
  it("names the week", () => {
    expect(weekTitle("2026-11-16")).toBe("16 – 21 Nov 2026");
    expect(weekTitle("2026-11-30")).toBe("30 Nov – 5 Dec 2026");
  });

  it("is one page per toilet and embeds its fonts", async () => {
    const pdf = await renderToiletChartsPdf({
      pages: [toilet(1), toilet(2)].map((t) => ({ toilet: t, uploadUrl: `https://one.example.invalid/toilets?upload=${t.id}&week=2026-11-16` })),
      weekStart: "2026-11-16",
      settings: { morningAt: "09:00", afternoonAt: "13:00", checklist: [...DEFAULT_CHECKLIST], defaults: true },
      // Thursday shut, to see the shaded row.
      isOpen: (day) => day !== "2026-11-19",
      test: true,
    });
    if (process.env.TOILET_PDF_OUT) writeFileSync(process.env.TOILET_PDF_OUT, pdf);
    const text = pdf.toString("latin1");
    expect((text.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(2);
    expect(fontsNotEmbedded(pdf)).toEqual([]);
  }, 60_000);
});
