import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/platform/whatsapp/store", () => ({ whatsappDb: vi.fn(), readSwitches: vi.fn(), readTemplateRow: vi.fn() }));
vi.mock("@/modules/chats/data/files", () => ({ chatFileLink: vi.fn(), checkChatUpload: vi.fn() }));
vi.mock("@/modules/chats/data/people", () => ({ readDeskPerson: vi.fn() }));
vi.mock("@/modules/whatsapp/data/helper-store", () => ({ readChat: vi.fn() }));
vi.mock("@/modules/whatsapp/data/helper-handoffs", () => ({
  insertAnswer: vi.fn(),
  markReplyDone: vi.fn(),
  readHandoff: vi.fn(),
  updateHandoff: vi.fn(),
}));

import type { CheckedFile } from "@/modules/chats/data/files";
import { answerHandoffInChat, deliverHeldMessages, resendChatMessage, sendChatMessage, type ChatSendDeps, type ChatSender } from "@/modules/chats/data/send";
import type { ChatGuard, ChatRowPatch, MessagePatch } from "@/modules/chats/data/store";
import type { ChatViewer } from "@/modules/chats/domain/access";
import { SCHOOL_MESSAGE_TEMPLATE } from "@/modules/chats/domain/templates";
import type { ChatMessage, ChatRow } from "@/modules/chats/domain/types";
import { speakerHead } from "@/modules/chats/domain/words";
import type { Handoff } from "@/modules/whatsapp/data/helper-handoffs";
import { ANSWER_READY_TEMPLATE } from "@/modules/whatsapp/domain/helper-hub-templates";
import type { WhatsAppConfig } from "@/platform/whatsapp/config";
import { SCHOOL_WHATSAPP_NUMBER } from "@/platform/whatsapp/numbers";
import type { TemplateRow, WhatsAppSwitches } from "@/platform/whatsapp/policy";
import type { ProviderSendResult } from "@/platform/whatsapp/providers";

/*
 * A message from school to a parent (D-616), against a stand-in database and
 * hub: who may write, the 24 hours, the one note that tells a parent a
 * message waits, the head that says who writes, a repeated tap, and what
 * waited going the moment the parent writes. Every name and number is made
 * up (rule 6).
 */

const NOW = "2026-11-15T06:00:00.000Z";
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.parse(NOW) - hours * HOUR).toISOString();

const TEACHER = "11111111-1111-4111-8111-111111111111";
const OTHER_TEACHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const CHAT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARENT = "+919000000010";
const STRANGER = "+919000000011";

