import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SCHEDULED_SENDS_LIVE } from "@/modules/whatsapp/domain/campaign-schedule";

/**
 * While the 9:30 timer is off (`SCHEDULED_SENDS_LIVE`), nothing in One sends
 * a reminder nobody pressed (go-live Phase D review). Every screen that saves
 * `auto` clamps it, and the scheduled-runs route sends nothing even when a
 * campaign carries `auto` — one the fees app saved, or one saved before this.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("scheduled sends while the timer is off", () => {
  it("is off today", () => {
    expect(SCHEDULED_SENDS_LIVE).toBe(false);
  });

  it("clamps auto in both ladder set-up actions and the campaign form", () => {
    const ladder = read("src/app/(app)/fees/reminders/ladder/actions.ts");
    expect(ladder.match(/const auto = SCHEDULED_SENDS_LIVE && formData\.get\("auto"\) === "on";/g)).toHaveLength(2);
    // Turning a single step on still refuses out loud rather than silently.
    expect(ladder).toContain("if (auto && !SCHEDULED_SENDS_LIVE)");
    expect(read("src/app/(app)/fees/reminders/campaigns/actions.ts")).toContain(
      'auto: SCHEDULED_SENDS_LIVE && formData.get("scheduleAuto") === "on"',
    );
  });

  it("makes the scheduled-runs route send nothing before it reads a campaign (a dry run still reports)", () => {
    const route = read("src/app/api/fees/cron/whatsapp-scheduled-runs/route.ts");
    const stop = route.indexOf("if (!SCHEDULED_SENDS_LIVE && !dryRun)");
    expect(stop).toBeGreaterThan(route.indexOf("const auth = await authorize(request);"));
    expect(stop).toBeLessThan(route.indexOf("listCampaigns(supabase"));
    expect(stop).toBeLessThan(route.indexOf("executeReminderRun("));
  });
});
