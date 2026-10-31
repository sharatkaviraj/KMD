import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isJobName } from "@/modules/jobs/domain/jobs";

/**
 * One's database timers at cutover (go-live Phase G, plan §11 C4): a runbook
 * the owner runs once, so what it would do is pinned here — it refuses
 * anything but production, reads every secret from Vault by name, puts
 * auto-day-close in exactly one place, never calls the fees app, and its
 * rollback stops every One timer that writes money (critique0 #25).
 */

const sql = readFileSync(join(process.cwd(), "docs/cutover/one-live-cron-jobs.sql"), "utf8").replace(/\r\n/g, "\n");
const body = sql.replace(/--[^\n]*/g, "");

describe("one-live-cron-jobs.sql", () => {
  it("refuses unless the database says production", () => {
    expect(body).toMatch(/select d\.environment into v_env from vppsone\.deployment d/);
    expect(body).toMatch(/if v_env is distinct from 'production' then\s+raise exception/);
  });

  it("names every secret, holds none, and refuses when one is missing", () => {
    for (const name of [
      "VPPS_WHATSAPP_CRON_SECRET",
      "VPPS_ONLINE_PAYMENTS_CRON_SECRET",
      "VPPS_CRON_SECRET",
      "VPPS_STAFF_NOTICES_JOB_TOKEN",
      "VPPS_FEE_DAY_SUMMARY_JOB_TOKEN",
      "VPPS_FEE_DAY_NOT_CLOSED_JOB_TOKEN",
      "VPPS_HEALTH_JOB_TOKEN",
    ]) {
      expect(body, name).toContain(`'${name}'`);
    }
    expect(body).toContain("raise exception 'Refused: no Vault secret named %");
    expect(sql).not.toMatch(/[0-9a-f]{32,}/);
  });

  it("schedules each job once, auto-day-close only here, at 00:05 IST", () => {
    const jobs = [...body.matchAll(/\('([a-z-]+)', '([^']+)', '([^']+)', '(VPPS_[A-Z_]+)'\)/g)].map((m) => ({
      name: m[1],
      schedule: m[2],
      target: m[3],
    }));
    expect(jobs.map((j) => j.name).sort()).toEqual([
      "auto-day-close",
      "fees-nightly-backup",
      "online-payments-reconcile",
      "ops-health",
      "staff-fee-day-not-closed",
      "staff-fee-day-summary",
      "staff-notices-dispatch",
      "whatsapp-scheduled-runs",
    ]);
    expect(jobs.find((j) => j.name === "auto-day-close")).toMatchObject({ schedule: "35 18 * * *", target: "/api/fees/cron/auto-day-close" });
    expect(jobs.find((j) => j.name === "whatsapp-scheduled-runs")?.schedule).toBe("0 4 * * *");
    expect(jobs.find((j) => j.name === "online-payments-reconcile")?.schedule).toBe("*/10 * * * *");
    // Job-token jobs name real jobs.
    for (const job of jobs.filter((j) => !j.target.startsWith("/"))) expect(isJobName(job.target), job.target).toBe(true);
    // One's own vercel.json never schedules auto-day-close.
    const vercel = readFileSync(join(process.cwd(), "vercel.json"), "utf8");
    expect(vercel).not.toContain("auto-day-close");
  });

  it("calls One's host only, and checks that nothing calls the fees app", () => {
    expect(body).toContain("v_base constant text := 'https://one.vpps.co.in'");
    expect(body).not.toMatch(/schoolfees-two\.vercel\.app'|fees\.vpps\.co\.in'/);
    expect(body).toMatch(/as jobs_calling_the_fees_app/);
  });

  it("removes the broken sibling-groups timer", () => {
    expect(body).toContain("perform cron.unschedule('refresh-sibling-groups-matview')");
  });

  it("its rollback stops every One timer that changes money or sends, EMI late fees included", () => {
    const rollback = sql.slice(sql.indexOf("-- ROLLBACK"), sql.indexOf("do $$"));
    for (const name of [
      "whatsapp-scheduled-runs",
      "online-payments-reconcile",
      "auto-day-close",
      "staff-notices-dispatch",
      "ops-health",
      "charge-emi-late-fees-daily",
    ]) {
      expect(rollback, name).toContain(`'${name}'`);
    }
  });

  it("checks the timers by name, not by a count — smoke-enforce optional, every scheduled job expected", () => {
    const check = body.slice(body.indexOf("with expected(jobname, optional)"), body.indexOf("as jobs_calling_the_fees_app"));
    expect(check).toContain("('smoke-enforce', true)");
    for (const name of [
      "refresh-workbook-materialized-views",
      "enqueue-workbook-refresh-daily",
      "charge-emi-late-fees-daily",
      "whatsapp-scheduled-runs",
      "online-payments-reconcile",
      "auto-day-close",
      "fees-nightly-backup",
      "staff-notices-dispatch",
      "staff-fee-day-summary",
      "staff-fee-day-not-closed",
      "ops-health",
    ]) {
      expect(check, name).toContain(`('${name}', false)`);
    }
    expect(check).toMatch(/'MISSING'[\s\S]*'EXTRA \(not on the list\)'[\s\S]*'INACTIVE'/);
    expect(check).not.toContain("refresh-sibling-groups-matview");
  });
});
