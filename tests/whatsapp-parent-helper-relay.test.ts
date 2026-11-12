import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/whatsapp/data/helper-store", () => ({
  finishTurn: vi.fn(),
  readChat: vi.fn(),
  readHelperSettings: vi.fn(),
  saveChat: vi.fn(),
  startTurn: vi.fn(),
}));
vi.mock("@/modules/whatsapp/data/helper-handoffs", () => ({}));
vi.mock("@/platform/whatsapp/store", () => ({ readSwitches: vi.fn(), readTemplateRow: vi.fn() }));
const log = vi.hoisted(() => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/platform/observability/log", () => log);

import type { AlertRecord, DeliveryRecord, Handoff, HandoffPatch, NewHandoff, Person, WaitingAnswer } from "@/modules/whatsapp/data/helper-handoffs";
import {
  deliverWaitingAnswers,
  handleStaffAnswer,
  openHandoff,
  relayFromMessages,
  runDueHandoffs,
  reachOf,
  runHandoffStep,
  type RelayDeps,
} from "@/modules/whatsapp/data/helper-relay";
import type { TurnFinish } from "@/modules/whatsapp/data/helper-store";
import { childFactsFromRow, type ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import { EMPTY_CHAT, type ChatState } from "@/modules/whatsapp/domain/helper-plan";
import type { WhatsAppConfig } from "@/platform/whatsapp/config";
import type { TemplateRow, WhatsAppSwitches } from "@/platform/whatsapp/policy";
import type { ProviderSendResult } from "@/platform/whatsapp/providers";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";

/**
 * Veer Patta AI, step 2 (D-578): a hand-off reaching a person, their swiped
 * answer reaching the parent, reminders and passing up. Every name and number
 * here is made up (rule 6).
 */

/** 12:00 in India. */
const NOON = new Date("2026-11-12T06:30:00Z");
const HOUR = 3_600_000;
const OWNER = "+919000000001";
const TEACHER_PHONE = "+919000000002";
const ADMIN_PHONE = "+919000000003";
const REPLY_ID = "55555555-5555-4555-8555-555555555555";
const TEACHER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "66666666-6666-4666-8666-666666666666";
const ACCOUNTANT_ID = "77777777-7777-4777-8777-777777777777";

const HUB: WhatsAppConfig = { ok: true, provider: "hub", hubUrl: "https://hub.example.test", hubKey: "k", senderNumber: "+918302207823" };

/** Real recipients on, as they will be for real families; the practice tests turn them off, as they are today. */
function switches(over: Partial<WhatsAppSwitches> = {}): WhatsAppSwitches {
  return { dryRun: false, features: { parent_helper: true }, realRecipients: true, ownerTestNumber: OWNER, dailyLimit: 250, feeSender: "fees", ...over };
}
const TODAY = switches({ realRecipients: false });

const aarav = childFactsFromRow({
  today: "2026-11-12",
  student: { id: "11111111-1111-4111-8111-111111111111", full_name: "AARAV TEST", class_id: "c6", status: "active", session_label: "TEST-2026-27", class_name: "Class 6", section: null, stream_name: null },
  installments: [],
  receipts: [],
  attendance: null,
  days: [],
  results: [],
  class_teacher: { staff_id: TEACHER_ID, name: "TEST Teacher One", is_test: true },
  calendar: [],
}) as ChildFacts;

const teacher: Person = { staffId: TEACHER_ID, name: "TEST Teacher One", role: "teacher", e164: TEACHER_PHONE, consented: true, language: "en", isClassTeacher: true };
const admin: Person = { staffId: ADMIN_ID, name: "TEST Admin", role: "admin", e164: ADMIN_PHONE, consented: true, language: "hi", isClassTeacher: false };
const accountant: Person = { staffId: ACCOUNTANT_ID, name: "TEST Accountant", role: "accountant", e164: null, consented: false, language: "en", isClassTeacher: false };

function template(key: string, status = "approved"): TemplateRow {
  const blanks = key.includes("staff") ? 4 : 2;
  return { key, provider_name: key, language_code: key.includes("_en_") ? "en" : "hi", feature: "parent_helper", body_params: blanks, header: "none", url_button: false, status };
}

type World = {
  handoffs: Map<string, Handoff>;
  alerts: AlertRecord[];
  answers: Array<{ id: string; replyId: string; body: string; answeredBy: string }>;
  deliveries: Map<string, DeliveryRecord & { status: DeliveryRecord["status"] }>;
  sent: Array<Record<string, unknown>>;
  finished: Array<[string, TurnFinish]>;
  saved: string[];
  done: Array<[string, string]>;
  started: string[];
  /** When each number last wrote, as the helper's chat memory has it. */
  chats: Map<string, string>;
  people: Person[] | null;
};

function handoffRow(over: Partial<Handoff> = {}): Handoff {
  return {
    id: "h1",
    parentReplyId: REPLY_ID,
    parentE164: OWNER,
    language: "en",
    target: "class_teacher",
    topic: "message_teacher",
    complaint: false,
    practice: false,
    classTeacherId: TEACHER_ID,
    aboutName: "Aarav",
    level: 0,
    reminders: 0,
    levelAlertedAt: null,
    nextAction: "alert",
    nextActionAt: NOON.toISOString(),
    answeredAt: null,
    closedAt: null,
    sessionLabel: "TEST-2026-27",
    studentLabel: "Aarav · Class 6",
    fromName: "TEST Parent",
    body: "Please share today's homework",
    replyDone: false,
    ...over,
  };
}

function world(over: { now?: Date; switches?: WhatsAppSwitches | null; templates?: Record<string, TemplateRow | null>; send?: RelayDeps["send"]; people?: Person[] | null } = {}) {
  let clock = over.now ?? NOON;
  const w: World = {
    handoffs: new Map(),
    alerts: [],
    answers: [],
    deliveries: new Map(),
    sent: [],
    finished: [],
    saved: [],
    done: [],
    started: [],
    chats: new Map(),
    people: over.people === undefined ? [teacher] : over.people,
  };
  let messageNo = 0;
  const deps: RelayDeps = {
    now: () => clock,
    readConfig: () => HUB,
    readSwitches: async () => (over.switches === undefined ? switches() : over.switches),
    readHelperName: async () => "Veer Patta AI",
    readTemplateRow: async (key) => (over.templates && key in over.templates ? over.templates[key]! : template(key)),
    readChat: async (from): Promise<ChatState> => ({ ...EMPTY_CHAT, lastTurnAt: w.chats.get(from) ?? null }),
    saveChat: async (from) => {
      w.saved.push(from);
    },
    send:
      over.send ??
      (async (body): Promise<ProviderSendResult> => {
        w.sent.push(body);
        messageNo += 1;
        return { outcome: "accepted", messageId: `wamid.OUT${messageNo}`, httpStatus: 200 };
      }),
    claim: async () => ({ ok: true, claimed: true, typing: true, staff: false, stale: false, takenBy: null }),
    startTurn: async (row) => {
      if (w.started.includes(row.providerMessageId)) return "duplicate";
      w.started.push(row.providerMessageId);
      return "started";
    },
    finishTurn: async (id, finish) => {
      w.finished.push([id, finish]);
    },
    createHandoff: async (row: NewHandoff) => {
      const id = `h${w.handoffs.size + 1}`;
      w.handoffs.set(
        id,
        handoffRow({
          id,
          ...row,
          studentLabel: row.aboutName === "Aarav" ? "Aarav · Class 6" : null,
          levelAlertedAt: null,
        }),
      );
      return id;
    },
    readHandoff: async (id) => {
      const row = w.handoffs.get(id);
      return row ? { ...row } : null;
    },
    readHandoffForReply: async (replyId) => [...w.handoffs.values()].find((row) => row.parentReplyId === replyId) ?? null,
    updateHandoff: async (id, patch: HandoffPatch) => {
      const row = w.handoffs.get(id);
      if (!row) return false;
      const next = { ...row };
      if (patch.level !== undefined) next.level = patch.level;
      if (patch.reminders !== undefined) next.reminders = patch.reminders;
      if (patch.levelAlertedAt !== undefined) next.levelAlertedAt = patch.levelAlertedAt;
      if (patch.nextAction !== undefined) {
        next.nextAction = patch.nextAction;
        next.nextActionAt = patch.nextAction ? (patch.nextActionAt ?? null) : null;
      }
      if (patch.answeredAt !== undefined) next.answeredAt = patch.answeredAt;
      if (patch.closedAt !== undefined) next.closedAt = patch.closedAt;
      w.handoffs.set(id, next);
      return true;
    },
    readPeopleToTell: async (_handoff, level) => (level > 0 ? [admin] : w.people),
    readPerson: async (staffId) => [teacher, admin, accountant].find((person) => person.staffId === staffId) ?? null,
    insertAlert: async (row) => {
      w.alerts.push(row);
      return true;
    },
    findAlert: async (messageId) => {
      const alert = w.alerts.find((row) => row.messageId === messageId && row.status === "sent");
      return alert ? { handoffId: alert.handoffId, staffId: alert.staffId, toE164: alert.toE164 } : null;
    },
    insertAnswer: async (row) => {
      const id = `a${w.answers.length + 1}`;
      w.answers.push({ id, ...row });
      return id;
    },
    markReplyDone: async (replyId, staffId) => {
      w.done.push([replyId, staffId]);
    },
    insertDelivery: async (row) => {
      w.deliveries.set(row.answerId, { ...row });
      return true;
    },
    takeWaiting: async (answerId) => {
      const row = w.deliveries.get(answerId);
      if (!row || row.status !== "waiting") return false;
      w.deliveries.set(answerId, { ...row, status: "sent" });
      return true;
    },
    finishDelivery: async (answerId, write) => {
      const row = w.deliveries.get(answerId);
      if (row) w.deliveries.set(answerId, { ...row, status: write.status, messageId: write.messageId, reason: write.reason });
    },
    readWaitingAnswers: async (parentE164): Promise<WaitingAnswer[]> =>
      [...w.deliveries.values()]
        .filter((row) => row.status === "waiting" && w.handoffs.get(row.handoffId)?.parentE164 === parentE164)
        .map((row) => {
          const answer = w.answers.find((candidate) => candidate.id === row.answerId)!;
          return {
            answerId: row.answerId,
            handoffId: row.handoffId,
            answerBody: answer.body,
            answeredBy: answer.answeredBy,
            answererKind: row.answererKind,
            answererName: row.answererName,
            createdAt: NOON.toISOString(),
          };
        }),
    takeDueHandoffs: async () =>
      [...w.handoffs.values()].filter((row) => row.nextAction && row.nextActionAt && Date.parse(row.nextActionAt) <= clock.getTime()).map((row) => row.id),
  };
  return { deps, w, setNow: (at: Date) => (clock = at) };
}

const textOf = (body: Record<string, unknown>) => (body.text as { body: string } | undefined)?.body ?? "";
const templateOf = (body: Record<string, unknown>) => (body.template as { name: string } | undefined)?.name ?? null;

function staffReply(over: Partial<WebhookInbound> = {}): WebhookInbound {
  return {
    providerMessageId: "wamid.ANSWER1",
    from: TEACHER_PHONE,
    fromName: "TEST Teacher One",
    type: "text",
    text: "Pages 12 and 13 of the maths book.",
    replyTo: "wamid.OUT1",
    at: new Date(NOON.getTime() - 2_000).toISOString(),
    raw: { type: "text" },
    ...over,
  };
}

const openInput = (over: Partial<Parameters<typeof openHandoff>[0]> = {}) => ({
  parentReplyId: REPLY_ID,
  parentE164: OWNER,
  language: "en" as const,
  target: "class_teacher" as const,
  topic: "message_teacher",
  child: aarav,
  sessionLabel: "TEST-2026-27",
  fromName: "TEST Parent",
  practice: false,
  ...over,
});

describe("a hand-off reaches the person it is for", () => {
  it("in the day: the class teacher is told at once, typed while their chat is open, and a reminder is set for 3 hours", async () => {
    const { deps, w } = world();
    w.chats.set(TEACHER_PHONE, new Date(NOON.getTime() - HOUR).toISOString());
    const opened = await openHandoff(openInput(), deps);
    expect(opened.step?.told).toBe(1);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.to).toBe("919000000002");
    expect(textOf(w.sent[0]!)).toContain("A parent's message for you");
    expect(w.alerts).toEqual([
      { handoffId: "h1", staffId: TEACHER_ID, toE164: TEACHER_PHONE, kind: "alert", via: "text", status: "sent", reason: null, messageId: "wamid.OUT1" },
    ]);
    const row = w.handoffs.get("h1")!;
    expect(row).toMatchObject({ classTeacherId: TEACHER_ID, complaint: false, nextAction: "remind", levelAlertedAt: NOON.toISOString() });
    expect(row.nextActionAt).toBe(new Date(NOON.getTime() + 3 * HOUR).toISOString());
  });

  it("the approved staff template when their chat is not open", async () => {
    const { deps, w } = world();
    await openHandoff(openInput(), deps);
    expect(templateOf(w.sent[0]!)).toBe("vpps_staff_parent_question_en_v1");
    expect(w.alerts[0]).toMatchObject({ via: "template", status: "sent" });
  });

  it("the template too when Meta says a chat we thought open has closed", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const { deps, w } = world({
      send: async (body) => {
        sent.push(body);
        return sent.length === 1
          ? { outcome: "rejected", httpStatus: 400, errorCode: "window_closed", errorTitle: null, errorDetail: null }
          : { outcome: "accepted", messageId: "wamid.T2", httpStatus: 200 };
      },
    });
    w.chats.set(TEACHER_PHONE, new Date(NOON.getTime() - HOUR).toISOString());
    await openHandoff(openInput(), deps);
    expect(sent.map((body) => body.type)).toEqual(["text", "template"]);
    expect(w.alerts).toEqual([expect.objectContaining({ via: "template", status: "sent", messageId: "wamid.T2" })]);
  });

  it("at night: nobody is told until 6 am", async () => {
    const { deps, w } = world({ now: new Date("2026-11-12T16:00:00Z") });
    const opened = await openHandoff(openInput(), deps);
    expect(opened.step).toBeNull();
    expect(w.sent).toEqual([]);
    expect(w.handoffs.get("h1")).toMatchObject({ nextAction: "alert", nextActionAt: "2026-11-13T00:30:00.000Z" });
  });

  it("a job that runs at night anyway waits for 6 am", async () => {
    const { deps, w, setNow } = world();
    await deps.createHandoff({ ...openInput(), complaint: false, classTeacherId: TEACHER_ID, aboutName: "Aarav", nextAction: "alert", nextActionAt: NOON.toISOString() });
    setNow(new Date("2026-11-12T17:00:00Z"));
    expect(await runHandoffStep("h1", deps)).toEqual({ outcome: "waiting", told: 0, next: "alert" });
    expect(w.sent).toEqual([]);
    expect(w.handoffs.get("h1")!.nextActionAt).toBe("2026-11-13T00:30:00.000Z");
  });

  it("practice: only the owner's number, in place of the test account, and only one person", async () => {
    const { deps, w } = world({ people: [{ ...accountant, e164: null }, admin], switches: TODAY });
    w.chats.set(OWNER, new Date(NOON.getTime() - 60_000).toISOString());
    await openHandoff(openInput({ target: "accounts", topic: "fees", practice: true }), deps);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.to).toBe("919000000001");
    expect(textOf(w.sent[0]!)).toContain("in place of TEST Accountant");
    expect(w.alerts).toEqual([expect.objectContaining({ staffId: ACCOUNTANT_ID, toE164: OWNER, status: "sent" })]);
  });

  it("fees: the accountant and an admin; someone with no number is noted, not skipped silently", async () => {
    const { deps, w } = world({ people: [accountant, admin] });
    await openHandoff(openInput({ target: "accounts", topic: "fees" }), deps);
    expect(w.alerts.map((alert) => [alert.staffId, alert.status, alert.reason])).toEqual([
      [ACCOUNTANT_ID, "skipped", "no_number"],
      [ADMIN_ID, "sent", null],
    ]);
    expect(templateOf(w.sent[0]!)).toBe("vpps_staff_parent_question_hi_v1");
  });

  it("a number on file is not a yes: someone who never agreed, or stopped, is noted and sent nothing (D-582)", async () => {
    const { deps, w } = world({ people: [{ ...teacher, consented: false }] });
    await openHandoff(openInput(), deps);
    expect(w.sent).toEqual([]);
    expect(w.alerts).toEqual([expect.objectContaining({ staffId: TEACHER_ID, toE164: null, status: "skipped", reason: "no_consent" })]);
    // Nobody to tell and not a complaint: it stays with the office in Messages.
    expect(w.handoffs.get("h1")).toMatchObject({ nextAction: null, nextActionAt: null });
  });

  it("a complaint whose class teacher never said yes goes straight up to an admin", async () => {
    const { deps, w } = world({ people: [{ ...teacher, consented: false }] });
    await openHandoff(openInput({ topic: "complaint" }), deps);
    expect(w.handoffs.get("h1")).toMatchObject({ complaint: true, nextAction: "pass_up" });
    await runHandoffStep("h1", deps);
    expect(w.alerts.map((alert) => [alert.staffId, alert.status, alert.reason])).toEqual([
      [TEACHER_ID, "skipped", "no_consent"],
      [ADMIN_ID, "sent", null],
    ]);
  });

  it("practice asks no yes of the test account: the owner's number stands in for it", async () => {
    const { deps, w } = world({ people: [{ ...teacher, e164: null, consented: false }], switches: TODAY });
    w.chats.set(OWNER, new Date(NOON.getTime() - 60_000).toISOString());
    await openHandoff(openInput({ practice: true }), deps);
    expect(w.alerts).toEqual([expect.objectContaining({ staffId: TEACHER_ID, toE164: OWNER, status: "sent" })]);
  });

  it("practice mode or the helper switched off: nothing is sent and nothing more is planned", async () => {
    const { deps, w } = world({ switches: switches({ dryRun: true }) });
    await openHandoff(openInput(), deps);
    expect(w.sent).toEqual([]);
    expect(w.alerts[0]).toMatchObject({ status: "skipped", reason: "practice_mode" });
    expect(w.handoffs.get("h1")).toMatchObject({ nextAction: null, nextActionAt: null });
  });

  it("templates not approved yet: noted, and a reminder still planned (their chat may open meanwhile)", async () => {
    const { deps, w } = world({ templates: { vpps_staff_parent_question_en_v1: template("vpps_staff_parent_question_en_v1", "pending") } });
    await openHandoff(openInput(), deps);
    expect(w.sent).toEqual([]);
    expect(w.alerts[0]).toMatchObject({ status: "skipped", reason: "template_not_approved" });
    expect(w.handoffs.get("h1")!.nextAction).toBe("remind");
  });

  it("a complaint whose class teacher cannot be reached goes straight up to an admin", async () => {
    const { deps, w } = world({ people: [] });
    await openHandoff(openInput({ topic: "complaint" }), deps);
    expect(w.handoffs.get("h1")).toMatchObject({ complaint: true, nextAction: "pass_up", nextActionAt: NOON.toISOString() });
    await runHandoffStep("h1", deps);
    expect(w.alerts).toEqual([expect.objectContaining({ staffId: ADMIN_ID, kind: "passed_up", status: "sent" })]);
    expect(w.handoffs.get("h1")).toMatchObject({ level: 1, reminders: 0, nextAction: "remind" });
  });

  it("anything else nobody can be told about stays with the office in Messages", async () => {
    const { deps, w } = world({ people: [] });
    await openHandoff(openInput(), deps);
    expect(w.handoffs.get("h1")).toMatchObject({ nextAction: null });
  });

  it("a staff list that cannot be read is tried again in 15 minutes", async () => {
    const { deps, w } = world({ people: null });
    await openHandoff(openInput(), deps);
    expect(w.handoffs.get("h1")).toMatchObject({ nextAction: "alert", nextActionAt: new Date(NOON.getTime() + 15 * 60_000).toISOString() });
  });
});

