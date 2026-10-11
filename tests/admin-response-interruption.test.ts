import { EventEmitter } from "node:events";
import type { Page, Request, Route } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { interruptOneAdminResponse } from "./e2e/support/admin-response-interruption";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function scene() {
  const events = new EventEmitter();
  const response = deferred<{ status(): number; dispose(): Promise<void> }>();
  let handler!: (route: Route) => Promise<void>;
  let handled = false;
  let aborts = 0;
  let continues = 0;
  let removals = 0;
  let fetchOptions: unknown;
  const request = {
    method: () => "POST", headers: () => ({ "next-action": "synthetic-action" }),
    url: () => "http://localhost:3100/collection/review", failure: () => ({ errorText: "net::ERR_FAILED" }),
  } as unknown as Request;
  const route = {
    request: () => request,
    fetch: (options: unknown) => { fetchOptions = options; return response.promise; },
    abort: async () => {
      if (handled) throw new Error("Route is already handled!");
      handled = true; ++aborts; events.emit("requestfailed", request);
    },
    continue: async () => { handled = true; ++continues; },
  } as unknown as Route;
  const page = {
    on: events.on.bind(events), off: events.off.bind(events),
    route: async (_pattern: string, callback: typeof handler) => { handler = callback; },
    // Model the installed Playwright server removeHandler behavior: removing
    // an active route automatically continues it before a delayed abort.
    unroute: async () => { ++removals; if (!handled) await route.continue(); },
  } as unknown as Page;
  return {
    page, request, route, response, events,
    deliver: () => handler(route),
    state: () => ({ aborts, continues, removals, fetchOptions }),
  };
}

describe("admin post-commit response-loss harness", () => {
  it("reproduces early unroute making the delayed abort a second terminal action", async () => {
    const s = scene();
    await s.page.route("**/collection/review", async route => { await route.fetch(); await route.abort("failed"); });
    const activation = s.deliver();
    await s.page.unroute("**/collection/review");
    s.response.resolve({ status: () => 200, dispose: async () => {} });
    await expect(activation).rejects.toThrow("Route is already handled");
    expect(s.state()).toMatchObject({ aborts: 0, continues: 1 });
  });

  it("keeps ownership until commit response, abort and matching browser failure, then detaches once", async () => {
    const s = scene();
    const injection = await interruptOneAdminResponse(s.page);
    const activation = s.deliver();
    const finish = injection.finish();
    await Promise.resolve();
    expect(s.state()).toMatchObject({ aborts: 0, continues: 0, removals: 0, fetchOptions: { maxRetries: 0, maxRedirects: 0, timeout: 45_000 } });
    s.response.resolve({ status: () => 303, dispose: async () => {} });
    await activation;
    await expect(finish).resolves.toEqual({ forwarded: 1, aborted: 1, serverStatus: 303, browserFailure: "net::ERR_FAILED" });
    expect(s.state()).toMatchObject({ aborts: 1, continues: 0, removals: 1 });
    expect(s.events.listenerCount("requestfailed")).toBe(0);
  });

  it("propagates failed forwarding and does not detach or claim a committed interruption", async () => {
    const s = scene();
    const injection = await interruptOneAdminResponse(s.page);
    const activation = s.deliver();
    s.response.reject(new Error("forwarding failed"));
    await activation;
    await expect(injection.finish()).rejects.toThrow("forwarding failed");
    expect(s.state()).toMatchObject({ aborts: 0, continues: 0, removals: 0 });
  });

  it("rejects server failure rather than treating any HTTP response as post-commit proof", async () => {
    const s = scene();
    const injection = await interruptOneAdminResponse(s.page);
    const activation = s.deliver();
    s.response.resolve({ status: () => 500, dispose: async () => {} });
    await activation;
    await expect(injection.finish()).rejects.toThrow("post-commit response loss not established");
    expect(s.state()).toMatchObject({ aborts: 0, removals: 0 });
  });

  it("fails within a bound when no matching request occurs", async () => {
    const s = scene();
    const injection = await interruptOneAdminResponse(s.page, 10);
    s.events.emit("requestfailed", { failure: () => ({ errorText: "unrelated" }) });
    await expect(injection.finish()).rejects.toThrow("did not settle");
    expect(s.state()).toMatchObject({ aborts: 0, removals: 0 });
  });
});
