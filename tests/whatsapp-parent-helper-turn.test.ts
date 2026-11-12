import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/assist/data/settings", () => ({ getAssistSettings: vi.fn() }));
vi.mock("@/modules/whatsapp/data/helper-claude", () => ({ askHelperClaude: vi.fn(), hasClaudeKey: vi.fn(() => false) }));
vi.mock("@/modules/whatsapp/data/helper-store", () => ({
  finishTurn: vi.fn(),
  insertHandoff: vi.fn(),
  pickHandoffStaff: vi.fn(),
  readBudget: vi.fn(),
  readChat: vi.fn(),
  readChildFacts: vi.fn(),
  readHelperSettings: vi.fn(),
  saveAbsenceNotes: vi.fn(),
  saveChat: vi.fn(),
  startTurn: vi.fn(),
}));
vi.mock("@/platform/whatsapp/store", () => ({ readSwitches: vi.fn() }));
const log = vi.hoisted(() => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/platform/observability/log", () => log);

import type { ClaudeTurn } from "@/modules/whatsapp/data/helper-claude";
import type { Handoff } from "@/modules/whatsapp/data/helper-handoffs";
import type { RateResult } from "@/modules/whatsapp/data/helper-relay";
import type { TurnFinish } from "@/modules/whatsapp/data/helper-store";
import { runHelperTurn, runHelperTurns, type HelperDeps } from "@/modules/whatsapp/data/helper-turn";
import type { HelperAnswer } from "@/modules/whatsapp/domain/helper-ai";
import { NO_KNOWLEDGE, type LessonNote, type SchoolKnowledge } from "@/modules/whatsapp/domain/helper-lessons";
import { childFactsFromRow, type ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import { EMPTY_CHAT, type ChatPatch, type ChatState } from "@/modules/whatsapp/domain/helper-plan";
import type { WhatsAppConfig } from "@/platform/whatsapp/config";
import type { WhatsAppSwitches } from "@/platform/whatsapp/policy";
import type { ClaimResult, ProviderSendResult } from "@/platform/whatsapp/providers";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";

/**
 * Veer Patta AI's turn (D-574): when One answers a message and when it leaves
 * it to the hub's own bot. Every name and number here is made up (rule 6).
 */

const NOW = new Date("2026-11-12T06:30:00Z");
const OWNER = "+919000000001";
const STRANGER = "+919111111111";
const AARAV_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "44444444-4444-4444-8444-444444444444";
const REPLY_ID = "55555555-5555-4555-8555-555555555555";
const DISPUTE = "I paid in August but the receipt is not showing";

const aarav = childFactsFromRow({
  today: "2026-11-12",
  student: { id: AARAV_ID, full_name: "TEST AARAV KUMAR", class_id: "c6", status: "active", session_label: "TEST-2026-27", class_name: "Class 6", section: null, stream_name: null },
  installments: [
    { installment_no: 1, due_date: "2026-04-20", pending: 0, late_pending: 0, applied: 5000, carry_forward: false },
    { installment_no: 2, due_date: "2026-07-20", pending: 3000, late_pending: 1000, applied: 2000, carry_forward: false },
  ],
  receipts: [{ number: "TEST-SVP-0002", date: "2026-08-01", amount: 2000, mode: "online", reversed: false }],
  attendance: { attendance_pct: 92.5, days_counted: 120, absent_days: 9, late_days: 3 },
  days: [],
  results: [],
  class_teacher: { staff_id: "22222222-2222-4222-8222-222222222222", name: "TEST Teacher One", is_test: true },
  calendar: [],
}) as ChildFacts;

const HUB: WhatsAppConfig = { ok: true, provider: "hub", hubUrl: "https://hub.example.test", hubKey: "k", senderNumber: "+918302207823" };

function switches(over: Partial<WhatsAppSwitches> = {}): WhatsAppSwitches {
  return { dryRun: false, features: { parent_helper: true }, realRecipients: false, ownerTestNumber: OWNER, dailyLimit: 250, ...over };
}

/** A parent who was greeted earlier today and writes in English. */
const RETURNING: ChatState = { ...EMPTY_CHAT, language: "en", greetedAt: "2026-11-12T04:00:00.000Z", lastTurnAt: "2026-11-12T04:00:00.000Z" };

function inbound(over: Partial<WebhookInbound> = {}): WebhookInbound {
  return {
    providerMessageId: "wamid.TEST1",
    from: OWNER,
    fromName: "TEST Parent",
    type: "text",
    text: "fees",
    replyTo: null,
    at: new Date(NOW.getTime() - 3_000).toISOString(),
    raw: { type: "text" },
    ...over,
  };
}

function answer(over: Partial<HelperAnswer> = {}): HelperAnswer {
  return { language: "en", topic: "other", reply: "Happy to help.", show: "none", handoff: "none", child: null, needs_care: false, summary: null, absence: null, school_answer: null, unanswered: null, ...over };
}

const CLAIMED: ClaimResult = { ok: true, claimed: true, typing: true, staff: false, stale: false, takenBy: null };

type Calls = {
  started: string[];
  claims: string[];
  sent: Record<string, unknown>[];
  finished: Array<[string, TurnFinish]>;
  saved: Array<[string, ChatPatch]>;
  handoffs: Array<Parameters<HelperDeps["insertHandoff"]>[0]>;
  picked: Array<Parameters<HelperDeps["pickHandoffStaff"]>>;
};

function fakes(over: Partial<HelperDeps> = {}): { deps: HelperDeps; calls: Calls; askClaude: ReturnType<typeof vi.fn> } {
  const calls: Calls = { started: [], claims: [], sent: [], finished: [], saved: [], handoffs: [], picked: [] };
  const askClaude = vi.fn(async (): Promise<ClaudeTurn> => ({ answer: answer(), model: "claude-haiku-5-5", careful: false, costUsd: 0.002, problem: null }));
  const deps: HelperDeps = {
    now: () => NOW,
    readConfig: () => HUB,
    readSwitches: async () => switches(),
    readSettings: async () => ({ helperName: "Veer Patta AI", practiceStudentIds: [AARAV_ID] }),
    readChildFacts: async () => [aarav],
    readChat: async () => RETURNING,
    saveChat: async (from, patch) => {
      calls.saved.push([from, patch]);
    },
    readBudget: async () => ({ spentUsd: 0.5, turnsToday: 3 }),
    readAiSettings: async () => ({ enabled: true, monthlyBudgetUsd: 25 }),
    hasClaudeKey: () => true,
    askClaude,
    startTurn: async (row) => {
      calls.started.push(row.providerMessageId);
      return "started";
    },
    finishTurn: async (id, finish) => {
      calls.finished.push([id, finish]);
    },
    claim: async (wamid) => {
      calls.claims.push(wamid);
      return CLAIMED;
    },
    send: async (body): Promise<ProviderSendResult> => {
      calls.sent.push(body);
      return { outcome: "accepted", messageId: `wamid.REPLY${calls.sent.length}`, httpStatus: 200 };
    },
    pickHandoffStaff: async (...args) => {
      calls.picked.push(args);
      return STAFF_ID;
    },
    insertHandoff: async (row) => {
      calls.handoffs.push(row);
      return REPLY_ID;
    },
    ...over,
  };
  return { deps, calls, askClaude };
}

function bodyText(body: Record<string, unknown> | undefined): string {
  if (!body) return "";
  if (body.type === "text") return String((body.text as { body: string }).body);
  return String(((body.interactive as { body: { text: string } }).body).text);
}

beforeEach(() => {
  log.logInfo.mockClear();
  log.logWarn.mockClear();
});

/* ------------------------------------------------- when it stays out */

describe("when Veer Patta AI leaves the message to the hub", () => {
  it("stays out of a number it does not know, before touching anything", async () => {
    const { deps, calls } = fakes();
    expect(await runHelperTurn(inbound({ from: STRANGER }), deps)).toEqual({ outcome: "skipped", reason: "unknown_number" });
    expect(calls.started).toEqual([]);
    expect(calls.claims).toEqual([]);
    expect(calls.sent).toEqual([]);
  });

  it("stays out in practice mode, with the switch off, and where it cannot claim", async () => {
    expect(await runHelperTurn(inbound(), fakes({ readSwitches: async () => switches({ dryRun: true }) }).deps)).toEqual({ outcome: "skipped", reason: "practice_mode" });
    expect(await runHelperTurn(inbound(), fakes({ readSwitches: async () => switches({ features: {} }) }).deps)).toEqual({ outcome: "skipped", reason: "feature_off" });
    expect(await runHelperTurn(inbound(), fakes({ readSwitches: async () => null }).deps)).toEqual({ outcome: "skipped", reason: "unknown_number" });
    expect(await runHelperTurn(inbound(), fakes({ claim: null }).deps)).toEqual({ outcome: "skipped", reason: "cannot_claim" });
  });

  it("stays out of old messages, stickers and an unreadable settings row", async () => {
    const { deps, calls } = fakes();
    expect(await runHelperTurn(inbound({ at: new Date(NOW.getTime() - 11 * 60_000).toISOString() }), deps)).toEqual({ outcome: "skipped", reason: "too_old" });
    expect(await runHelperTurn(inbound({ at: "not a date" }), deps)).toEqual({ outcome: "skipped", reason: "too_old" });
    expect(await runHelperTurn(inbound({ type: "sticker", text: null, raw: { type: "sticker" } }), deps)).toEqual({ outcome: "skipped", reason: "not_readable" });
    expect(await runHelperTurn(inbound(), fakes({ readSettings: async () => null }).deps)).toEqual({ outcome: "skipped", reason: "settings_unreadable" });
    expect(calls.claims).toEqual([]);
  });

  it("stays out when the family's records cannot be read, or name no child", async () => {
    expect(await runHelperTurn(inbound(), fakes({ readChildFacts: async () => null }).deps)).toEqual({ outcome: "skipped", reason: "facts_unreadable" });
    expect(await runHelperTurn(inbound(), fakes({ readChildFacts: async () => [] }).deps)).toEqual({ outcome: "skipped", reason: "no_children" });
    expect(await runHelperTurn(inbound(), fakes({ readBudget: async () => null }).deps)).toEqual({ outcome: "skipped", reason: "budget_unreadable" });
  });

  it("stops at forty answers a day for one number", async () => {
    const { deps, calls } = fakes({ readBudget: async () => ({ spentUsd: 0, turnsToday: 40 }) });
    expect(await runHelperTurn(inbound(), deps)).toEqual({ outcome: "skipped", reason: "daily_cap" });
    expect(calls.claims).toEqual([]);
  });

  it("never says anything to stop", async () => {
    const { deps, calls } = fakes();
    expect(await runHelperTurn(inbound({ text: "STOP" }), deps)).toEqual({ outcome: "skipped", reason: "stop" });
    expect(calls.started).toEqual([]);
  });

  it("never answers the same message twice", async () => {
    const { deps, calls } = fakes({ startTurn: async () => "duplicate" });
    expect(await runHelperTurn(inbound(), deps)).toEqual({ outcome: "skipped", reason: "duplicate" });
    expect(calls.claims).toEqual([]);
    expect(calls.sent).toEqual([]);
    expect(await runHelperTurn(inbound(), fakes({ startTurn: async () => "failed" }).deps)).toEqual({ outcome: "skipped", reason: "ledger_failed" });
  });

  it.each([
    [{ ok: true, claimed: false, typing: false, staff: false, stale: false, takenBy: "bot" } as ClaimResult, "taken_by:bot"],
    [{ ok: true, claimed: false, typing: false, staff: true, stale: false, takenBy: null } as ClaimResult, "staff_handling"],
    [{ ok: true, claimed: false, typing: false, staff: false, stale: true, takenBy: null } as ClaimResult, "stale"],
    [{ ok: false, httpStatus: 503, problem: "down" } as ClaimResult, "claim_failed:503"],
    [{ ok: false, httpStatus: null, problem: "timeout" } as ClaimResult, "claim_failed:network"],
  ])("leaves the message when the hub keeps it (%#)", async (claim, reason) => {
    const { deps, calls } = fakes({ claim: async () => claim });
    expect(await runHelperTurn(inbound(), deps)).toEqual({ outcome: "not_claimed", reason });
    expect(calls.finished).toEqual([["wamid.TEST1", { status: "not_claimed", reason }]]);
    expect(calls.sent).toEqual([]);
    expect(calls.saved).toEqual([]);
  });
});

/* ------------------------------------------------------ when it answers */

describe("when Veer Patta AI answers", () => {
  it("answers a plain ask from the card: claim, send, ledger, then the chat", async () => {
    const { deps, calls, askClaude } = fakes();
    expect(await runHelperTurn(inbound(), deps)).toEqual({ outcome: "answered", route: "rule", intent: "fees", handoff: null });
    expect(calls.started).toEqual(["wamid.TEST1"]);
    expect(calls.claims).toEqual(["wamid.TEST1"]);
    expect(calls.sent).toHaveLength(1);
    expect(calls.sent[0]).toMatchObject({ messaging_product: "whatsapp", to: "919000000001" });
    expect(bodyText(calls.sent[0])).toContain("₹3,000");
    expect(askClaude).not.toHaveBeenCalled();
    expect(calls.finished).toEqual([
      [
        "wamid.TEST1",
        {
          status: "answered",
          intent: "fees",
          route: "rule",
          model: null,
          costUsd: 0,
          handoff: null,
          parentReplyId: null,
          latencyMs: 3_000,
          reason: null,
          replyMessageId: "wamid.REPLY1",
        },
      ],
    ]);
    // "fees" says nothing about the language, so the one on file stays.
    expect(calls.saved).toEqual([[OWNER, { awaiting: null, awaitingUntil: null }]]);
  });

  it("answers a tap on its own button without Claude, and a voice note with a kind word", async () => {
    const tap = fakes();
    const raw = { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "vpai:attendance", title: "Attendance" } } };
    expect(await runHelperTurn(inbound({ type: "interactive", text: "Attendance", raw }), tap.deps)).toEqual({ outcome: "answered", route: "tap", intent: "attendance", handoff: null });
    expect(tap.askClaude).not.toHaveBeenCalled();

    const voice = fakes();
    expect(await runHelperTurn(inbound({ type: "audio", text: null, raw: { type: "audio" } }), voice.deps)).toEqual({ outcome: "answered", route: "rule", intent: "voice", handoff: null });
  });

  it("asks Claude what no rule answers, and hands a fee dispute to accounts", async () => {
    const summary = "Parent says the August payment is not showing.";
    const { deps, calls, askClaude } = fakes();
    askClaude.mockResolvedValueOnce({
      answer: answer({ topic: "complaint", handoff: "accounts", reply: "I am sorry about this.", summary }),
      model: "claude-opus-5-5",
      careful: true,
      costUsd: 0.03,
      problem: null,
    });
    expect(await runHelperTurn(inbound({ text: DISPUTE }), deps)).toEqual({ outcome: "answered", route: "ai_careful", intent: "complaint", handoff: "accounts" });
    expect(askClaude).toHaveBeenCalledWith(expect.objectContaining({ helperName: "Veer Patta AI", text: DISPUTE, language: "en", firstContact: false }));
    expect(calls.picked).toEqual([["accounts", aarav, "TEST-2026-27"]]);
    expect(calls.handoffs).toEqual([
      {
        sessionLabel: "TEST-2026-27",
        fromName: "TEST Parent",
        fromPhone: OWNER,
        studentId: AARAV_ID,
        studentLabel: `${aarav.firstName} · Class 6`,
        regarding: `Veer Patta AI · complaint: ${summary}`,
        body: DISPUTE,
        receivedAt: new Date(NOW.getTime() - 3_000).toISOString(),
        assignedStaffId: STAFF_ID,
      },
    ]);
    // The ledger is written only after the hand-off is in the inbox.
    expect(calls.finished[0][1]).toMatchObject({ status: "answered", route: "ai_careful", model: "claude-opus-5-5", costUsd: 0.03, handoff: "accounts", parentReplyId: REPLY_ID });
    expect(bodyText(calls.sent[0])).toContain("I am sorry about this.");
  });

  it("tells the parent honestly when the hand-off could not be saved", async () => {
    const { deps, calls, askClaude } = fakes({ insertHandoff: async () => null });
    askClaude.mockResolvedValueOnce({ answer: answer({ topic: "complaint", handoff: "accounts", reply: "Sorry." }), model: "claude-haiku-5-5", careful: false, costUsd: 0.002, problem: null });
    expect(await runHelperTurn(inbound({ text: DISPUTE }), deps)).toEqual({ outcome: "answered", route: "ai", intent: "complaint", handoff: null });
    expect(bodyText(calls.sent[0])).toContain("could not be passed on just now");
    expect(calls.finished[0][1]).toMatchObject({ status: "answered", handoff: null, parentReplyId: null, reason: "handoff_not_saved" });
  });

  it("still hands off when no member of staff could be picked", async () => {
    const { deps, calls, askClaude } = fakes({ pickHandoffStaff: async () => Promise.reject(new Error("down")) });
    askClaude.mockResolvedValueOnce({ answer: answer({ topic: "complaint", handoff: "accounts", reply: "Sorry." }), model: "claude-haiku-5-5", careful: false, costUsd: 0.002, problem: null });
    expect(await runHelperTurn(inbound({ text: DISPUTE }), deps)).toMatchObject({ outcome: "answered", handoff: "accounts" });
    expect(calls.handoffs[0]).toMatchObject({ assignedStaffId: null, regarding: `Veer Patta AI · complaint: ${DISPUTE}` });
  });

  describe("a child who will be away (D-588)", () => {
    const AWAY = "Aarav is unwell and will not come today";
    const sickToday = {
      answer: answer({ topic: "leave", handoff: "class_teacher", reply: "I hope Aarav feels better soon.", child: aarav.key, summary: "Aarav is unwell, away today.", absence: { from: "today" as const, days: 1, reason: "sick" as const } }),
      model: null,
      careful: false,
      costUsd: 0.002,
      problem: null,
    };

    it("keeps the day once the hand-off is in Messages, and tells the parent the register will show it", async () => {
      const kept: unknown[] = [];
      const { deps, calls, askClaude } = fakes({
        saveAbsence: async (row) => {
          kept.push({ row, handoffsBefore: calls.handoffs.length });
          return true;
        },
      });
      askClaude.mockResolvedValueOnce(sickToday);
      expect(await runHelperTurn(inbound({ text: AWAY }), deps)).toEqual({ outcome: "answered", route: "ai", intent: "leave", handoff: "class_teacher" });
      expect(kept).toEqual([
        { row: { studentId: AARAV_ID, sessionLabel: "TEST-2026-27", days: ["2026-11-12"], reason: "sick", parentReplyId: REPLY_ID, practice: true }, handoffsBefore: 1 },
      ]);
      expect(calls.handoffs[0]).toMatchObject({ studentId: AARAV_ID, body: AWAY, regarding: "Veer Patta AI · leave: Aarav is unwell, away today." });
      const sent = bodyText(calls.sent[0]);
      expect(sent).toContain(`passed to *${aarav.firstName}*'s class teacher (TEST Teacher One)`);
      expect(sent).toContain("Today's register will show that you told the school.");
      expect(sent).toContain(`We hope *${aarav.firstName}* feels better soon.`);
      expect(calls.finished[0][1]).toMatchObject({ status: "answered", handoff: "class_teacher", parentReplyId: REPLY_ID, reason: null });
    });

    it.each<[string, Partial<HelperDeps>]>([
      ["could not be written", { saveAbsence: async () => false }],
      ["threw", { saveAbsence: async () => Promise.reject(new Error("down")) }],
      ["has nowhere to go", { saveAbsence: undefined }],
    ])("never promises the register when the note %s, and still passes the message on", async (_label, over) => {
      const { deps, calls, askClaude } = fakes(over);
      askClaude.mockResolvedValueOnce(sickToday);
      expect(await runHelperTurn(inbound({ text: AWAY }), deps)).toMatchObject({ outcome: "answered", handoff: "class_teacher" });
      const sent = bodyText(calls.sent[0]);
      expect(sent).toContain(`passed to *${aarav.firstName}*'s class teacher`);
      expect(sent).not.toContain("register");
      expect(sent).toContain("The school will get back to you.");
      expect(calls.finished[0][1]).toMatchObject({ handoff: "class_teacher", parentReplyId: REPLY_ID, reason: "absence_not_saved" });
    });

    it("keeps no note when the message itself could not be passed on", async () => {
      const saveAbsence = vi.fn(async () => true);
      const { deps, calls, askClaude } = fakes({ insertHandoff: async () => null, saveAbsence });
      askClaude.mockResolvedValueOnce(sickToday);
      expect(await runHelperTurn(inbound({ text: AWAY }), deps)).toMatchObject({ outcome: "answered", handoff: null });
      expect(saveAbsence).not.toHaveBeenCalled();
      expect(bodyText(calls.sent[0])).toContain("could not be passed on just now");
      expect(calls.finished[0][1]).toMatchObject({ reason: "handoff_not_saved" });
    });
  });

  it("falls back to the menu when Claude has no answer, and says why in the ledger", async () => {
    const { deps, calls, askClaude } = fakes();
    askClaude.mockResolvedValueOnce({ answer: null, model: "claude-opus-5-5", careful: true, costUsd: 0.01, problem: "timeout" });
    expect(await runHelperTurn(inbound({ text: DISPUTE }), deps)).toEqual({ outcome: "answered", route: "fallback", intent: "fallback", handoff: null });
    expect(bodyText(calls.sent[0])).toContain("Sorry, I did not understand that");
    expect(calls.finished[0][1]).toMatchObject({ reason: "ai_timeout", costUsd: 0.01 });
  });

  it("still answers once the message is claimed, even when Claude throws", async () => {
    const { deps, calls, askClaude } = fakes();
    askClaude.mockRejectedValueOnce(new Error("boom"));
    expect(await runHelperTurn(inbound({ text: DISPUTE }), deps)).toEqual({ outcome: "answered", route: "fallback", intent: "fallback", handoff: null });
    expect(calls.sent).toHaveLength(1);
    expect(calls.finished[0][1]).toMatchObject({ reason: "compose_crashed" });
  });

  const aiOff: Array<[string, Partial<HelperDeps>]> = [
    ["switched off", { readAiSettings: async () => ({ enabled: false, monthlyBudgetUsd: 25 }) }],
    ["over budget", { readBudget: async () => ({ spentUsd: 25, turnsToday: 3 }) }],
    ["unreadable", { readAiSettings: async () => null }],
    ["without a key", { hasClaudeKey: () => false }],
  ];
  it.each(aiOff)("does not ask Claude when the AI is %s", async (_label, over) => {
    const { deps, calls, askClaude } = fakes(over);
    expect(await runHelperTurn(inbound({ text: DISPUTE }), deps)).toEqual({ outcome: "answered", route: "fallback", intent: "fallback", handoff: null });
    expect(askClaude).not.toHaveBeenCalled();
    expect(calls.sent).toHaveLength(1);
  });
});

