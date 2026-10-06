import { describe, expect, it } from "vitest";

import { CHUNK_CONCURRENCY, fetchInChunks, mapConcurrently } from "@/platform/helpers/chunk";

const ids = (count: number) => Array.from({ length: count }, (_, n) => `id-${n}`);
const later = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("fetchInChunks", () => {
  it("joins the rows in chunk order however the chunks finish", async () => {
    // The first chunk answers last; the rows must still come back in order.
    const result = await fetchInChunks(ids(7), 2, (chunk) =>
      later({ data: chunk, error: null }, chunk[0] === "id-0" ? 20 : 1),
    );
    expect(result).toEqual({ data: ids(7), error: null });
  });

  it("returns the rows before the first failing chunk, and its error", async () => {
    const result = await fetchInChunks(ids(8), 2, (chunk) =>
      later(
        chunk[0] === "id-2"
          ? { data: null, error: "second" }
          : chunk[0] === "id-6"
            ? { data: null, error: "fourth" }
            : { data: chunk, error: null },
        chunk[0] === "id-6" ? 1 : 10,
      ),
    );
    // The fourth chunk failed first in time; the second failed first in order.
    expect(result).toEqual({ data: ["id-0", "id-1"], error: "second" });
  });

  it("reads several chunks at once, never more than the bound", async () => {
    let inFlight = 0;
    let most = 0;
    const result = await fetchInChunks(ids(30), 2, async (chunk) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await later(null, 5);
      inFlight--;
      return { data: chunk, error: null };
    });
    expect(result.data).toHaveLength(30);
    expect(most).toBe(CHUNK_CONCURRENCY);
  });

  it("makes no request for no ids", async () => {
    let calls = 0;
    const result = await fetchInChunks([], 200, async () => {
      calls++;
      return { data: [], error: null };
    });
    expect(result).toEqual({ data: [], error: null });
    expect(calls).toBe(0);
  });
});

describe("mapConcurrently", () => {
  it("does not start more reads after a request rejects", async () => {
    const started: number[] = [];
    const settled: number[] = [];
    await expect(mapConcurrently([1, 2, 3, 4, 5], 2, async (n) => {
      started.push(n);
      if (n === 2) throw new Error("unavailable");
      await later(null, 10);
      settled.push(n);
      return n;
    })).rejects.toThrow("unavailable");
    await later(null, 20);
    expect(started).toEqual([1, 2]);
    expect(settled).toEqual([1]);
  });

  it("rejects with the first rejection", async () => {
    await expect(
      mapConcurrently([1, 2, 3], 2, (n) => (n === 2 ? Promise.reject(new Error("two")) : later(n, 5))),
    ).rejects.toThrow("two");
  });

  it("refuses a concurrency that would read nothing", async () => {
    await expect(mapConcurrently([1], 0, async (n) => n)).rejects.toThrow(/positive integer/);
  });
});
