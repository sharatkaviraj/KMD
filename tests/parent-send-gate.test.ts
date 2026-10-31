import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  checkParentSend,
  isRefusedGeneration,
  toE164,
  type ParentSendGate,
  type ParentSendReader,
} from "@/platform/messaging/parent-send-gate";
import { sendAisensyCampaignMessage } from "@/modules/whatsapp/data/aisensy";

/**
 * The one gate in front of every parent WhatsApp (go-live Phase D, plan §6.3,
 * critique0 #10 and #30). Each branch, and that each read fails closed.
 * Numbers are test values (rule 6).
 */

const LIVE_PROD = { VPPSONE_ENV: "live", VERCEL_ENV: "production" };
const TEST_PHONE = "+919000000001";
const REAL_PHONE = "+919000000002";

function reader(overrides: Partial<ParentSendReader> = {}): ParentSendReader {
  return {
    parentDispatchOn: async () => true,
    dispatchCategories: async () => ["fee_reminder", "receipt", "absent_notice", "school_notice", "general"],
    absentNoticeOwner: async () => "fees_notice",
    isTestAccount: async () => false,
    isTestRecipient: async (phone) => phone === TEST_PHONE,
    ...overrides,
  };
}

const send = (gate: Partial<ParentSendGate> = {}, extra: { campaignName?: string; destination?: string } = {}) => ({
  kind: "fee_reminder" as const,
  sessionLabel: "2026-27",
  actor: { userId: "u-real" } as ParentSendGate["actor"],
  ...gate,
  campaignName: extra.campaignName ?? "vpps_app_fee_due_hi_v7",
  destination: extra.destination ?? REAL_PHONE,
});

