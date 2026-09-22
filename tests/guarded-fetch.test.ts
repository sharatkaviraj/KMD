import { describe, expect, it, vi } from "vitest";

import { createGuardedFetch } from "@/platform/supabase/guarded-fetch";

/**
 * The net under a hundred and fifty `.in(...)` call sites.
 *
 * A filter list is serialized into the request URL. Past about 300 uuids the
 * URL is too long, and the failure is an eight-second stall followed by a bare
 * `TypeError: fetch failed` — which the common `const { data } = await …` shape
 * discards, leaving an empty array and a plausible, wrong screen.
 *
 * This cannot make a discarded error loud. It can make the same failure
 * instant and named, which is what these assertions are about.
 */
const rest = (table: string, ids: number) =>
  `https://example.supabase.co/rest/v1/${table}?student_id=in.(${Array.from(
    { length: ids },
    () => "00000000-0000-4000-8000-000000000000",
  ).join("%2C")})`;

describe("createGuardedFetch", () => {
  it("passes an ordinary request straight through", async () => {
    const underlying = vi.fn(async () => new Response("ok"));
    const guarded = createGuardedFetch(underlying as unknown as typeof fetch);

    const response = await guarded("https://example.supabase.co/rest/v1/students?id=eq.1");

    expect(await response.text()).toBe("ok");
    expect(underlying).toHaveBeenCalledOnce();
  });

  it("passes a filter that is long but still sendable", async () => {
    const underlying = vi.fn(async () => new Response("ok"));
    const guarded = createGuardedFetch(underlying as unknown as typeof fetch);

    // 250 ids measured fine against the real server; the guard must not be
    // stricter than the thing it is protecting, or it becomes the outage.
    await guarded(rest("defaulter_contacts", 250));

    expect(underlying).toHaveBeenCalledOnce();
  });

  it("refuses a filter too long to send, without calling fetch", async () => {
    const underlying = vi.fn(async () => new Response("ok"));
    const guarded = createGuardedFetch(underlying as unknown as typeof fetch);

    await expect(guarded(rest("students", 583))).rejects.toThrow(/Refusing a \d+-character request/);

    // The point of the guard: the eight seconds are never spent.
    expect(underlying).not.toHaveBeenCalled();
  });

  it("names the table and points at the fix", async () => {
    const guarded = createGuardedFetch((async () => new Response("ok")) as unknown as typeof fetch);

    // A message that says only "fetch failed" is what cost sixteen seconds and
    // four missing columns to diagnose. This one has to be actionable on its
    // own, from a log line, without the reader knowing any of that history.
    await expect(guarded(rest("student_repayment_plan_items", 583))).rejects.toThrow(
      /student_repayment_plan_items/,
    );
    await expect(guarded(rest("students", 583))).rejects.toThrow(/fetchInChunks/);
  });

  it("reads the url out of a Request object too", async () => {
    const underlying = vi.fn(async () => new Response("ok"));
    const guarded = createGuardedFetch(underlying as unknown as typeof fetch);

    // supabase-js passes a string today, but it is not obliged to.
    await expect(guarded(new Request(rest("students", 583)))).rejects.toThrow(/Refusing/);
    expect(underlying).not.toHaveBeenCalled();
  });
});
