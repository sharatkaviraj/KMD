import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The fee-schema catch-up that unblocked the first real load (go-live Phase
 * D): live had `staff_payment_alerts` (fees 20261030170000) and the failure
 * desk's `whatsapp_send_attempts`, `whatsapp_number_health` and seven new
 * columns on `whatsapp_reminder_sends` (fees 20261030190000), and
 * load-snapshot refuses a live table or column One lacks.
 *
 * Phase B's lesson: a migration that lands without the grant the server
 * needs breaks production quietly. Applied and checked on wtgx with
 * has_table_privilege; pinned here from the files.
 */
const dir = join(process.cwd(), "supabase/fee-migrations");
const read = (name: string) => readFileSync(join(dir, name), "utf8").replace(/\r\n/g, "\n");

describe("fee catch-up for Phase D", () => {
  it("copies the failure desk unchanged below its header", () => {
    const sql = read("20261030190000_whatsapp_failure_desk.sql");
    expect(sql).toContain("Difference from the fees app: none.");
    expect(sql).toContain("create table if not exists public.whatsapp_send_attempts");
    expect(sql).toContain("create table if not exists public.whatsapp_number_health");
    expect(sql).toContain("add column if not exists failure_cause text");
    expect(sql).toContain("revoke all on public.whatsapp_send_attempts from anon;");
  });

  it("copies the staff alerts with no real phone number in it (rule 6)", () => {
    const sql = read("20261030170000_online_payment_staff_alerts.sql");
    expect(sql).toContain("('online_payment_staff_whatsapp_numbers', '')");
    expect(sql).not.toMatch(/\+91\d{10}/);
    expect(sql).toContain("grant select, insert, update on public.staff_payment_alerts to service_role;");
    expect(sql).toContain("revoke all on public.staff_payment_alerts from anon, authenticated;");
    expect(sql).not.toMatch(/cron\.schedule/);
  });

  it("gives the service role the two tables live's default privileges would have", () => {
    const sql = read("20261031042100_failure_desk_service_grants.sql");
    expect(sql).toContain("grant select, insert, update, delete on public.whatsapp_send_attempts to service_role;");
    expect(sql).toContain("grant select, insert, update, delete on public.whatsapp_number_health to service_role;");
    expect(sql).not.toMatch(/\bto (anon|authenticated|public)\b/);
  });

  it("never schedules a job that calls the fees app", () => {
    for (const name of [
      "20261030170000_online_payment_staff_alerts.sql",
      "20261030190000_whatsapp_failure_desk.sql",
    ]) {
      expect(read(name)).not.toMatch(/schoolfees-two|vercel\.app/);
    }
  });
});