/* ------------------------------------------------------ when sending fails */

describe("step 2: hand-offs reach a person, and answers come back (D-578)", () => {
  it("a swiped reply to one of the helper's alerts is a staff answer, handled before anything else", async () => {
    const staffAnswer = vi.fn(async () => ({ outcome: "answered" as const, route: "rule" as const, intent: "staff_answer", handoff: "class_teacher" as const }));
    const { deps, calls } = fakes({ staffAnswer });
    const reply = inbound({ from: STRANGER, replyTo: "wamid.ALERT1", text: "Will send it tonight." });
    expect(await runHelperTurn(reply, deps)).toEqual({ outcome: "answered", route: "rule", intent: "staff_answer", handoff: "class_teacher" });
    expect(staffAnswer).toHaveBeenCalledWith(reply);
    expect(calls.started).toEqual([]);
    expect(calls.sent).toEqual([]);
  });

  it("any other message goes on as before, and a message that quotes nothing never asks", async () => {
    const staffAnswer = vi.fn(async () => null);
    expect(await runHelperTurn(inbound({ from: STRANGER, replyTo: "wamid.OTHER" }), fakes({ staffAnswer }).deps)).toEqual({ outcome: "skipped", reason: "unknown_number" });
    expect(staffAnswer).toHaveBeenCalledTimes(1);
    await runHelperTurn(inbound(), fakes({ staffAnswer }).deps);
    expect(staffAnswer).toHaveBeenCalledTimes(1);
  });

  it("an answer that waited goes first, and a bare 'ok' needs nothing more", async () => {
    const deliverWaiting = vi.fn(async () => 1);
    const { deps, calls, askClaude } = fakes({ deliverWaiting });
    expect(await runHelperTurn(inbound({ text: "ok thanks" }), deps)).toEqual({ outcome: "answered", route: "rule", intent: "answer_delivered", handoff: null });
    expect(deliverWaiting).toHaveBeenCalledWith(OWNER);
    // After the claim: the hub's bot must not answer as well.
    expect(calls.claims).toEqual(["wamid.TEST1"]);
    expect(calls.sent).toEqual([]);
    expect(askClaude).not.toHaveBeenCalled();
    expect(calls.finished).toEqual([["wamid.TEST1", expect.objectContaining({ status: "answered", intent: "answer_delivered", route: "rule" })]]);
  });

  it("a new question after a waiting answer is answered too", async () => {
    const { deps, calls } = fakes({ deliverWaiting: async () => 1 });
    expect(await runHelperTurn(inbound({ text: "fees" }), deps)).toMatchObject({ outcome: "answered", intent: "fees" });
    expect(calls.sent).toHaveLength(1);
  });

  it("once the parent is told it was passed on, the person it is for is told", async () => {
    const openHandoff = vi.fn(async () => undefined);
    const { deps, askClaude } = fakes({ openHandoff });
    askClaude.mockResolvedValueOnce({
      answer: answer({ topic: "complaint", handoff: "accounts", reply: "I am sorry about this.", summary: "Payment not showing." }),
      model: "claude-opus-5-5",
      careful: true,
      costUsd: 0.03,
      problem: null,
    });
    await runHelperTurn(inbound({ text: DISPUTE }), deps);
    expect(openHandoff).toHaveBeenCalledWith({
      parentReplyId: REPLY_ID,
      parentE164: OWNER,
      language: "en",
      target: "accounts",
      topic: "complaint",
      child: aarav,
      sessionLabel: "TEST-2026-27",
      fromName: "TEST Parent",
      practice: true,
    });
  });

  it("nobody is told when the parent's reply did not go, or nothing was passed on", async () => {
    const openHandoff = vi.fn(async () => undefined);
    const refused = fakes({
      openHandoff,
      send: async () => ({ outcome: "rejected", httpStatus: 400, errorCode: "131047", errorTitle: null, errorDetail: null }),
    });
    refused.askClaude.mockResolvedValueOnce({ answer: answer({ topic: "complaint", handoff: "accounts", reply: "Sorry." }), model: "claude-haiku-5-5", careful: false, costUsd: 0.002, problem: null });
    await runHelperTurn(inbound({ text: DISPUTE }), refused.deps);
    await runHelperTurn(inbound({ providerMessageId: "wamid.TEST2", text: "fees" }), fakes({ openHandoff }).deps);
    expect(openHandoff).not.toHaveBeenCalled();
  });
});

