import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A template sent with quick replies (D-615): each button carries its own
 * payload, and the message goes now, tried once, because the queue and
 * Retry rebuild a message from its log row without the payloads.
 */

vi.mock("server-only", () => ({}));

const OWNER = "+919999900001";

const state = vi.hoisted(() => ({
  bodies: [] as Array<Record<string, unknown>>,
  claims: [] as Array<{ log: Record<string, unknown>; status: string }>,
}));

vi.mock("@/platform/whatsapp/config", () => ({
  readWhatsAppConfig: () => ({ ok: true, provider: "hub", hubUrl: "https://hub.test", hubKey: "test-key" }),
}));
vi.mock("@/platform/whatsapp/providers", () => ({
  providerFor: () => ({
    name: "hub",
    send: async (body: Record<string, unknown>) => {
      state.bodies.push(body);
      return { outcome: "accepted", messageId: "wamid.1", httpStatus: 200 };
    },
  }),
}));
vi.mock("@/platform/whatsapp/store", () => ({
  whatsappDb: vi.fn(),
  claimSend: async (log: Record<string, unknown>, status: string) => {
    state.claims.push({ log, status });
    return { ok: true, id: "log-1", status };
  },
  readMessage: vi.fn(),
  readSwitches: async () => ({ dryRun: false, features: { report_delivery: true }, realRecipients: false, ownerTestNumber: OWNER, dailyLimit: 50 }),
  readTemplateRow: async (key: string) => ({
    key,
    provider_name: key,
    language_code: "en",
    feature: "report_delivery",
    body_params: 3,
    header: "none",
    url_button: false,
    status: "approved",
    category: "utility",
  }),
  recordAttempt: async () => undefined,
  recordStatus: vi.fn(),
  takeDue: vi.fn(),
  takePollable: vi.fn(),
  wroteWithin24h: vi.fn(),
}));

import { sendTemplate } from "@/platform/whatsapp/service";

beforeEach(() => {
  state.bodies = [];
  state.claims = [];
});

describe("a template with quick replies (D-615)", () => {
  it("carries each button's payload, in order", async () => {
    const sent = await sendTemplate(OWNER, "vpps_parent_report_card_en_v1", "en", ["Aarav Test", "Class 6", "Half Yearly"], {
      feature: "report_delivery",
      quickReplies: ["vpai:report_card:abc1234"],
    });
    expect(sent.outcome).toBe("accepted");
    const template = state.bodies[0]!.template as { components: Array<Record<string, unknown>> };
    expect(template.components).toContainEqual({ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "vpai:report_card:abc1234" }] });
    // No link button is filled for it, and the log keeps no link button either.
    expect(template.components.some((component) => component.sub_type === "url")).toBe(false);
    expect(state.claims[0]!.log.button_params).toEqual([]);
  });

  it("goes now and is tried once, even when asked to queue", async () => {
    await sendTemplate(OWNER, "vpps_parent_report_card_en_v1", "en", ["Aarav Test", "Class 6", "Half Yearly"], {
      feature: "report_delivery",
      quickReplies: ["vpai:report_card:abc1234"],
      delivery: "queue",
      maxAttempts: 4,
    });
    expect(state.claims[0]!.status).toBe("sending");
    expect(state.claims[0]!.log.max_attempts).toBe(1);
    expect(state.bodies).toHaveLength(1);
  });

  it("leaves a message without quick replies as it was asked", async () => {
    await sendTemplate(OWNER, "vpps_parent_report_card_en_v1", "en", ["Aarav Test", "Class 6", "Half Yearly"], {
      feature: "report_delivery",
      delivery: "queue",
      maxAttempts: 4,
    });
    expect(state.claims[0]!.status).toBe("queued");
    expect(state.claims[0]!.log.max_attempts).toBe(4);
    expect(state.bodies).toHaveLength(0);
  });
});