const REF = (n: number) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, "0")}`;

const teacherViewer: ChatViewer = { staffId: TEACHER, role: "teacher", replies: true, seesAll: false, feesDesk: false, viewingTest: false };
const teacher: ChatSender = { viewer: teacherViewer, name: "Test Teacher" };
const otherTeacher: ChatSender = { viewer: { ...teacherViewer, staffId: OTHER_TEACHER }, name: "Other Teacher" };
const admin: ChatSender = { viewer: { staffId: ADMIN, role: "admin", replies: true, seesAll: true, feesDesk: true, viewingTest: false }, name: "Test Principal" };

const CONFIG: WhatsAppConfig = { ok: true, provider: "mock", senderNumber: SCHOOL_WHATSAPP_NUMBER };

const SWITCHES: WhatsAppSwitches = {
  dryRun: false,
  features: { parent_helper: true },
  realRecipients: false,
  ownerTestNumber: PARENT,
  dailyLimit: 250,
  feeSender: "fees",
};

function template(key: string, language: "hi" | "en", status = "approved"): TemplateRow {
  return { key, provider_name: key, language_code: language, feature: "parent_helper", body_params: 2, header: "none", url_button: false, status, category: "utility" };
}

function makeChat(over: Partial<ChatRow> = {}): ChatRow {
  return {
    id: CHAT_ID,
    parentE164: PARENT,
    desk: "class",
    classTeacherId: TEACHER,
    practice: false,
    sessionLabel: "2026-27",
    fromName: "Test Parent",
    studentIds: [],
    studentLabel: "Riya · Class 6",
    language: "hi",
    status: "waiting",
    waitingSince: ago(1),
    topic: null,
    complaint: false,
    wantsAdmin: false,
    takenBy: null,
    takenAt: null,
    liveUntil: null,
    lastParentAt: ago(1),
    lastStaffAt: null,
    lastMessageAt: ago(1),
    lastPreview: "Namaste",
    lastDirection: "in",
    nudgeStep: "first",
    nextNudgeAt: ago(-0.05),
    passedUpAt: null,
    doneAt: null,
    doneBy: null,
    mergedInto: null,
    createdAt: ago(1),
    ...over,
  };
}

const accepted = (): ProviderSendResult => ({ outcome: "accepted", messageId: `wamid.${Math.random().toString(36).slice(2)}`, httpStatus: 200 });

type WorldOptions = {
  chat?: Partial<ChatRow>;
  switches?: WhatsAppSwitches | null;
  lastTurnAt?: string | null;
  send?: (body: Record<string, unknown>) => ProviderSendResult;
  templates?: TemplateRow[];
  file?: CheckedFile | null;
  handoffs?: Array<Pick<Handoff, "id" | "parentReplyId" | "answeredAt" | "closedAt">>;
  chatsEnabled?: boolean;
};

/** The stand-in database and hub: what the send read, wrote and sent. */
function world(options: WorldOptions = {}) {
  const chat = makeChat(options.chat);
  const messages = new Map<string, ChatMessage>();
  const noteWamids = new Map<string, string | null>();
  const sent: Array<Record<string, unknown>> = [];
  const chatUpdates: Array<{ id: string; patch: ChatRowPatch; guard?: ChatGuard }> = [];
  const answers: Array<{ replyId: string; body: string; answeredBy: string }> = [];
  const doneReplies: string[] = [];
  const handoffs = new Map((options.handoffs ?? []).map((handoff) => [handoff.id, handoff as Handoff]));
  const templates = new Map((options.templates ?? []).map((row) => [row.key, row]));
  const switches = options.switches === undefined ? SWITCHES : options.switches;
  let counter = 0;

  const byTime = (a: ChatMessage, b: ChatMessage) => Date.parse(a.at) - Date.parse(b.at);

  const deps: ChatSendDeps = {
    now: () => new Date(NOW),
    readConfig: () => CONFIG,
    readSwitches: async () => switches,
    readTemplateRow: async (key) => templates.get(key) ?? null,
    lastTurnAt: async () => options.lastTurnAt ?? null,
    send: async (body) => {
      sent.push(body);
      return (options.send ?? accepted)(body);
    },
    readSettings: async () => ({ enabled: options.chatsEnabled ?? true, nudges: true, liveMinutes: 30, firstNudgeMinutes: 2 }),
    readChat: async (id) => (id === chat.id ? chat : null),
    readChatsForParent: async (e164) => (e164 === chat.parentE164 ? [chat] : []),
    readMessage: async (id) => messages.get(id) ?? null,
    readMessageByClientRef: async (ref) => [...messages.values()].find((message) => message.clientRef === ref) ?? null,
    readLastOut: async (chatId) => [...messages.values()].filter((m) => m.chatId === chatId && m.direction === "out").sort(byTime).at(-1) ?? null,
    readWaitingOut: async (chatIds) =>
      [...messages.values()].filter((m) => chatIds.includes(m.chatId) && m.direction === "out" && m.status === "waiting").sort(byTime),
    append: async (input) => {
      if (input.clientRef && [...messages.values()].some((message) => message.clientRef === input.clientRef)) return { id: null, duplicate: true };
      counter += 1;
      const id = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
      messages.set(id, {
        id,
        chatId: input.chatId,
        direction: input.direction,
        kind: input.kind,
        body: input.body,
        media: input.media ?? null,
        meta: input.meta ?? {},
        wamid: input.wamid ?? null,
        status: input.status ?? "received",
        error: input.error ?? null,
        staffId: input.staffId ?? null,
        staffName: input.staffName ?? null,
        at: input.at ?? NOW,
        clientRef: input.clientRef ?? null,
      });
      return { id, duplicate: false };
    },
    updateMessage: async (id, patch: MessagePatch, fromStatus) => {
      const message = messages.get(id);
      if (!message || (fromStatus && message.status !== fromStatus)) return false;
      messages.set(id, {
        ...message,
        ...(patch.status ? { status: patch.status } : {}),
        ...("wamid" in patch ? { wamid: patch.wamid ?? null } : {}),
        ...("error" in patch ? { error: patch.error ?? null } : {}),
        ...(patch.meta ? { meta: patch.meta } : {}),
      });
      if ("note_wamid" in patch) noteWamids.set(id, patch.note_wamid ?? null);
      return true;
    },
    updateChat: async (id, patch, guard) => {
      chatUpdates.push({ id, patch, guard });
      return true;
    },
    markRead: async () => undefined,
    readChatHandoffIds: async () => [...handoffs.keys()],
    checkUpload: async () => options.file ?? null,
    fileLink: async (path) => `https://files.example.test/${path}`,
    readHandoff: async (id) => handoffs.get(id) ?? null,
    updateHandoff: async (id, patch) => {
      const handoff = handoffs.get(id);
      if (handoff) handoffs.set(id, { ...handoff, ...("answeredAt" in patch ? { answeredAt: patch.answeredAt ?? null } : {}) });
      return true;
    },
    insertAnswer: async (row) => {
      answers.push(row);
      return "answer-1";
    },
    markReplyDone: async (replyId) => {
      doneReplies.push(replyId);
    },
    readChatIdForHandoff: async (handoffId) => (handoffs.has(handoffId) ? chat.id : null),
    readStaff: async (staffId) => (staffId === TEACHER ? { name: "Test Teacher", role: "teacher" } : null),
  };
  return { deps, chat, messages, sent, chatUpdates, answers, doneReplies, handoffs, noteWamids };
}