describe("did this answer help? (D-584)", () => {
  const ANSWERED_ID = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
  const KEY = "9f8e7d6c5b4a";
  /** The class teacher's answer the parent was asked about, in Hindi. */
  const ANSWERED: Handoff = {
    id: ANSWERED_ID,
    parentReplyId: "99999999-9999-4999-8999-999999999999",
    parentE164: OWNER,
    language: "hi",
    target: "class_teacher",
    topic: "message_teacher",
    complaint: false,
    practice: true,
    classTeacherId: "22222222-2222-4222-8222-222222222222",
    aboutName: "Aarav",
    level: 0,
    reminders: 0,
    levelAlertedAt: "2026-11-12T05:00:00.000Z",
    nextAction: null,
    nextActionAt: null,
    answeredAt: "2026-11-12T06:00:00.000Z",
    closedAt: null,
    sessionLabel: "TEST-2026-27",
    studentLabel: "Aarav · Class 6",
    fromName: "TEST Parent",
    body: "Please share today's homework",
    replyDone: true,
    studentId: AARAV_ID,
    ratingAskedAt: "2026-11-12T06:00:00.000Z",
    rating: "not_helped",
    followUpOf: null,
  };
  const NOTE = "अभिभावक / Parent: “Please share today's homework”\nजवाब / Answer (कक्षा अध्यापक / Class teacher TEST Teacher One): “Pages 12 and 13.”";

  function rateTap(id: string, title = "👎 No"): WebhookInbound {
    return inbound({ type: "interactive", text: title, raw: { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } } });
  }
  const buttonIds = (body: Record<string, unknown> | undefined) =>
    (body?.interactive as { action: { buttons: Array<{ reply: { id: string } }> } }).action.buttons.map((button) => button.reply.id);

  it("a no is put in Messages for the school office, the parent is told in the question's language, and then the office is told", async () => {
    let sentWhenOpened = -1;
    const openHandoff = vi.fn(async () => {
      sentWhenOpened = made.calls.sent.length;
    });
    const rateAnswer = vi.fn(async (): Promise<RateResult> => ({ outcome: "pass_on", handoff: ANSWERED, body: NOTE }));
    const made = fakes({ openHandoff, rateAnswer });
    const { deps, calls, askClaude } = made;

    expect(await runHelperTurn(rateTap(`vpai:not_helped:${KEY}`), deps)).toEqual({ outcome: "answered", route: "tap", intent: "rated_not_helped", handoff: "office" });
    expect(rateAnswer).toHaveBeenCalledWith({ from: OWNER, key: KEY, value: "not_helped" });
    expect(askClaude).not.toHaveBeenCalled();
    expect(calls.picked).toEqual([["office", null, "TEST-2026-27"]]);
    expect(calls.handoffs).toEqual([
      {
        sessionLabel: "TEST-2026-27",
        fromName: "TEST Parent",
        fromPhone: OWNER,
        studentId: AARAV_ID,
        studentLabel: "Aarav · Class 6",
        regarding: expect.stringContaining("answer did not help"),
        body: NOTE,
        receivedAt: new Date(NOW.getTime() - 3_000).toISOString(),
        assignedStaffId: STAFF_ID,
      },
    ]);
    expect(bodyText(calls.sent[0])).toContain("आपका सवाल और यह जवाब स्कूल ऑफ़िस तक पहुँचा दिया गया है");
    expect(calls.finished).toEqual([
      ["wamid.TEST1", expect.objectContaining({ status: "answered", intent: "rated_not_helped", route: "tap", handoff: "office", parentReplyId: REPLY_ID })],
    ]);
    expect(openHandoff).toHaveBeenCalledWith({
      parentReplyId: REPLY_ID,
      parentE164: OWNER,
      language: "hi",
      target: "office",
      topic: "not_helped",
      child: null,
      aboutName: "Aarav",
      followUpOf: ANSWERED_ID,
      sessionLabel: "TEST-2026-27",
      fromName: "TEST Parent",
      practice: true,
    });
    expect(sentWhenOpened).toBe(1);
  });

  it("a yes is thanked, and nothing goes to the office", async () => {
    const openHandoff = vi.fn(async () => undefined);
    const rateAnswer = vi.fn(async (): Promise<RateResult> => ({ outcome: "helped", handoff: { ...ANSWERED, language: "en", rating: "helped" } }));
    const { deps, calls } = fakes({ openHandoff, rateAnswer });
    expect(await runHelperTurn(rateTap(`vpai:helped:${KEY}`, "👍 Yes, it helped"), deps)).toEqual({ outcome: "answered", route: "tap", intent: "rated_helped", handoff: null });
    expect(bodyText(calls.sent[0])).toContain("We're glad it helped");
    expect(calls.handoffs).toEqual([]);
    expect(openHandoff).not.toHaveBeenCalled();
  });

  it.each([
    ["already", "rating_already", "that is already noted"],
    ["already_passed_on", "rating_passed_already", "The school office already has your question"],
    ["not_saved", "rating_not_saved", "It could not be passed on just now. Please call the office: 9352205884"],
  ] as const)("%s: answered as %s, and nothing new is written", async (outcome, intent, words) => {
    const openHandoff = vi.fn(async () => undefined);
    const rateAnswer = vi.fn(async (): Promise<RateResult> => ({ outcome, handoff: { ...ANSWERED, language: "en" } }));
    const { deps, calls } = fakes({ openHandoff, rateAnswer });
    expect(await runHelperTurn(rateTap(`vpai:not_helped:${KEY}`), deps)).toMatchObject({ outcome: "answered", intent, handoff: null });
    expect(bodyText(calls.sent[0])).toContain(words);
    expect(calls.handoffs).toEqual([]);
    expect(openHandoff).not.toHaveBeenCalled();
  });

  it("a no the helper cannot match to an answer is shown the way to the office; nothing is written", async () => {
    const rateAnswer = vi.fn(async (): Promise<RateResult> => ({ outcome: "unknown" }));
    const { deps, calls } = fakes({ rateAnswer });
    expect(await runHelperTurn(rateTap(`vpai:not_helped:${KEY}`), deps)).toEqual({ outcome: "answered", route: "tap", intent: "rating_unknown", handoff: null });
    expect(bodyText(calls.sent[0])).toContain("Tap *Talk to office* below");
    expect(buttonIds(calls.sent[0])).toEqual(["vpai:office", "vpai:menu"]);
    expect(calls.handoffs).toEqual([]);
    // A yes to one it cannot match is simply thanked.
    const yes = fakes({ rateAnswer: async () => ({ outcome: "unknown" }) });
    expect(await runHelperTurn(rateTap(`vpai:helped:${KEY}`, "👍 Yes, it helped"), yes.deps)).toMatchObject({ intent: "rating_unknown" });
    expect(bodyText(yes.calls.sent[0])).toContain("We're glad it helped");
  });

  it("a no that cannot be put in Messages is never called passed on, and nobody is told", async () => {
    const openHandoff = vi.fn(async () => undefined);
    const { deps, calls } = fakes({
      openHandoff,
      rateAnswer: async () => ({ outcome: "pass_on", handoff: { ...ANSWERED, language: "en" }, body: NOTE }),
      insertHandoff: async () => null,
    });
    expect(await runHelperTurn(rateTap(`vpai:not_helped:${KEY}`), deps)).toMatchObject({ outcome: "answered", intent: "rating_not_saved", handoff: null });
    expect(bodyText(calls.sent[0])).toContain("Please call the office: 9352205884");
    expect(calls.finished[0]![1]).toMatchObject({ reason: "handoff_not_saved", parentReplyId: null });
    expect(openHandoff).not.toHaveBeenCalled();
  });

  it("a rating that names no answer is not one of the helper's buttons: it is read as its words, and rates nothing", async () => {
    const rateAnswer = vi.fn(async (): Promise<RateResult> => ({ outcome: "unknown" }));
    const { deps, askClaude } = fakes({ rateAnswer });
    expect(await runHelperTurn(rateTap("vpai:not_helped"), deps)).toMatchObject({ outcome: "answered", route: "ai" });
    expect(rateAnswer).not.toHaveBeenCalled();
    expect(askClaude).toHaveBeenCalledTimes(1);
  });
});