describe("reminders and passing up, from the five-minute job", () => {
  it("a complaint: alert, a reminder after 3 hours, an admin after a day, one reminder to them, then quiet", async () => {
    const { deps, w, setNow } = world();
    await openHandoff(openInput({ topic: "complaint" }), deps);
    expect(w.handoffs.get("h1")!.nextAction).toBe("remind");

    setNow(new Date(NOON.getTime() + 3 * HOUR));
    expect(await runDueHandoffs(deps)).toMatchObject({ taken: 1, done: 1, told: 1 });
    expect(w.alerts.at(-1)).toMatchObject({ kind: "reminder", staffId: TEACHER_ID });
    expect(w.handoffs.get("h1")).toMatchObject({ reminders: 1, nextAction: "pass_up", nextActionAt: new Date(NOON.getTime() + 24 * HOUR).toISOString() });

    setNow(new Date(NOON.getTime() + 24 * HOUR));
    await runDueHandoffs(deps);
    expect(w.alerts.at(-1)).toMatchObject({ kind: "passed_up", staffId: ADMIN_ID });
    expect(textOf(w.sent.at(-1)!) || templateOf(w.sent.at(-1)!)).toBeTruthy();

    setNow(new Date(NOON.getTime() + 27 * HOUR));
    await runDueHandoffs(deps);
    expect(w.alerts.at(-1)).toMatchObject({ kind: "reminder", staffId: ADMIN_ID });
    expect(w.handoffs.get("h1")).toMatchObject({ level: 1, reminders: 1, nextAction: null });
    expect(w.alerts).toHaveLength(4);
  });

  it("an answer, or the message marked done in Messages, stops everything", async () => {
    const { deps, w, setNow } = world();
    await openHandoff(openInput(), deps);
    w.handoffs.set("h1", { ...w.handoffs.get("h1")!, replyDone: true });
    setNow(new Date(NOON.getTime() + 3 * HOUR));
    expect(await runHandoffStep("h1", deps)).toEqual({ outcome: "closed", told: 0, next: null });
    expect(w.alerts).toHaveLength(1);
    expect(w.handoffs.get("h1")!.closedAt).toBe(new Date(NOON.getTime() + 3 * HOUR).toISOString());
  });
});

