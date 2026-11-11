import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DEFAULT_HUB_URL, hubWebhookSecrets, readWhatsAppConfig, webhookSecrets, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { describeError, isRetryableCode } from "@/platform/whatsapp/errors";
import { FEES_AISENSY_NUMBER, maskNumber, SCHOOL_WHATSAPP_NUMBER } from "@/platform/whatsapp/numbers";
import { acceptedMessageId, cleanParam, graphError, templateMessageBody, textMessageBody } from "@/platform/whatsapp/payload";
import { checkWhatsAppSend, FEES_APP_FEATURES, switchesFromFlags, type PolicyInput, type TemplateRow, type WhatsAppSwitches } from "@/platform/whatsapp/policy";
import { parseWebhook, verifySignature } from "@/platform/whatsapp/webhook";

/**
 * The school's own WhatsApp (D-562, D-566), the pure half: which server, may this
 * message go, the exact JSON, the plain words for Meta's codes, and the
 * webhook. Every number here is a test value (rule 6) except the school's own
 * number and the fees app's AiSensy number, which are the point.
 */

const OWNER = "+919000000001";
const PARENT = "+919000000002";
const SERVER = { WHATSAPP_HUB_URL: "https://hub.example.test/v1/", WHATSAPP_HUB_KEY: "k", WHATSAPP_SENDER_NUMBER: "+91 83022 07823" };