describe("Link my WhatsApp (D-582)", () => {
  it("a member of staff sending their link code is handled before the parents' helper", async () => {
    const staffLink = vi.fn(async () => ({ outcome: "answered" as const, route: "rule" as const, intent: "staff_link", handoff: null }));
    const { deps, calls } = fakes({ staffLink });
    const message = inbound({ from: STRANGER, text: "Hello! Please link my WhatsApp to VPPS One.\nCode: ABCD-2345" });
    expect(await runHelperTurn(message, deps)).toEqual({ outcome: "answered", route: "rule", intent: "staff_link", handoff: null });
    expect(staffLink).toHaveBeenCalledWith(message);
    expect(calls.started).toEqual([]);
    expect(calls.sent).toEqual([]);
  });

  it("a message with no code goes on as before", async () => {
    const staffLink = vi.fn(async () => null);
    expect(await runHelperTurn(inbound({ from: STRANGER }), fakes({ staffLink }).deps)).toEqual({ outcome: "skipped", reason: "unknown_number" });
    expect(staffLink).toHaveBeenCalledTimes(1);
  });

  it("a link step that throws is an ordinary message, never a crash", async () => {
    const staffLink = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await runHelperTurn(inbound({ text: "fees" }), fakes({ staffLink }).deps)).toMatchObject({ outcome: "answered", intent: "fees" });
  });

  it("an old message is never looked at for a code", async () => {
    const staffLink = vi.fn(async () => null);
    await runHelperTurn(inbound({ at: new Date(NOW.getTime() - 3_600_000).toISOString() }), fakes({ staffLink }).deps);
    expect(staffLink).not.toHaveBeenCalled();
  });
});

