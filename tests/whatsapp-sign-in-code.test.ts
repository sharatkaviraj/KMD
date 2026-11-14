import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const log = vi.hoisted(() => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/platform/observability/log", () => log);
const hub = vi.hoisted(() => ({
  config: { ok: true, provider: "hub", hubUrl: "https://hub.example.test", hubKey: "k", senderNumber: "+918302207823" } as Record<string, unknown>,
  send: vi.fn(),
  templates: new Map<string, { provider_name: string; language_code: string; status: string }>(),
}));
vi.mock("@/platform/whatsapp/config", () => ({ readWhatsAppConfig: () => hub.config }));
vi.mock("@/platform/whatsapp/providers", () => ({ providerFor: () => ({ send: hub.send }) }));
vi.mock("@/platform/whatsapp/store", () => ({
  whatsappDb: vi.fn(() => {
    throw new Error("the tests pass their own database");
  }),
  readTemplateRow: vi.fn(async (key: string) => hub.templates.get(key) ?? null),
}));

import {
  deliverSignInCode,
  readSignInMode,
  requestSignInCode,
  signInClientKey,
  signInCodeHash,
  verifySignInCode,
} from "@/modules/whatsapp/data/sign-in-codes";
import {
  maskSignInPhone,
  newSignInCode,
  requestAnswer,
  signInCodeIn,
  signInPhoneKey,
  signInTemplateLanguage,
  SIGN_IN_TEMPLATE,
  verifyAnswer,
} from "@/modules/whatsapp/domain/sign-in-code";
import { ALL_HUB_SUBMISSIONS, HUB_TEMPLATE_SUBMISSIONS, SIGN_IN_HUB_SUBMISSIONS } from "@/modules/whatsapp/domain/hub-templates";

/**
 * Sign in with a WhatsApp code (D-585). Every number here is made up (rule 6).
 * The SQL half — limits, the one-time check, who matches — is proven on
 * PGlite by tests/sql/staff-sign-in-codes.mjs.
 */

const ROW_ID = "11111111-1111-4111-8111-111111111111";

type Call = { table: string; op: string; args: unknown[] };

/** Just enough of the Supabase client for these functions. */
function fakeDb(rpc: (name: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string } | null }) {
  const calls: Call[] = [];
  const chain = (table: string, op: string, args: unknown[]) => {
    calls.push({ table, op, args });
    const done = Promise.resolve({ data: [], error: null });
    const link: Record<string, unknown> = {
      eq: (...more: unknown[]) => chain(table, `${op}.eq`, more),
      lt: (...more: unknown[]) => chain(table, `${op}.lt`, more),
      select: (...more: unknown[]) => chain(table, `${op}.select`, more),
      maybeSingle: async () => ({ data: { mode: "all_staff" }, error: null }),
      then: done.then.bind(done),
    };
    return link;
  };
  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => rpc(name, args)),
    from: (table: string) => ({
      update: (patch: unknown) => chain(table, "update", [patch]),
      delete: () => chain(table, "delete", []),
      select: (...args: unknown[]) => chain(table, "select", args),
    }),
  };
  return { db: db as never, calls, rpc: db.rpc };
}

beforeEach(() => {
  hub.send.mockReset();
  hub.templates.clear();
  hub.config = { ok: true, provider: "hub", hubUrl: "https://hub.example.test", hubKey: "k", senderNumber: "+918302207823" };
  log.logInfo.mockReset();
  log.logWarn.mockReset();
});

describe("the number and the code", () => {
  it("reads an Indian mobile number however staff type it, and nothing else", () => {
    for (const typed of ["90000 00002", "+91 90000 00002", "090000 00002", "919000000002", "9000000002", " 9000-000-002 "]) {
      expect(signInPhoneKey(typed)).toBe("9000000002");
    }
    for (const typed of ["", "12345", "5000000002", "+44 7700 900000", "0141 222 3333", "90000000021", null, undefined]) {
      expect(signInPhoneKey(typed)).toBeNull();
    }
  });

  it("shows only the last four digits", () => {
    expect(maskSignInPhone("9000000002")).toBe("+91 ••••• •0002");
  });

  it("takes six digits typed, pasted or spaced, and refuses anything else", () => {
    expect(signInCodeIn("123456")).toBe("123456");
    expect(signInCodeIn("123 456")).toBe("123456");
    expect(signInCodeIn("123-456")).toBe("123456");
    expect(signInCodeIn("12345")).toBeNull();
    expect(signInCodeIn("1234567")).toBeNull();
    expect(signInCodeIn("12a456")).toBeNull();
  });

  it("makes a six-digit code from a random source, keeping leading zeros", () => {
    expect(newSignInCode(() => 42)).toBe("000042");
    expect(newSignInCode((max) => max - 1)).toBe("999999");
    const seen = vi.fn((max: number) => 123456 % max);
    newSignInCode(seen);
    expect(seen).toHaveBeenCalledWith(1_000_000);
  });

  it("sends Hindi to a Hindi or both-languages reader and English to an English one", () => {
    expect(signInTemplateLanguage("en")).toBe("en");
    expect(signInTemplateLanguage("hi")).toBe("hi");
    expect(signInTemplateLanguage("both")).toBe("hi");
    expect(signInTemplateLanguage(undefined)).toBe("hi");
  });
});