const textOf = (body: Record<string, unknown>) => (body.text as { body: string } | undefined)?.body;

describe("who may write", () => {
  it("lets the class teacher answer their own parent", async () => {
    const w = world();
    const outcome = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Kal school aayegi.", file: null }, teacher, w.deps);
    expect(outcome).toMatchObject({ ok: true, delivery: "sent", duplicate: false });
    expect(w.sent).toHaveLength(1);
  });

  it("asks an admin to take a teacher's chat over first, and keeps nothing", async () => {
    const w = world();
    const outcome = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hello", file: null }, admin, w.deps);
    expect(outcome).toEqual({ ok: false, reason: "take_over", code: null });
    expect(w.messages.size).toBe(0);
    expect(w.sent).toHaveLength(0);
  });

  it("does not show another teacher's chat at all", async () => {
    const w = world();
    expect(await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, otherTeacher, w.deps)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("stops the teacher while the principal's office has the chat", async () => {
    const w = world({ chat: { takenBy: ADMIN } });
    expect(await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps)).toMatchObject({ ok: false, reason: "taken" });
  });

  it("sends a chat that joined another desk's chat there", async () => {
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const w = world({ chat: { mergedInto: other } });
    expect(await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps)).toEqual({ ok: false, reason: "moved", code: other });
  });

  it("refuses ids that are not ids", async () => {
    const w = world();
    expect(await sendChatMessage({ chatId: "x", clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await sendChatMessage({ chatId: CHAT_ID, clientRef: "y", text: "Hi", file: null }, teacher, w.deps)).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("what was typed", () => {
  it("needs words or a file", async () => {
    const w = world();
    expect(await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "  \u0000 ", file: null }, teacher, w.deps)).toMatchObject({ ok: false, reason: "empty" });
  });

  it("refuses a message too long for WhatsApp", async () => {
    const w = world();
    expect(await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "a".repeat(3501), file: null }, teacher, w.deps)).toMatchObject({ ok: false, reason: "too_long" });
  });

  it("refuses a file that is not on the chat's shelf", async () => {
    const w = world({ file: null });
    const outcome = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "", file: { path: "elsewhere/x.pdf", filename: "x.pdf" } }, teacher, w.deps);
    expect(outcome).toMatchObject({ ok: false, reason: "bad_file" });
  });

  it("sends a photo by its link, with the words underneath", async () => {
    const path = `${CHAT_ID}/photo.jpg`;
    const w = world({ file: { path, type: { kind: "image", mime: "image/jpeg", ext: "jpg" }, bytes: 50_000 } as CheckedFile });
    const outcome = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Homework", file: { path, filename: "IMG_1.jpg" } }, teacher, w.deps);
    expect(outcome).toMatchObject({ ok: true, delivery: "sent" });
    expect(w.sent[0]).toMatchObject({ type: "image", image: { link: `https://files.example.test/${path}` } });
    expect((w.sent[0].image as { caption: string }).caption).toContain("Homework");
  });
});

