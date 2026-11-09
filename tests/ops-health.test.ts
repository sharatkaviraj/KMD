import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  confined: false,
  counts: {} as Record<string, unknown> | null,
  rpcError: null as { message: string } | null,
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  sessions: ["2026-27", "TEST-2026-27"] as string[],
  queued: [] as Array<Record<string, unknown>>,
  dispatched: 0,
  probeStatus: 401 as number | null,
  probes: [] as Array<{ url: string; init: RequestInit }>,
}));

vi.mock("@/platform/deployment/confinement", () => ({ isConfinedDeployment: () => state.confined }));
vi.mock("@/modules/staff-notices/data/enqueue", () => ({
  queueStaffNotice: vi.fn(async () => null),
  queueStaffNoticeToPermission: vi.fn(async (input: Record<string, unknown>) => {
    state.queued.push(input);
    return 1;
  }),
}));
vi.mock("@/modules/staff-notices/data/dispatcher", () => ({
  dispatchStaffNotices: vi.fn(async () => {
    state.dispatched += 1;
    return { accepted: 0, held: 0, suppressed: 1 };
  }),
}));
vi.mock("@/platform/supabase/admin", () => {
  const chain = (data: unknown) => {
    const builder: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "is", "gte", "order", "range", "schema"]) builder[name] = () => builder;
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return builder;
  };
  return {
    createAdminClient: () => ({
      rpc: (name: string, args: unknown) => {
        state.rpcCalls.push({ name, args });
        return Promise.resolve({ data: state.rpcError ? null : state.counts, error: state.rpcError });
      },
      schema: () => ({
        from: (table: string) =>
          table === "app_settings"
            ? chain([{ value: "2026-27" }])
            : chain(state.sessions.map((session_label) => ({ session_label }))),
      }),
      from: () => chain([]),
    }),
  };
});

import { healthCheck } from "@/modules/jobs/data/job-work";
import { JOBS, summaryLine } from "@/modules/jobs/domain/jobs";
import {
  alertKey,
  alertPayload,
  countOf,
  DRIVE_BACKUP_MAX_HOURS,
  evaluateHealth,
  HEALTH_CHECKS,
  HEALTH_SUMMARY_LABELS,
  healthSummary,
  needsAttention,
  PARENT_REMINDER_CAP_DEFAULT,
  probeVerdict,
  SCHOOL_NOTICE_BUDGET,
  WEBHOOK_PROBE_KEY,
  webhookProbeFinding,
} from "@/modules/ops-health/domain/health";
import { assertNoPhoneNumber, renderPayloadNotice } from "@/modules/staff-notices/domain/notices";
import { KINDS } from "@/modules/staff-notices/domain/kinds";
import { SCHOOL_NOTICE_MONTHLY_BUDGET } from "@/modules/whatsapp/domain/school-notices";

/**
 * The health pack (go-live Phase G, plan §9.1, critique1 B9): counts only,
 * an unreadable count is a finding (never a zero), one alert per set of
 * problems per day to the real admins, and a confined deployment alerts only
 * under a TEST session. Nothing is sent here.
 */

/** Everything readable and quiet, as the database answered on 31 Oct minus the broken sibling timer. */
const QUIET = {
  at: "2026-10-31T11:55:20Z",
  window_hours: 24,
  online_events_stuck: 0,
  online_captures_review: 0,
  outbox_uncertain: 0,
  outbox_failed: 0,
  cron_failed: 0,
  cron_failed_jobs: [],
  job_runs_failed: 0,
  job_runs_stale: 0,
  drive_backup_hours: 13,
  staff_failed: 0,
  staff_unknown: 0,
  parent_reminders_failed: 0,
  school_notices_failed: 0,
  one_sends_failed: 0,
  parent_reminders_month: 0,
  parent_reminders_cap: 5000,
  school_notices_month: 0,
  staff_month: 0,
  staff_cap: 1000,
  // Added by 20261031125856 (review of PR #149).
  net_http_failed: 0,
  online_events_pending_old: 0,
  receipt_notices_month: 0,
  one_sends_month: 6,
  whatsapp_month_total: 6,
  whatsapp_plan_cap: null,
  cutover_rows: 0,
};

