import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { correctionNoteText } from "@/modules/finance-controls/domain/display";

// Accountant run, 6 Nov 2026.
describe("Dues aging: every overdue installment has a column", () => {
  const data = readFileSync("src/modules/defaulters/vx/domain/board.ts", "utf8");
  const screen = readFileSync("src/vx/screens/dues/screen.tsx", "utf8");
  const words = readFileSync("src/vx/screens/dues/words.ts", "utf8");

  it("files Inst 3, Inst 4 and plan rows instead of dropping them into the total only", () => {
    expect(data).toContain("else if (row.installmentNo === 3) c.inst3 += pending;");
    expect(data).toContain("else if (row.installmentNo === 4) c.inst4 += pending;");
    expect(data).toContain("else c.other += pending;");
  });

  it("no longer says Inst 3 and 4 are not due", () => {
    expect(words).not.toContain("Inst 3 and 4 are not due yet");
    expect(screen).toMatch(/heatKeys\.map\(\(k, j\) => heatCell\(r\[k\], i, j\)\)/);
  });
});

describe("correction notes", () => {
  it("reads an admin reversal tag in words", () => {
    expect(correctionNoteText("admin_reversal:6f1c2b9e-1234-4abc-9def-0123456789ab")).toBe("Receipt reversed by an admin");
  });

  it("keeps every other note as written", () => {
    expect(correctionNoteText("Wrong amount typed")).toBe("Wrong amount typed");
    expect(correctionNoteText("admin_reversal: see receipt 12")).toBe("admin_reversal: see receipt 12");
    expect(correctionNoteText(null)).toBeNull();
  });
});
