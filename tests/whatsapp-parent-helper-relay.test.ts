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
vi.mock("@/modules/whatsapp/data/parent-suggestions", () => ({}));
vi.mock("@/platform/whatsapp/store", () => ({ readSwitches: vi.fn(), readTemplateRow: vi.fn() }));
const log = vi.hoisted(() => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/platform/observability/log", () => log);

import type { AlertRecord, DeliveryRecord, Handoff, HandoffPatch, NewHandoff, Person, WaitingAnswer } from "@/modules/whatsapp/data/helper-handoffs";
import {
  deliverWaitingAnswers,
  handleStaffAnswer,
  openHandoff,
  rateAnswer,
  relayFromMessages,
  runDueHandoffs,
  reachOf,
  runHandoffStep,
  type RelayDeps,
} from "@/modules/whatsapp/data/helper-relay";
import type { TurnFinish } from "@/modules/whatsapp/data/helper-store";
import type { DecideOutcome, DecideResult, HandoffNote } from "@/modules/whatsapp/data/parent-suggestions";
import type { NoteChoice } from "@/modules/whatsapp/domain/helper-away-note";
import { childFactsFromRow, type ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import { NOT_HELPED_TOPIC } from "@/modules/whatsapp/domain/helper-handoff";
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
  /** A child's absence each Messages row came with (D-602), by that row's id. */
  notes: Map<string, HandoffNote>;
  /** Each tap decided, as the person who tapped. */
  decisions: Array<{ actorStaffId: string; id: string; choice: NoteChoice }>;
  /** What kind of message each turn was started as. */
  kinds: string[];
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
    studentId: "11111111-1111-4111-8111-111111111111",
    ratingAskedAt: null,
    rating: null,
    followUpOf: null,
    ...over,
  };
}

