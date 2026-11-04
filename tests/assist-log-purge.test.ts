import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `vppsone.assist_log` is kept 180 days, then purged by the nightly job
 * (MCP feasibility §10, D8's retention for metadata-only AI logs).
 *
 * The fake below is the table and the three PostgREST shapes the purge uses —
 * a bounded select, a filtered delete with a count, and a head count — so the
 * tests check what is deleted, in how many requests, and that nothing but
 * counts comes back out through the scheduler.
 */

type Row = { id: string; created_at: string };

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  calls: [] as { op: "select" | "delete" | "count"; size: number }[],
  failDeletes: false,
  adminClient: vi.fn(),
}));

function fakeClient() {
  return {
    from(table: string) {
      if (table !== "assist_log") throw new Error(`Unexpected table ${table}`);
      let op: "select" | "delete" | "count" = "select";
      let before: string | null = null;
      let ids: string[] | null = null;
      let limit = Infinity;
      let ascending = true;
      const builder = {
        select(_columns: string, options?: { count?: string; head?: boolean }) {
          op = options?.head ? "count" : "select";
          return builder;
        },
        delete(options?: { count?: string }) {
          expect(options).toEqual({ count: "exact" });
          op = "delete";
          return builder;
        },
        lt(column: string, value: string) {
          expect(column).toBe("created_at");
          before = value;
          return builder;
        },
        in(column: string, values: string[]) {
          expect(column).toBe("id");
          ids = values;
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          expect(column).toBe("created_at");
          ascending = options.ascending;
          return builder;
        },
        limit(value: number) {
          limit = value;
          return builder;
        },
        then<T>(resolve: (value: unknown) => T) {
          const old = state.rows.filter((row) => before !== null && row.created_at < before);
          if (op === "count") {
            state.calls.push({ op, size: 0 });
            return Promise.resolve(resolve({ data: null, count: old.length, error: null }));
          }
          if (op === "select") {
            const picked = [...old]
              .sort((a, b) => (ascending ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)))
              .slice(0, limit)
              .map((row) => ({ id: row.id }));
            state.calls.push({ op, size: picked.length });
            return Promise.resolve(resolve({ data: picked, error: null }));
          }
          // A delete never runs without both filters: the ids and the age.
          expect(before).not.toBeNull();
          expect(ids).not.toBeNull();
          state.calls.push({ op, size: ids!.length });
          if (state.failDeletes) return Promise.resolve(resolve({ data: null, count: 0, error: null }));
          const doomed = new Set(old.filter((row) => ids!.includes(row.id)).map((row) => row.id));
          state.rows = state.rows.filter((row) => !doomed.has(row.id));
          return Promise.resolve(resolve({ data: null, count: doomed.size, error: null }));
        },
      };
      return builder;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: state.adminClient }));
// The run bookkeeping has its own tests; here the work is run and its summary returned.
vi.mock("@/modules/jobs/data/run-job", () => ({
  runJob: async (_job: string, _options: unknown, work: () => Promise<Record<string, unknown>>) => ({ status: "ok", summary: await work() }),
}));
vi.mock("@/platform/observability/heartbeat", () => ({ sendHeartbeat: async () => undefined }));

import { GET } from "@/app/api/jobs/[job]/route";
import { purgeAssistLog } from "@/modules/assist/data/log";
import { ASSIST_LOG_PURGE_BATCH, ASSIST_LOG_RETENTION_DAYS, assistLogCutoff } from "@/modules/assist/domain/retention";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";

const NOW = new Date("2026-11-03T21:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function seed(count: number, daysOld: number, prefix: string) {
  for (let i = 0; i < count; i += 1) {
    state.rows.push({
      id: `${prefix}-${String(i).padStart(4, "0")}`,
      created_at: new Date(NOW.getTime() - daysOld * DAY - i * 1000).toISOString(),
    });
  }
}

beforeEach(() => {
  state.rows = [];
  state.calls = [];
  state.failDeletes = false;
  state.adminClient.mockReset().mockImplementation(fakeClient);
});