describe("which server this deployment talks to", () => {
  it("is not configured with nothing set, and says what is missing", () => {
    expect(readWhatsAppConfig({})).toMatchObject({ ok: false, code: "not_configured", provider: null });
  });

  it("reads the school's hub, trimming a trailing slash and a pasted /v1", () => {
    expect(readWhatsAppConfig(SERVER)).toEqual({ ok: true, provider: "hub", hubUrl: "https://hub.example.test", hubKey: "k", senderNumber: SCHOOL_WHATSAPP_NUMBER });
  });

  it("needs only the hub's key: the address defaults, and the hub sends from the school's number only", () => {
    expect(readWhatsAppConfig({ WHATSAPP_HUB_KEY: "k" })).toEqual({ ok: true, provider: "hub", hubUrl: DEFAULT_HUB_URL, hubKey: "k", senderNumber: SCHOOL_WHATSAPP_NUMBER });
    expect(DEFAULT_HUB_URL).toMatch(/^https:\/\//);
    expect(readWhatsAppConfig({ WHATSAPP_HUB_URL: "https://hub.example.test" })).toMatchObject({ ok: false, code: "not_configured", provider: "hub" });
    expect(readWhatsAppConfig({ WHATSAPP_PROVIDER: "school_server", WHATSAPP_HUB_KEY: "k" })).toMatchObject({ ok: false, code: "not_configured" });
  });

  it("reads Meta's Cloud API, with the default Graph version", () => {
    const config = readWhatsAppConfig({ WHATSAPP_PHONE_NUMBER_ID: "123456789012345", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_SENDER_NUMBER: "8302207823" });
    expect(config).toMatchObject({ ok: true, provider: "meta_cloud", phoneNumberId: "123456789012345", graphVersion: "v21.0" });
  });

  it("refuses the fees app's AiSensy number as the sender, whatever else is set", () => {
    expect(readWhatsAppConfig({ ...SERVER, WHATSAPP_SENDER_NUMBER: "+91 80 4713 6289" })).toMatchObject({ ok: false, code: "fees_number" });
    expect(FEES_AISENSY_NUMBER).toBe("+918047136289");
  });

  it("refuses any sender but the school's number, and a missing one", () => {
    expect(readWhatsAppConfig({ ...SERVER, WHATSAPP_SENDER_NUMBER: "+919000000009" })).toMatchObject({ ok: false, code: "sender_wrong" });
    const direct = { WHATSAPP_PHONE_NUMBER_ID: "123456789012345", WHATSAPP_ACCESS_TOKEN: "t" };
    expect(readWhatsAppConfig({ ...direct, WHATSAPP_SENDER_NUMBER: "" })).toMatchObject({ ok: false, code: "sender_missing" });
    expect(readWhatsAppConfig({ ...SERVER, WHATSAPP_SENDER_NUMBER: "" })).toMatchObject({ ok: true, provider: "hub" });
  });

  it("refuses a key over plain http, and the mock on a live deployment", () => {
    expect(readWhatsAppConfig({ ...SERVER, WHATSAPP_HUB_URL: "http://hub.example.test" })).toMatchObject({ ok: false, code: "bad_url" });
    expect(readWhatsAppConfig({ ...SERVER, WHATSAPP_HUB_URL: "http://localhost:8787" })).toMatchObject({ ok: true });
    expect(readWhatsAppConfig({ ...SERVER, WHATSAPP_HUB_URL: "http://localhost:8787", VERCEL_ENV: "production" })).toMatchObject({ ok: false, code: "bad_url" });
    expect(readWhatsAppConfig({ WHATSAPP_PROVIDER: "mock", VERCEL_ENV: "production" })).toMatchObject({ ok: false, code: "mock_on_live" });
    expect(readWhatsAppConfig({ WHATSAPP_PROVIDER: "mock" })).toMatchObject({ ok: true, provider: "mock" });
  });

  it("refuses a phone number where Meta's number ID belongs", () => {
    expect(readWhatsAppConfig({ WHATSAPP_PHONE_NUMBER_ID: "+91 83022 07823", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_SENDER_NUMBER: "8302207823" })).toMatchObject({ ok: false });
  });

  it("signs Meta's webhook with the app secret, and the hub's with One's own hub key", () => {
    expect(webhookSecrets({ WHATSAPP_APP_SECRET: "a", WHATSAPP_HUB_KEY: "b" })).toEqual(["a"]);
    expect(webhookSecrets({})).toEqual([]);
    expect(hubWebhookSecrets({ WHATSAPP_APP_SECRET: "a", WHATSAPP_HUB_KEY: " b " })).toEqual(["b"]);
    expect(hubWebhookSecrets({})).toEqual([]);
  });
});

describe("may this message go", () => {
  const config = readWhatsAppConfig(SERVER) as WhatsAppConfig;
  // These cases are about the other checks, so the fee messages are One's here.
  const switches: WhatsAppSwitches = { dryRun: false, features: { fee_reminder: true }, realRecipients: false, ownerTestNumber: OWNER, dailyLimit: 250, feeSender: "one" };
  const row: TemplateRow = { key: "vpps_app_fee_due_hi_v7", provider_name: "vpps_app_fee_due_hi_v7", language_code: "hi", feature: "fee_reminder", body_params: 5, header: "none", url_button: true, status: "approved" };
  const input = (over: Partial<PolicyInput> & Record<string, unknown> = {}): PolicyInput =>
    ({ feature: "fee_reminder", to: OWNER, switches, config, kind: "template", template: row, language: null, bodyParamCount: 5, hasDocument: false, hasUrlButton: true, ...over }) as PolicyInput;

  it("sends to the owner's own number with everything right", () => {
    expect(checkWhatsAppSend(input())).toEqual({ decision: "send", to: OWNER });
  });

  it("never messages a parent while real recipients are off", () => {
    expect(checkWhatsAppSend(input({ to: PARENT }))).toMatchObject({ decision: "refuse", code: "not_owner_test_number" });
    expect(checkWhatsAppSend(input({ to: PARENT, switches: { ...switches, ownerTestNumber: null } }))).toMatchObject({ code: "not_owner_test_number" });
    expect(checkWhatsAppSend(input({ to: PARENT, switches: { ...switches, realRecipients: true } }))).toMatchObject({ decision: "send" });
  });

  it("never messages the fees app's AiSensy number or the school's own", () => {
    expect(checkWhatsAppSend(input({ to: FEES_AISENSY_NUMBER, switches: { ...switches, realRecipients: true } }))).toMatchObject({ code: "fees_number" });
    expect(checkWhatsAppSend(input({ to: SCHOOL_WHATSAPP_NUMBER, switches: { ...switches, realRecipients: true } }))).toMatchObject({ code: "own_number" });
  });

  it("fails closed on unread switches, a feature switched off, and an unapproved template", () => {
    expect(checkWhatsAppSend(input({ switches: null }))).toMatchObject({ code: "read_failed" });
    expect(checkWhatsAppSend(input({ switches: { ...switches, features: {} } }))).toMatchObject({ code: "feature_off" });
    expect(checkWhatsAppSend(input({ template: null }))).toMatchObject({ code: "template_not_approved" });
    expect(checkWhatsAppSend(input({ template: { ...row, status: "pending" } }))).toMatchObject({ code: "template_not_approved" });
  });

  it("refuses a message that does not fit its template", () => {
    expect(checkWhatsAppSend(input({ bodyParamCount: 6 }))).toMatchObject({ code: "template_mismatch" });
    expect(checkWhatsAppSend(input({ hasUrlButton: false }))).toMatchObject({ code: "template_mismatch" });
    expect(checkWhatsAppSend(input({ hasDocument: true }))).toMatchObject({ code: "template_mismatch" });
    expect(checkWhatsAppSend(input({ language: "en" }))).toMatchObject({ code: "template_mismatch" });
    expect(checkWhatsAppSend(input({ template: { ...row, key: "vpps_app_fee_due_hi_v6" } }))).toMatchObject({ code: "template_mismatch" });
  });

  it("practice mode logs and sends nothing; an unconnected deployment refuses", () => {
    expect(checkWhatsAppSend(input({ switches: { ...switches, dryRun: true } }))).toEqual({ decision: "dry_run", to: OWNER });
    expect(checkWhatsAppSend(input({ config: readWhatsAppConfig({}) }))).toMatchObject({ code: "not_configured" });
  });

  it("a typed message goes only inside the 24 hours after the person wrote", () => {
    const text = (wrote: boolean | null) => ({ feature: "fee_reminder", to: OWNER, switches, config, kind: "text", wroteInLast24h: wrote }) as PolicyInput;
    expect(checkWhatsAppSend(text(true))).toMatchObject({ decision: "send" });
    expect(checkWhatsAppSend(text(false))).toMatchObject({ code: "outside_24h" });
    expect(checkWhatsAppSend(text(null))).toMatchObject({ code: "outside_24h" });
  });

  it("leaves the Fees app's messages to the Fees app unless the owner moved them to One", () => {
    // 11 Nov 2026: the Fees app sends fee reminders, receipts, reversals and statements from its own number.
    for (const feeSender of [undefined, "fees" as const]) {
      for (const feature of ["fee_reminder", "receipt", "reversal", "fee_statement"] as const) {
        const verdict = checkWhatsAppSend(input({ feature, switches: { ...switches, feeSender, features: { [feature]: true } } }));
        expect(verdict).toMatchObject({ decision: "refuse", code: "fees_app_sends" });
      }
    }
    // The school's own messages are One's whatever the row says.
    const notice = { ...row, feature: "school_notice" };
    expect(
      checkWhatsAppSend(input({ feature: "school_notice", template: notice, switches: { ...switches, feeSender: "fees", features: { school_notice: true } } })),
    ).toEqual({ decision: "send", to: OWNER });
    expect(FEES_APP_FEATURES.has("collection_request")).toBe(false);
  });

  it("reads the switches from runtime_flags, practice mode on unless it says off", () => {
    const rows = [
      { key: "whatsapp_dry_run", enabled: null, value: null },
      { key: "whatsapp_features", enabled: true, value: { receipt: true, fee_reminder: "yes" } },
      { key: "whatsapp_real_recipients", enabled: false, value: null },
      { key: "whatsapp_owner_test_number", enabled: true, value: OWNER },
      { key: "whatsapp_daily_limit", enabled: true, value: 250 },
    ];
    expect(switchesFromFlags(rows)).toMatchObject({ dryRun: true, realRecipients: false, ownerTestNumber: OWNER, dailyLimit: 250, features: { receipt: true, fee_reminder: false } });
    expect(switchesFromFlags(rows.slice(1))).toBeNull();
    // Who sends fee messages: the Fees app unless the row says "one" in so many words.
    expect(switchesFromFlags(rows)!.feeSender).toBe("fees");
    expect(switchesFromFlags([...rows, { key: "whatsapp_fee_sender", enabled: true, value: "fees" }])!.feeSender).toBe("fees");
    expect(switchesFromFlags([...rows, { key: "whatsapp_fee_sender", enabled: false, value: "one" }])!.feeSender).toBe("fees");
    expect(switchesFromFlags([...rows, { key: "whatsapp_fee_sender", enabled: true, value: "one" }])!.feeSender).toBe("one");
    expect(switchesFromFlags(rows.map((r) => (r.key === "whatsapp_features" ? { ...r, enabled: false } : r)))!.features.receipt).toBe(false);
  });
});

describe("the message, in Meta's Cloud API format", () => {
  it("names the template with its language, and keeps header, body and button apart", () => {
    expect(
      templateMessageBody({ to: OWNER, name: "vpps_receipt_hi_v1", languageCode: "hi", bodyParams: ["Rs. 500", "line\nbreak"], document: { url: "https://example.test/r.pdf", filename: "Receipt.pdf" }, urlButtonSuffix: "pc_1" }),
    ).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919000000001",
      type: "template",
      template: {
        name: "vpps_receipt_hi_v1",
        language: { code: "hi" },
        components: [
          { type: "header", parameters: [{ type: "document", document: { link: "https://example.test/r.pdf", filename: "Receipt.pdf" } }] },
          { type: "body", parameters: [{ type: "text", text: "Rs. 500" }, { type: "text", text: "line break" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "pc_1" }] },
        ],
      },
    });
  });

  it("makes a value acceptable to Meta without changing what it says", () => {
    expect(cleanParam("a\tb\r\nc")).toBe("a b c");
    expect(cleanParam("a" + " ".repeat(9) + "b")).toBe("a    b");
    expect(cleanParam("  ")).toBe("-");
    expect(cleanParam(null)).toBe("-");
  });

  it("a typed message, cut at WhatsApp's length", () => {
    expect(textMessageBody(OWNER, "x".repeat(5000))).toMatchObject({ type: "text", to: "919000000001", text: { preview_url: false } });
    expect((textMessageBody(OWNER, "x".repeat(5000)) as { text: { body: string } }).text.body).toHaveLength(4096);
  });

  it("reads Meta's answer: the message id, or the error", () => {
    expect(acceptedMessageId({ messages: [{ id: " wamid.1 " }] })).toBe("wamid.1");
    expect(acceptedMessageId({ messages: [] })).toBeNull();
    expect(acceptedMessageId({ status: "ok" })).toBeNull();
    expect(graphError({ error: { code: 131026, message: "Receiver is incapable", error_data: { details: "not on WhatsApp" } } })).toEqual({ code: "131026", hubCode: null, title: "Receiver is incapable", detail: "not on WhatsApp" });
    expect(graphError({ error: { message: "Only the owner's test number while the hub is in test mode", type: "VppsHubError", code: "test_mode", hub_code: "test_mode" } })).toMatchObject({ code: "test_mode", hubCode: "test_mode" });
    expect(graphError({ error: { message: "x", hub_code: "Not A Code!" } })).toMatchObject({ hubCode: null });
  });
});