describe("WhatsApp's own rules come first", () => {
  it("keeps nothing in practice mode, and says so", async () => {
    const w = world({ switches: { ...SWITCHES, dryRun: true } });
    expect(await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps)).toEqual({ ok: false, reason: "blocked", code: "practice_mode" });
    expect(w.messages.size).toBe(0);
  });

  it("writes only to the owner's number while real parents are off", async () => {
    const w = world({ chat: { parentE164: STRANGER } });
    expect(await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps)).toEqual({
      ok: false,
      reason: "blocked",
      code: "not_owner_test_number",
    });
  });

  it("goes to any parent once real parents are on", async () => {
    const w = world({ chat: { parentE164: STRANGER }, switches: { ...SWITCHES, realRecipients: true } });
    expect(await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps)).toMatchObject({ ok: true, delivery: "sent" });
  });

  it("refuses when the switches cannot be read", async () => {
    const w = world({ switches: null });
    expect(await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps)).toEqual({ ok: false, reason: "blocked", code: "read_failed" });
  });
});

describe("inside the parent's 24 hours", () => {
  it("heads the first message with who is writing, and not the next one straight after", async () => {
    const w = world();
    await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Pehli baat", file: null }, teacher, w.deps);
    await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(2), text: "Doosri baat", file: null }, teacher, w.deps);
    const head = speakerHead({ kind: "class_teacher", name: "Test Teacher" }, "hi");
    expect(textOf(w.sent[0])).toBe(`${head}\nPehli baat`);
    expect(textOf(w.sent[1])).toBe("Doosri baat");
  });

  it("marks the message sent with WhatsApp's id", async () => {
    const w = world();
    const outcome = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps);
    if (!outcome.ok) throw new Error("not sent");
    expect(outcome.message.status).toBe("sent");
    expect(outcome.message.wamid).toMatch(/^wamid\./);
  });

  it("sends nothing twice for a repeated tap", async () => {
    const w = world();
    const first = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps);
    const again = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps);
    expect(again).toMatchObject({ ok: true, duplicate: true });
    if (!first.ok || !again.ok) throw new Error("not sent");
    expect(again.message.id).toBe(first.message.id);
    expect(w.sent).toHaveLength(1);
  });

  it("counts Veer Patta AI's memory of the parent's last message too", async () => {
    const w = world({ chat: { lastParentAt: ago(30) }, lastTurnAt: ago(2) });
    expect(await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps)).toMatchObject({ ok: true, delivery: "sent" });
  });

  it("closes the questions Veer Patta AI passed on to this chat, in Messages too", async () => {
    const w = world({ handoffs: [{ id: "h1", parentReplyId: "reply-1", answeredAt: null, closedAt: null }] });
    await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Fees jama ho gayi hai.", file: null }, teacher, w.deps);
    expect(w.answers).toEqual([{ replyId: "reply-1", body: "Fees jama ho gayi hai.", answeredBy: TEACHER }]);
    expect(w.doneReplies).toEqual(["reply-1"]);
    expect(w.handoffs.get("h1")?.answeredAt).toBe(NOW);
  });

  it("waits instead when Meta says the 24 hours closed after all", async () => {
    const w = world({
      templates: [template(ANSWER_READY_TEMPLATE.hi, "hi")],
      send: (body) =>
        body.type === "template"
          ? accepted()
          : { outcome: "rejected", httpStatus: 400, errorCode: "window_closed", errorTitle: "Re-engagement message", errorDetail: null },
    });
    const outcome = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps);
    expect(outcome).toMatchObject({ ok: true, delivery: "waiting" });
    expect(w.sent.map((body) => body.type)).toEqual(["text", "template"]);
  });

  it("puts the chat back to waiting when the answer failed, and keeps Messages open", async () => {
    const w = world({
      send: () => ({ outcome: "rejected", httpStatus: 400, errorCode: "131026", errorTitle: "Undeliverable", errorDetail: null }),
      handoffs: [{ id: "h1", parentReplyId: "reply-1", answeredAt: null, closedAt: null }],
    });
    const outcome = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps);
    expect(outcome).toMatchObject({ ok: true, delivery: "failed" });
    if (!outcome.ok) throw new Error("not kept");
    expect(w.messages.get(outcome.message.id)?.error).toBe("send_rejected:131026");
    expect(w.chatUpdates).toHaveLength(1);
    expect(w.chatUpdates[0].patch).toMatchObject({ status: "waiting", waiting_since: ago(1) });
    expect(w.chatUpdates[0].guard).toEqual({ last_direction: "out", last_staff_at: NOW });
    expect(w.answers).toHaveLength(0);
  });

  it("calls a send that never finished failed, not sent", async () => {
    const w = world({ send: () => ({ outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "Timed out" }) });
    const outcome = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps);
    expect(outcome).toMatchObject({ ok: true, delivery: "failed" });
  });
});

