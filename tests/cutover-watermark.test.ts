import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  payCodeRefused,
  watermarkFrom,
  writtenBeforeWatermark,
  type CutoverWatermark,
} from "@/platform/migration/cutover-watermark";

/**
 * The line between the fees app's rows and One's (go-live Phase D, critique0
 * #11 and #12): its failed sends are not retried from One, its pending ones
 * not reconciled, its pay codes not paid through One.
 */
const AT: CutoverWatermark = { state: "at", at: "2026-12-13T00:30:00Z", source: "cutover" };

describe("the cutover watermark", () => {
  it("is the cutover row when there is one, else the table's last load, else none", () => {
    expect(
      watermarkFrom({
        cutover: { snapshot_at: "2026-12-13T00:30:00Z", started_at: "2026-12-13T00:00:00Z" },
        load: { snapshot_at: "2026-12-10T00:00:00Z" },
      }),
    ).toEqual({ state: "at", at: "2026-12-13T00:30:00Z", source: "cutover" });
    expect(watermarkFrom({ cutover: { snapshot_at: null, started_at: "2026-12-13T00:00:00Z" }, load: null })).toEqual({
      state: "at",
      at: "2026-12-13T00:00:00Z",
      source: "cutover",
    });
    expect(watermarkFrom({ cutover: null, load: { snapshot_at: "2026-12-10T00:00:00Z" } })).toMatchObject({
      source: "load",
    });
    expect(watermarkFrom({ cutover: null, load: null })).toEqual({ state: "none" });
  });

  it("refuses rows written before the line, and lets One's own through", () => {
    expect(writtenBeforeWatermark({ created_at: "2026-12-12T09:00:00Z", session_label: "2026-27" }, AT)).toBe(true);
    expect(writtenBeforeWatermark({ created_at: "2026-12-13T09:00:00Z", session_label: "2026-27" }, AT)).toBe(false);
  });

  it("restricts nothing before any real data was loaded", () => {
    expect(writtenBeforeWatermark({ created_at: "2020-01-01T00:00:00Z" }, { state: "none" })).toBe(false);
  });

  it("fails closed: an unreadable line, or a row with no time, refuses", () => {
    expect(writtenBeforeWatermark({ created_at: "2026-12-13T09:00:00Z" }, { state: "unreadable" })).toBe(true);
    expect(writtenBeforeWatermark({ created_at: null }, AT)).toBe(true);
  });

  it("never refuses a TEST-session row: the test session is One's own", () => {
    expect(writtenBeforeWatermark({ created_at: "2026-12-01T00:00:00Z", session_label: "TEST-2026-27" }, AT)).toBe(false);
  });

  it("refuses a pay code the fees app minted (for /pay/[code], Phase E)", () => {
    expect(payCodeRefused({ created_at: "2026-12-12T23:59:59Z", session_label: "2026-27" }, AT)).toBe(true);
    expect(payCodeRefused({ created_at: "2026-12-13T01:00:00Z", session_label: "2026-27" }, AT)).toBe(false);
  });

  it("is what the run retry and the reconcile action read", () => {
    const actions = readFileSync(join(process.cwd(), "src/app/(app)/fees/reminders/runs/[runId]/actions.ts"), "utf8");
    expect(actions.match(/readCutoverWatermark\("public\.whatsapp_reminder_sends"\)/g)).toHaveLength(2);
    expect(actions.match(/writtenBeforeWatermark\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