describe("the retention rule", () => {
  it("is 180 days, and a row is past it only once strictly older", () => {
    expect(ASSIST_LOG_RETENTION_DAYS).toBe(180);
    expect(assistLogCutoff(NOW).toISOString()).toBe("2026-05-07T21:00:00.000Z");
    expect(() => assistLogCutoff(NOW, 0)).toThrow();
    expect(() => assistLogCutoff(NOW, 1.5)).toThrow();
  });

  it("deletes in batches that fit one request URL", () => {
    expect(ASSIST_LOG_PURGE_BATCH).toBeLessThanOrEqual(IN_FILTER_CHUNK_SIZE);
  });
});

describe("purgeAssistLog()", () => {
  it("deletes only rows past 180 days, in bounded batches, oldest first", async () => {
    seed(450, 200, "old");
    seed(30, 179, "recent");
    seed(5, 0, "today");

    const result = await purgeAssistLog(NOW, { batch: 200, maxBatches: 50 });

    expect(result).toEqual({ deleted: 450, batches: 3, more: false });
    expect(state.rows).toHaveLength(35);
    expect(state.rows.every((row) => !row.id.startsWith("old-"))).toBe(true);
    expect(state.calls.filter((call) => call.op === "delete").map((call) => call.size)).toEqual([200, 200, 50]);
  });

  it("keeps a row exactly on the cutoff", async () => {
    state.rows.push({ id: "edge", created_at: assistLogCutoff(NOW).toISOString() });
    expect(await purgeAssistLog(NOW)).toEqual({ deleted: 0, batches: 0, more: false });
    expect(state.rows).toHaveLength(1);
  });

  it("stops at the batch cap and says more is waiting, for the next night", async () => {
    seed(450, 365, "old");

    const result = await purgeAssistLog(NOW, { batch: 200, maxBatches: 2 });

    expect(result).toEqual({ deleted: 400, batches: 2, more: true });
    expect(state.rows).toHaveLength(50);
    // The next run finishes it.
    expect(await purgeAssistLog(NOW, { batch: 200, maxBatches: 2 })).toEqual({ deleted: 50, batches: 1, more: false });
    expect(state.rows).toHaveLength(0);
  });

  it("fails loudly when rows past retention survive their delete", async () => {
    seed(3, 400, "old");
    state.failDeletes = true;
    await expect(purgeAssistLog(NOW)).rejects.toThrow("none was deleted");
  });
});

describe("the scheduled job", () => {
  const ORIGINAL = { cron: process.env.CRON_SECRET, jobs: process.env.JOBS_SECRET };
  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL.cron;
    process.env.JOBS_SECRET = ORIGINAL.jobs;
    vi.useRealTimers();
  });

  async function call(headers: Record<string, string> = {}) {
    const request = new NextRequest("https://one.example.invalid/api/jobs/assist-log-purge", { headers });
    return GET(request, { params: Promise.resolve({ job: "assist-log-purge" }) });
  }

  it("refuses without the machine credential, before touching the log", async () => {
    process.env.CRON_SECRET = "synthetic-cron-secret";
    seed(3, 400, "old");

    const response = await call({ authorization: "Bearer wrong" });

    expect(response.status).toBe(404);
    expect(state.adminClient).not.toHaveBeenCalled();
    expect(state.rows).toHaveLength(3);
  });

  it("runs on Vercel's cron credential and reports counts, never a row", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.CRON_SECRET = "synthetic-cron-secret";
    seed(7, 400, "old");
    seed(2, 10, "recent");

    const response = await call({ authorization: "Bearer synthetic-cron-secret" });
    const body = (await response.json()) as { job: string; status: string; summary: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body.job).toBe("assist-log-purge");
    expect(body.summary).toEqual({ deleted: 7, retention_days: 180, more_waiting: "no" });
    expect(JSON.stringify(body)).not.toMatch(/old-|recent-/);
    expect(state.rows.map((row) => row.id)).toEqual(["recent-0000", "recent-0001"]);
  });
});