describe("what the page may say", () => {
  it("says 'sent' whether or not the number is on a record, so nobody can find out whose number is on file", () => {
    for (const outcome of ["send", "no_match", "shared_number", "not_allowed"]) expect(requestAnswer(outcome)).toBe("sent");
    expect(requestAnswer("limited")).toBe("limited");
    expect(requestAnswer("busy")).toBe("busy");
    expect(requestAnswer("off")).toBe("off");
    expect(requestAnswer("bad_number")).toBe("bad_number");
    expect(requestAnswer("something new")).toBe("unavailable");
    expect(requestAnswer(null)).toBe("unavailable");
  });

  it("while codes go to the owner only, tells every other number 'not yet', on a record or not (D-608)", () => {
    for (const outcome of ["no_match", "shared_number", "not_allowed"]) {
      expect(requestAnswer(outcome, "owner_only")).toBe("not_yet");
      expect(requestAnswer(outcome, "all_staff")).toBe("sent");
    }
    expect(requestAnswer("send", "owner_only")).toBe("sent");
    expect(requestAnswer("limited", "owner_only")).toBe("limited");
  });

  it("folds every finished code into one 'start again'", () => {
    for (const outcome of ["locked", "expired", "used", "no_code"]) expect(verifyAnswer(outcome)).toBe("start_again");
    expect(verifyAnswer("ok")).toBe("ok");
    expect(verifyAnswer("wrong")).toBe("wrong");
    expect(verifyAnswer("not_staff")).toBe("not_staff");
    expect(verifyAnswer(undefined)).toBe("unavailable");
  });
});

describe("hashing", () => {
  it("ties a code's hash to its row, so one row's hash is no use on another", () => {
    const one = signInCodeHash(ROW_ID, "123456");
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(signInCodeHash("22222222-2222-4222-8222-222222222222", "123456")).not.toBe(one);
    expect(signInCodeHash(ROW_ID, "123457")).not.toBe(one);
  });

  it("keeps the browser's address as a short hash, never the address", () => {
    const key = signInClientKey("203.0.113.9");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("203");
    expect(signInClientKey("")).toBe(signInClientKey("unknown"));
  });
});

describe("asking for a code", () => {
  it("refuses a bad number without touching the database", async () => {
    const { db, rpc } = fakeDb(() => ({ data: null, error: null }));
    const asked = await requestSignInCode({ phone: "12345", language: "hi", clientKey: "a".repeat(32) }, db);
    expect(asked.answer).toBe("bad_number");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the hash and the ten digits, never the code itself", async () => {
    let args: Record<string, unknown> = {};
    const { db } = fakeDb((_name, given) => {
      args = given;
      return { data: [{ outcome: "send", staff_profile_id: "s1", phone_key: "9000000002", retry_after_seconds: null }], error: null };
    });
    const asked = await requestSignInCode({ phone: "+91 90000 00002", language: "en", clientKey: "b".repeat(32) }, db);
    expect(asked.answer).toBe("sent");
    expect(asked.challengeId).toBe(args.p_id);
    expect(args.p_phone).toBe("9000000002");
    expect(args.p_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.values(args).some((value) => typeof value === "string" && /^\d{6}$/.test(value))).toBe(false);
    expect(asked.deliver).toBeTypeOf("function");
  });

  it("says 'not yet', with no code and no cookie to set, when the page read owner only (D-608)", async () => {
    const { db } = fakeDb(() => ({ data: [{ outcome: "not_allowed", staff_profile_id: null, phone_key: null, retry_after_seconds: null }], error: null }));
    const asked = await requestSignInCode({ phone: "9000000003", language: "hi", clientKey: "c".repeat(32), mode: "owner_only" }, db);
    expect(asked).toMatchObject({ answer: "not_yet", challengeId: null, deliver: null });
  });

  it("answers a number on no record exactly like one that got a code, and sends nothing", async () => {
    for (const outcome of ["no_match", "shared_number", "not_allowed"]) {
      const { db } = fakeDb(() => ({ data: [{ outcome, staff_profile_id: null, phone_key: null, retry_after_seconds: null }], error: null }));
      const asked = await requestSignInCode({ phone: "9000000003", language: "hi", clientKey: "c".repeat(32) }, db);
      expect(asked.answer).toBe("sent");
      expect(asked.challengeId).not.toBeNull();
      expect(asked.deliver).toBeNull();
    }
  });

  it("passes on a wait, and says unavailable when the database fails", async () => {
    const limited = fakeDb(() => ({ data: [{ outcome: "limited", staff_profile_id: null, phone_key: null, retry_after_seconds: 25 }], error: null }));
    const wait = await requestSignInCode({ phone: "9000000002", language: "hi", clientKey: "d".repeat(32) }, limited.db);
    expect(wait).toMatchObject({ answer: "limited", retryAfterSeconds: 25, challengeId: null, deliver: null });

    const broken = fakeDb(() => ({ data: null, error: { code: "57014" } }));
    expect((await requestSignInCode({ phone: "9000000002", language: "hi", clientKey: "d".repeat(32) }, broken.db)).answer).toBe("unavailable");
  });

  it("is off when this deployment has no working WhatsApp connection", async () => {
    hub.config = { ok: false, code: "not_configured", reason: "none", provider: null };
    const { db } = fakeDb(() => ({ data: null, error: null }));
    expect(await readSignInMode(db)).toBe("off");
  });
});