describe("the parent-send gate", () => {
  it("lets a real send through when every switch is on, on production", async () => {
    expect(await checkParentSend(send(), reader(), LIVE_PROD)).toEqual({ ok: true, allowlistRequired: false });
  });

  it("refuses every _v6 template, whatever else is on", async () => {
    const verdict = await checkParentSend(send({}, { campaignName: "vpps_app_fee_due_hi_v6" }), reader(), LIVE_PROD);
    expect(verdict).toMatchObject({ ok: false, code: "v6_never" });
    expect(isRefusedGeneration("vpps_app_late_fee_applied_en_v6")).toBe(true);
    expect(isRefusedGeneration("vpps_app_fee_due_hi_v7")).toBe(false);
  });

  it.each([[{}], [{ VPPSONE_ENV: "dev" }], [{ VPPSONE_ENV: "staging", VERCEL_ENV: "production" }]])(
    "1. refuses unless VPPSONE_ENV is live (%o)",
    async (env) => {
      expect(await checkParentSend(send(), reader(), env)).toMatchObject({ ok: false, code: "not_live" });
    },
  );

  it("2. refuses when parent_dispatch is off, or cannot be read", async () => {
    expect(await checkParentSend(send(), reader({ parentDispatchOn: async () => false }), LIVE_PROD)).toMatchObject({
      code: "dispatch_off",
    });
    expect(await checkParentSend(send(), reader({ parentDispatchOn: async () => null }), LIVE_PROD)).toMatchObject({
      code: "read_failed",
    });
    expect(
      await checkParentSend(
        send(),
        reader({ parentDispatchOn: async () => Promise.reject(new Error("network")) }),
        LIVE_PROD,
      ),
    ).toMatchObject({ code: "read_failed" });
  });

  it("3. refuses a kind parent_dispatch_categories does not list, or a value of the wrong shape", async () => {
    expect(await checkParentSend(send({ kind: "reversal" }), reader(), LIVE_PROD)).toMatchObject({ code: "category_off" });
    expect(
      await checkParentSend(send(), reader({ dispatchCategories: async () => "fee_reminder" }), LIVE_PROD),
    ).toMatchObject({ code: "category_off" });
    expect(await checkParentSend(send(), reader({ dispatchCategories: async () => null }), LIVE_PROD)).toMatchObject({
      code: "read_failed",
    });
  });

  it("3b. sends an absence only from the path absent_notice_owner names — never both", async () => {
    const absent = (path: "fees_notice" | "native") => send({ kind: "absent_notice", absentPath: path });
    expect(await checkParentSend(absent("fees_notice"), reader(), LIVE_PROD)).toMatchObject({ ok: true });
    expect(await checkParentSend(absent("native"), reader(), LIVE_PROD)).toMatchObject({ code: "absent_owner" });
    expect(
      await checkParentSend(absent("native"), reader({ absentNoticeOwner: async () => "native" }), LIVE_PROD),
    ).toMatchObject({ ok: true });
    expect(
      await checkParentSend(send({ kind: "absent_notice" }), reader(), LIVE_PROD),
    ).toMatchObject({ code: "absent_owner" });
    expect(
      await checkParentSend(absent("fees_notice"), reader({ absentNoticeOwner: async () => null }), LIVE_PROD),
    ).toMatchObject({ code: "read_failed" });
  });

  describe("4. the test-recipient allowlist", () => {
    it("binds a test session", async () => {
      const verdict = await checkParentSend(send({ sessionLabel: "TEST-2026-27" }), reader(), LIVE_PROD);
      expect(verdict).toMatchObject({ code: "not_test_recipient" });
      expect(
        await checkParentSend(send({ sessionLabel: "TEST-2026-27" }, { destination: TEST_PHONE }), reader(), LIVE_PROD),
      ).toEqual({ ok: true, allowlistRequired: true });
    });

    it("binds a test account in a real session", async () => {
      const r = reader({ isTestAccount: async () => true });
      expect(await checkParentSend(send(), r, LIVE_PROD)).toMatchObject({ code: "not_test_recipient" });
      expect(await checkParentSend(send({}, { destination: "9000000001" }), r, LIVE_PROD)).toMatchObject({ ok: true });
    });

    it("binds every deployment that is not Vercel production", async () => {
      for (const env of [{ VPPSONE_ENV: "live" }, { VPPSONE_ENV: "live", VERCEL_ENV: "preview" }]) {
        expect(await checkParentSend(send(), reader(), env)).toMatchObject({ code: "not_test_recipient" });
        expect(await checkParentSend(send({}, { destination: TEST_PHONE }), reader(), env)).toMatchObject({ ok: true });
      }
    });

    it("binds a test send typed in by staff, even in production", async () => {
      expect(await checkParentSend(send({ testSend: true, sessionLabel: null }), reader(), LIVE_PROD)).toMatchObject({
        code: "not_test_recipient",
      });
    });

    it("fails closed when the actor, the list or the number cannot be read", async () => {
      expect(await checkParentSend(send({ actor: "unknown" }), reader(), LIVE_PROD)).toMatchObject({ code: "actor_unknown" });
      expect(
        await checkParentSend(send(), reader({ isTestAccount: async () => null }), LIVE_PROD),
      ).toMatchObject({ code: "actor_unknown" });
      expect(
        await checkParentSend(
          send({ sessionLabel: "TEST-2026-27" }, { destination: TEST_PHONE }),
          reader({ isTestRecipient: async () => null }),
          LIVE_PROD,
        ),
      ).toMatchObject({ code: "read_failed" });
      expect(
        await checkParentSend(send({ sessionLabel: "TEST-2026-27" }, { destination: "12" }), reader(), LIVE_PROD),
      ).toMatchObject({ code: "bad_destination" });
    });

    it("treats a malformed rehearsal label as a test session", async () => {
      expect(await checkParentSend(send({ sessionLabel: "TEST-26" }), reader(), LIVE_PROD)).toMatchObject({
        code: "not_test_recipient",
      });
    });

    it("lets a cron run (no person) send in a real session on production", async () => {
      const isTestAccount = vi.fn(async () => true);
      expect(await checkParentSend(send({ actor: "system" }), reader({ isTestAccount }), LIVE_PROD)).toMatchObject({
        ok: true,
      });
      expect(isTestAccount).not.toHaveBeenCalled();
    });
  });

  it("normalises a number the way the allowlist stores it", () => {
    expect(toE164("9000000001")).toBe("+919000000001");
    expect(toE164("919000000001")).toBe("+919000000001");
    expect(toE164("+91 90000 00001")).toBe("+919000000001");
    expect(toE164("12345")).toBeNull();
  });
});

