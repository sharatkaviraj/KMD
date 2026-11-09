import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VPPS One and the school's WhatsApp hub (D-566), against a fake hub.
 *
 * The hub (veerpatta/vpps-whatsapp-hub) owns +91 83022 07823 on Meta's Cloud
 * API and takes Meta's own message JSON at `POST /v1/messages`; it lists and
 * takes templates at `GET/POST /v1/templates`, answers `GET /v1/status/{wamid}`
 * and forwards Meta's webhook, signed with One's own key. Nothing here talks
 * to the real hub: `fetch` is the fake, and every number is a test value
 * (rule 6) except the school's own.
 */

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  recordStatus: vi.fn(async () => ({ matched: true, changed: true, id: "m1", previous: "accepted", source_table: null, source_id: null })),
  storeInbound: vi.fn(async () => true),
  applyTemplateEvents: vi.fn(async () => ({ written: 0, needsSync: false })),
  syncHubTemplates: vi.fn(async () => ({ ok: true as const, checked: 0, approved: 0, missing: 0 })),
  syncDeliveryToSource: vi.fn(async () => undefined),
}));

vi.mock("@/platform/whatsapp/store", () => ({ recordStatus: store.recordStatus, storeInbound: store.storeInbound }));
vi.mock("@/platform/whatsapp/service", () => ({ applyTemplateEvents: store.applyTemplateEvents }));
vi.mock("@/modules/whatsapp/data/hub-templates", () => ({ syncHubTemplates: store.syncHubTemplates }));
vi.mock("@/modules/whatsapp/data/whatsapp-source-sync", () => ({ syncDeliveryToSource: store.syncDeliveryToSource }));
vi.mock("@/platform/env", () => ({ getSiteUrl: () => "https://one.vpps.co.in" }));
vi.mock("@/platform/observability/log", () => ({ logWarn: vi.fn() }));

