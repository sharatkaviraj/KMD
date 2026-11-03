import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The staff-alert WhatsApp switch (`online_payment_staff_whatsapp_enabled`) is
 * flipped on the online-payments screen like the other seven (go-live Phase F;
 * review of PR #148): only with `settings:write`, never by a test account
 * (the switch is school-wide), and audited. Against a fake client.
 */

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}

const gate = vi.hoisted(() => ({ settingsWrite: true, testAccount: false }));
const writes: Array<{ table: string; op: string; row?: unknown }> = [];

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/platform/auth/current-staff", () => ({
  assertPermission: async () => ({ id: "staff-1", role: "admin", isTestAccount: gate.testAccount }),
}));
vi.mock("@/modules/fees/platform/session", () => ({
  requireStaffPermission: async () => {
    if (!gate.settingsWrite) throw new Error("forbidden");
    return { id: "staff-1" };
  },
}));
vi.mock("@/platform/auth/test-session-access", () => ({
  assertNotTestAccount: async () => {
    if (gate.testAccount) throw new Error("test account");
  },
  assertStudentsVisible: async () => undefined,
  passesFence: async (check: () => Promise<void>) => check().then(
    () => true,
    () => false,
  ),
}));
vi.mock("@/modules/payments/data/online/after-posting", () => ({ afterOnlinePosting: vi.fn() }));
vi.mock("@/modules/payments/data/online/service", () => ({ applyCapture: vi.fn() }));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      return {
        upsert: (row: unknown) => {
          writes.push({ table, op: "upsert", row });
          return Promise.resolve({ data: null, error: null });
        },
        insert: (row: unknown) => {
          writes.push({ table, op: "insert", row });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  }),
}));

import { setOnlineSwitchAction } from "@/app/(app)/fees/payments/online/actions";

const KEY = "online_payment_staff_whatsapp_enabled";

async function redirectOf(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Redirect) return error.to;
    throw error;
  }
  throw new Error("expected a redirect");
}

const form = (value: string) => {
  const data = new FormData();
  data.set("key", KEY);
  data.set("value", value);
  return data;
};

beforeEach(() => {
  writes.length = 0;
  gate.settingsWrite = true;
  gate.testAccount = false;
});

describe("the staff-alert WhatsApp switch", () => {
  it("a real admin turns it on, and the change is audited", async () => {
    expect(await redirectOf(() => setOnlineSwitchAction(form("true")))).toBe("/fees/payments/online?notice=switched");
    expect(writes[0]).toMatchObject({ table: "app_settings", op: "upsert", row: expect.objectContaining({ key: KEY, value: "true" }) });
    expect(writes[1]).toMatchObject({ table: "online_payment_audit", op: "insert", row: expect.objectContaining({ detail: { key: KEY, value: "true" } }) });
  });

  it("needs settings:write", async () => {
    gate.settingsWrite = false;
    await expect(setOnlineSwitchAction(form("true"))).rejects.toThrow("forbidden");
    expect(writes).toHaveLength(0);
  });

  it("a test account never flips it: the switch is school-wide", async () => {
    gate.testAccount = true;
    expect(await redirectOf(() => setOnlineSwitchAction(form("true")))).toBe("/fees/payments/online?notice=not_switched");
    expect(writes).toHaveLength(0);
  });
});