describe("what is a problem", () => {
  it("a quiet database is quiet", () => {
    const result = evaluateHealth(QUIET);
    expect(result.problems).toEqual([]);
    expect(result.unreadable).toEqual([]);
    expect(needsAttention(result)).toBe(false);
    expect(result.findings).toHaveLength(HEALTH_CHECKS.length);
  });

  it("any open item or failure in the window is a problem", () => {
    for (const key of [
      "online_events_stuck",
      "online_captures_review",
      "outbox_uncertain",
      "outbox_failed",
      "cron_failed",
      "job_runs_failed",
      "job_runs_stale",
      "staff_failed",
      "staff_unknown",
      "parent_reminders_failed",
      "school_notices_failed",
      "one_sends_failed",
      "net_http_failed",
      "online_events_pending_old",
    ]) {
      const result = evaluateHealth({ ...QUIET, [key]: 1 });
      expect(result.problems.map((f) => f.key), key).toEqual([key]);
    }
  });

  it("a count the database could not read is a finding, never a zero", () => {
    const result = evaluateHealth({ ...QUIET, cron_failed: null });
    expect(result.problems).toEqual([]);
    expect(result.unreadable.map((f) => f.key)).toEqual(["cron_failed"]);
    expect(needsAttention(result)).toBe(true);
    // No answer at all: every count unreadable.
    expect(evaluateHealth(null).unreadable).toHaveLength(HEALTH_CHECKS.length);
    expect(evaluateHealth({}).unreadable).toHaveLength(HEALTH_CHECKS.length);
    expect(countOf({ a: "12" }, "a")).toBe(12);
    expect(countOf({ a: "twelve" }, "a")).toBeNull();
    expect(countOf({ a: Number.NaN }, "a")).toBeNull();
  });

  it("names the failing timers (job names only)", () => {
    const result = evaluateHealth({ ...QUIET, cron_failed: 720, cron_failed_jobs: ["refresh-sibling-groups-matview"] });
    expect(result.problems[0].detail?.en).toBe("refresh-sibling-groups-matview");
  });

  it("the Drive backup: a missed night, or never", () => {
    expect(evaluateHealth({ ...QUIET, drive_backup_hours: DRIVE_BACKUP_MAX_HOURS }).problems).toEqual([]);
    expect(evaluateHealth({ ...QUIET, drive_backup_hours: DRIVE_BACKUP_MAX_HOURS + 1 }).problems.map((f) => f.key)).toEqual([
      "drive_backup_hours",
    ]);
    expect(evaluateHealth({ ...QUIET, drive_backup_hours: -1 }).problems[0].detail?.en).toBe("never ran");
  });

  it("this month's WhatsApp: a warning from 80% of the cap", () => {
    expect(evaluateHealth({ ...QUIET, parent_reminders_month: 3999 }).problems).toEqual([]);
    expect(evaluateHealth({ ...QUIET, parent_reminders_month: 4000 }).problems.map((f) => f.key)).toEqual([
      "parent_reminders_month",
    ]);
    // Unset cap: the fee app's own default.
    const unset = evaluateHealth({ ...QUIET, parent_reminders_cap: null, parent_reminders_month: PARENT_REMINDER_CAP_DEFAULT * 0.8 });
    expect(unset.problems.map((f) => f.key)).toEqual(["parent_reminders_month"]);
    expect(unset.problems[0].detail?.en).toBe("3200 of 4000");
    expect(evaluateHealth({ ...QUIET, school_notices_month: SCHOOL_NOTICE_BUDGET * 0.8 }).problems).toHaveLength(1);
    expect(evaluateHealth({ ...QUIET, staff_month: 800 }).problems.map((f) => f.key)).toEqual(["staff_month"]);
    // Staff cap off: nothing goes on that lane, so nothing to warn about.
    expect(evaluateHealth({ ...QUIET, staff_cap: null, staff_month: 5000 }).problems).toEqual([]);
  });

  it("school WhatsApp across every lane: judged only once the owner sets the plan's allowance", () => {
    expect(evaluateHealth({ ...QUIET, whatsapp_month_total: 9000 }).problems).toEqual([]);
    const capped = evaluateHealth({ ...QUIET, whatsapp_plan_cap: 10000, whatsapp_month_total: 8000 });
    expect(capped.problems.map((f) => f.key)).toEqual(["whatsapp_month_total"]);
    expect(capped.problems[0].detail?.en).toBe("8000 of 10000");
    // A lane that could not be read makes the total unreadable, never a smaller number.
    expect(evaluateHealth({ ...QUIET, whatsapp_month_total: null }).unreadable.map((f) => f.key)).toEqual(["whatsapp_month_total"]);
  });

  it("the webhook probe: 401 is healthy; 404 is 'not configured yet' before the line and a problem after; no answer is unreadable", () => {
    expect(probeVerdict(401).ok).toBe(true);
    expect(probeVerdict(404, { cutover: false })).toMatchObject({ ok: true });
    expect(probeVerdict(404, { cutover: true })).toMatchObject({ ok: false });
    expect(probeVerdict(200).ok).toBe(false);
    expect(probeVerdict(500).ok).toBe(false);
    expect(webhookProbeFinding(401, QUIET)).toMatchObject({ key: WEBHOOK_PROBE_KEY, status: "ok", value: 401 });
    expect(webhookProbeFinding(404, QUIET)).toMatchObject({ status: "ok", detail: { en: "not configured yet (C6)" } });
    expect(webhookProbeFinding(404, { ...QUIET, cutover_rows: 1 })).toMatchObject({ status: "problem", value: 404 });
    // The line unreadable: treated as drawn, so a 404 is never silenced by a broken count.
    expect(webhookProbeFinding(404, { ...QUIET, cutover_rows: null })).toMatchObject({ status: "problem" });
    expect(webhookProbeFinding(null, QUIET)).toMatchObject({ status: "unreadable", value: null });
    const result = evaluateHealth(QUIET, [webhookProbeFinding(500, QUIET)]);
    expect(result.problems.map((f) => f.key)).toEqual([WEBHOOK_PROBE_KEY]);
    expect(HEALTH_SUMMARY_LABELS[WEBHOOK_PROBE_KEY]).toBeDefined();
  });

  it("keeps its copies of the caps equal to the fee code's", () => {
    expect(SCHOOL_NOTICE_BUDGET).toBe(SCHOOL_NOTICE_MONTHLY_BUDGET);
    const settings = readFileSync(join(process.cwd(), "src/modules/whatsapp/data/whatsapp-settings.ts"), "utf8");
    expect(settings).toMatch(new RegExp(`monthMessageCap: ${PARENT_REMINDER_CAP_DEFAULT},`));
  });
});

