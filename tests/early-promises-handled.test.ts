import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A promise started early and awaited after another await must be marked
 * handled, or a rejection that lands first ends the Vercel function instance
 * and every request on it. On 6 Nov 2026 a statement timeout in My class's
 * class insight (`/teach/class`) took an `/exam-office` request down with it
 * ("unrecoverable error: Unhandled Rejection").
 */
describe("My class starts its slow reads early, safely", () => {
  const source = readFileSync("src/vx/screens/teach/data.ts", "utf8");
  const loadClass = source.slice(source.indexOf("export async function loadClass"), source.indexOf("export async function", source.indexOf("export async function loadClass") + 10));

  it("marks the insight, headers and slots promises handled before the first round", () => {
    const mark = loadClass.indexOf("for (const early of [insightP, headersP, slotsP]) early.catch(() => {});");
    expect(mark).toBeGreaterThan(0);
    expect(mark).toBeLessThan(loadClass.indexOf("const [labels, held, registers"));
  });
});