describe("a swiped answer goes back to the parent", () => {
  async function alerted(options: Parameters<typeof world>[0] = {}) {
    const made = world(options);
    made.w.chats.set(TEACHER_PHONE, new Date(NOON.getTime() - HOUR).toISOString());
    await openHandoff(openInput(), made.deps);
    made.w.sent.length = 0;
    return made;
  }

  it("is saved in Messages, sent to the parent while their chat is open, and the teacher is thanked", async () => {
    const { deps, w } = await alerted();
    w.chats.set(OWNER, new Date(NOON.getTime() - 2 * HOUR).toISOString());
    const outcome = await handleStaffAnswer(staffReply(), deps);
    expect(outcome).toEqual({ outcome: "answered", route: "rule", intent: "staff_answer", handoff: "class_teacher" });
    expect(w.answers).toEqual([{ id: "a1", replyId: REPLY_ID, body: "Pages 12 and 13 of the maths book.", answeredBy: TEACHER_ID }]);
    expect(w.sent.map((body) => body.to)).toEqual(["919000000001", "919000000002"]);
    expect(textOf(w.sent[0]!)).toBe(
      "💬 *Answer from TEST Teacher One, class teacher*\n_Your message about Aarav: “Please share today's homework”_\n\nPages 12 and 13 of the maths book.",
    );
    expect(textOf(w.sent[1]!)).toBe("✅ Your answer has gone to the parent of Aarav · Class 6. Thank you!");
    expect(w.deliveries.get("a1")).toMatchObject({ status: "sent", via: "text", answererKind: "class_teacher", answererName: "TEST Teacher One" });
    expect(w.handoffs.get("h1")).toMatchObject({ answeredAt: NOON.toISOString(), nextAction: null });
    expect(w.done).toEqual([[REPLY_ID, TEACHER_ID]]);
    expect(w.finished).toEqual([["wamid.ANSWER1", expect.objectContaining({ status: "answered", intent: "staff_answer", route: "rule", replyMessageId: "wamid.OUT3" })]]);
    expect(w.saved).toEqual([TEACHER_PHONE]);
  });

  it("a parent who has gone quiet gets the approved note, and the answer waits for their reply", async () => {
    const { deps, w } = await alerted();
    await handleStaffAnswer(staffReply(), deps);
    expect(templateOf(w.sent[0]!)).toBe("vpps_parent_answer_ready_en_v1");
    expect(w.sent[0]!.template).toMatchObject({
      components: [{ type: "body", parameters: [{ type: "text", text: "Class teacher TEST Teacher One" }, { type: "text", text: "Aarav" }] }],
    });
    expect(textOf(w.sent[1]!)).toContain("they get yours the moment they reply");
    expect(w.deliveries.get("a1")).toMatchObject({ status: "waiting", via: "template" });

    // The parent writes again: the answer goes first, once.
    expect(await deliverWaitingAnswers(OWNER, deps)).toBe(1);
    expect(textOf(w.sent.at(-1)!)).toContain("Pages 12 and 13 of the maths book.");
    expect(await deliverWaitingAnswers(OWNER, deps)).toBe(0);
    expect(w.deliveries.get("a1")!.status).toBe("sent");
  });

  it("when the note cannot go either, the teacher is told it has not reached the parent, and Messages stays open", async () => {
    const { deps, w } = await alerted({ templates: { vpps_parent_answer_ready_en_v1: null } });
    await handleStaffAnswer(staffReply(), deps);
    expect(textOf(w.sent[0]!)).toContain("could not be sent to the parent");
    expect(w.deliveries.get("a1")).toMatchObject({ status: "waiting", reason: "note_not_sent:template_not_approved" });
    expect(w.done).toEqual([]);
  });

  it("a voice note or photo is not passed on: the teacher is asked to type", async () => {
    const { deps, w } = await alerted();
    await handleStaffAnswer(staffReply({ type: "audio", text: null, raw: { type: "audio" } }), deps);
    expect(w.answers).toEqual([]);
    expect(textOf(w.sent[0]!)).toContain("type your answer as words");
  });

  it("is only an answer when it quotes an alert and comes from the number the alert went to", async () => {
    const { deps, w } = await alerted();
    expect(await handleStaffAnswer(staffReply({ replyTo: null }), deps)).toBeNull();
    expect(await handleStaffAnswer(staffReply({ replyTo: "wamid.SOMETHING_ELSE" }), deps)).toBeNull();
    expect(await handleStaffAnswer(staffReply({ from: ADMIN_PHONE }), deps)).toBeNull();
    expect(w.sent).toEqual([]);
  });

  it("is answered once, however often the hub forwards it", async () => {
    const { deps, w } = await alerted();
    await handleStaffAnswer(staffReply(), deps);
    expect(await handleStaffAnswer(staffReply(), deps)).toEqual({ outcome: "skipped", reason: "duplicate" });
    expect(w.answers).toHaveLength(1);
  });

  it("practice mode: left alone (the hub's bot answers)", async () => {
    const made = world();
    made.w.chats.set(TEACHER_PHONE, new Date(NOON.getTime() - HOUR).toISOString());
    await openHandoff(openInput(), made.deps);
    const later = world({ switches: switches({ dryRun: true }) });
    Object.assign(later.w, { alerts: made.w.alerts, handoffs: made.w.handoffs });
    expect(await handleStaffAnswer(staffReply(), later.deps)).toEqual({ outcome: "skipped", reason: "practice_mode" });
  });

  it("practice: the owner answers in the teacher's place, and gets both the answer and the thanks", async () => {
    const { deps, w } = world({ switches: TODAY });
    w.chats.set(OWNER, new Date(NOON.getTime() - 60_000).toISOString());
    await openHandoff(openInput({ practice: true }), deps);
    const outcome = await handleStaffAnswer(staffReply({ from: OWNER }), deps);
    expect(outcome).toMatchObject({ outcome: "answered" });
    expect(w.answers[0]!.answeredBy).toBe(TEACHER_ID);
    expect(w.sent.slice(1).map((body) => body.to)).toEqual(["919000000001", "919000000001"]);
  });
});