describe("teach it once (D-589)", () => {
  const LESSON_A = "66666666-6666-4666-8666-666666666666";
  const LESSON_P = "77777777-7777-4777-8777-777777777777";
  const LESSON_NEW = "88888888-8888-4888-8888-888888888888";
  const SCHOOL: SchoolKnowledge = {
    answers: [{ key: "A1", id: LESSON_A, question: "What are the winter school timings?", answer: "From 1 November, 9 am to 3 pm." }],
    byPeople: [{ key: "P1", id: LESSON_P, question: "Can a child move to another section?" }],
  };

  function teaching(over: Partial<HelperDeps> = {}) {
    const notes: Array<[LessonNote, boolean, string | null]> = [];
    const kinds: boolean[] = [];
    const made = fakes({
      readKnowledge: async (practice) => {
        kinds.push(practice);
        return SCHOOL;
      },
      noteLesson: async (note, practice, topic) => {
        notes.push([note, practice, topic]);
        return note.lessonId ?? LESSON_NEW;
      },
      ...over,
    });
    return { ...made, notes, kinds };
  }

  const claude = (over: Partial<HelperAnswer>): ClaudeTurn => ({ answer: answer(over), model: "claude-haiku-5-5", careful: false, costUsd: 0.002, problem: null });

  it("Claude reads the practice family's school answers, and an answer given from one is counted on it", async () => {
    const { deps, calls, askClaude, notes, kinds } = teaching();
    askClaude.mockResolvedValueOnce(claude({ topic: "calendar", reply: "In winter, school runs from 9 am to 3 pm.", school_answer: "A1" }));
    expect(await runHelperTurn(inbound({ text: "what time does school open in winter" }), deps)).toEqual({ outcome: "answered", route: "ai", intent: "calendar", handoff: null });
    expect(kinds).toEqual([true]);
    expect(askClaude).toHaveBeenCalledWith(expect.objectContaining({ knowledge: SCHOOL }));
    expect(notes).toEqual([[{ role: "used", lessonId: LESSON_A }, true, "calendar"]]);
    expect(calls.finished[0][1]).toMatchObject({ status: "answered", lessonId: LESSON_A, lessonRole: "used" });
    expect(calls.handoffs).toEqual([]);
  });

  it("a general question nothing answers goes to the office as before, and onto the list in Claude's general words", async () => {
    const { deps, calls, askClaude, notes } = teaching();
    askClaude.mockResolvedValueOnce(
      claude({ topic: "calendar", handoff: "office", reply: "I will ask the school.", summary: "Parent asks the date of sports day.", unanswered: { question: "When is sports day this year?", same_as: null } }),
    );
    expect(await runHelperTurn(inbound({ text: "sports day kab hai" }), deps)).toMatchObject({ outcome: "answered", handoff: "office" });
    expect(calls.handoffs).toHaveLength(1);
    expect(notes).toEqual([[{ role: "asked", lessonId: null, question: "When is sports day this year?", fingerprint: "when is sports day this year" }, true, "calendar"]]);
    expect(calls.finished[0][1]).toMatchObject({ handoff: "office", lessonId: LESSON_NEW, lessonRole: "asked" });
  });

  it("a question a person always answers is counted there", async () => {
    const { deps, askClaude, notes } = teaching();
    askClaude.mockResolvedValueOnce(
      claude({ topic: "request", handoff: "office", reply: "I will pass this on.", unanswered: { question: "Can a child change section?", same_as: "P1" } }),
    );
    await runHelperTurn(inbound({ text: "section change ho sakta hai?" }), deps);
    expect(notes[0][0]).toMatchObject({ role: "asked", lessonId: LESSON_P });
  });

  it("never keeps a question that names the family", async () => {
    const { deps, calls, askClaude, notes } = teaching();
    askClaude.mockResolvedValueOnce(
      claude({ topic: "other", handoff: "office", reply: "I will ask.", unanswered: { question: "Can Sunil Rawat pay the bus fee at the bank?", same_as: null } }),
    );
    await runHelperTurn(inbound({ text: "bank me bus fee?", fromName: "Sunil Rawat" }), deps);
    expect(notes).toEqual([]);
    expect(calls.finished[0][1]).not.toHaveProperty("lessonId");
  });

  it("keeps nothing when the school's answers could not be read: Claude never saw them", async () => {
    const { deps, askClaude, notes } = teaching({ readKnowledge: async () => null });
    askClaude.mockResolvedValueOnce(claude({ topic: "calendar", handoff: "office", unanswered: { question: "When is sports day this year?", same_as: null } }));
    await runHelperTurn(inbound({ text: "sports day?" }), deps);
    expect(askClaude).toHaveBeenCalledWith(expect.objectContaining({ knowledge: NO_KNOWLEDGE }));
    expect(notes).toEqual([]);
  });

  it("keeps nothing when the reply did not reach the parent, or the answer came from a card", async () => {
    const rejected = teaching({ send: async () => ({ outcome: "rejected", httpStatus: 403, errorCode: "test_mode", errorTitle: "Test mode", errorDetail: null }) });
    rejected.askClaude.mockResolvedValueOnce(claude({ topic: "calendar", school_answer: "A1" }));
    expect(await runHelperTurn(inbound({ text: "winter timing?" }), rejected.deps)).toMatchObject({ outcome: "failed" });
    expect(rejected.notes).toEqual([]);

    const card = teaching();
    await runHelperTurn(inbound({ text: "fees" }), card.deps);
    expect(card.askClaude).not.toHaveBeenCalled();
    expect(card.notes).toEqual([]);
  });

  it("a list that cannot be written never stops the answer", async () => {
    const { deps, calls, askClaude } = teaching({ noteLesson: async () => Promise.reject(new Error("down")) });
    askClaude.mockResolvedValueOnce(claude({ topic: "calendar", school_answer: "A1" }));
    expect(await runHelperTurn(inbound({ text: "winter timing?" }), deps)).toMatchObject({ outcome: "answered" });
    expect(calls.finished[0][1]).toMatchObject({ status: "answered" });
    expect(calls.finished[0][1]).not.toHaveProperty("lessonId");
  });

  it("marks the ledger row as the practice family's", async () => {
    const rows: Array<Parameters<HelperDeps["startTurn"]>[0]> = [];
    const { deps } = teaching({
      startTurn: async (row) => {
        rows.push(row);
        return "started";
      },
    });
    await runHelperTurn(inbound(), deps);
    expect(rows[0]).toMatchObject({ practice: true });
  });
});

