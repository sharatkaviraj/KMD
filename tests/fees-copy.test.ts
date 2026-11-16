import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FEES_COPY_FIXED_TAGS,
  FEES_COPY_FRESH_HOURS,
  feesCopyFreshness,
  feesCopyTags,
  showsFeesCopyStatus,
} from "@/modules/coexistence/domain/fees-copy";

/*
 * The night's copy of the Fees app into One (D-644, D-648): the rules the
 * screen-clearing request and the "updated from Fees" line follow, the
 * request itself, and the SQL that schedules it.
 */

const state = { tags: [] as unknown[], tagsError: null as Error | null, secretOk: false, secretCalls: [] as string[] };
const expired: string[] = [];

vi.mock("@/modules/coexistence/data/fees-copy", () => ({
  feesCopySecretMatches: async (secret: string) => {
    state.secretCalls.push(secret);
    return state.secretOk;
  },
  readFeesCopyCacheTags: async () => {
    if (state.tagsError) throw state.tagsError;
    return state.tags;
  },
}));
vi.mock("@/platform/performance/shared-cache", () => ({
  expireTag: (tag: string) => {
    expired.push(tag);
  },
}));
vi.mock("@/platform/observability/log", () => ({ logInfo: () => undefined, logWarn: () => undefined }));

const { POST } = await import("@/app/api/jobs/fees-copy-done/route");

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const sqlOf = (dir: string, suffix: string) => {
  const files = readdirSync(join(process.cwd(), dir)).filter((name) => name.endsWith(suffix));
  expect(files, suffix).toHaveLength(1);
  return read(join(dir, files[0]!));
};
/** The SQL with its comments taken out, so a word in the header is not mistaken for a statement. */
const statements = (sql: string) => sql.replace(/--[^\n]*/g, "");

const CHILD = "0b8f6f2e-6f7a-4c43-9d0e-1a2b3c4d5e6f";

describe("the tags a copy expires", () => {
  it("always the fixed ones, then each real year's and each child's from the database, once each", () => {
    const tags = feesCopyTags(["session:2026-27", "dues-badge:2026-27", `student:${CHILD}`, "session:2026-27"]);
    expect(tags).toEqual([...FEES_COPY_FIXED_TAGS, "session:2026-27", "dues-badge:2026-27", `student:${CHILD}`]);
  });

  it("drops anything that is not one of the three shapes, rather than expiring a different tag", () => {
    const tags = feesCopyTags([
      "session:TEST-2026-27",
      "dues-badge:2026",
      "student:not-a-uuid",
      `student:${CHILD.toUpperCase()}`,
      "vx-calendar",
      "",
      42,
      null,
      { tag: "session:2026-27" },
    ]);
    expect(tags).toEqual([...FEES_COPY_FIXED_TAGS]);
  });
});

describe("whether the last copy is last night's", () => {
  const now = new Date("2026-11-17T06:00:00.000Z");

  it("is fresh within the hours a night's copy covers, and stale after", () => {
    expect(feesCopyFreshness("2026-11-16T20:31:05.000Z", now)).toBe("fresh");
    const edge = new Date(now.getTime() - FEES_COPY_FRESH_HOURS * 3_600_000).toISOString();
    expect(feesCopyFreshness(edge, now)).toBe("fresh");
    expect(feesCopyFreshness(new Date(Date.parse(edge) - 1000).toISOString(), now)).toBe("stale");
  });

  it("says never when there is no copy, or no time it can read", () => {
    expect(feesCopyFreshness(null, now)).toBe("never");
    expect(feesCopyFreshness(undefined, now)).toBe("never");
    expect(feesCopyFreshness("last night", now)).toBe("never");
  });
});

describe("who sees the updated-from-Fees line", () => {
  const real = { isActive: true, isTestAccount: false };
  const base = { bridgeOn: false, confined: false, viewer: real, sessionLabel: "2026-27" };

  it("real, active staff in a real year, while the link is off", () => {
    expect(showsFeesCopyStatus(base)).toBe(true);
  });

  it("nobody while the link is on, on a confined deployment, or in a practice year", () => {
    expect(showsFeesCopyStatus({ ...base, bridgeOn: true })).toBe(false);
    expect(showsFeesCopyStatus({ ...base, confined: true })).toBe(false);
    expect(showsFeesCopyStatus({ ...base, sessionLabel: "TEST-2026-27" })).toBe(false);
    expect(showsFeesCopyStatus({ ...base, sessionLabel: "" })).toBe(false);
    expect(showsFeesCopyStatus({ ...base, sessionLabel: null })).toBe(false);
  });

  it("never a practice account, an inactive account, or an account the shell marks confined", () => {
    expect(showsFeesCopyStatus({ ...base, viewer: { isActive: true, isTestAccount: true } })).toBe(false);
    expect(showsFeesCopyStatus({ ...base, viewer: { isActive: false } })).toBe(false);
    expect(showsFeesCopyStatus({ ...base, viewer: { isActive: true, confined: true } })).toBe(false);
  });

  it("is drawn by the shell only when the link's own line is not", () => {
    const layout = read("src/app/(app)/layout.tsx");
    expect(layout).toContain("const showCopyStatus = !showBridgeStatus && showsFeesCopyStatus(");
    expect(layout).toMatch(/showBridgeStatus \? <Suspense[\s\S]*?<RosterStatus[\s\S]*?: showCopyStatus \? <Suspense[\s\S]*?<FeesCopyStatus/);
  });
});