describe("an answer typed in One's Messages", () => {
  it("goes back the helper's way when the helper passed the message on", async () => {
    const { deps, w } = world();
    await openHandoff(openInput(), deps);
    w.sent.length = 0;
    w.chats.set(OWNER, new Date(NOON.getTime() - HOUR).toISOString());
    expect(await relayFromMessages({ replyId: REPLY_ID, body: "  Done, see you at 10.  ", staffId: ADMIN_ID }, deps)).toEqual({ result: "sent" });
    expect(textOf(w.sent[0]!)).toContain("Answer from the principal's office");
    expect(textOf(w.sent[0]!)).toContain("Done, see you at 10.");
    expect(w.answers[0]).toMatchObject({ answeredBy: ADMIN_ID, body: "Done, see you at 10." });
  });

  it("is left to Messages' own queue for any other message", async () => {
    const { deps } = world();
    expect(await relayFromMessages({ replyId: REPLY_ID, body: "x", staffId: ADMIN_ID }, deps)).toBeNull();
  });

  it("is left to Messages' own queue, unsaved by the helper, when the helper may not message the parent", async () => {
    for (const over of [{ dryRun: true }, { features: { parent_helper: false } }]) {
      const { deps, w } = world();
      await openHandoff(openInput(), deps);
      const paused: RelayDeps = { ...deps, readSwitches: async () => switches(over) };
      w.sent.length = 0;
      expect(await relayFromMessages({ replyId: REPLY_ID, body: "Done.", staffId: ADMIN_ID }, paused)).toBeNull();
      expect(w.answers).toHaveLength(0);
      expect(w.sent).toHaveLength(0);
    }
  });
});

describe("who an alert can reach (D-582)", () => {
  it("their own number, only with their yes", () => {
    expect(reachOf(teacher, false, OWNER)).toEqual({ to: TEACHER_PHONE, why: null });
    expect(reachOf({ ...teacher, consented: false }, false, OWNER)).toEqual({ to: null, why: "no_consent" });
    expect(reachOf({ ...teacher, e164: null }, false, OWNER)).toEqual({ to: null, why: "no_number" });
  });

  it("practice: the owner's number, whatever the test account has", () => {
    expect(reachOf({ ...teacher, e164: null, consented: false }, true, OWNER)).toEqual({ to: OWNER, why: null });
    expect(reachOf(teacher, true, null)).toEqual({ to: null, why: "no_number" });
  });
});