describe("when the reply cannot be sent", () => {
  it("sends plain words once when Meta refuses the buttons", async () => {
    const results: ProviderSendResult[] = [
      { outcome: "rejected", httpStatus: 400, errorCode: "131009", errorTitle: "Parameter value is not valid", errorDetail: null },
      { outcome: "accepted", messageId: "wamid.PLAIN", httpStatus: 200 },
    ];
    const sent: Record<string, unknown>[] = [];
    const { deps, calls } = fakes({
      send: async (body) => {
        sent.push(body);
        return results.shift() as ProviderSendResult;
      },
    });
    expect(await runHelperTurn(inbound({ text: "menu" }), deps)).toEqual({ outcome: "answered", route: "rule", intent: "menu", handoff: null });
    expect(sent.map((body) => body.type)).toEqual(["interactive", "text"]);
    expect(bodyText(sent[1])).toContain("Here is the menu");
    expect(calls.finished[0][1]).toMatchObject({ status: "answered", reason: "sent_as_plain_text", replyMessageId: "wamid.PLAIN" });
  });

  it("does not retry what the hub itself refused, and keeps the chat as it was", async () => {
    const sent: Record<string, unknown>[] = [];
    const { deps, calls } = fakes({
      send: async (body) => {
        sent.push(body);
        return { outcome: "rejected", httpStatus: 403, errorCode: "test_mode", errorTitle: "Test mode", errorDetail: null };
      },
    });
    expect(await runHelperTurn(inbound({ text: "menu" }), deps)).toEqual({ outcome: "failed", reason: "send_rejected:test_mode" });
    expect(sent).toHaveLength(1);
    expect(calls.finished[0][1]).toMatchObject({ status: "failed", reason: "send_rejected:test_mode" });
    expect(calls.saved).toEqual([]);
  });

  it("files a lost answer as unknown", async () => {
    const { deps } = fakes({ send: async () => ({ outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "Network" }) });
    expect(await runHelperTurn(inbound(), deps)).toEqual({ outcome: "failed", reason: "send_unknown:network" });
  });
});