describe("POST /api/jobs/fees-copy-done", () => {
  const CRON = "c".repeat(48);
  const request = (authorization: string | null, body: unknown = { run: 9 }) =>
    new Request("https://one.vpps.co.in/api/jobs/fees-copy-done", {
      method: "POST",
      headers: authorization ? { authorization, "content-type": "application/json" } : { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", CRON);
    state.tags = ["session:2026-27", `student:${CHILD}`];
    state.tagsError = null;
    state.secretOk = false;
    state.secretCalls = [];
    expired.length = 0;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a 404 with no secret, or the wrong one, and clears nothing", async () => {
    for (const header of [null, "Bearer", "Basic abc", `Bearer ${"f".repeat(64)}`]) {
      const response = await POST(request(header));
      expect(response.status, String(header)).toBe(404);
    }
    expect(expired).toEqual([]);
    // Only a Bearer value is ever compared against Vault.
    expect(state.secretCalls).toEqual(["f".repeat(64)]);
  });

  it("with CRON_SECRET, clears the fixed tags and every one the copy named, and says how many", async () => {
    const response = await POST(request(`Bearer ${CRON}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, run: 9, expired: FEES_COPY_FIXED_TAGS.length + 2, students: 1 });
    expect(expired).toEqual([...FEES_COPY_FIXED_TAGS, "session:2026-27", `student:${CHILD}`]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.secretCalls).toEqual([]);
  });

  it("with the night's own secret (checked in Postgres), does the same", async () => {
    state.secretOk = true;
    const secret = "a".repeat(64);
    const response = await POST(request(`Bearer ${secret}`, { run: "nine" }));
    expect(response.status).toBe(200);
    expect(state.secretCalls).toEqual([secret]);
    expect((await response.json()).run).toBeNull();
  });

  it("answers 503 and clears nothing when the copied tags cannot be read", async () => {
    state.tagsError = new Error("fees_copy_cache_tags: timeout");
    const response = await POST(request(`Bearer ${CRON}`));
    expect(response.status).toBe(503);
    expect(expired).toEqual([]);
  });
});

describe("the SQL behind the night", () => {
  it("asks for the request after the copy, with the Vault secret, and never stops the copy for it", () => {
    const sql = statements(sqlOf("supabase/migrations", "_fees_copy_nightly.sql"));
    expect(sql).toMatch(/v_report := vppsone\.fees_copy_run\('apply'\)/);
    expect(sql).toMatch(/net\.http_post\(\s*url := 'https:\/\/one\.vpps\.co\.in\/api\/jobs\/fees-copy-done'/);
    expect(sql).toMatch(/s\.name = 'FEES_COPY_CRON_SECRET'/);
    // Each step after the copy is its own sub-transaction.
    expect(sql.match(/exception when others then/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("turns the link off only with a fresh copy, pauses the link's check and schedules the copy once a night", () => {
    const sql = statements(sqlOf("supabase/migrations", "_fees_link_off.sql"));
    expect(sql).toMatch(/r\.mode = 'apply' and r\.status = 'applied'\s+and r\.finished_at >= pg_catalog\.clock_timestamp\(\) - interval '50 hours'/);
    expect(sql).toMatch(/raise exception 'D-648: no copy/);
    expect(sql).toMatch(/update vppsone\.fees_bridge_state set enabled = false where id;/);
    expect(sql).toMatch(/cron\.alter_job\(j\.jobid, active := false\)\s+from cron\.job j\s+where j\.jobname = 'fees-bridge-nightly-verify'/);
    // D-457: once a day, at night, never more often.
    expect(sql).toMatch(/cron\.schedule\('fees-copy-nightly', '30 20 \* \* \*', 'select vppsone\.fees_copy_nightly\(\);'\)/);
    expect(sql).toMatch(/cron\.schedule\('fees-copy-audit', '50 20 \* \* \*', 'select vppsone\.fees_copy_audit\(100000\);'\)/);
    expect(sql.match(/cron\.schedule\(/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(drop|truncate|delete)\b/i);
    expect(sql).not.toMatch(/vgqyilgstjvgohrsiwkb/);
  });
});

describe("Settings → WhatsApp, the Fees app's messages", () => {
  it("can be switched on for the test year, and the page says the real year is the Fees app's", () => {
    const actions = read("src/app/(app)/settings/whatsapp/actions.ts");
    expect(actions).not.toContain("feature_fees_app");
    expect(actions).toContain("feesAppSendsRealYear(feature, (await readSwitches())?.feeSender)");
    expect(actions).toContain('"feature_test_year"');

    const page = read("src/app/(app)/settings/whatsapp/page.tsx");
    expect(page).toContain("const testYearOnly = feesAppSendsRealYear(feature, switches?.feeSender);");
    expect(page).toContain("w.testYearOnlyHelp");
    expect(page).not.toMatch(/feesApp \? null/);
  });
});
