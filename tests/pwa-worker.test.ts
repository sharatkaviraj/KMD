import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function worker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const stored = new Map<string, Map<string, Response>>();
  const key = (value: string | { url: string }) => typeof value === "string" ? new URL(value, "https://school.test").href : value.url;
  const cache = (name: string) => {
    const entries = stored.get(name) ?? new Map<string, Response>(); stored.set(name, entries);
    return {
      addAll: async (urls: string[]) => urls.forEach(url => entries.set(key(url), new Response("offline"))),
      match: async (request: string | { url: string }) => entries.get(key(request)),
      put: async (request: { url: string }, response: Response) => entries.set(key(request), response),
      keys: async () => [...entries.keys()].map(url => ({ url })),
      delete: async (request: { url: string }) => entries.delete(key(request)),
    };
  };
  const network = vi.fn(async () => {
    const response = new Response("network"); Object.defineProperty(response, "type", { value: "basic" }); return response;
  });
  const skip = vi.fn(); const claim = vi.fn();
  vm.runInNewContext(readFileSync("public/service-worker.js", "utf8"), {
    URL, Response, fetch: network,
    self: { location: { origin: "https://school.test" }, addEventListener: (name: string, handler: typeof listeners[string]) => { listeners[name] = handler; }, skipWaiting: skip, clients: { claim }, registration: { navigationPreload: { enable: vi.fn() } } },
    caches: { open: async (name: string) => cache(name), keys: async () => [...stored.keys()], delete: async (name: string) => stored.delete(name), match: async (url: string) => { for (const entries of stored.values()) if (entries.has(key(url))) return entries.get(key(url)); } },
  });
  async function dispatch(name: string, extra: object = {}) {
    const pending: Promise<unknown>[] = []; let response: Promise<Response> | undefined;
    listeners[name]({ ...extra, waitUntil: (promise: Promise<unknown>) => pending.push(promise), respondWith: (promise: Promise<Response>) => { response = promise; } });
    const result = response ? await response : undefined;
    await Promise.all(pending);
    return result;
  }
  const fetch = (path: string, method = "GET", mode = "cors") => dispatch("fetch", { request: { url: key(path), method, mode }, preloadResponse: Promise.resolve(undefined) });
  return { stored, network, skip, claim, dispatch, fetch };
}

it("waits for deliberate update activation and only removes owned caches", async () => {
  const w = worker();
  w.stored.set("unrelated", new Map()); w.stored.set("vppsone-public-v3", new Map());
  await w.dispatch("install"); expect(w.skip).not.toHaveBeenCalled();
  await w.dispatch("message", { data: { type: "ACTIVATE_UPDATE" } }); expect(w.skip).toHaveBeenCalledOnce();
  await w.dispatch("activate"); expect(w.claim).toHaveBeenCalledOnce(); expect(w.stored.has("unrelated")).toBe(true); expect(w.stored.has("vppsone-public-v3")).toBe(false);
});
it("never intercepts private JSON or mutations, and never stores protected navigation", async () => {
  const w = worker(); await w.dispatch("install");
  for (const path of ["/api/fees/students?session=x", "/api/performance", "/r/bearer?_rsc=1"]) expect(await w.fetch(path)).toBeUndefined();
  expect(await w.fetch("/teach/attendance", "POST", "navigate")).toBeUndefined();
  expect(await (await w.fetch("/teach/attendance", "GET", "navigate"))?.text()).toBe("network");
  expect([...w.stored.values()].some(entries => [...entries.keys()].some(url => url.includes("/teach")))).toBe(false);
  w.network.mockRejectedValue(new Error("offline"));
  expect(await (await w.fetch("/teach/attendance", "GET", "navigate"))?.text()).toBe("offline");
});
it("bounds static caches and preserves the reconnect shell", async () => {
  const w = worker(); await w.dispatch("install");
  for (let i = 0; i < 180; i++) await w.fetch(`/_next/static/${i}.js`);
  const entries = w.stored.get("vppsone-public-v4")!;
  expect(entries.size).toBeLessThanOrEqual(160);
  expect(entries.has("https://school.test/offline.html")).toBe(true);
});
