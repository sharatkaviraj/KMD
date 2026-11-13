import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/platform/whatsapp/store", () => ({ readSwitches: vi.fn(), whatsappDb: vi.fn() }));

import { finishTurn, stagesForLedger } from "@/modules/whatsapp/data/helper-store";

/**
 * Where an answer's time went (D-605): the ledger keeps whole, non-negative
 * milliseconds for the parts a turn reached, and nothing a parent wrote.
 */

type Update = Record<string, unknown>;

function fakeDb(): { db: Parameters<typeof finishTurn>[2]; updates: Update[] } {
  const updates: Update[] = [];
  const db = {
    from: () => ({
      update: (row: Update) => {
        updates.push(row);
        return { eq: async () => ({ error: null }) };
      },
    }),
  } as unknown as Parameters<typeof finishTurn>[2];
  return { db, updates };
}

describe("the time each part of an answer took (D-605)", () => {
  it("keeps whole, non-negative milliseconds, and nothing else", () => {
    expect(stagesForLedger({ before: 2_999.6, claim: 412.2, dots: -3, ai: Number.NaN, send: 180 })).toEqual({ before: 3_000, claim: 412, dots: 0, send: 180 });
    expect(stagesForLedger({})).toBeNull();
    expect(stagesForLedger(null)).toBeNull();
    expect(stagesForLedger(undefined)).toBeNull();
  });

  it("writes them beside the answer's total, and leaves the column alone when there are none", async () => {
    const timed = fakeDb();
    await finishTurn("wamid.TEST1", { status: "answered", latencyMs: 4_200, stages: { before: 1_000, claim: 300, compose: 2_500, send: 400 } }, timed.db);
    expect(timed.updates[0]).toMatchObject({ status: "answered", latency_ms: 4_200, stages_ms: { before: 1_000, claim: 300, compose: 2_500, send: 400 } });

    const untimed = fakeDb();
    await finishTurn("wamid.TEST2", { status: "not_claimed", reason: "staff_handling" }, untimed.db);
    expect(untimed.updates[0]).not.toHaveProperty("stages_ms");
  });

  it("is a column of its own, added before the code that writes it", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261113084707_parent_helper_turn_stages.sql"), "utf8");
    expect(sql).toMatch(/alter table vppsone\.parent_helper_turns\s+add column if not exists stages_ms jsonb/);
    expect(sql).not.toMatch(/\b(drop|delete|truncate)\b/i);
  });
});