describe("after the parent's 24 hours", () => {
  it("keeps an answer waiting and tells the parent once that it is ready", async () => {
    const w = world({ chat: { lastParentAt: ago(30) }, templates: [template(ANSWER_READY_TEMPLATE.hi, "hi")] });
    const first = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Pehli", file: null }, teacher, w.deps);
    const second = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(2), text: "Doosri", file: null }, teacher, w.deps);
    expect(first).toMatchObject({ ok: true, delivery: "waiting" });
    expect(second).toMatchObject({ ok: true, delivery: "waiting" });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toMatchObject({ type: "template", template: { name: ANSWER_READY_TEMPLATE.hi } });
    if (!first.ok) throw new Error("not kept");
    expect(w.noteWamids.get(first.message.id)).toMatch(/^wamid\./);
  });

  it("uses the school's own note when the school writes first, and waits while Meta has not approved it", async () => {
    const w = world({
      chat: { lastParentAt: ago(50), lastStaffAt: ago(40), status: "open" },
      templates: [template(SCHOOL_MESSAGE_TEMPLATE.hi, "hi", "pending")],
    });
    const outcome = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Kal PTM hai.", file: null }, teacher, w.deps);
    expect(outcome).toMatchObject({ ok: true, delivery: "waiting" });
    expect(w.sent).toHaveLength(0);
    if (!outcome.ok) throw new Error("not kept");
    expect(w.messages.get(outcome.message.id)?.error).toBe("note_not_sent:needs_template");
  });

  it("speaks English to an English-reading parent", async () => {
    const w = world({ chat: { lastParentAt: ago(30), language: "en" }, templates: [template(ANSWER_READY_TEMPLATE.en, "en")] });
    await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Done", file: null }, teacher, w.deps);
    expect(w.sent[0]).toMatchObject({ template: { name: ANSWER_READY_TEMPLATE.en, language: { code: "en" } } });
  });
});