describe("sending it", () => {
  it("sends the copy-code template in the person's language, the code in the body and the button", async () => {
    hub.templates.set(SIGN_IN_TEMPLATE.en, { provider_name: SIGN_IN_TEMPLATE.en, language_code: "en", status: "approved" });
    hub.templates.set(SIGN_IN_TEMPLATE.hi, { provider_name: SIGN_IN_TEMPLATE.hi, language_code: "hi", status: "approved" });
    hub.send.mockResolvedValue({ outcome: "accepted", messageId: "wamid.1", httpStatus: 200 });
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    await deliverSignInCode(ROW_ID, "9000000002", "042424", "en", db);

    const body = hub.send.mock.calls[0]![0] as { to: string; template: { name: string; language: { code: string }; components: Array<{ type: string; parameters: Array<{ text: string }> }> } };
    expect(body.to).toBe("919000000002");
    expect(body.template.name).toBe(SIGN_IN_TEMPLATE.en);
    expect(body.template.components.map((part) => [part.type, part.parameters[0]!.text])).toEqual([
      ["body", "042424"],
      ["button", "042424"],
    ]);
    // Noted on its own row, never in the message log (which keeps the blanks).
    expect(calls.map((call) => call.table)).not.toContain("whatsapp_messages");
    expect(calls.find((call) => call.op === "update")?.args[0]).toMatchObject({ send_status: "accepted", provider_message_id: "wamid.1" });
  });

  it("falls back to the other language while only that one is approved", async () => {
    hub.templates.set(SIGN_IN_TEMPLATE.hi, { provider_name: SIGN_IN_TEMPLATE.hi, language_code: "hi", status: "approved" });
    hub.templates.set(SIGN_IN_TEMPLATE.en, { provider_name: SIGN_IN_TEMPLATE.en, language_code: "en", status: "pending" });
    hub.send.mockResolvedValue({ outcome: "accepted", messageId: "wamid.2", httpStatus: 200 });
    const { db } = fakeDb(() => ({ data: null, error: null }));
    await deliverSignInCode(ROW_ID, "9000000002", "111111", "en", db);
    expect((hub.send.mock.calls[0]![0] as { template: { name: string } }).template.name).toBe(SIGN_IN_TEMPLATE.hi);
  });

  it("sends nothing until Meta approves a template, and says why", async () => {
    hub.templates.set(SIGN_IN_TEMPLATE.hi, { provider_name: SIGN_IN_TEMPLATE.hi, language_code: "hi", status: "pending" });
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    await deliverSignInCode(ROW_ID, "9000000002", "111111", "hi", db);
    expect(hub.send).not.toHaveBeenCalled();
    expect(calls.find((call) => call.op === "update")?.args[0]).toMatchObject({ send_status: "refused", send_error: "template_not_approved" });
  });

  it("never writes the code into a stored error, even when the hub repeats it back", async () => {
    hub.templates.set(SIGN_IN_TEMPLATE.hi, { provider_name: SIGN_IN_TEMPLATE.hi, language_code: "hi", status: "approved" });
    hub.send.mockResolvedValue({ outcome: "rejected", httpStatus: 403, errorCode: "recipient_not_allowed", errorTitle: "Code 314159 not sent to this number" });
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    await deliverSignInCode(ROW_ID, "9000000002", "314159", "hi", db);
    const patch = calls.find((call) => call.op === "update")?.args[0] as { send_status: string; send_error: string };
    expect(patch.send_status).toBe("refused");
    expect(patch.send_error).not.toContain("314159");
    expect(patch.send_error).toContain("••••••");
    expect(JSON.stringify(log.logWarn.mock.calls)).not.toContain("314159");
  });

  it("never throws: the page has already answered", async () => {
    hub.templates.set(SIGN_IN_TEMPLATE.hi, { provider_name: SIGN_IN_TEMPLATE.hi, language_code: "hi", status: "approved" });
    hub.send.mockRejectedValue(new Error("socket hang up"));
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    await expect(deliverSignInCode(ROW_ID, "9000000002", "222222", "hi", db)).resolves.toBeUndefined();
    expect(calls.find((call) => call.op === "update")?.args[0]).toMatchObject({ send_status: "unknown" });
    // Old rows go after every send, whatever happened.
    expect(calls.some((call) => call.op === "delete")).toBe(true);
  });
});

