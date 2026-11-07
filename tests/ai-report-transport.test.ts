import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { bridgeRequest, bridgeWorkbookRequest } from "@/platform/fees-bridge/transport";

/*
 * The AI report's two Fees reads (7 Nov 2026): the whole-year workbook as
 * bytes, and the photographs as JSON pages. Read-only, pinned to Fees'
 * origin, never a TEST session, never a redirect.
 */

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
const base = { sessionLabel: "2026-27", token: "synthetic-token", key: "synthetic-key" };
const workbook = (body: BodyInit | null = zip, headers: Record<string, string> = {}, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": XLSX_TYPE, "X-One-Session": "2026-27", "X-One-As-Of": "2026-11-07T05:00:00.000Z", ...headers } });

describe("the AI report's Fees workbook", () => {
  it("is a pinned, uncached, unredirected GET with the server's credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(workbook());
    const result = await bridgeWorkbookRequest({ ...base, fetcher });
    expect([...result.bytes]).toEqual([...zip]);
    expect(result).toMatchObject({ sessionLabel: "2026-27", asOf: "2026-11-07T05:00:00.000Z" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://fees.vpps.co.in/api/one/v1/screens/reports/ai-context?session=2026-27");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error", headers: { Authorization: "Bearer synthetic-token", "X-One-Bridge-Key": "synthetic-key", Accept: XLSX_TYPE } });
  });

  it("never asks for a TEST or malformed session, another host, or without credentials", async () => {
    const fetcher = vi.fn();
    for (const change of [{ sessionLabel: "TEST-2026-27" }, { sessionLabel: "2026" }, { origin: "https://untrusted.invalid" }, { token: "" }, { key: "" }]) {
      await expect(bridgeWorkbookRequest({ ...base, ...change, fetcher })).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("passes on Fees' own refusal, by its code", async () => {
    const refused = (status: number, body: unknown) => vi.fn().mockResolvedValue(Response.json(body, { status }));
    await expect(bridgeWorkbookRequest({ ...base, fetcher: refused(403, { error: { code: "forbidden", message: "x" } }) })).rejects.toMatchObject({ code: "forbidden" });
    await expect(bridgeWorkbookRequest({ ...base, fetcher: refused(413, null) })).rejects.toMatchObject({ code: "too_large" });
    await expect(bridgeWorkbookRequest({ ...base, fetcher: vi.fn().mockRejectedValue(new TypeError("fetch failed")) })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses anything that is not this session's workbook, and anything too big for one response", async () => {
    const big = new Uint8Array(4_500_001);
    big.set(zip);
    for (const response of [
      workbook(zip, { "Content-Type": "text/html" }),
      workbook(new Uint8Array([1, 2, 3, 4, 5])),
      workbook(zip, { "X-One-Session": "2025-26" }),
      workbook(zip, { "Content-Length": "4500001" }),
      workbook(big),
    ]) {
      await expect(bridgeWorkbookRequest({ ...base, fetcher: vi.fn().mockResolvedValue(response) })).rejects.toThrow();
    }
  });
});

describe("the AI report's photograph pages", () => {
  const json = { token: "synthetic-token", key: "synthetic-key", schema: z.object({ ok: z.boolean() }) };
  const ok = () => vi.fn().mockResolvedValue(Response.json({ version: 1, data: { ok: true } }));

  it("may be read a page at a time, with the last page's cursor", async () => {
    for (const path of ["/screens/reports/ai-photos?session=2026-27", "/screens/reports/ai-photos?session=2026-27&after=00000000-0000-4000-8000-000000000001"]) {
      const fetcher = ok();
      expect(await bridgeRequest({ ...json, path, fetcher })).toEqual({ ok: true });
      expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
    }
  });

  it("is the only AI read the JSON transport makes: the workbook has its own byte transport", async () => {
    for (const path of ["/screens/reports/ai-context?session=2026-27", "/screens/reports/ai-photos/../payments", "/screens/reports/ai-photosx"]) {
      await expect(bridgeRequest({ ...json, path, fetcher: ok() }), path).rejects.toMatchObject({ code: "invalid_route" });
    }
  });
});
