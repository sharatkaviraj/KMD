import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const scene = vi.hoisted(() => ({ ended: [] as Record<string, unknown>[], live: [] as Record<string, unknown>[] }));

vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let liveRead = false;
      const chain: Record<string, unknown> = {};
      for (const name of ["eq", "in", "gte", "order"]) chain[name] = () => chain;
      chain.select = (columns: string) => { liveRead = columns === "day, need_key, covering_staff_id, status"; return chain; };
      chain.returns = () => Promise.resolve({ data: liveRead ? scene.live : scene.ended, error: null });
      return chain;
    },
  }),
}));

import { myEndedDuties } from "@/modules/substitutions/data/duty-repo";

const me = "00000000-0000-4000-8000-000000000011";
const row = (over: Record<string, unknown>) => ({
  id: "d1", session_label: "TEST-2026-27", day: "2026-11-09", need_key: "n1", period: 7, event_kind: "ordinary",
  class_ids: ["c2"], class_labels: ["Class 2"], subject_code: "SPORTS", absent_staff_ids: ["x"], status: "cancelled",
  covering_staff_id: me, suggested_staff_id: null, reason: null, source: "auto", pinned: false, match_tier: null,
  warnings: [], revision: 1, supersedes: null, day_revision: 1, created_at: "2026-11-06T11:57:49Z",
  ended_at: "2026-11-06T12:51:55Z", acknowledged_at: null, cannot_cover_at: null, cannot_cover_note: null, ...over,
});

describe("covers the office took back (teacher 11, 6 Nov)", () => {
  beforeEach(() => { scene.ended = []; scene.live = []; });

  it("says a cancelled cover is off, a moved one went to another teacher, and a reopened one was taken back", async () => {
    scene.ended = [row({}), row({ id: "d2", need_key: "n2", period: 3 }), row({ id: "d3", need_key: "n3", period: 5 })];
    scene.live = [
      { day: "2026-11-09", need_key: "n2", covering_staff_id: "someone-else", status: "assigned" },
      { day: "2026-11-09", need_key: "n3", covering_staff_id: null, status: "needs_help" },
    ];
    const out = await myEndedDuties(me, "TEST-2026-27", ["2026-11-09"], "2026-11-05T19:00:00Z");
    expect(out.map(({ duty, why }) => [duty.id, why])).toEqual([["d2", "other"], ["d3", "open"], ["d1", "off"]]);
  });

  it("leaves out a need that is still hers on a newer revision, one she said she can't take, and repeats", async () => {
    scene.ended = [
      row({ id: "d1", status: "superseded" }), row({ id: "d0", status: "superseded", revision: 0 }),
      row({ id: "d4", need_key: "n4", cannot_cover_at: "2026-11-06T12:00:00Z" }),
    ];
    scene.live = [{ day: "2026-11-09", need_key: "n1", covering_staff_id: me, status: "assigned" }];
    expect(await myEndedDuties(me, "TEST-2026-27", ["2026-11-09"], "2026-11-05T19:00:00Z")).toEqual([]);
  });
});
