import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isJobName } from "@/modules/jobs/domain/jobs";

/**
 * The staff WhatsApp timers (critique1 A10; review of PR #148) are a committed,
 * checkable operator step, not prose: `scripts/ops/schedule-staff-notices-cron.sql`
 * reads the deployment marker first and refuses anything but production, reads
 * every token from Vault by name, is idempotent, and is a required item in the
 * cutover sheet and in PROGRESS.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = read("scripts", "ops", "schedule-staff-notices-cron.sql");
const BODY = SCRIPT.replace(/--[^\n]*/g, "");

describe("scripts/ops/schedule-staff-notices-cron.sql", () => {
  it("reads vppsone.deployment before anything else and refuses unless it says production", () => {
    const marker = BODY.indexOf("from vppsone.deployment");
    expect(marker).toBeGreaterThan(-1);
    expect(BODY).toContain("if v_env is distinct from 'production' then");
    expect(marker).toBeLessThan(BODY.indexOf("vault.decrypted_secrets"));
    expect(marker).toBeLessThan(BODY.indexOf("cron.unschedule"));
    expect(marker).toBeLessThan(BODY.indexOf("cron.schedule("));
  });

  it("is idempotent: unschedules a job of the same name before scheduling it", () => {
    expect(BODY).toContain("if exists (select 1 from cron.job c where c.jobname = v_job.jobname) then");
    expect(BODY.indexOf("perform cron.unschedule(v_job.jobname)")).toBeLessThan(BODY.indexOf("perform cron.schedule("));
  });

  it("schedules the five-minute dispatch and the two fee-day jobs, each a real job, on the IST minute", () => {
    for (const [name, schedule, job] of [
      ["staff-notices-dispatch", "*/5 * * * *", "staff-notices"],
      ["staff-fee-day-summary", "30 13 * * *", "fee-day-summary"],
      ["staff-fee-day-not-closed", "30 14 * * *", "fee-day-not-closed"],
    ] as const) {
      expect(BODY).toContain(`('${name}', '${schedule}', '${job}',`);
      expect(isJobName(job), job).toBe(true);
    }
  });

  it("reads each token from Vault by name when the job fires, and holds no secret", () => {
    expect(BODY).toContain("(select decrypted_secret from vault.decrypted_secrets where name = %L)");
    expect(SCRIPT).not.toMatch(/token=[0-9a-f]{16,}/);
    expect(SCRIPT).not.toMatch(/JOBS_SECRET\s*=/);
  });

  it("is a required step in the cutover sheet and in PROGRESS", () => {
    expect(read("docs", "cutover", "STAFF-WHATSAPP.md")).toContain("scripts/ops/schedule-staff-notices-cron.sql");
    expect(read("docs", "PROGRESS.md")).toContain("scripts/ops/schedule-staff-notices-cron.sql");
  });
});