describe("checking it", () => {
  it("sends only the hash and hands back the person only on ok", async () => {
    let args: Record<string, unknown> = {};
    const ok = fakeDb((_name, given) => {
      args = given;
      return { data: [{ outcome: "ok", staff_profile_id: "s1", user_id: "u1", tries_left: 4 }], error: null };
    });
    expect(await verifySignInCode(ROW_ID, "123456", ok.db)).toEqual({ answer: "ok", triesLeft: 4, staffProfileId: "s1", userId: "u1" });
    expect(args).toEqual({ p_id: ROW_ID, p_code_hash: signInCodeHash(ROW_ID, "123456") });

    const wrong = fakeDb(() => ({ data: [{ outcome: "wrong", staff_profile_id: "s1", user_id: "u1", tries_left: 2 }], error: null }));
    expect(await verifySignInCode(ROW_ID, "000000", wrong.db)).toEqual({ answer: "wrong", triesLeft: 2, staffProfileId: null, userId: null });
  });
});

describe("the hub's copy-code templates", () => {
  it("are submitted with the rest, as authentication templates with a 10-minute footer", () => {
    expect(SIGN_IN_HUB_SUBMISSIONS.map((one) => one.name).sort()).toEqual([SIGN_IN_TEMPLATE.en, SIGN_IN_TEMPLATE.hi].sort());
    for (const one of SIGN_IN_HUB_SUBMISSIONS) {
      expect(one).toMatchObject({ category: "AUTHENTICATION", code_expiration_minutes: 10 });
      expect((one.button_text ?? "").length).toBeLessThanOrEqual(25);
    }
    expect(ALL_HUB_SUBMISSIONS).toHaveLength(HUB_TEMPLATE_SUBMISSIONS.length + SIGN_IN_HUB_SUBMISSIONS.length);
  });
});

describe("the sign-in page", () => {
  const actions = readFileSync(join(process.cwd(), "src/app/login/actions.ts"), "utf8");
  const form = readFileSync(join(process.cwd(), "src/app/login/code-form.tsx"), "utf8");

  it("keeps which code this browser asked for in a cookie the page's script cannot read", () => {
    const cookie = actions.slice(actions.indexOf("name: SIGN_IN_CHALLENGE_COOKIE"), actions.indexOf("maxAge: SIGN_IN_CODE_MINUTES"));
    expect(cookie).toContain("httpOnly: true");
    expect(cookie).toContain('path: "/login"');
  });

  it("sends the code after answering, so the time it takes says nothing either", () => {
    expect(actions).toMatch(/if \(asked\.deliver\) after\(asked\.deliver\)/);
  });

  it("tells the request which mode it read, so only owner-only can answer 'not yet' (D-608)", () => {
    expect(actions).toMatch(/requestSignInCode\(\{[^}]*mode \}\)/);
  });

  it("signs in only through the admission check every door runs, held to the code's profile", () => {
    expect(actions).toMatch(/admitSignedInUser\(supabase, userId, \{ signOutScope: "local", expectedStaffProfileId: checked\.staffProfileId \}\)/);
  });

  it("tells everybody the same thing after Send code, and keeps email and password one tap away", () => {
    expect(form).toContain("If this number is on your staff record");
    expect(form).toContain("Use email and password instead");
    expect(form).toContain('autoComplete="one-time-code"');
  });

  it("reads the clipboard by itself only where the browser already allows it (D-608)", () => {
    expect(form).toContain('navigator.permissions.query({ name: "clipboard-read" as PermissionName })');
    expect(form).toMatch(/if \(stopped \|\| !allowed\(\) \|\| !document\.hasFocus\(\)\) return;/);
    expect(form).toContain("found === baseline || tried.has(found)");
  });
});
