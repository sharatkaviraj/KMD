import { describe, expect, it, vi } from "vitest";

import { askYears, feesReceiptExit, firstAnswering, MOST_SESSIONS, receiptSessionOrder, sourceReceiptHref } from "@/vx/screens/receipts/source-receipt";

/* Reviews F01/F02: a Fees receipt read in One. Synthetic numbers, ids and years only. */
const id = "00000000-0000-4000-8000-000000000001";

describe("sourceReceiptHref", () => {
  it("pins the receipt by id and year, and keeps the number readable", () => {
    expect(sourceReceiptHref("SVP 2026/1", id, "2026-27")).toBe(`/receipts/SVP%202026%2F1?receiptId=${id}&session=2026-27`);
  });
});

describe("receiptSessionOrder", () => {
  const anyone = () => true;
  it("asks the named year, the chosen year, the active year, then the rest — each once", () => {
    expect(receiptSessionOrder({ first: ["2025-26", "2026-27"], active: "2026-27", available: ["2024-25", "2025-26", "2026-27"], may: anyone }))
      .toEqual(["2025-26", "2026-27", "2024-25"]);
  });
  it("never asks a TEST year, a malformed one, or one the person may not open", () => {
    const may = (label: string) => label !== "2024-25";
    expect(receiptSessionOrder({ first: ["TEST-2026-27", null, "", "2026"], active: undefined, available: ["TEST-2026-27", "2024-25", "2025-26"], may }))
      .toEqual(["2025-26"]);
  });
  it("keeps Fees' order for the rest rather than sorting the labels (CLAUDE.md 3a)", () => {
    expect(receiptSessionOrder({ first: [], active: null, available: ["2024-25", "2026-27", "2025-26"], may: anyone })).toEqual(["2024-25", "2026-27", "2025-26"]);
  });
  it(`asks at most ${MOST_SESSIONS} years`, () => {
    const available = ["2026-27", "2025-26", "2024-25", "2023-24", "2022-23", "2021-22"];
    expect(receiptSessionOrder({ first: [], active: "2026-27", available, may: anyone })).toHaveLength(MOST_SESSIONS);
  });
});

describe("firstAnswering", () => {
  it("stops at the first year that answers", async () => {
    const attempt = vi.fn(async (label: string) => (label === "2025-26" ? "found" : null));
    expect(await firstAnswering(["2026-27", "2025-26", "2024-25"], attempt)).toEqual({ sessionLabel: "2025-26", value: "found" });
    expect(attempt).toHaveBeenCalledTimes(2);
  });
  it("answers null when no year has it, and lets a stopping failure through", async () => {
    expect(await firstAnswering(["2026-27"], async () => null)).toBeNull();
    await expect(firstAnswering(["2026-27", "2025-26"], async () => { throw new Error("stop"); })).rejects.toThrow("stop");
  });
});

describe("askYears", () => {
  it("asks only the named year when it answers, without naming the others", async () => {
    const others = vi.fn(async () => ["2026-27", "2025-26"]);
    expect(await askYears("2026-27", others, async () => "found")).toEqual({ sessionLabel: "2026-27", value: "found" });
    expect(others).not.toHaveBeenCalled();
  });
  it("then the others, never the named year twice", async () => {
    const attempt = vi.fn(async (label: string) => (label === "2025-26" ? "found" : null));
    expect(await askYears("2026-27", async () => ["2026-27", "2025-26"], attempt)).toEqual({ sessionLabel: "2025-26", value: "found" });
    expect(attempt.mock.calls.map((call) => call[0])).toEqual(["2026-27", "2025-26"]);
  });
  it("starts with the others when the link names no year", async () => {
    const attempt = vi.fn(async () => null);
    expect(await askYears(null, async () => ["2026-27"], attempt)).toBeNull();
    expect(attempt).toHaveBeenCalledOnce();
  });
});

describe("feesReceiptExit — only what Fees' own receipt page offers this person", () => {
  const exit = (input: Partial<Parameters<typeof feesReceiptExit>[0]>) =>
    feesReceiptExit({ canPrint: false, canReverseHere: false, mayReverse: false, isVoided: false, ...input })?.en ?? null;
  it("offers nothing to a role Fees would offer nothing", () => {
    expect(exit({})).toBeNull();
  });
  it("sends with receipts:print, and reverses there only while One cannot", () => {
    expect(exit({ canPrint: true })).toBe("Send in Fees");
    expect(exit({ mayReverse: true })).toBe("Reverse in Fees");
    expect(exit({ canPrint: true, mayReverse: true })).toBe("Reverse or send in Fees");
    // Reversal is here: Fees is only for sending.
    expect(exit({ canPrint: true, mayReverse: true, canReverseHere: true })).toBe("Send in Fees");
    expect(exit({ mayReverse: true, canReverseHere: true })).toBeNull();
  });
  it("on a reversed receipt, offers Fees' 'tell the family' to whoever may reverse", () => {
    expect(exit({ isVoided: true, mayReverse: true, canPrint: true })).toBe("Tell the family in Fees");
    expect(exit({ isVoided: true, canPrint: true })).toBe("Send in Fees");
    expect(exit({ isVoided: true })).toBeNull();
  });
  it("words every choice in both languages", () => {
    for (const input of [{ canPrint: true }, { mayReverse: true }, { canPrint: true, mayReverse: true }, { isVoided: true, mayReverse: true }]) {
      expect(feesReceiptExit({ canPrint: false, canReverseHere: false, mayReverse: false, isVoided: false, ...input })?.hi).toMatch(/[ऀ-ॿ]/);
    }
  });
});
