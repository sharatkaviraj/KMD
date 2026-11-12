import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/whatsapp/data/helper-store", () => ({
  finishTurn: vi.fn(),
  readHelperSettings: vi.fn(),
  saveChat: vi.fn(),
  startTurn: vi.fn(),
}));
vi.mock("@/platform/whatsapp/store", () => ({ readSwitches: vi.fn(), whatsappDb: vi.fn() }));
const log = vi.hoisted(() => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/platform/observability/log", () => log);

import type { TurnFinish } from "@/modules/whatsapp/data/helper-store";
import {
  cancelStaffLink,
  handleStaffLink,
  readOpenLink,
  readWhatsappLinkCard,
  startStaffLink,
  staffLinkStatus,
  type LinkResult,
  type StaffLinkDeps,
} from "@/modules/whatsapp/data/staff-link";
import {
  LINK_CODE_ALPHABET,
  isLinkCode,
  linkCodeIn,
  linkMessage,
  linkOutcome,
  linkReplyText,
  linkUrl,
  newLinkCode,
  showLinkCode,
} from "@/modules/whatsapp/domain/staff-link";
import type { WhatsAppConfig } from "@/platform/whatsapp/config";
import type { WhatsAppSwitches } from "@/platform/whatsapp/policy";
import type { ClaimResult, ProviderSendResult } from "@/platform/whatsapp/providers";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";

/**
 * Link my WhatsApp (D-582): a member of staff sends a one-time code from their
 * phone to the school's number, and One learns their WhatsApp number from
 * WhatsApp itself. Every name and number here is made up (rule 6).
 */

const NOW = new Date("2026-11-12T06:30:00Z");
const OWNER = "+919000000001";
const TEACHER_PHONE = "+919000000002";
const TEACHER_ID = "22222222-2222-4222-8222-222222222222";
const HUB: WhatsAppConfig = { ok: true, provider: "hub", hubUrl: "https://hub.example.test", hubKey: "k", senderNumber: "+918302207823" };

/** A fixed sequence standing in for crypto.randomInt. */
function sequence(values: number[]) {
  let i = 0;
  return (below: number) => {
    const value = values[i % values.length]!;
    i += 1;
    return value % below;
  };
}

describe("the codes", () => {
  it("uses 31 characters nobody misreads: no I, L, O, 0 or 1", () => {
    expect(LINK_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(LINK_CODE_ALPHABET).size).toBe(31);
    for (const char of "ILO01") expect(LINK_CODE_ALPHABET).not.toContain(char);
  });

  it("always has a letter and a digit, so a word such as WHATSAPP is never a code", () => {
    expect(isLinkCode("WHATSAPP")).toBe(false);
    expect(isLinkCode("23456789")).toBe(false);
    expect(isLinkCode("ABCD2345")).toBe(true);
    expect(isLinkCode("ABCD234O")).toBe(false);
    expect(isLinkCode("ABCD234")).toBe(false);
    // All letters first: drawn again until a digit comes.
    const code = newLinkCode(sequence([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 23]));
    expect(code).toBe("ABCDEFG2");
    expect(isLinkCode(code)).toBe(true);
  });

  it("are shown in two halves and sent in the person's language, to the school's number", () => {
    expect(showLinkCode("ABCD2345")).toBe("ABCD-2345");
    expect(linkMessage("ABCD2345", "en")).toBe("Hello! Please link my WhatsApp to VPPS One.\nCode: ABCD-2345");
    expect(linkMessage("ABCD2345", "hi")).toContain("कोड: ABCD-2345");
    const url = new URL(linkUrl("ABCD2345", "hi"));
    expect(url.origin + url.pathname).toBe("https://wa.me/918302207823");
    expect(url.searchParams.get("text")).toBe(linkMessage("ABCD2345", "hi"));
  });
});

describe("finding a code in a message", () => {
  it("finds the prepared message, in either language, however the code is written", () => {
    expect(linkCodeIn(linkMessage("ABCD2345", "en"))).toEqual({ code: "ABCD2345", labelled: true });
    expect(linkCodeIn(linkMessage("ABCD2345", "hi"))).toEqual({ code: "ABCD2345", labelled: true });
    expect(linkCodeIn("please link vpps one code abcd 2345 thanks")).toEqual({ code: "ABCD2345", labelled: true });
    expect(linkCodeIn("VPPS One code: ABCD2345")).toEqual({ code: "ABCD2345", labelled: true });
  });

  it("tries a code typed by hand, without being sure it is one", () => {
    expect(linkCodeIn("abcd-2345")).toEqual({ code: "ABCD2345", labelled: false });
    expect(linkCodeIn("  ABCD 2345 ")).toEqual({ code: "ABCD2345", labelled: false });
    expect(linkCodeIn("Code: ABCD-2345")).toEqual({ code: "ABCD2345", labelled: false });
  });

  it("never takes a parent's ordinary message for one", () => {
    for (const text of [
      "What is the fee for class 6?",
      "WHATSAPP",
      "Whatsapp",
      "12345678",
      "My son's admission number is SR660, code 4455",
      "UPI ref code 44552233",
      "VPPS One is great",
      "",
      null,
    ]) {
      expect(linkCodeIn(text)).toBeNull();
    }
  });
});

describe("the answer on WhatsApp", () => {
  it("names the person only for a link that worked", () => {
    expect(linkReplyText("linked", "en", "TEST Teacher One", "Veer Patta AI")).toContain("Linked, TEST Teacher One!");
    expect(linkReplyText("linked", "hi", "TEST Teacher One", "Veer Patta AI")).toContain("TEST Teacher One जी");
    expect(linkReplyText("linked", "en", "TEST Teacher One", "Veer Patta AI")).toContain("between 6 am and 9 pm");
    expect(linkReplyText("used", "en", "TEST Teacher One", "Veer Patta AI")).not.toContain("TEST Teacher One");
  });

  it("has words for every outcome in both languages", () => {
    for (const outcome of ["linked", "already_linked", "used", "expired", "inactive", "not_test_number", "no_code", "bad_number", "error"] as const) {
      expect(linkReplyText(outcome, "hi", null, "Veer Patta AI").length).toBeGreaterThan(10);
      expect(linkReplyText(outcome, "en", null, "Veer Patta AI").length).toBeGreaterThan(10);
    }
    expect(linkOutcome("linked")).toBe("linked");
    expect(linkOutcome("something new")).toBe("error");
    expect(linkOutcome(null)).toBe("error");
  });
});

/* ------------------------------------------------------- from WhatsApp */

function switches(over: Partial<WhatsAppSwitches> = {}): WhatsAppSwitches {
  return { dryRun: false, features: { parent_helper: true }, realRecipients: true, ownerTestNumber: OWNER, dailyLimit: 250, feeSender: "fees", ...over };
}

function inbound(over: Partial<WebhookInbound> = {}): WebhookInbound {
  return {
    providerMessageId: "wamid.LINK1",
    from: TEACHER_PHONE,
    fromName: "TEST Teacher",
    type: "text",
    text: linkMessage("ABCD2345", "en"),
    replyTo: null,
    at: new Date(NOW.getTime() - 4_000).toISOString(),
    raw: {},
    ...over,
  };
}

const LINKED: LinkResult = { outcome: "linked", staffId: TEACHER_ID, name: "TEST Teacher One", language: "en", isTest: true };

function fakes(over: Partial<StaffLinkDeps> & { result?: LinkResult } = {}) {
  const calls = {
    linked: [] as Array<[string, string]>,
    sent: [] as Array<Record<string, unknown>>,
    started: [] as string[],
    claims: [] as string[],
    finished: [] as Array<[string, TurnFinish]>,
    saved: [] as Array<[string, string]>,
  };
  const deps: StaffLinkDeps = {
    now: () => NOW,
    link: async (code, from) => {
      calls.linked.push([code, from]);
      return over.result ?? LINKED;
    },
    readSwitches: async () => switches(),
    readConfig: () => HUB,
    readHelperName: async () => "Veer Patta AI",
    claim: async (wamid): Promise<ClaimResult> => {
      calls.claims.push(wamid);
      return { ok: true, claimed: true, typing: true, staff: false, stale: false, takenBy: null };
    },
    send: async (body): Promise<ProviderSendResult> => {
      calls.sent.push(body);
      return { outcome: "accepted", messageId: "wamid.OUT1", httpStatus: 200 };
    },
    startTurn: async (row) => {
      if (calls.started.includes(row.providerMessageId)) return "duplicate";
      calls.started.push(row.providerMessageId);
      return "started";
    },
    finishTurn: async (id, finish) => {
      calls.finished.push([id, finish]);
    },
    saveChat: async (from, _patch, at) => {
      calls.saved.push([from, at.toISOString()]);
    },
    ...over,
  };
  return { deps, calls };
}

const textOf = (body: Record<string, unknown>) => (body.text as { body: string }).body;

describe("a link code arriving on WhatsApp", () => {
  it("links the number it came from, opens their chat, and answers when the helper may", async () => {
    const { deps, calls } = fakes();
    expect(await handleStaffLink(inbound(), deps)).toEqual({ outcome: "answered", route: "rule", intent: "staff_link", handoff: null });
    expect(calls.linked).toEqual([["ABCD2345", TEACHER_PHONE]]);
    // When they wrote, not when One answered: Meta's 24 hours run from their message.
    expect(calls.saved).toEqual([[TEACHER_PHONE, "2026-11-12T06:29:56.000Z"]]);
    expect(calls.claims).toEqual(["wamid.LINK1"]);
    expect(calls.sent).toHaveLength(1);
    expect(calls.sent[0]!.to).toBe("919000000002");
    expect(textOf(calls.sent[0]!)).toContain("Linked, TEST Teacher One!");
    expect(calls.finished).toEqual([["wamid.LINK1", expect.objectContaining({ status: "answered", intent: "staff_link", route: "rule", reason: null, replyMessageId: "wamid.OUT1" })]]);
  });

  it("links but stays quiet in practice mode, switched off, or to anybody but the owner while testing", async () => {
    for (const quiet of [switches({ dryRun: true }), switches({ features: {} }), switches({ realRecipients: false }), null]) {
      const { deps, calls } = fakes({ readSwitches: async () => quiet });
      expect(await handleStaffLink(inbound(), deps)).toEqual({ outcome: "skipped", reason: "staff_link_linked" });
      expect(calls.linked).toHaveLength(1);
      expect(calls.saved).toHaveLength(1);
      expect(calls.claims).toEqual([]);
      expect(calls.sent).toEqual([]);
      expect(calls.started).toEqual([]);
    }
  });

  it("a code someone else used is answered without saying whose it was", async () => {
    const { deps, calls } = fakes({ result: { outcome: "used", staffId: null, name: null, language: null, isTest: null } });
    await handleStaffLink(inbound(), deps);
    expect(textOf(calls.sent[0]!)).toContain("already been used");
    expect(textOf(calls.sent[0]!)).not.toContain("TEST Teacher");
    expect(calls.saved).toEqual([]);
    expect(calls.finished[0]![1]).toMatchObject({ status: "answered", reason: "used" });
  });

  it("answers in Hindi when the message was in Hindi and the person is not known", async () => {
    const { deps, calls } = fakes({ result: { outcome: "no_code", staffId: null, name: null, language: null, isTest: null } });
    await handleStaffLink(inbound({ text: linkMessage("ABCD2345", "hi") }), deps);
    expect(textOf(calls.sent[0]!)).toContain("यह कोड नहीं मिला");
  });

  it("a bare code nobody made is an ordinary message after all", async () => {
    const { deps, calls } = fakes({ result: { outcome: "no_code", staffId: null, name: null, language: null, isTest: null } });
    expect(await handleStaffLink(inbound({ text: "ABCD-2345" }), deps)).toBeNull();
    expect(calls.sent).toEqual([]);
    const down = fakes({ result: { outcome: "error", staffId: null, name: null, language: null, isTest: null } });
    expect(await handleStaffLink(inbound({ text: "ABCD-2345" }), down.deps)).toBeNull();
  });

  it("never looks at a message with no code, a voice note, or a number that is not a mobile", async () => {
    const { deps, calls } = fakes();
    expect(await handleStaffLink(inbound({ text: "What is the fee?" }), deps)).toBeNull();
    expect(await handleStaffLink(inbound({ type: "audio", text: null }), deps)).toBeNull();
    expect(await handleStaffLink(inbound({ from: "12" }), deps)).toBeNull();
    expect(calls.linked).toEqual([]);
  });

  it("the same message twice is answered once", async () => {
    const { deps, calls } = fakes();
    await handleStaffLink(inbound(), deps);
    expect(await handleStaffLink(inbound(), deps)).toEqual({ outcome: "skipped", reason: "duplicate" });
    expect(calls.sent).toHaveLength(1);
  });

  it("stays quiet when the hub gives the message to someone else, and says so in the ledger", async () => {
    const { deps, calls } = fakes({ claim: async () => ({ ok: true, claimed: false, typing: false, staff: true, stale: false, takenBy: null }) });
    expect(await handleStaffLink(inbound(), deps)).toEqual({ outcome: "not_claimed", reason: "staff_handling" });
    expect(calls.sent).toEqual([]);
    expect(calls.linked).toHaveLength(1);
    expect(calls.finished[0]![1]).toMatchObject({ status: "not_claimed", reason: "staff_handling", intent: "staff_link" });
  });

  it("a reply Meta refuses is a failed turn, the link still made", async () => {
    const { deps, calls } = fakes({ send: async () => ({ outcome: "rejected", httpStatus: 400, errorCode: "131047", errorTitle: null, errorDetail: null }) });
    expect(await handleStaffLink(inbound(), deps)).toEqual({ outcome: "failed", reason: "send_rejected:131047" });
    expect(calls.linked).toHaveLength(1);
    expect(calls.finished[0]![1]).toMatchObject({ status: "failed", intent: "staff_link" });
  });
});

/* ------------------------------------------------------------ the screen */

type Query = { table: string; op: string; filters: Array<[string, string, unknown]>; values?: Record<string, unknown> };

/**
 * Just enough of the Supabase query builder for these reads and writes.
 * `select` answers every read; `selectFrom` answers the reads of one table.
 */
function fakeDb(
  rows: {
    select?: Record<string, unknown> | null;
    selectFrom?: Record<string, Record<string, unknown> | null>;
    insertErrors?: Array<{ code: string } | null>;
  } = {},
) {
  const queries: Query[] = [];
  const insertErrors = [...(rows.insertErrors ?? [])];
  const builder = (query: Query) => {
    const chain = {
      eq: (column: string, value: unknown) => {
        query.filters.push(["eq", column, value]);
        return chain;
      },
      is: (column: string, value: unknown) => {
        query.filters.push(["is", column, value]);
        return chain;
      },
      lt: (column: string, value: unknown) => {
        query.filters.push(["lt", column, value]);
        return chain;
      },
      gt: (column: string, value: unknown) => {
        query.filters.push(["gt", column, value]);
        return chain;
      },
      not: (column: string, operator: string, value: unknown) => {
        query.filters.push([`not.${operator}`, column, value]);
        return chain;
      },
      order: (column: string, value: unknown) => {
        query.filters.push(["order", column, value]);
        return chain;
      },
      limit: (count: number) => {
        query.filters.push(["limit", "", count]);
        return chain;
      },
      maybeSingle: async () => ({
        data: rows.selectFrom && query.table in rows.selectFrom ? rows.selectFrom[query.table] : (rows.select ?? null),
        error: null,
      }),
      then: (resolve: (value: { error: { code: string } | null }) => unknown) =>
        resolve({ error: query.op === "insert" ? (insertErrors.shift() ?? null) : null }),
    };
    return chain;
  };
  const db = {
    from: (table: string) => ({
      select: () => {
        const query: Query = { table, op: "select", filters: [] };
        queries.push(query);
        return builder(query);
      },
      delete: () => {
        const query: Query = { table, op: "delete", filters: [] };
        queries.push(query);
        return builder(query);
      },
      insert: (values: Record<string, unknown>) => {
        const query: Query = { table, op: "insert", filters: [], values };
        queries.push(query);
        return builder(query);
      },
    }),
  };
  return { db: db as never, queries };
}

describe("making a code and asking after it", () => {
  it("clears the person's open codes and old ones, then saves a new one with a QR code for a computer", async () => {
    const { db, queries } = fakeDb();
    const started = await startStaffLink(TEACHER_ID, "en", db, sequence([0, 1, 2, 3, 23, 24, 25, 26]));
    expect(started).toMatchObject({ code: "ABCD2345", shown: "ABCD-2345", message: linkMessage("ABCD2345", "en"), url: linkUrl("ABCD2345", "en") });
    expect(started!.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(queries.map((query) => [query.op, query.filters.map(([kind, column]) => `${kind}:${column}`).join(",")])).toEqual([
      ["delete", "eq:staff_profile_id,is:used_at"],
      ["delete", "is:used_at,lt:expires_at"],
      ["insert", ""],
    ]);
    expect(queries[2]!.values).toMatchObject({ code: "ABCD2345", staff_profile_id: TEACHER_ID });
  });

  it("draws again when a code is taken, and gives up rather than guess", async () => {
    const taken = fakeDb({ insertErrors: [{ code: "23505" }, null] });
    expect(await startStaffLink(TEACHER_ID, "hi", taken.db, sequence([0, 1, 2, 3, 23, 24, 25, 26, 4, 5, 6, 7, 27, 28, 29, 30]))).toMatchObject({ code: "EFGH6789" });
    const broken = fakeDb({ insertErrors: [{ code: "42501" }] });
    expect(await startStaffLink(TEACHER_ID, "hi", broken.db)).toBeNull();
  });

  it("says linked with the number masked, waiting, run out, or gone", async () => {
    const linked = fakeDb({ select: { expires_at: NOW.toISOString(), used_at: NOW.toISOString(), used_from: TEACHER_PHONE } });
    expect(await staffLinkStatus(TEACHER_ID, "abcd-2345", linked.db)).toEqual({ state: "linked", number: "+91 ••••• •0002" });
    expect(linked.queries[0]!.filters).toEqual([
      ["eq", "code", "ABCD2345"],
      ["eq", "staff_profile_id", TEACHER_ID],
    ]);
    const later = new Date(Date.now() + 600_000).toISOString();
    expect(await staffLinkStatus(TEACHER_ID, "ABCD2345", fakeDb({ select: { expires_at: later, used_at: null, used_from: null } }).db)).toEqual({ state: "waiting", expiresAt: later });
    expect(await staffLinkStatus(TEACHER_ID, "ABCD2345", fakeDb({ select: { expires_at: "2026-01-01T00:00:00Z", used_at: null, used_from: null } }).db)).toEqual({ state: "expired" });
    expect(await staffLinkStatus(TEACHER_ID, "ABCD2345", fakeDb({ select: null }).db)).toEqual({ state: "gone" });
    expect(await staffLinkStatus(TEACHER_ID, "not a code", fakeDb().db)).toEqual({ state: "gone" });
  });

  it("the card: linked only with a number and a yes; never the whole number", async () => {
    const sentFrom = (usedFrom: string | null) => ({ staff_whatsapp_links: usedFrom ? { used_from: usedFrom } : null });
    const card = (profile: Record<string, unknown>, usedFrom: string | null = null) =>
      readWhatsappLinkCard(TEACHER_ID, fakeDb({ selectFrom: { staff_profiles: profile, ...sentFrom(usedFrom) } }).db);
    const yes = { whatsapp_phone: "9000000002", phone: null, whatsapp_opt_in_at: "2026-11-12T06:00:00Z", whatsapp_opt_in_source: "self", whatsapp_opt_out_at: null };

    // Linked from their phone: the number on file is the one their code came from.
    expect(await card(yes, TEACHER_PHONE)).toEqual({ state: "linked", number: "+91 ••••• •0002", since: "2026-11-12T06:00:00Z", source: "whatsapp" });
    // A yes from Preferences, or a code from a number they have since changed: as recorded.
    expect(await card(yes)).toMatchObject({ state: "linked", source: "self" });
    expect(await card(yes, "+919000000009")).toMatchObject({ state: "linked", source: "self" });
    expect(await card({ ...yes, whatsapp_opt_out_at: "2026-11-13T06:00:00Z" }, TEACHER_PHONE)).toMatchObject({
      state: "stopped",
      since: "2026-11-13T06:00:00Z",
      source: "whatsapp",
    });
    expect(await card({ ...yes, whatsapp_phone: null })).toEqual({ state: "none", number: null, since: null, source: null });
  });

  it("the card asks after their newest used code, by their own id", async () => {
    const { db, queries } = fakeDb({ selectFrom: { staff_profiles: null } });
    expect(await readWhatsappLinkCard(TEACHER_ID, db)).toBeNull();
    const sent = queries.find((query) => query.table === "staff_whatsapp_links");
    expect(sent?.filters).toEqual([
      ["eq", "staff_profile_id", TEACHER_ID],
      ["not.is", "used_at", null],
      ["order", "used_at", { ascending: false }],
      ["limit", "", 1],
    ]);
  });

  it("the card falls back to the phone on file, the number every staff message goes to", async () => {
    const card = await readWhatsappLinkCard(
      TEACHER_ID,
      fakeDb({ select: { whatsapp_phone: null, phone: "9000000002", whatsapp_opt_in_at: "2026-11-12T06:00:00Z", whatsapp_opt_in_source: "form", whatsapp_opt_out_at: null } }).db,
    );
    expect(card).toEqual({ state: "linked", number: "+91 ••••• •0002", since: "2026-11-12T06:00:00Z", source: "form" });
    const asked = await readWhatsappLinkCard(TEACHER_ID, fakeDb({ select: { whatsapp_phone: null, phone: "9000000002", whatsapp_opt_in_at: null, whatsapp_opt_in_source: null, whatsapp_opt_out_at: null } }).db);
    expect(asked).toEqual({ state: "none", number: "+91 ••••• •0002", since: null, source: null });
  });

  it("finds their newest open code again, so a page opened later goes back to waiting", async () => {
    const later = new Date(Date.now() + 600_000).toISOString();
    const open = fakeDb({ select: { code: "ABCD2345", expires_at: later } });
    const found = await readOpenLink(TEACHER_ID, "hi", open.db);
    expect(found).toMatchObject({ code: "ABCD2345", shown: "ABCD-2345", message: linkMessage("ABCD2345", "hi"), url: linkUrl("ABCD2345", "hi"), expiresAt: later, to: "+91 83022 07823" });
    expect(open.queries[0]!.filters.map(([kind, column]) => `${kind}:${column}`)).toEqual([
      "eq:staff_profile_id",
      "is:used_at",
      "gt:expires_at",
      "order:created_at",
      "limit:",
    ]);
    expect(await readOpenLink(TEACHER_ID, "hi", fakeDb({ select: null }).db)).toBeNull();
    // A row that is not a code One makes is never shown as one.
    expect(await readOpenLink(TEACHER_ID, "hi", fakeDb({ select: { code: "WHATSAPP", expires_at: later } }).db)).toBeNull();
  });

  it("cancel takes away only this person's unused codes", async () => {
    const { db, queries } = fakeDb();
    expect(await cancelStaffLink(TEACHER_ID, db)).toBe(true);
    expect(queries).toEqual([
      {
        table: "staff_whatsapp_links",
        op: "delete",
        filters: [
          ["eq", "staff_profile_id", TEACHER_ID],
          ["is", "used_at", null],
        ],
      },
    ]);
  });
});

describe("the migration", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).filter((name) => name.endsWith("_staff_whatsapp_link.sql"));
  const sql = readFileSync(join(dir, file[0] ?? "missing"), "utf8").replace(/--[^\n]*/g, "");

  it("is one file", () => {
    expect(file).toHaveLength(1);
  });

  it("records the yes as the person's own, and changes no existing table or rule", () => {
    expect(sql).toContain("whatsapp_opt_in_source = 'self'");
    expect(sql).not.toMatch(/alter table vppsone\.staff_profiles/i);
    // Nothing is taken away, so it applies without anybody standing by to confirm.
    expect(sql).not.toMatch(/\b(drop|truncate)\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("keeps the codes and the link to the service role", () => {
    expect(sql).toContain("revoke all on vppsone.staff_whatsapp_links from public, anon, authenticated;");
    expect(sql).toContain("grant select, insert, update, delete on vppsone.staff_whatsapp_links to service_role;");
    expect(sql).toContain("revoke all on function vppsone.link_staff_whatsapp(text, text) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function vppsone.link_staff_whatsapp(text, text) to service_role;");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("set search_path = ''");
  });

  it("holds a test account to the test list, and writes the number as ten digits", () => {
    expect(sql).toContain("from vppsone.message_test_recipients r where r.phone_e164 = p_from");
    expect(sql).toContain("whatsapp_phone = right(p_from, 10)");
  });

  it("seeds no number and no consent", () => {
    expect(sql).not.toMatch(/insert into vppsone\.(staff_profiles|message_test_recipients|staff_whatsapp_links)/i);
    expect(sql).not.toMatch(/[6-9]\d{9}/);
  });
});