/* ------------------------------------------------------ several at once */

describe("several messages in one delivery", () => {
  it("runs each on its own, and a crash in one never stops another", async () => {
    const { deps } = fakes({
      startTurn: async (row) => {
        if (row.providerMessageId === "wamid.BAD") throw new Error("ledger exploded");
        return "started";
      },
    });
    const outcomes = await runHelperTurns([inbound({ providerMessageId: "wamid.BAD", text: DISPUTE }), inbound({ providerMessageId: "wamid.GOOD" })], deps);
    expect(outcomes).toEqual([
      { outcome: "failed", reason: "crashed" },
      { outcome: "answered", route: "rule", intent: "fees", handoff: null },
    ]);
    expect(await runHelperTurns([], deps)).toEqual([]);
  });

  it("never puts a parent's words or whole number in the logs", async () => {
    const { deps } = fakes({
      startTurn: async () => {
        throw new Error("ledger exploded");
      },
    });
    await runHelperTurns([inbound({ text: DISPUTE }), inbound({ providerMessageId: "wamid.X", from: STRANGER, text: DISPUTE })], deps);
    const logged = JSON.stringify([...log.logInfo.mock.calls, ...log.logWarn.mock.calls]);
    expect(log.logWarn).toHaveBeenCalledWith("whatsapp.helper.turn_crashed", expect.anything());
    expect(logged).not.toContain(DISPUTE);
    expect(logged).not.toContain("9000000001");
    // A stranger's message is not even logged: most of the school's chats are not One's.
    expect(logged).not.toContain("1111111");
  });
});