describe("what the job records and what the alert says", () => {
  const result = evaluateHealth({ ...QUIET, cron_failed: 720, cron_failed_jobs: ["refresh-sibling-groups-matview"], staff_unknown: null });

  it("a summary of plain counts, labelled in both languages", () => {
    expect(healthSummary(result)).toEqual({ problems: 1, unreadable: 1, cron_failed: 720, not_read: "staff_unknown" });
    for (const key of Object.keys(healthSummary(result))) expect(HEALTH_SUMMARY_LABELS[key], key).toBeDefined();
    expect(summaryLine(healthSummary(result), "hi")).toContain("डेटाबेस टाइमर विफल: 720");
  });

  it("the alert's list, in both languages, with no phone number in it", () => {
    const payload = alertPayload(result, "2026-11-02");
    expect(payload).toMatchObject({ date: "2026-11-02", problem_count: 2 });
    expect(payload.what_en).toBe("database timer failures 720 (refresh-sibling-groups-matview) · staff WhatsApp uncertain: could not be read");
    expect(String(payload.what_hi)).toContain("डेटाबेस टाइमर विफल 720");
    const rendered = renderPayloadNotice("ops_alert", payload, {
      staffName: "Test Admin",
      language: "en",
      origin: "https://one.example.test",
      studentNames: false,
    });
    expect(rendered.templateCode).toBe(KINDS.ops_alert.template);
    expect(rendered.params[2]).toBe("2");
    expect(rendered.link).toBe("https://one.example.test/jobs");
    expect(() => assertNoPhoneNumber(rendered)).not.toThrow();
  });

  it("one alert per set of problems per day", () => {
    expect(alertKey(result, "2026-11-02")).toBe(alertKey(evaluateHealth({ ...QUIET, cron_failed: 5, staff_unknown: null }), "2026-11-02"));
    expect(alertKey(result, "2026-11-02")).not.toBe(alertKey(result, "2026-11-03"));
    expect(alertKey(result, "2026-11-02")).not.toBe(alertKey(evaluateHealth({ ...QUIET, cron_failed: 5 }), "2026-11-02"));
    expect(alertKey(result, "2026-11-02")).toMatch(/^ops_alert:2026-11-02:[0-9a-f]{8}$/);
  });

  it("the job is in the registry, at 08:00 in school", () => {
    expect(JOBS.health.schedule).toBe("30 2 * * *");
    expect(JOBS.health.when.en).toContain("8:00");
  });
});