function world(
  over: {
    now?: Date;
    switches?: WhatsAppSwitches | null;
    templates?: Record<string, TemplateRow | null>;
    send?: RelayDeps["send"];
    people?: Person[] | null;
    ratingWrites?: "fail";
    /** The note cannot be read. */
    noteRead?: "fail";
    decide?: (input: { actorStaffId: string; id: string; choice: NoteChoice }) => Promise<DecideResult>;
  } = {},
) {
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
    notes: new Map(),
    decisions: [],
    kinds: [],
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
      w.kinds.push(row.kind);
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
          followUpOf: row.followUpOf ?? null,
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
    // Newest first, this number's only, as the table is read.
    readRecentHandoffs: async (parentE164) => [...w.handoffs.values()].filter((row) => row.parentE164 === parentE164).reverse(),
    setRating: async (id, value) => {
      if (over.ratingWrites === "fail") return "failed";
      const row = w.handoffs.get(id);
      if (!row) return "already";
      const may = value === "helped" ? row.rating === null : row.rating === null || row.rating === "helped";
      if (!may) return "already";
      w.handoffs.set(id, { ...row, rating: value });
      return "set";
    },
    claimRatingQuestion: async (id, at) => {
      const row = w.handoffs.get(id);
      if (!row || row.ratingAskedAt) return false;
      w.handoffs.set(id, { ...row, ratingAskedAt: at });
      return true;
    },
    readLatestAnswer: async (handoffId) => {
      const sent = [...w.deliveries.values()].filter((row) => row.handoffId === handoffId && row.status === "sent").at(-1);
      const answer = sent ? w.answers.find((row) => row.id === sent.answerId) : undefined;
      return sent && answer ? { body: answer.body, answererKind: sent.answererKind, answererName: sent.answererName } : null;
    },
    readHandoffNote: async (replyId) => {
      if (over.noteRead === "fail") throw new Error("down");
      const note = w.notes.get(replyId);
      return note ? { ...note } : null;
    },
    // As `decide_parent_suggestions` does: still waiting, not past its time, and only the class teacher may.
    decideNote:
      over.decide ??
      (async (input): Promise<DecideResult> => {
        w.decisions.push(input);
        const one = (outcome: DecideOutcome): DecideResult => ({
          ok: true,
          applied: outcome.outcome === "applied" ? 1 : 0,
          dismissed: outcome.outcome === "dismissed" ? 1 : 0,
          results: [outcome],
        });
        const found = [...w.notes.entries()].find(([, note]) => note.id === input.id);
        if (!found) return one({ id: input.id, outcome: "not_found" });
        const [replyId, note] = found;
        if (note.status !== "pending") return one({ id: note.id, outcome: "already" });
        if (Date.parse(note.expiresAt) <= clock.getTime()) return one({ id: note.id, outcome: "expired" });
        if (input.actorStaffId !== TEACHER_ID) return one({ id: note.id, outcome: "not_permitted" });
        const dismiss = input.choice === "dismiss";
        w.notes.set(replyId, {
          ...note,
          status: dismiss ? "dismissed" : "applied",
          mark: input.choice === "dismiss" ? null : input.choice,
          decidedByName: "TEST Teacher One",
        });
        return one({ id: note.id, outcome: dismiss ? "dismissed" : "applied" });
      }),
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

  it("a number on file is not a yes: someone who never agreed, or stopped, is noted and sent nothing (D-583)", async () => {
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
    // The answer, "Did this answer help?" (D-584), then the teacher's thanks.
    expect(w.sent.map((body) => body.to)).toEqual(["919000000001", "919000000001", "919000000002"]);
    expect(textOf(w.sent[0]!)).toBe(
      "💬 *Answer from TEST Teacher One, class teacher*\n_Your message about Aarav: “Please share today's homework”_\n\nPages 12 and 13 of the maths book.",
    );
    expect(w.sent[1]!.type).toBe("interactive");
    expect(textOf(w.sent[2]!)).toBe("✅ Your answer has gone to the parent of Aarav · Class 6. Thank you!");
    expect(w.deliveries.get("a1")).toMatchObject({ status: "sent", via: "text", answererKind: "class_teacher", answererName: "TEST Teacher One" });
    expect(w.handoffs.get("h1")).toMatchObject({ answeredAt: NOON.toISOString(), nextAction: null });
    expect(w.done).toEqual([[REPLY_ID, TEACHER_ID]]);
    expect(w.finished).toEqual([["wamid.ANSWER1", expect.objectContaining({ status: "answered", intent: "staff_answer", route: "rule", replyMessageId: "wamid.OUT4" })]]);
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

    // The parent writes again: the answer goes first, once, and then the question.
    expect(await deliverWaitingAnswers(OWNER, deps)).toBe(1);
    expect(textOf(w.sent.at(-2)!)).toContain("Pages 12 and 13 of the maths book.");
    expect(w.sent.at(-1)!.type).toBe("interactive");
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
    // The answer, the question and the thanks, all on the owner's number.
    expect(w.sent.slice(1).map((body) => body.to)).toEqual(["919000000001", "919000000001", "919000000001"]);
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

describe("who an alert can reach (D-583)", () => {
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

describe("did this answer help? (D-584)", () => {
  const FOLLOW_REPLY = "88888888-8888-4888-8888-888888888888";
  const QUESTION = "Please share today's homework";
  const ANSWER = "Pages 12 and 13 of the maths book.";

  /** h1, answered by its class teacher on WhatsApp while the parent's chat is open. */
  async function answered(options: Parameters<typeof world>[0] = {}) {
    const made = world(options);
    made.w.chats.set(TEACHER_PHONE, new Date(NOON.getTime() - HOUR).toISOString());
    made.w.chats.set(OWNER, new Date(NOON.getTime() - 2 * HOUR).toISOString());
    await openHandoff(openInput(), made.deps);
    await handleStaffAnswer(staffReply(), made.deps);
    made.w.sent.length = 0;
    return made;
  }

  /** The office's hand-off for a "no" to h1, as the turn opens it. */
  const followUp = (over: Partial<Parameters<typeof openHandoff>[0]> = {}) =>
    openInput({ parentReplyId: FOLLOW_REPLY, target: "office", topic: NOT_HELPED_TOPIC, child: null, aboutName: "Aarav", followUpOf: "h1", ...over });

  const buttonsOf = (body: Record<string, unknown>) =>
    (body.interactive as { action: { buttons: Array<{ reply: { id: string; title: string } }> } }).action.buttons.map((button) => button.reply);
  const questionText = (body: Record<string, unknown>) => (body.interactive as { body: { text: string } }).body.text;

  it("is asked once, right after the answer, on two buttons that name this hand-off", async () => {
    const { deps, w } = world();
    w.chats.set(TEACHER_PHONE, new Date(NOON.getTime() - HOUR).toISOString());
    w.chats.set(OWNER, new Date(NOON.getTime() - 2 * HOUR).toISOString());
    await openHandoff(openInput(), deps);
    w.sent.length = 0;
    await handleStaffAnswer(staffReply(), deps);

    const question = w.sent[1]!;
    expect(question.to).toBe("919000000001");
    expect(questionText(question)).toBe("Did this answer help?\nIf not, tap *No* and the school office will look at it.");
    expect(buttonsOf(question)).toEqual([
      { id: "vpai:helped:h100", title: "👍 Yes, it helped" },
      { id: "vpai:not_helped:h100", title: "👎 No" },
    ]);
    expect(w.handoffs.get("h1")!.ratingAskedAt).toBe(NOON.toISOString());

    // A second answer to the same message, typed in Messages: it goes, and nothing is asked again.
    w.sent.length = 0;
    expect(await relayFromMessages({ replyId: REPLY_ID, body: "Also bring the notebook.", staffId: ADMIN_ID }, deps)).toEqual({ result: "sent" });
    expect(w.sent.map((body) => body.type)).toEqual(["text"]);
  });

  it("is not asked when the answer itself did not reach the parent", async () => {
    const { deps, w } = world({ templates: { vpps_parent_answer_ready_en_v1: null } });
    w.chats.set(TEACHER_PHONE, new Date(NOON.getTime() - HOUR).toISOString());
    await openHandoff(openInput(), deps);
    w.sent.length = 0;
    await handleStaffAnswer(staffReply(), deps);
    expect(w.sent.map((body) => body.type)).toEqual(["text"]);
    expect(w.handoffs.get("h1")!.ratingAskedAt).toBeNull();
  });

  it("a no reaches the school office as a complaint, told what did not help", async () => {
    const { deps, w } = await answered({ people: [{ ...admin, language: "en" }] });
    w.chats.set(ADMIN_PHONE, new Date(NOON.getTime() - HOUR).toISOString());
    const opened = await openHandoff(followUp(), deps);
    expect(opened.handoffId).toBe("h2");
    expect(w.handoffs.get("h2")).toMatchObject({ target: "office", topic: "not_helped", complaint: true, classTeacherId: null, followUpOf: "h1", nextAction: "remind" });
    expect(textOf(w.sent.at(-1)!)).toContain("Aarav · Class 6 · The answer did not help");
  });

  it("the office's answer quotes what the parent first asked, and asks nothing more", async () => {
    const { deps, w } = await answered();
    await openHandoff(followUp(), deps);
    const note = `अभिभावक / Parent: “${QUESTION}”\nजवाब / Answer (कक्षा अध्यापक / Class teacher TEST Teacher One): “${ANSWER}”`;
    w.handoffs.set("h2", { ...w.handoffs.get("h2")!, body: note });
    w.sent.length = 0;

    expect(await relayFromMessages({ replyId: FOLLOW_REPLY, body: "The homework is on the class board as well.", staffId: ADMIN_ID }, deps)).toEqual({ result: "sent" });
    expect(w.sent).toHaveLength(1);
    expect(textOf(w.sent[0]!)).toBe(
      `💬 *Answer from the principal's office*\n_Your message about Aarav: “${QUESTION}”_\n\nThe homework is on the class board as well.`,
    );
    expect(w.handoffs.get("h2")!.ratingAskedAt).toBeNull();
  });

  it("a yes is kept once; a second tap changes nothing", async () => {
    const { deps, w } = await answered();
    expect(await rateAnswer({ from: OWNER, key: "h100", value: "helped" }, deps)).toMatchObject({ outcome: "helped", handoff: { id: "h1" } });
    expect(w.handoffs.get("h1")!.rating).toBe("helped");
    expect(await rateAnswer({ from: OWNER, key: "h100", value: "helped" }, deps)).toMatchObject({ outcome: "already" });
  });

  it("a no, even after a yes, comes back with the parent's words and the answer, for the office", async () => {
    const { deps, w } = await answered();
    await rateAnswer({ from: OWNER, key: "h100", value: "helped" }, deps);
    const rated = await rateAnswer({ from: OWNER, key: "h100", value: "not_helped" }, deps);
    expect(rated).toMatchObject({ outcome: "pass_on", handoff: { id: "h1" } });
    expect(rated.outcome === "pass_on" ? rated.body : null).toBe(
      `अभिभावक / Parent: “${QUESTION}”\nजवाब / Answer (कक्षा अध्यापक / Class teacher TEST Teacher One): “${ANSWER}”`,
    );
    expect(w.handoffs.get("h1")!.rating).toBe("not_helped");
    // A yes after the no does not take the no back.
    expect(await rateAnswer({ from: OWNER, key: "h100", value: "helped" }, deps)).toMatchObject({ outcome: "already" });
    expect(w.handoffs.get("h1")!.rating).toBe("not_helped");
  });

  it("an answer that cannot be read leaves the parent's words for the office", async () => {
    const { deps } = await answered();
    const rated = await rateAnswer({ from: OWNER, key: "h100", value: "not_helped" }, { ...deps, readLatestAnswer: async () => null });
    expect(rated.outcome === "pass_on" ? rated.body : null).toBe(`अभिभावक / Parent: “${QUESTION}”`);
  });

  it("a no the office already has is not passed on twice", async () => {
    const { deps } = await answered();
    await openHandoff(followUp(), deps);
    expect(await rateAnswer({ from: OWNER, key: "h100", value: "not_helped" }, deps)).toMatchObject({ outcome: "already_passed_on" });
  });

  it("rates only this number's own hand-offs: another number, a made-up key or the office's own hand-off rate nothing", async () => {
    const { deps, w } = await answered();
    expect(await rateAnswer({ from: "+919000000009", key: "h100", value: "not_helped" }, deps)).toEqual({ outcome: "unknown" });
    expect(await rateAnswer({ from: OWNER, key: "zzzz", value: "not_helped" }, deps)).toEqual({ outcome: "unknown" });
    await openHandoff(followUp(), deps);
    expect(await rateAnswer({ from: OWNER, key: "h200", value: "not_helped" }, deps)).toEqual({ outcome: "unknown" });
    expect(await rateAnswer({ from: OWNER, key: "h100", value: "helped" }, { ...deps, readRecentHandoffs: async () => null })).toEqual({ outcome: "unknown" });
    expect([...w.handoffs.values()].map((row) => row.rating)).toEqual([null, null]);
  });

  it("a no that cannot be written down is never called passed on; a yes is thanked all the same", async () => {
    const { deps } = await answered({ ratingWrites: "fail" });
    expect(await rateAnswer({ from: OWNER, key: "h100", value: "not_helped" }, deps)).toMatchObject({ outcome: "not_saved" });
    expect(await rateAnswer({ from: OWNER, key: "h100", value: "helped" }, deps)).toMatchObject({ outcome: "helped" });
  });
});

describe("a child the parent says will be away: decided from the alert (D-602)", () => {
  const NOTE_ID = "88888888-8888-4888-8888-888888888888";
  const OTHER_NOTE = "99999999-9999-4999-8999-999999999999";

  function noteRow(over: Partial<HandoffNote> = {}): HandoffNote {
    return { id: NOTE_ID, status: "pending", days: ["2026-11-12"], reason: "sick", expiresAt: "2026-11-12T18:30:00.000Z", practice: false, mark: null, decidedByName: null, ...over };
  }

  const buttonsOf = (body: Record<string, unknown>) =>
    ((body.interactive as { action?: { buttons?: Array<{ reply: { id: string; title: string } }> } } | undefined)?.action?.buttons ?? []).map((button) => button.reply);
  const bodyOf = (body: Record<string, unknown>) => (body.interactive as { body?: { text: string } } | undefined)?.body?.text ?? "";

  /** The class teacher alerted about a note; their chat open unless `closed`. */
  async function alertedWithNote(options: Parameters<typeof world>[0] & { closed?: boolean; note?: Partial<HandoffNote>; practice?: boolean } = {}) {
    const made = world(options);
    made.w.notes.set(REPLY_ID, noteRow({ practice: options.practice ?? false, ...options.note }));
    const phone = options.practice ? OWNER : TEACHER_PHONE;
    if (!options.closed) made.w.chats.set(phone, new Date(NOON.getTime() - HOUR).toISOString());
    await openHandoff(openInput({ topic: "leave", practice: options.practice ?? false }), made.deps);
    return made;
  }

  function noteTap(choice: NoteChoice, over: Partial<WebhookInbound> & { id?: string } = {}): WebhookInbound {
    const { id, ...rest } = over;
    const title = { leave: "Mark Leave", absent: "Mark Absent", dismiss: "Not now" }[choice];
    return staffReply({
      providerMessageId: "wamid.TAP1",
      type: "interactive",
      text: title,
      raw: { type: "interactive", interactive: { type: "button_reply", button_reply: { id: id ?? `vpnote:${choice}:${NOTE_ID}`, title } } },
      ...rest,
    });
  }

  it("the class teacher's typed alert carries Mark Leave, Mark Absent and Not now, each naming the note", async () => {
    const { w } = await alertedWithNote();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.type).toBe("interactive");
    expect(buttonsOf(w.sent[0]!)).toEqual([
      { id: `vpnote:leave:${NOTE_ID}`, title: "Mark Leave" },
      { id: `vpnote:absent:${NOTE_ID}`, title: "Mark Absent" },
      { id: `vpnote:dismiss:${NOTE_ID}`, title: "Not now" },
    ]);
    expect(bodyOf(w.sent[0]!)).toContain("🗓️ Today · Sick");
    expect(bodyOf(w.sent[0]!)).toContain("↩️ Swipe right on this message and type your answer.");
    expect(w.alerts).toEqual([expect.objectContaining({ staffId: TEACHER_ID, via: "text", status: "sent", messageId: "wamid.OUT1" })]);
    // Nothing is decided by the alert itself.
    expect(w.decisions).toEqual([]);
    expect(w.notes.get(REPLY_ID)!.status).toBe("pending");
  });

  it("a closed chat gets the approved away note, each quick reply carrying the note's own payload", async () => {
    const { w } = await alertedWithNote({ closed: true });
    expect(w.sent).toHaveLength(1);
    expect(templateOf(w.sent[0]!)).toBe("vpps_staff_away_note_en_v1");
    expect((w.sent[0]!.template as { components: unknown[] }).components).toEqual([
      {
        type: "body",
        parameters: ["TEST Teacher One", "Aarav · Class 6", "Today · Sick", "Please share today's homework"].map((text) => ({ type: "text", text })),
      },
      ...["leave", "absent", "dismiss"].map((choice, index) => ({
        type: "button",
        sub_type: "quick_reply",
        index: String(index),
        parameters: [{ type: "payload", payload: `vpnote:${choice}:${NOTE_ID}` }],
      })),
    ]);
    expect(w.alerts).toEqual([expect.objectContaining({ via: "template", status: "sent", messageId: "wamid.OUT1" })]);
  });

  it("until Meta approves the away note, the ordinary approved alert goes, and the note waits in One", async () => {
    const { w } = await alertedWithNote({ closed: true, templates: { vpps_staff_away_note_en_v1: template("vpps_staff_away_note_en_v1", "pending") } });
    expect(w.sent.map(templateOf)).toEqual(["vpps_staff_parent_question_en_v1"]);
    expect(w.alerts).toEqual([expect.objectContaining({ via: "template", status: "sent" })]);
  });

  it("an away note Meta refuses gives way to the ordinary alert; one whose fate is unknown is not followed by a second", async () => {
    const refusedSent: Array<Record<string, unknown>> = [];
    const refused = await alertedWithNote({
      closed: true,
      send: async (body) => {
        refusedSent.push(body);
        return refusedSent.length === 1
          ? { outcome: "rejected", httpStatus: 400, errorCode: "132001", errorTitle: null, errorDetail: null }
          : { outcome: "accepted", messageId: "wamid.T2", httpStatus: 200 };
      },
    });
    expect(refusedSent.map(templateOf)).toEqual(["vpps_staff_away_note_en_v1", "vpps_staff_parent_question_en_v1"]);
    expect(refused.w.alerts).toEqual([expect.objectContaining({ via: "template", status: "sent", messageId: "wamid.T2" })]);

    const unknown: Array<Record<string, unknown>> = [];
    const lost = await alertedWithNote({
      closed: true,
      send: async (body) => {
        unknown.push(body);
        return { outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "No answer from the hub." };
      },
    });
    expect(unknown).toHaveLength(1);
    expect(lost.w.alerts).toEqual([expect.objectContaining({ via: "template", status: "failed", reason: "send_unknown:network" })]);
  });

  it("buttons Meta will not take: the alert goes typed without them, and the note waits in One", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const { w } = await alertedWithNote({
      send: async (body) => {
        sent.push(body);
        return sent.length === 1
          ? { outcome: "rejected", httpStatus: 400, errorCode: "131009", errorTitle: null, errorDetail: null }
          : { outcome: "accepted", messageId: "wamid.T2", httpStatus: 200 };
      },
    });
    expect(sent.map((body) => body.type)).toEqual(["interactive", "text"]);
    expect(textOf(sent[1]!)).toContain("A parent's message for you");
    expect(textOf(sent[1]!)).not.toContain("👇");
    expect(w.alerts).toEqual([expect.objectContaining({ via: "text", status: "sent", messageId: "wamid.T2" })]);
  });

  it.each([
    ["already decided", { note: { status: "applied" as const, mark: "leave" as const } }],
    ["past its time", { note: { expiresAt: "2026-11-12T06:00:00.000Z" } }],
    ["with no days", { note: { days: [] } }],
    ["of another kind than the hand-off", { note: { practice: true } }],
    ["for someone who is not the class teacher", { people: [{ ...teacher, isClassTeacher: false }] }],
    ["unreadable", { noteRead: "fail" as const }],
  ])("no buttons when the note is %s: the ordinary alert, as before", async (_case, options) => {
    const { w } = await alertedWithNote(options);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.type).toBe("text");
    expect(textOf(w.sent[0]!)).not.toContain("👇");
  });

  it("only a class teacher's hand-off carries them: the office's never does", async () => {
    const { deps, w } = world();
    w.notes.set(REPLY_ID, noteRow());
    w.chats.set(TEACHER_PHONE, new Date(NOON.getTime() - HOUR).toISOString());
    await openHandoff(openInput({ target: "office", topic: "office" }), deps);
    expect(w.sent[0]!.type).toBe("text");
  });

  it("a reminder still carries them while the note waits", async () => {
    const { deps, w, setNow } = await alertedWithNote();
    setNow(new Date(NOON.getTime() + 3 * HOUR));
    await runHandoffStep("h1", deps);
    expect(w.sent).toHaveLength(2);
    expect(bodyOf(w.sent[1]!)).toContain("⏰ *Reminder: a parent is waiting for your answer*");
    expect(buttonsOf(w.sent[1]!).map((button) => button.id)).toEqual([`vpnote:leave:${NOTE_ID}`, `vpnote:absent:${NOTE_ID}`, `vpnote:dismiss:${NOTE_ID}`]);
  });

  it("Mark Leave decides the note as the class teacher: never an answer to the parent, and they are told what it did", async () => {
    const { deps, w } = await alertedWithNote();
    w.sent.length = 0;
    const outcome = await handleStaffAnswer(noteTap("leave"), deps);
    expect(outcome).toEqual({ outcome: "answered", route: "tap", intent: "staff_note", handoff: "class_teacher" });
    expect(w.decisions).toEqual([{ actorStaffId: TEACHER_ID, id: NOTE_ID, choice: "leave" }]);
    expect(w.notes.get(REPLY_ID)).toMatchObject({ status: "applied", mark: "leave" });
    // Nothing for the parent, nothing in Messages.
    expect(w.answers).toEqual([]);
    expect(w.done).toEqual([]);
    expect(w.sent.map((body) => body.to)).toEqual(["919000000002"]);
    expect(textOf(w.sent[0]!)).toBe(
      [
        "✅ Leave noted for the register · Aarav · Class 6 · Today",
        "The parent gets no absent message for those days.",
        "↩️ Changed your mind? Open One and press Undo under Decided today.",
      ].join("\n"),
    );
    expect(w.kinds.at(-1)).toBe("tap");
    expect(w.finished).toEqual([
      ["wamid.TAP1", expect.objectContaining({ status: "answered", intent: "staff_note", route: "tap", parentReplyId: REPLY_ID, replyMessageId: "wamid.OUT2" })],
    ]);
    expect(w.saved).toEqual([TEACHER_PHONE]);
    // Swiping right still answers the parent: the hand-off is not answered by a tap.
    expect(w.handoffs.get("h1")!.answeredAt).toBeNull();
  });

  it("Mark Absent and Not now say what they did", async () => {
    const absent = await alertedWithNote();
    await handleStaffAnswer(noteTap("absent"), absent.deps);
    expect(absent.w.notes.get(REPLY_ID)).toMatchObject({ status: "applied", mark: "absent" });
    expect(textOf(absent.w.sent.at(-1)!)).toMatch(/^✅ Absent noted for the register · Aarav · Class 6 · Today/);

    const notNow = await alertedWithNote();
    await handleStaffAnswer(noteTap("dismiss"), notNow.deps);
    expect(notNow.w.notes.get(REPLY_ID)).toMatchObject({ status: "dismissed" });
    expect(textOf(notNow.w.sent.at(-1)!)).toBe("👍 Let go · nothing was changed · Aarav · Class 6\n↩️ Changed your mind? Open One and press Undo under Decided today.");
  });

  it("a quick reply on the approved note decides it by its payload", async () => {
    const { deps, w } = await alertedWithNote({ closed: true });
    const tap = staffReply({
      providerMessageId: "wamid.TAP2",
      type: "button",
      text: "Mark Absent",
      raw: { type: "button", button: { payload: `vpnote:absent:${NOTE_ID}`, text: "Mark Absent" } },
    });
    expect(await handleStaffAnswer(tap, deps)).toMatchObject({ outcome: "answered", intent: "staff_note" });
    expect(w.decisions).toEqual([{ actorStaffId: TEACHER_ID, id: NOTE_ID, choice: "absent" }]);
  });

  it("a quick reply that came back without our payload decides only the alert's own note, by its words", async () => {
    const { deps, w } = await alertedWithNote({ closed: true });
    const tap = staffReply({ providerMessageId: "wamid.TAP3", type: "button", text: "अभी नहीं", raw: { type: "button", button: { payload: "", text: "अभी नहीं" } } });
    await handleStaffAnswer(tap, deps);
    expect(w.decisions).toEqual([{ actorStaffId: TEACHER_ID, id: NOTE_ID, choice: "dismiss" }]);
  });

  it("a tap that names another note changes nothing", async () => {
    const { deps, w } = await alertedWithNote();
    w.notes.set("another-reply", noteRow({ id: OTHER_NOTE }));
    const outcome = await handleStaffAnswer(noteTap("leave", { id: `vpnote:leave:${OTHER_NOTE}` }), deps);
    expect(outcome).toMatchObject({ outcome: "answered", intent: "staff_note" });
    expect(w.decisions).toEqual([]);
    expect(w.notes.get("another-reply")!.status).toBe("pending");
    expect(textOf(w.sent.at(-1)!)).toBe("⚠️ It is no longer there. Nothing was changed.");
    expect(w.finished.at(-1)![1]).toMatchObject({ status: "answered", reason: "note_gone" });
  });

  it("is only a tap from the number the alert went to, on that alert", async () => {
    const { deps, w } = await alertedWithNote();
    expect(await handleStaffAnswer(noteTap("leave", { from: ADMIN_PHONE }), deps)).toBeNull();
    expect(await handleStaffAnswer(noteTap("leave", { replyTo: "wamid.SOMETHING_ELSE" }), deps)).toBeNull();
    expect(w.decisions).toEqual([]);
  });

  it("a second tap, or a note decided in One meanwhile, says how and by whom, and decides nothing", async () => {
    const { deps, w } = await alertedWithNote();
    await handleStaffAnswer(noteTap("leave"), deps);
    await handleStaffAnswer(noteTap("absent", { providerMessageId: "wamid.TAP9" }), deps);
    expect(w.decisions).toHaveLength(1);
    expect(textOf(w.sent.at(-1)!)).toBe("ℹ️ Someone has already decided this one.\nLeave · TEST Teacher One · Aarav · Class 6");
    // The same tap forwarded twice is handled once.
    expect(await handleStaffAnswer(noteTap("leave"), deps)).toEqual({ outcome: "skipped", reason: "duplicate" });
  });

  it("decided by someone else between the read and the tap: the database's answer stands", async () => {
    const { deps, w } = await alertedWithNote({
      decide: async (input) => {
        w.notes.set(REPLY_ID, noteRow({ status: "dismissed", decidedByName: "TEST Admin" }));
        return { ok: true, applied: 0, dismissed: 0, results: [{ id: input.id, outcome: "already" }] };
      },
    });
    await handleStaffAnswer(noteTap("leave"), deps);
    expect(textOf(w.sent.at(-1)!)).toBe("ℹ️ Someone has already decided this one.\nNot now · TEST Admin · Aarav · Class 6");
  });

  it("past its time, or not theirs to decide: nothing was changed", async () => {
    const late = await alertedWithNote({ note: { expiresAt: new Date(NOON.getTime() + HOUR).toISOString() } });
    late.setNow(new Date(NOON.getTime() + 2 * HOUR));
    await handleStaffAnswer(noteTap("leave", { at: new Date(NOON.getTime() + 2 * HOUR - 2_000).toISOString() }), late.deps);
    expect(textOf(late.w.sent.at(-1)!)).toBe("⏱️ Its day has passed, so it no longer waits. Nothing was changed.");
    expect(late.w.notes.get(REPLY_ID)!.status).toBe("pending");

    const theirs = await alertedWithNote({
      decide: async (input) => ({ ok: true, applied: 0, dismissed: 0, results: [{ id: input.id, outcome: "not_permitted" }] }),
    });
    await handleStaffAnswer(noteTap("leave"), theirs.deps);
    expect(textOf(theirs.w.sent.at(-1)!)).toBe("🚫 This one is for someone else to decide. Nothing was changed.");
  });

  it("a decision that could not be made is never called made", async () => {
    const down = await alertedWithNote({ decide: async () => ({ ok: false, reason: "unavailable" }) });
    const outcome = await handleStaffAnswer(noteTap("leave"), down.deps);
    expect(outcome).toEqual({ outcome: "failed", reason: "note_not_decided" });
    expect(textOf(down.w.sent.at(-1)!)).toBe("⚠️ That did not go through. Nothing was changed.\nPlease decide it in One instead.");
    expect(down.w.finished.at(-1)![1]).toMatchObject({ status: "failed", reason: "note_failed", intent: "staff_note" });

    const thrown = await alertedWithNote({ decide: async () => Promise.reject(new Error("down")) });
    expect(await handleStaffAnswer(noteTap("leave"), thrown.deps)).toEqual({ outcome: "failed", reason: "note_not_decided" });

    const unread = await alertedWithNote();
    unread.w.notes.clear();
    const gone = await handleStaffAnswer(noteTap("leave"), unread.deps);
    expect(gone).toMatchObject({ outcome: "answered" });
    expect(textOf(unread.w.sent.at(-1)!)).toBe("⚠️ It is no longer there. Nothing was changed.");
  });

  it("practice: the owner's tap decides as the test teacher, on test records, and says so", async () => {
    const { deps, w } = await alertedWithNote({ switches: TODAY, practice: true });
    expect(w.sent[0]!.to).toBe("919000000001");
    expect(w.sent[0]!.type).toBe("interactive");
    await handleStaffAnswer(noteTap("leave", { from: OWNER }), deps);
    expect(w.decisions).toEqual([{ actorStaffId: TEACHER_ID, id: NOTE_ID, choice: "leave" }]);
    expect(textOf(w.sent.at(-1)!).split("\n").at(-1)).toBe("🧪 Practice: decided as TEST Teacher One, on test records.");
  });

  it("practice mode: a tap is left alone, like any other message", async () => {
    const made = await alertedWithNote();
    const later = world({ switches: switches({ dryRun: true }) });
    Object.assign(later.w, { alerts: made.w.alerts, handoffs: made.w.handoffs, notes: made.w.notes });
    expect(await handleStaffAnswer(noteTap("leave"), later.deps)).toEqual({ outcome: "skipped", reason: "practice_mode" });
    expect(later.w.decisions).toEqual([]);
  });

  it("swiping right and typing still answers the parent, and decides nothing", async () => {
    const { deps, w } = await alertedWithNote();
    w.chats.set(OWNER, new Date(NOON.getTime() - 2 * HOUR).toISOString());
    expect(await handleStaffAnswer(staffReply(), deps)).toMatchObject({ outcome: "answered", intent: "staff_answer" });
    expect(w.answers).toHaveLength(1);
    expect(w.decisions).toEqual([]);
  });
});

/* ------------------------------------------- parent chats (D-616) */

describe("while parent chats are on (D-616)", () => {
  const CHAT_ID = "88888888-8888-4888-8888-888888888888";
  const said = { kind: "text" as const, body: "Please share today's homework", media: null, meta: {}, wamid: "wamid.IN1", at: NOON.toISOString(), replyTo: null };
  const ai = { text: "I have passed this to Aarav's class teacher.", wamid: "wamid.AI1", at: NOON.toISOString() };
  const sentOutcome = (delivery: "sent" | "waiting" | "failed") => ({
    ok: true as const,
    delivery,
    duplicate: false,
    message: {
      id: "99999999-9999-4999-8999-999999999999",
      chatId: CHAT_ID,
      direction: "out" as const,
      kind: "text" as const,
      body: "Done.",
      media: null,
      meta: {},
      wamid: null,
      status: delivery,
      error: null,
      staffId: ADMIN_ID,
      staffName: "TEST Admin",
      at: NOON.toISOString(),
    },
  });

  it("the message waits in the family's chat at the desk, and no alert goes: the chat's own nudge tells the desk", async () => {
    const { deps, w } = world();
    const openChat = vi.fn(async () => CHAT_ID);
    const opened = await openHandoff(openInput({ family: [aarav], said, ai, body: said.body }), { ...deps, openChat });
    expect(opened).toEqual({ handoffId: "h1", step: null, chatId: CHAT_ID });
    expect(w.sent).toEqual([]);
    expect(w.alerts).toEqual([]);
    expect(w.handoffs.get("h1")).toMatchObject({ nextAction: null });
    expect(openChat).toHaveBeenCalledWith({
      handoffId: "h1",
      parentReplyId: REPLY_ID,
      parentE164: OWNER,
      language: "en",
      target: "class_teacher",
      classTeacherId: TEACHER_ID,
      topic: "message_teacher",
      complaint: false,
      practice: false,
      sessionLabel: "TEST-2026-27",
      fromName: "TEST Parent",
      children: [{ studentId: aarav.studentId, firstName: "Aarav", className: aarav.className, classTeacherId: TEACHER_ID }],
      aboutStudentId: aarav.studentId,
      said,
      body: said.body,
      ai,
      staffNote: null,
    });
  });

  it("a chat that could not be written: the person it is for is alerted exactly as before", async () => {
    const { deps, w } = world();
    w.chats.set(TEACHER_PHONE, new Date(NOON.getTime() - HOUR).toISOString());
    const opened = await openHandoff(openInput(), { ...deps, openChat: async () => null });
    expect(opened.chatId).toBeNull();
    expect(opened.step?.told).toBe(1);
    expect(textOf(w.sent[0]!)).toContain("A parent's message for you");
  });

  it("at night the chat still takes it at once; the desk is nudged by the chat's own rules", async () => {
    const { deps, w } = world({ now: new Date("2026-11-11T17:30:00Z") });
    const opened = await openHandoff(openInput(), { ...deps, openChat: async () => CHAT_ID });
    expect(opened).toMatchObject({ chatId: CHAT_ID, step: null });
    expect(w.handoffs.get("h1")).toMatchObject({ nextAction: null });
    expect(w.sent).toEqual([]);
  });

  it("an answer typed in Messages goes the chat's way, so the chat shows it and nothing reaches the parent twice", async () => {
    const { deps, w } = world();
    await openHandoff(openInput(), deps);
    w.sent.length = 0;
    const answerInChat = vi.fn(async () => sentOutcome("sent"));
    expect(await relayFromMessages({ replyId: REPLY_ID, body: "  Done.  ", staffId: ADMIN_ID }, { ...deps, answerInChat })).toEqual({ result: "sent" });
    expect(answerInChat).toHaveBeenCalledWith({ handoffId: "h1", staffId: ADMIN_ID, text: "Done." });
    // The chat keeps the answer in Messages and sends it; the relay sends nothing of its own.
    expect(w.sent).toEqual([]);
    expect(w.answers).toEqual([]);
  });

  it("says where a chat answer stands: waiting for the parent to write, or not sent", async () => {
    const { deps } = world();
    await openHandoff(openInput(), deps);
    expect(await relayFromMessages({ replyId: REPLY_ID, body: "Done.", staffId: ADMIN_ID }, { ...deps, answerInChat: async () => sentOutcome("waiting") })).toEqual({
      result: "waiting",
    });
    expect(await relayFromMessages({ replyId: REPLY_ID, body: "Done.", staffId: ADMIN_ID }, { ...deps, answerInChat: async () => sentOutcome("failed") })).toEqual({
      result: "failed",
    });
  });

  it("an answer the chat would not take, or a message in no chat, goes the old way", async () => {
    for (const answerInChat of [async () => null, async () => ({ ok: false as const, reason: "not_saved" as const, code: null }), async () => Promise.reject(new Error("boom"))]) {
      const { deps, w } = world();
      await openHandoff(openInput(), deps);
      w.sent.length = 0;
      w.chats.set(OWNER, new Date(NOON.getTime() - HOUR).toISOString());
      expect(await relayFromMessages({ replyId: REPLY_ID, body: "Done.", staffId: ADMIN_ID }, { ...deps, answerInChat })).toEqual({ result: "sent" });
      expect(w.answers[0]).toMatchObject({ answeredBy: ADMIN_ID, body: "Done." });
      expect(textOf(w.sent[0]!)).toContain("Done.");
    }
  });
});
