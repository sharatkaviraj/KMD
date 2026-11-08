import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTeacherPhotos, photoCopyNote, runTeacherPhotoCopy } from "@/platform/fees-bridge/teacher-photo-copy";

/*
 * The teachers' photo copy has to finish (owner, 8 Nov 2026): the first one
 * stopped after a single batch at 279 of 484 children and nothing carried on.
 */

type Batch = { ok: boolean; pending?: number; copied?: number; failed?: number; next?: string | null } | "drop";

function serve(batches: Batch[]) {
  const asked: (string | null)[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    asked.push((JSON.parse(String(init.body)) as { after: string | null }).after);
    const next = batches.shift();
    if (!next || next === "drop") throw new TypeError("network");
    return { json: async () => next } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { asked, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("teachers' photo copy", () => {
  it("asks batch after batch until Fees' pages are read", async () => {
    const { asked } = serve([
      { ok: true, pending: 205, copied: 120, failed: 0, next: "a" },
      { ok: true, pending: 85, copied: 85, failed: 0, next: null },
    ]);
    const bars: unknown[] = [];
    const result = await runTeacherPhotoCopy((bar) => bars.push(bar));
    expect(asked).toEqual([null, "a"]);
    expect(result).toEqual({ first: 205, copied: 205, failed: 0, left: false, stopped: false });
    expect(bars).toEqual([{ done: 120, of: 205 }, { done: 205, of: 205 }, null]);
  });

  it("asks a failed batch once more from the same place before giving up", async () => {
    vi.useFakeTimers();
    const { asked } = serve([
      { ok: true, pending: 205, copied: 100, failed: 0, next: "a" },
      "drop",
      { ok: true, pending: 105, copied: 105, failed: 0, next: null },
    ]);
    const running = runTeacherPhotoCopy();
    await vi.runAllTimersAsync();
    expect(await running).toEqual({ first: 205, copied: 205, failed: 0, left: false, stopped: false });
    expect(asked).toEqual([null, "a", "a"]);
  });

  it("says what is left when it is stopped part-way", async () => {
    vi.useFakeTimers();
    serve([{ ok: true, pending: 205, copied: 100, failed: 0, next: "a" }, "drop", "drop"]);
    const running = runTeacherPhotoCopy();
    await vi.runAllTimersAsync();
    const result = await running;
    expect(result).toMatchObject({ copied: 100, left: true, stopped: true });
    expect(photoCopyNote(result, "en")).toBe("Photos copied for teachers: 100. The rest are copied the next time an admin opens One.");
  });

  it("runs one copy at a time: a tap while the quiet one runs joins it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => { release = done; });
    const fetchMock = vi.fn(async () => {
      await gate;
      return { json: async () => ({ ok: true, pending: 3, copied: 3, failed: 0, next: null }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const quiet = runTeacherPhotoCopy();
    const bars: unknown[] = [];
    const tapped = copyTeacherPhotos("en", (bar) => bars.push(bar));
    release();
    const [result, note] = await Promise.all([quiet, tapped]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.copied).toBe(3);
    expect(note).toBe("Photos copied for teachers: 3.");
    expect(bars).toEqual([{ done: 3, of: 3, text: "Copying photos for teachers… 3 of 3" }, null]);
  });

  it("tells the admin when every photo is already there", async () => {
    serve([{ ok: true, pending: 0, copied: 0, failed: 0, next: null }]);
    expect(await copyTeacherPhotos("en", () => {})).toBe("Teachers' photos are up to date.");
  });
});