describe("why a message did not go, in plain words", () => {
  it("names a number that is not on WhatsApp, and does not retry it", () => {
    const plain = describeError("131026");
    expect(plain.text.en).toMatch(/not on WhatsApp/);
    expect(plain.text.hi).toBeTruthy();
    expect(plain.retryable).toBe(false);
    expect(plain.next).toBe("call_parent");
  });

  it("retries only what can work again unchanged", () => {
    expect(isRetryableCode("130429")).toBe(true);
    expect(isRetryableCode(131000)).toBe(true);
    expect(isRetryableCode("132001")).toBe(false);
    expect(isRetryableCode(null)).toBe(false);
  });

  it("keeps an unknown reason readable", () => {
    expect(describeError(null, "Something new").text.en).toBe("WhatsApp did not take this message: Something new");
    expect(describeError("999999").text.en).toBe("WhatsApp did not take this message.");
  });
});

describe("the webhook", () => {
  const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

  it("accepts only an HMAC of the exact bytes, under any configured secret", () => {
    const body = JSON.stringify({ entry: [] });
    expect(verifySignature(body, sign(body, "s2"), ["s1", "s2"])).toBe(true);
    expect(verifySignature(body + " ", sign(body, "s2"), ["s1", "s2"])).toBe(false);
    expect(verifySignature(body, sign(body, "other"), ["s1"])).toBe(false);
    expect(verifySignature(body, sign(body, "s1"), [])).toBe(false);
    expect(verifySignature(body, null, ["s1"])).toBe(false);
    expect(verifySignature(body, "sha256=abc", ["s1"])).toBe(false);
  });

  const change = (display: string, value: Record<string, unknown>) => ({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: display, phone_number_id: "123" }, ...value } }] }],
  });

  it("reads statuses with Meta's error code, and parents' replies with what they answer", () => {
    const parsed = parseWebhook(
      change("918302207823", {
        statuses: [
          { id: "wamid.a", status: "delivered", timestamp: "1762650000", recipient_id: "919000000002" },
          { id: "wamid.b", status: "failed", timestamp: "1762650001", errors: [{ code: 131026, title: "Receiver is incapable", error_data: { details: "x" } }] },
          { id: "wamid.c", status: "deleted" },
        ],
        contacts: [{ wa_id: "919000000002", profile: { name: "Test Parent" } }],
        messages: [{ id: "wamid.in", from: "919000000002", timestamp: "1762650002", type: "button", button: { text: "Paid" }, context: { id: "wamid.a" } }],
      }),
    );
    expect(parsed.otherNumber).toBe(0);
    expect(parsed.statuses.map((s) => [s.providerMessageId, s.status, s.errorCode])).toEqual([
      ["wamid.a", "delivered", null],
      ["wamid.b", "failed", "131026"],
    ]);
    expect(parsed.statuses[0]!.recipient).toBe(PARENT);
    expect(parsed.inbound).toEqual([expect.objectContaining({ providerMessageId: "wamid.in", from: PARENT, fromName: "Test Parent", type: "button", text: "Paid", replyTo: "wamid.a" })]);
  });

  it("leaves another number's change unread — the fees app's above all", () => {
    const parsed = parseWebhook(change("918047136289", { statuses: [{ id: "wamid.x", status: "read" }] }));
    expect(parsed.statuses).toEqual([]);
    expect(parsed.otherNumber).toBe(1);
  });

  it("survives a payload of the wrong shape", () => {
    expect(parseWebhook(null)).toEqual({ numbers: [], statuses: [], inbound: [], templates: [], otherNumber: 0 });
    expect(parseWebhook({ entry: "nope" }).statuses).toEqual([]);
  });
});

describe("numbers on a screen", () => {
  it("are masked, the school's included", () => {
    expect(maskNumber(PARENT)).not.toContain("9000000002");
    expect(maskNumber(null)).toBeTruthy();
  });
});