describe("what waited goes the moment the parent writes", () => {
  it("sends every waiting message, oldest first, the first headed, and keeps the chat live", async () => {
    const w = world({ chat: { lastParentAt: ago(30) }, templates: [template(ANSWER_READY_TEMPLATE.hi, "hi")] });
    await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Pehli", file: null }, teacher, w.deps);
    await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(2), text: "Doosri", file: null }, teacher, w.deps);
    w.sent.length = 0;

    const result = await deliverHeldMessages({ parentE164: PARENT }, w.deps);
    expect(result).toEqual({ sent: 2, failed: 0, held: 0 });
    const head = speakerHead({ kind: "class_teacher", name: "Test Teacher" }, "hi");
    expect(w.sent.map(textOf)).toEqual([`${head}\nPehli`, "Doosri"]);
    expect(w.chatUpdates.at(-1)?.patch).toEqual({ live_until: new Date(Date.parse(NOW) + 30 * 60_000).toISOString() });
  });

  it("keeps them waiting while practice mode is on", async () => {
    const w = world({ chat: { lastParentAt: ago(30) }, templates: [template(ANSWER_READY_TEMPLATE.hi, "hi")] });
    await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Pehli", file: null }, teacher, w.deps);
    const practice = { ...w.deps, readSwitches: async () => ({ ...SWITCHES, dryRun: true }) };
    expect(await deliverHeldMessages({ parentE164: PARENT }, practice)).toEqual({ sent: 0, failed: 0, held: 1 });
  });

  it("does nothing for a parent with no chat", async () => {
    const w = world();
    expect(await deliverHeldMessages({ parentE164: STRANGER }, w.deps)).toEqual({ sent: 0, failed: 0, held: 0 });
  });
});

describe("sending a failed message again", () => {
  it("sends it as a new message and marks the old one", async () => {
    let fail = true;
    const w = world({
      send: () => (fail ? { outcome: "rejected", httpStatus: 500, errorCode: null, errorTitle: "Server error", errorDetail: null } : accepted()),
    });
    const failed = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps);
    if (!failed.ok) throw new Error("not kept");
    fail = false;
    const again = await resendChatMessage({ messageId: failed.message.id, clientRef: REF(2) }, teacher, w.deps);
    expect(again).toMatchObject({ ok: true, delivery: "sent", duplicate: false });
    expect(w.messages.get(failed.message.id)?.meta.resent).toBe(true);
    // Once is enough: the old one cannot be sent a third time.
    expect(await resendChatMessage({ messageId: failed.message.id, clientRef: REF(3) }, teacher, w.deps)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("only sends again what failed", async () => {
    const w = world();
    const sent = await sendChatMessage({ chatId: CHAT_ID, clientRef: REF(1), text: "Hi", file: null }, teacher, w.deps);
    if (!sent.ok) throw new Error("not sent");
    expect(await resendChatMessage({ messageId: sent.message.id, clientRef: REF(2) }, teacher, w.deps)).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("an answer written in Messages", () => {
  it("goes the chat's way when the parent's message is in a chat", async () => {
    const w = world({ handoffs: [{ id: "h1", parentReplyId: "reply-1", answeredAt: null, closedAt: null }] });
    const outcome = await answerHandoffInChat({ handoffId: "h1", staffId: TEACHER, text: "Ho gaya." }, w.deps);
    expect(outcome).toMatchObject({ ok: true, delivery: "sent" });
    expect(w.messages.size).toBe(1);
    expect([...w.messages.values()][0]).toMatchObject({ direction: "out", staffName: "Test Teacher", body: "Ho gaya." });
  });

  it("leaves the old way alone while chats are off", async () => {
    const w = world({ chatsEnabled: false, handoffs: [{ id: "h1", parentReplyId: "reply-1", answeredAt: null, closedAt: null }] });
    expect(await answerHandoffInChat({ handoffId: "h1", staffId: TEACHER, text: "Ho gaya." }, w.deps)).toBeNull();
  });

  it("leaves a message that is in no chat to the old way", async () => {
    const w = world();
    expect(await answerHandoffInChat({ handoffId: "nope", staffId: TEACHER, text: "Ho gaya." }, w.deps)).toBeNull();
  });
});
