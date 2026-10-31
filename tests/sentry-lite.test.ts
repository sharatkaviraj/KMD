import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authHeader,
  buildEvent,
  configuredDsn,
  envelopeBody,
  envelopeUrl,
  framesFrom,
  parseDsn,
  reportServerError,
  scrub,
} from "@/platform/observability/sentry-lite";

/**
 * Server errors to Sentry without the SDK (go-live Phase G, plan §9.1,
 * critique1 B9): off without a DSN; the route template only, never a path
 * with an id or a query (job tokens travel as `?token=`); no headers, user or
 * body; phones and emails masked; never throws. Synthetic values only.
 */

const DSN = "https://abc123@o450000.ingest.de.sentry.io/4500000000000001";

describe("the DSN", () => {
  it("parses a Sentry DSN and refuses anything else", () => {
    expect(parseDsn(DSN)).toEqual({
      publicKey: "abc123",
      host: "o450000.ingest.de.sentry.io",
      protocol: "https",
      projectId: "4500000000000001",
      pathPrefix: "",
    });
    for (const bad of [undefined, "", "not a url", "https://o1.ingest.sentry.io/1", "https://k@host/abc", "ftp://k@host/1"]) {
      expect(parseDsn(bad), String(bad)).toBeNull();
    }
    expect(envelopeUrl(parseDsn(DSN)!)).toBe("https://o450000.ingest.de.sentry.io/api/4500000000000001/envelope/");
    expect(authHeader(parseDsn(DSN)!)).toContain("sentry_key=abc123");
  });

  it("reads SENTRY_DSN, else the fee app's NEXT_PUBLIC_SENTRY_DSN, else nothing", () => {
    expect(configuredDsn({})).toBeNull();
    expect(configuredDsn({ NEXT_PUBLIC_SENTRY_DSN: DSN })?.projectId).toBe("4500000000000001");
    expect(configuredDsn({ SENTRY_DSN: "https://k@h.example/7", NEXT_PUBLIC_SENTRY_DSN: DSN })?.projectId).toBe("7");
  });
});

describe("what is sent", () => {
  const now = new Date("2026-11-02T04:00:00Z");

  it("the route template and the error, nothing about the request or the person", () => {
    const error = new Error("Could not post for parent 98765 43210 (test.parent@example.com)");
    const event = buildEvent(
      error,
      { method: "POST", routePath: "/api/jobs/[job]?token=deadbeef", routeType: "route", routerKind: "App Router" },
      { eventId: "a".repeat(32), now, environment: "production" },
    );
    expect(event.transaction).toBe("/api/jobs/[job]");
    expect(event.tags).toEqual({ method: "POST", route_type: "route", router_kind: "App Router" });
    expect(event.exception.values[0].value).toBe("Could not post for parent [phone] ([email])");
    const json = JSON.stringify(event);
    for (const leak of ["token", "deadbeef", "98765", "example.com", "cookie", "headers", "user"]) {
      expect(json, leak).not.toContain(leak);
    }
  });

  it("masks every phone shape the staff guard knows", () => {
    for (const phone of ["9876543210", "+91 98765 43210", "919876543210", "98765-43210"]) {
      expect(scrub(`call ${phone} now`), phone).toBe("call [phone] now");
    }
    expect(scrub("receipt SVP-2026-27-5001, ₹12,50,000")).toBe("receipt SVP-2026-27-5001, ₹12,50,000");
  });

  it("turns a V8 stack into frames, oldest first", () => {
    const stack = [
      "Error: boom",
      "    at inner (/var/task/.next/server/chunks/1.js:10:5)",
      "    at async outer (/var/task/node_modules/next/dist/server.js:20:7)",
      "    at node:internal/process/task_queues:95:5",
    ].join("\n");
    const frames = framesFrom(stack);
    expect(frames.map((frame) => frame.lineno)).toEqual([95, 20, 10]);
    expect(frames[2]).toMatchObject({ function: "inner", in_app: true });
    expect(frames[1].in_app).toBe(false);
  });

  it("a thrown string or object is still an event", () => {
    expect(buildEvent("plain", {}, { eventId: "b".repeat(32), now }).exception.values[0].value).toBe("plain");
    expect(buildEvent({ odd: true }, {}, { eventId: "b".repeat(32), now }).exception.values[0].type).toBe("Error");
  });

  it("an envelope is three JSON lines", () => {
    const body = envelopeBody({ event_id: "c".repeat(32) }, now);
    const lines = body.trimEnd().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ event_id: "c".repeat(32), sent_at: now.toISOString() });
    expect(lines[1]).toEqual({ type: "event" });
  });
});

describe("posting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does nothing without a DSN", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await reportServerError(new Error("x"), {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts one envelope, and never throws when Sentry is down", async () => {
    vi.stubEnv("SENTRY_DSN", DSN);
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(reportServerError(new Error("x"), { routePath: "/receipts" })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o450000.ingest.de.sentry.io/api/4500000000000001/envelope/");
    expect((init.headers as Record<string, string>)["X-Sentry-Auth"]).toContain("sentry_key=abc123");
  });
});