import { POST as hubWebhook } from "@/app/api/webhooks/whatsapp-hub/route";
import { APPROVED_HUB, V7_SITUATIONS, V8_SITUATIONS, activeCampaignName, v7CampaignName, v8CampaignName } from "@/modules/whatsapp/domain/campaign-generation";
import { V7_CAMPAIGNS, V8_CAMPAIGNS } from "@/modules/whatsapp/domain/campaign-bodies-v6";
import { classifyFailure } from "@/modules/whatsapp/domain/failure-cause";
import { HUB_TEMPLATE_SUBMISSIONS, hubExpectedBodies } from "@/modules/whatsapp/domain/hub-templates";
import { readWhatsAppConfig, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { describeError } from "@/platform/whatsapp/errors";
import { HUB_CODES, providerFor, readHubStatus, refusalCode } from "@/platform/whatsapp/providers";
import { parseWebhook } from "@/platform/whatsapp/webhook";

const HUB = "https://hub.example.test";
const KEY = "one-test-key-not-real";
const OWNER = "919000000001";

type Call = { url: string; method: string; auth: string | null; body: unknown };
let calls: Call[] = [];

/** A fake hub: each test says what it answers, and every request is kept. */
function fakeHub(answer: (call: Call) => { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const call: Call = {
        url: String(input),
        method: init?.method ?? "GET",
        auth: headers.get("authorization"),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      };
      calls.push(call);
      const { status, body } = answer(call);
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
}

const hub = () => providerFor(readWhatsAppConfig({ WHATSAPP_HUB_URL: HUB, WHATSAPP_HUB_KEY: KEY }) as Extract<WhatsAppConfig, { ok: true }>);
const TEMPLATE = { messaging_product: "whatsapp", to: OWNER, type: "template", template: { name: "vpps_app_fee_due_hi_v8", language: { code: "hi" } } };
const hubError = (hubCode: string | null, code: string | number, message = "Refused") => ({ error: { message, type: "VppsHubError", code, hub_code: hubCode } });

beforeEach(() => {
  calls = [];
  for (const fn of Object.values(store)) fn.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sending through the hub", () => {
  it("posts Meta's JSON to /v1/messages with One's key, and keeps Meta's message id", async () => {
    fakeHub(() => ({ status: 200, body: { messaging_product: "whatsapp", contacts: [{ wa_id: OWNER }], messages: [{ id: "wamid.HBg1" }] } }));
    const answer = await hub().send(TEMPLATE);
    expect(answer).toEqual({ outcome: "accepted", messageId: "wamid.HBg1", httpStatus: 200 });
    expect(calls).toEqual([{ url: `${HUB}/v1/messages`, method: "POST", auth: `Bearer ${KEY}`, body: TEMPLATE }]);
  });

  it.each([
    [403, "sending_off"],
    [403, "test_mode"],
    [409, "window_closed"],
    [409, "opted_out"],
    [400, "not_approved"],
    [400, "bad_number"],
  ])("files a %s %s under the hub's own reason: nothing went", async (status, hubCode) => {
    fakeHub(() => ({ status, body: hubError(hubCode, hubCode) }));
    expect(await hub().send(TEMPLATE)).toMatchObject({ outcome: "rejected", httpStatus: status, errorCode: hubCode });
  });

  it("knows every hub refusal by name, in plain words, Hindi and English", () => {
    for (const code of HUB_CODES) {
      const plain = describeError(code);
      expect(plain.text.en, code).not.toBe("WhatsApp did not take this message.");
      expect(plain.text.hi, code).toBeTruthy();
      expect(plain.retryable, code).toBe(false);
    }
  });

  it("takes the hub's 502 with Meta's own code as Meta's definite no", async () => {
    fakeHub(() => ({ status: 502, body: hubError(null, 131026, "Receiver is incapable") }));
    expect(await hub().send(TEMPLATE)).toMatchObject({ outcome: "rejected", httpStatus: 502, errorCode: "131026", errorTitle: "Receiver is incapable" });
  });

  it("treats any other 5xx, a lost answer and an answer without an id as unknown: it may have gone", async () => {
    fakeHub(() => ({ status: 502, body: "Bad gateway" }));
    expect(await hub().send(TEMPLATE)).toMatchObject({ outcome: "unknown", errorCode: "server_error" });
    fakeHub(() => ({ status: 200, body: { ok: true } }));
    expect(await hub().send(TEMPLATE)).toMatchObject({ outcome: "unknown", errorCode: "no_receipt" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("socket hang up"))));
    expect(await hub().send(TEMPLATE)).toMatchObject({ outcome: "unknown", errorCode: "network" });
  });

  it("says plainly when the hub refuses One's key", async () => {
    fakeHub(() => ({ status: 401, body: { ok: false, error: "bad_api_key" } }));
    expect(await hub().send(TEMPLATE)).toMatchObject({ outcome: "rejected", errorCode: "bad_api_key" });
    expect(describeError("bad_api_key").text.en).toMatch(/key/i);
    expect(await hub().checkConnection()).toMatchObject({ ok: false, problem: expect.stringMatching(/refused One's key/) });
  });

  it("files a refusal under the hub's reason first, then Meta's number", () => {
    expect(refusalCode(hubError("opted_out", 131050), 409)).toBe("opted_out");
    expect(refusalCode(hubError(null, 131047), 400)).toBe("131047");
    expect(refusalCode({}, 429)).toBe("130429");
    expect(refusalCode(null, 401)).toBe("bad_api_key");
  });

  it("puts the hub's and Meta's codes on the failure desk under the right cause", () => {
    const cause = (code: string) => classifyFailure({ code, httpStatus: 400 });
    expect([cause("opted_out"), cause("131050")]).toEqual(["opted_out", "opted_out"]);
    expect([cause("bad_number"), cause("131026")]).toEqual(["not_on_whatsapp", "not_on_whatsapp"]);
    expect([cause("not_approved"), cause("window_closed"), cause("131047"), cause("132000"), cause("132001")]).toEqual(Array(5).fill("template"));
    expect([cause("sending_off"), cause("test_mode"), cause("bad_api_key")]).toEqual(Array(3).fill("account"));
  });
});

describe("templates on the hub", () => {
  const listed = {
    templates: [
      {
        name: "vpps_app_fee_due_hi_v8",
        language: "hi",
        category: "UTILITY",
        status: "APPROVED",
        quality: "GREEN",
        rejected_reason: "NONE",
        components: [
          { type: "BODY", text: "A {{1}} B {{2}} C {{3}} D {{4}} E {{5}}" },
          { type: "BUTTONS", buttons: [{ type: "URL", text: "Pay now", url: "https://one.vpps.co.in/pay/{{1}}" }, { type: "PHONE_NUMBER", text: "Call office" }] },
        ],
      },
      { name: "vpps_app_fee_due_en_v8", language: "en", category: "UTILITY", status: "REJECTED", rejected_reason: "INVALID_FORMAT", components: [] },
    ],
  };

  it("lists them with One's key: status, category, wording, button and quality", async () => {
    fakeHub(() => ({ status: 200, body: listed }));
    const answer = await hub().listTemplates();
    expect(calls[0]).toMatchObject({ url: `${HUB}/v1/templates`, method: "GET", auth: `Bearer ${KEY}` });
    expect(answer.ok && answer.templates).toEqual([
      expect.objectContaining({ name: "vpps_app_fee_due_hi_v8", status: "APPROVED", category: "utility", bodyParams: 5, buttonUrl: "https://one.vpps.co.in/pay/{{1}}", quality: "GREEN", rejectedReason: null }),
      expect.objectContaining({ name: "vpps_app_fee_due_en_v8", status: "REJECTED", rejectedReason: "INVALID_FORMAT" }),
    ]);
  });

  it("a template list read is the connection check: the hub has no health route", async () => {
    fakeHub(() => ({ status: 200, body: listed }));
    expect(await hub().checkConnection()).toMatchObject({ ok: true, displayNumber: "+918302207823", verifiedName: "Veer Patta School" });
  });

  it("submits one in the hub's format and reads back what Meta said", async () => {
    fakeHub(() => ({ status: 200, body: { ok: true, id: "1234567890", status: "PENDING", category: "UTILITY" } }));
    const submission = HUB_TEMPLATE_SUBMISSIONS[0]!;
    expect(await hub().submitTemplate!(submission)).toEqual({ ok: true, id: "1234567890", status: "PENDING", category: "utility" });
    expect(calls).toEqual([{ url: `${HUB}/v1/templates`, method: "POST", auth: `Bearer ${KEY}`, body: submission }]);
  });

  it("says why a submission was refused", async () => {
    fakeHub(() => ({ status: 400, body: hubError(null, 100, "Template name already exists") }));
    expect(await hub().submitTemplate!(HUB_TEMPLATE_SUBMISSIONS[0]!)).toEqual({ ok: false, code: "100", problem: "Template name already exists" });
  });

  it("keeps the hub's own words when it refuses in its short form, not just the HTTP number", async () => {
    fakeHub(() => ({ status: 400, body: { ok: false, error: "template already exists" } }));
    const answer = await hub().submitTemplate!(HUB_TEMPLATE_SUBMISSIONS[0]!);
    expect(answer).toMatchObject({ ok: false, problem: "template already exists" });
    fakeHub(() => ({ status: 400, body: "" }));
    expect(await hub().submitTemplate!(HUB_TEMPLATE_SUBMISSIONS[0]!)).toMatchObject({ ok: false, problem: "The hub answered 400." });
  });
});

describe("the _v8 set", () => {
  it("is the _v7 set word for word, under new names, one per situation and language", () => {
    expect(V8_SITUATIONS).toEqual(V7_SITUATIONS);
    expect(V8_CAMPAIGNS).toHaveLength(V7_CAMPAIGNS.length);
    expect(V8_CAMPAIGNS).toHaveLength(22);
    for (const [index, v8] of V8_CAMPAIGNS.entries()) {
      const v7 = V7_CAMPAIGNS[index]!;
      expect(v8.campaignName).toBe(v7.campaignName.replace(/_v7$/, "_v8"));
      expect(v8.campaignName).toBe(v8CampaignName(v8.situation, v8.language));
      expect(v8.body).toBe(v7.body);
      expect(v8.metaSamples).toEqual(v7.metaSamples);
      expect(v8.buttons).toEqual(v7.buttons);
    }
  });

  it("goes to the hub as UTILITY, with five samples, no footer, and Pay now then Call office", () => {
    expect(HUB_TEMPLATE_SUBMISSIONS).toHaveLength(22);
    expect(new Set(HUB_TEMPLATE_SUBMISSIONS.map((submission) => `${submission.name}:${submission.language}`)).size).toBe(22);
    for (const submission of HUB_TEMPLATE_SUBMISSIONS) {
      expect(submission.name).toMatch(/^vpps_app_[a-z_]+_(hi|en)_v8$/);
      expect(submission.category).toBe("UTILITY");
      expect(submission.examples).toHaveLength(5);
      expect(submission.footer).toBeUndefined();
      expect(submission.buttons.map((button) => button.type)).toEqual(["URL", "PHONE_NUMBER"]);
      expect(submission.buttons[0]).toMatchObject({ url: "https://one.vpps.co.in/pay/{{1}}" });
      expect(submission.body).toBe(hubExpectedBodies().get(submission.name));
      // Never the fees app's number, on a button or anywhere else.
      expect(JSON.stringify(submission)).not.toMatch(/8047136289/);
    }
  });

  it("is approved only from the hub's list: APPROVED_HUB starts empty and holds only _v8 names", () => {
    expect(APPROVED_HUB.size).toBe(0);
    for (const name of APPROVED_HUB) expect(name).toMatch(/_v8$/);
    // Until then nothing switches to it: the fee reminders keep their old names.
    expect(activeCampaignName("fee_due", "hi")).not.toMatch(/_v8$/);
    expect(v7CampaignName("fee_due", "hi")).toBe("vpps_app_fee_due_hi_v7");
  });
});

describe("asking the hub where a message is", () => {
  it("reads Meta's real status and error code", async () => {
    fakeHub(() => ({ status: 200, body: { wamid: "wamid.X", status: "failed", error_code: 131049, error_title: "Marketing limit", status_at: "1762650000" } }));
    const answer = await hub().fetchStatus!("wamid.X");
    expect(calls[0]).toMatchObject({ url: `${HUB}/v1/status/wamid.X`, auth: `Bearer ${KEY}` });
    expect(answer).toEqual({ ok: true, status: { wamid: "wamid.X", status: "failed", errorCode: "131049", errorTitle: "Marketing limit", at: new Date(1762650000 * 1000).toISOString() } });
  });

  it("knows a message the hub has never heard of, and an answer it cannot read", async () => {
    fakeHub(() => ({ status: 404, body: { error: { message: "Not found" } } }));
    expect(await hub().fetchStatus!("wamid.Y")).toMatchObject({ ok: false, notFound: true });
    expect(readHubStatus({ status: "deleted" }, "w")).toBeNull();
    expect(readHubStatus({ status: "DELIVERED", status_at: "2026-11-09T08:00:00Z" }, "w")).toMatchObject({ wamid: "w", status: "delivered", at: "2026-11-09T08:00:00.000Z" });
  });

  it("puts the message id into the path safely", async () => {
    fakeHub(() => ({ status: 200, body: { status: "sent" } }));
    await hub().fetchStatus!("wamid.a/../b?c");
    expect(calls[0]!.url).toBe(`${HUB}/v1/status/wamid.a%2F..%2Fb%3Fc`);
  });
});

describe("the hub's webhook", () => {
  const sign = (body: string, key: string) => `sha256=${createHmac("sha256", key).update(body, "utf8").digest("hex")}`;
  const post = (body: string, signature: string | null) =>
    hubWebhook(
      new Request("https://one.vpps.co.in/api/webhooks/whatsapp-hub", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json", "X-Vpps-Hub-App": "one", ...(signature ? { "X-Hub-Signature-256": signature } : {}) },
      }),
    );
  const payload = (field: string, value: Record<string, unknown>) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field, value }] }] });
  const delivered = payload("messages", {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "918302207823", phone_number_id: "1" },
    statuses: [{ id: "wamid.HBg1", status: "delivered", timestamp: "1762650000", recipient_id: OWNER }],
  });

  it("is not there until One's hub key is set", async () => {
    const answer = await post(delivered, sign(delivered, KEY));
    expect(answer.status).toBe(404);
    expect(store.recordStatus).not.toHaveBeenCalled();
  });

  it("reads nothing that is not signed with One's key, over the exact bytes", async () => {
    vi.stubEnv("WHATSAPP_HUB_KEY", KEY);
    expect((await post(delivered, null)).status).toBe(401);
    expect((await post(delivered, sign(delivered, "another-apps-key"))).status).toBe(401);
    expect((await post(`${delivered} `, sign(delivered, KEY))).status).toBe(401);
    expect(store.recordStatus).not.toHaveBeenCalled();
  });

  it("writes a signed delivery onto the log", async () => {
    vi.stubEnv("WHATSAPP_HUB_KEY", KEY);
    const answer = await post(delivered, sign(delivered, KEY));
    expect(answer.status).toBe(200);
    expect(store.recordStatus).toHaveBeenCalledWith(expect.objectContaining({ providerMessageId: "wamid.HBg1", status: "delivered" }));
  });

  it("passes template approvals and category changes to the registry", async () => {
    vi.stubEnv("WHATSAPP_HUB_KEY", KEY);
    const body = payload("message_template_status_update", { event: "REJECTED", message_template_name: "vpps_app_fee_due_en_v8", message_template_language: "en", reason: "INVALID_FORMAT" });
    expect((await post(body, sign(body, KEY))).status).toBe(200);
    expect(store.applyTemplateEvents).toHaveBeenCalledWith([
      { name: "vpps_app_fee_due_en_v8", language: "en", kind: "status", event: "REJECTED", reason: "INVALID_FORMAT", newCategory: null },
    ]);
  });

  it("reads both kinds of template event", () => {
    const status = JSON.parse(payload("message_template_status_update", { event: "approved", message_template_name: "vpps_app_fee_due_hi_v8", message_template_language: "hi", reason: "NONE" }));
    expect(parseWebhook(status).templates).toEqual([{ name: "vpps_app_fee_due_hi_v8", language: "hi", kind: "status", event: "APPROVED", reason: null, newCategory: null }]);
    const category = JSON.parse(payload("template_category_update", { message_template_name: "vpps_app_fee_due_hi_v8", message_template_language: "hi", new_category: "MARKETING" }));
    expect(parseWebhook(category).templates).toEqual([{ name: "vpps_app_fee_due_hi_v8", language: "hi", kind: "category", event: null, reason: null, newCategory: "marketing" }]);
  });
});