describe("sendAisensyCampaignMessage asks the gate before AiSensy", () => {
  const fetchSpy = vi.fn();
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchSpy.mockReset();
  });

  const args = {
    campaignName: "vpps_app_fee_due_hi_v7",
    destination: REAL_PHONE,
    userName: "Test Parent",
    templateParams: ["1", "2", "3", "4", "5"],
    gate: { kind: "fee_reminder" as const, sessionLabel: "2026-27", actor: "system" as const },
  };

  it("never reaches the network when the gate refuses", async () => {
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("AISENSY_API_KEY", "test-key");
    vi.stubEnv("VPPSONE_ENV", "dev");
    const result = await sendAisensyCampaignMessage(args, reader());
    expect(result).toMatchObject({ ok: false, refused: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a _v6 campaign even with everything on", async () => {
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("AISENSY_API_KEY", "test-key");
    vi.stubEnv("VPPSONE_ENV", "live");
    vi.stubEnv("VERCEL_ENV", "production");
    const result = await sendAisensyCampaignMessage({ ...args, campaignName: "vpps_app_fee_due_hi_v6" }, reader());
    expect(result).toMatchObject({ ok: false, refused: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts with a vppsone source once every check passes (fetch mocked; nothing is sent)", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ submitted_message_id: "m1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("AISENSY_API_KEY", "test-key");
    vi.stubEnv("VPPSONE_ENV", "live");
    vi.stubEnv("VERCEL_ENV", "production");
    const result = await sendAisensyCampaignMessage(args, reader());
    expect(result).toEqual({ ok: true, status: 200, messageId: "m1" });
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1].body));
    expect(body.source).toBe("vppsone");
  });
});

describe("every parent send goes through the choke point", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it.each([
    "src/modules/whatsapp/data/run-sender.ts",
    "src/modules/whatsapp/data/receipt-notice.ts",
    "src/modules/whatsapp/data/reversal-notice.ts",
    "src/modules/whatsapp/data/fee-statement-notice.ts",
    "src/modules/whatsapp/data/school-notice-sender.ts",
    "src/app/(app)/fees/reminders/actions.ts",
    "src/app/(app)/fees/reminders/runs/[runId]/actions.ts",
    "src/modules/collection/data/message-provider.ts",
  ])("%s states a gate and a vppsone source", (path) => {
    const source = read(path);
    expect(source).toContain("sendAisensyCampaignMessage(");
    expect(source).toMatch(/gate[:\s]/);
    expect(source).toMatch(/source: "vppsone\//);
    expect(source).not.toContain("veerpatta-fees-app/");
  });

  it("names AiSensy's endpoint only in the choke point and the two STAFF transports", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry) ? [full] : [];
      });
    const naming = walk(join(process.cwd(), "src"))
      .filter((file) => readFileSync(file, "utf8").includes("backend.aisensy.com"))
      .map((file) => file.slice(process.cwd().length + 1).replace(/\\/g, "/"))
      .sort();
    expect(naming).toEqual([
      // Teacher-task links: a message to staff about their own work (Phase F).
      "src/modules/collection/data/message-provider.ts",
      // Staff notices (Phase F gates these to the allowlist too).
      "src/modules/staff-notices/data/dispatcher.ts",
      "src/modules/whatsapp/data/aisensy.ts",
    ]);
    // And the one in message-provider is never reached by a parent message.
    const provider = read("src/modules/collection/data/message-provider.ts");
    expect(provider.indexOf('if (send.audience === "parent" && !send.taskId) return sendParentThroughGate')).toBeGreaterThan(-1);
    expect(provider.indexOf("sendParentThroughGate(send, context)")).toBeLessThan(provider.indexOf("backend.aisensy.com"));
  });

  it("the receipt resend no longer skips every switch: it passes the gate like the rest", () => {
    expect(read("src/modules/whatsapp/data/receipt-notice.ts")).toContain('kind: "receipt"');
  });

  it("the native parent path sends an absence as the native owner", () => {
    const provider = read("src/modules/collection/data/message-provider.ts");
    expect(provider).toContain('absentPath: "native"');
    expect(read("src/modules/whatsapp/data/school-notice-sender.ts")).toContain('absentPath: "fees_notice"');
  });
});

describe("the migration behind the gate", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261031040453_parent_send_gate.sql"), "utf8");

  it("adds both switches with fail-closed defaults and the allowlist table", () => {
    expect(sql).toContain("'parent_dispatch_categories', true, '[]'::jsonb");
    expect(sql).toContain("'absent_notice_owner', true, '\"fees_notice\"'::jsonb");
    expect(sql).toContain("create table if not exists vppsone.message_test_recipients");
    // No number is ever seeded (rule 6).
    expect(sql).not.toMatch(/insert into vppsone\.message_test_recipients/i);
  });

  it("keeps the allowlist away from the browser and gives the service role what the gate reads", () => {
    expect(sql).toContain("revoke all on vppsone.message_test_recipients from public, anon, authenticated;");
    expect(sql).toContain("grant select, insert, update, delete on vppsone.message_test_recipients to service_role;");
  });
});