describe("the health job", () => {
  beforeEach(() => {
    state.confined = false;
    state.counts = { ...QUIET };
    state.rpcError = null;
    state.rpcCalls = [];
    state.sessions = ["2026-27", "TEST-2026-27"];
    state.queued = [];
    state.dispatched = 0;
    state.probeStatus = 401;
    state.probes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        state.probes.push({ url: String(url), init });
        if (state.probeStatus === null) throw new Error("no answer");
        return new Response(null, { status: state.probeStatus });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("probes its own webhook with a wrong signature on production; a confined deployment does not", async () => {
    await healthCheck("2026-11-02");
    expect(state.probes).toHaveLength(1);
    expect(state.probes[0].url).toMatch(/\/api\/webhooks\/razorpay$/);
    expect(state.probes[0].init).toMatchObject({ method: "POST", redirect: "manual" });
    expect((state.probes[0].init.headers as Record<string, string>)["x-razorpay-signature"]).toBe("0".repeat(64));
    state.probes = [];
    state.confined = true;
    await healthCheck("2026-11-02");
    expect(state.probes).toEqual([]);
  });

  it("a 404 from the webhook after the cutover line alerts the admins; before it, it is quiet", async () => {
    state.probeStatus = 404;
    expect(await healthCheck("2026-11-02")).toEqual({ problems: 0, unreadable: 0 });
    state.counts = { ...QUIET, cutover_rows: 1 };
    const summary = await healthCheck("2026-11-02");
    expect(summary).toMatchObject({ problems: 1, [WEBHOOK_PROBE_KEY]: 404, queued: 1 });
    state.queued = [];
    state.probeStatus = null;
    expect(await healthCheck("2026-11-02")).toMatchObject({ unreadable: 1, not_read: WEBHOOK_PROBE_KEY });
  });

  it("reads the counts over 24 hours and queues nothing when all is quiet", async () => {
    const summary = await healthCheck("2026-11-02");
    expect(state.rpcCalls).toEqual([{ name: "ops_health_counts", args: { p_hours: 24 } }]);
    expect(summary).toEqual({ problems: 0, unreadable: 0 });
    expect(state.queued).toEqual([]);
    expect(state.dispatched).toBe(0);
  });

  it("alerts every real admin under the real session on production", async () => {
    state.counts = { ...QUIET, online_captures_review: 2 };
    const summary = await healthCheck("2026-11-02");
    expect(state.queued).toHaveLength(1);
    expect(state.queued[0]).toMatchObject({
      kind: "ops_alert",
      permission: "settings:manage",
      sessionLabel: "2026-27",
      payload: { date: "2026-11-02", problem_count: 1 },
    });
    expect(String(state.queued[0].key)).toMatch(/^ops_alert:2026-11-02:/);
    expect(summary).toMatchObject({ problems: 1, online_captures_review: 2, queued: 1, suppressed: 1 });
  });

  it("a confined deployment alerts under a TEST session only", async () => {
    state.confined = true;
    state.counts = { ...QUIET, cron_failed: 3 };
    await healthCheck("2026-11-02");
    expect(state.queued[0]).toMatchObject({ sessionLabel: "TEST-2026-27" });
    state.queued = [];
    state.sessions = ["2026-27"];
    const summary = await healthCheck("2026-11-02");
    expect(state.queued).toEqual([]);
    expect(summary).toMatchObject({ queued: 0, note: "no session to alert under" });
  });

  it("fails loudly when the counts cannot be read at all", async () => {
    state.rpcError = { message: "permission denied" };
    await expect(healthCheck("2026-11-02")).rejects.toThrow(/health counts/);
  });
});

describe("the migrations", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8").replace(/\r\n/g, "\n");
  // The latest definition of ops_health_counts is the one the database runs.
  const sql = read("20261031125856_ops_health_more_counts.sql");
  const first = read("20261031115621_ops_health_and_alerts.sql");

  it("grants the counts to the service role only, both times", () => {
    for (const text of [first, sql]) {
      expect(text).toContain("revoke all on function vppsone.ops_health_counts(integer) from public, anon, authenticated;");
      expect(text).toContain("grant execute on function vppsone.ops_health_counts(integer) to service_role;");
      expect(text).toMatch(/security definer\nset search_path = ''/);
    }
  });

  it("reads every count on its own, so one broken source is null and not a failed check", () => {
    // The month's total is a sum of lanes read on their own: null when any of
    // them is. It was named aisensy_month_total in this file and renamed by
    // 20261109062459, which patched the function in place.
    const keys = HEALTH_CHECKS.map((check) => check.key).filter((key) => key !== "whatsapp_month_total");
    for (const key of keys) expect(sql, key).toMatch(new RegExp(`'${key}', null`));
    for (const lane of ["parent_reminders_month", "school_notices_month", "receipt_notices_month", "one_sends_month", "staff_month"]) {
      expect(sql, lane).toContain(`(v_out ->> '${lane}')::bigint`);
    }
    expect(sql).toMatch(/'cutover_rows', null/);
    expect(sql).toMatch(/'aisensy_plan_cap', null/);
  });

  it("adds the AiSensy plan allowance switched off, and to the known keys", () => {
    expect(sql).toContain("'aisensy_month_plan_cap', false, null,");
    expect(sql).toMatch(/runtime_flags_key_known check \([\s\S]*'staff_notice_student_names',\n\s+'aisensy_month_plan_cap'/);
  });

  it("never selects a name, a phone or a payload — counts, caps and job names only", () => {
    const body = sql.slice(sql.indexOf("as $$"), sql.indexOf("$$;", sql.indexOf("as $$") + 5));
    expect(body).not.toMatch(/full_name|phone|destination|payload|template_params|student_id/);
  });
});
