import { describe, expect, it } from "vitest";

import type { ChatFilter } from "@/modules/chats/domain/filters";
import type { ChatMessage, ChatRow } from "@/modules/chats/domain/types";
import { dayMonthP, timeP } from "@/vx/format";
import {
  chatsHref,
  dayKey,
  dayLabel,
  drawLines,
  isLocal,
  localLine,
  mergeLines,
  newRef,
  photoName,
  pickedKind,
  quickReplies,
  rowTime,
  sizeWords,
  sortLines,
  speechLang,
  telHref,
  windowState,
} from "@/vx/screens/chats/logic";
import { chatListItem, eventWords, messageView, namesWanted, phoneWords, speakerWords, type ChatMessageView } from "@/vx/screens/chats/view";
import { QUICK_REPLIES, T } from "@/vx/screens/chats/words";

/*
 * The Chats screens' own rules (D-616): where a tap goes, how a day and a
 * time read in the school's time zone, how polled lines join the ones on
 * screen, the 24-hour window, a picked file, and what a row and a line of a
 * chat say. Every name and number here is made up (rule 6).
 */

const ME = "11111111-1111-4111-8111-111111111111";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const TEACHER_B = "66666666-6666-4666-8666-666666666666";

const NOW = "2026-11-15T06:00:00.000Z"; // 11:30 in the school, Sunday 15 Nov

const FILTER: ChatFilter = { view: "you", show: "active", teacherId: null, dues: false, query: "" };

function line(over: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: "m1",
    direction: "in",
    kind: "text",
    body: "Namaste",
    at: "2026-11-15T05:00:00.000Z",
    by: null,
    as: null,
    tick: null,
    problem: null,
    resent: false,
    file: null,
    map: null,
    contacts: null,
    event: null,
    ref: null,
    ...over,
  };
}

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    chatId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    direction: "in",
    kind: "text",
    body: "Namaste",
    media: null,
    meta: {},
    wamid: null,
    status: "received",
    error: null,
    staffId: null,
    staffName: null,
    at: "2026-11-15T05:00:00.000Z",
    clientRef: null,
    ...over,
  };
}

function chat(over: Partial<ChatRow> = {}): ChatRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    parentE164: "+919000000010",
    desk: "class",
    classTeacherId: TEACHER_B,
    practice: false,
    sessionLabel: "2026-27",
    fromName: "Test Parent",
    studentIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
    studentLabel: "riya · Class 6, Aarav · Class 2",
    language: "hi",
    status: "waiting",
    waitingSince: "2026-11-15T05:00:00.000Z",
    topic: null,
    complaint: false,
    wantsAdmin: false,
    takenBy: null,
    takenAt: null,
    liveUntil: null,
    lastParentAt: "2026-11-15T05:00:00.000Z",
    lastStaffAt: null,
    lastMessageAt: "2026-11-15T05:00:00.000Z",
    lastPreview: "Namaste",
    lastDirection: "in",
    nudgeStep: null,
    nextNudgeAt: null,
    passedUpAt: null,
    doneAt: null,
    doneBy: null,
    mergedInto: null,
    createdAt: "2026-11-15T05:00:00.000Z",
    ...over,
  };
}

describe("chatsHref: the list's address keeps the filter and leaves defaults out", () => {
  it("is plain /chats for the default view", () => {
    expect(chatsHref(FILTER)).toBe("/chats");
  });

  it("carries one change and keeps the rest", () => {
    expect(chatsHref(FILTER, { view: "all" })).toBe("/chats?view=all");
    const filtered: ChatFilter = { view: "class", show: "done", teacherId: TEACHER_B, dues: true, query: "riya" };
    expect(chatsHref(filtered)).toBe(`/chats?view=class&show=done&teacher=${TEACHER_B}&dues=1&q=riya`);
    expect(chatsHref(filtered, { dues: false, teacherId: null })).toBe("/chats?view=class&show=done&q=riya");
  });

  it("opens a chat with c=, and only when asked", () => {
    expect(chatsHref(FILTER, { chat: "abc" })).toBe("/chats?c=abc");
    expect(chatsHref(FILTER, { chat: null })).toBe("/chats");
  });

  it("encodes a search the way a URL needs", () => {
    expect(chatsHref(FILTER, { query: "R & S" })).toBe("/chats?q=R+%26+S");
  });
});

describe("days and times read in the school's time zone", () => {
  it("puts a moment on its IST day, not its UTC day", () => {
    // 00:30 in the school on 15 Nov is still 14 Nov in UTC.
    expect(dayKey("2026-11-14T19:00:00.000Z")).toBe("2026-11-15");
    expect(dayKey("not a time")).toBe("");
  });

  it("says Today, Yesterday, else the date", () => {
    expect(dayLabel("2026-11-15T01:00:00.000Z", NOW)).toEqual(T.today);
    expect(dayLabel("2026-11-14T19:00:00.000Z", NOW)).toEqual(T.today);
    expect(dayLabel("2026-11-14T10:00:00.000Z", NOW)).toEqual(T.yesterday);
    expect(dayLabel("2026-11-12T08:00:00.000Z", NOW)).toEqual(dayMonthP("2026-11-12T08:00:00.000Z"));
    expect(dayLabel("2026-11-12T08:00:00.000Z", NOW).en).toBe("12 Nov");
  });

  it("gives a list row the time today, Yesterday, else the date", () => {
    expect(rowTime("2026-11-15T01:00:00.000Z", NOW)).toEqual(timeP("2026-11-15T01:00:00.000Z"));
    expect(rowTime("2026-11-14T10:00:00.000Z", NOW)).toEqual(T.yesterday);
    expect(rowTime("2026-11-02T10:00:00.000Z", NOW)).toEqual(dayMonthP("2026-11-02T10:00:00.000Z"));
    expect(rowTime("garbage", NOW)).toEqual({ en: "" });
  });
});

describe("the lines on screen", () => {
  it("sorts oldest first and keeps the arrival order of one moment", () => {
    const a = line({ id: "a", at: "2026-11-15T05:00:00.000Z" });
    const b = line({ id: "b", at: "2026-11-15T04:00:00.000Z" });
    const c = line({ id: "c", at: "2026-11-15T05:00:00.000Z" });
    expect(sortLines([a, b, c]).map((l) => l.id)).toEqual(["b", "a", "c"]);
  });

  it("swaps the screen's own sending line for the saved one, found by its ref", () => {
    const local = localLine({ ref: "r1", text: "Hello", at: "2026-11-15T05:10:00.000Z", by: { en: "Me" }, file: null });
    const saved = line({ id: "m9", direction: "out", body: "Hello", at: "2026-11-15T05:10:01.000Z", tick: "sent", ref: "r1" });
    const merged = mergeLines([line({ id: "m1" }), local], [saved]);
    expect(merged.map((l) => l.id)).toEqual(["m1", "m9"]);
    expect(merged.some(isLocal)).toBe(false);
  });

  it("replaces a line seen before with its newer self, and adds new ones in time order", () => {
    const sending = line({ id: "m2", direction: "out", tick: "sent", at: "2026-11-15T05:05:00.000Z" });
    const read = { ...sending, tick: "read" as const };
    const newer = line({ id: "m3", at: "2026-11-15T05:06:00.000Z" });
    const merged = mergeLines([line({ id: "m1" }), sending], [newer, read]);
    expect(merged.map((l) => [l.id, l.tick])).toEqual([
      ["m1", null],
      ["m2", "read"],
      ["m3", null],
    ]);
  });

  it("never draws one saved line twice", () => {
    const local = localLine({ ref: "r1", text: "Hi", at: "2026-11-15T05:10:00.000Z", by: { en: "Me" }, file: null });
    const saved = line({ id: "m9", direction: "out", at: "2026-11-15T05:10:00.000Z", ref: "r1" });
    const merged = mergeLines([local, saved], [saved]);
    expect(merged.map((l) => l.id)).toEqual(["m9"]);
  });

  it("changes nothing when the polling brought nothing", () => {
    const current = [line({ id: "m1" })];
    const merged = mergeLines(current, []);
    expect(merged).toEqual(current);
    expect(merged).not.toBe(current);
  });

  it("draws a sending line as text, photo or document", () => {
    const base = { ref: "r", at: NOW, by: { en: "Me" } };
    expect(localLine({ ...base, text: "Hi", file: null })).toMatchObject({ id: "local:r", kind: "text", body: "Hi", tick: "sending", direction: "out", ref: "r" });
    const photo = { url: "", name: "Photo.jpg", mime: "image/jpeg", bytes: 1, kind: "image" as const, voice: false };
    expect(localLine({ ...base, text: "", file: photo })).toMatchObject({ kind: "image", body: null });
    expect(localLine({ ...base, text: "Fee slip", file: { ...photo, kind: "document", mime: "application/pdf" } })).toMatchObject({ kind: "document", body: "Fee slip" });
  });

  it("starts a day line at each new day and names the writer at each run", () => {
    const lines = [
      line({ id: "1", at: "2026-11-14T10:00:00.000Z" }),
      line({ id: "2", at: "2026-11-14T10:01:00.000Z" }),
      line({ id: "3", at: "2026-11-14T10:20:00.000Z" }),
      line({ id: "4", direction: "out", by: { en: "Teacher A" }, at: "2026-11-14T10:21:00.000Z" }),
      line({ id: "5", direction: "out", by: { en: "Teacher B" }, at: "2026-11-14T10:22:00.000Z" }),
      line({ id: "6", direction: "ai", by: T.ai, at: "2026-11-15T01:00:00.000Z" }),
      line({ id: "7", direction: "ai", by: T.ai, at: "2026-11-15T01:01:00.000Z" }),
    ];
    const drawn = drawLines(lines, NOW);
    expect(drawn.map((d) => d.day?.en ?? null)).toEqual(["Yesterday", null, null, null, null, "Today", null]);
    expect(drawn.map((d) => d.head)).toEqual([true, false, true, true, true, true, false]);
  });
});

describe("a new message's id", () => {
  it("uses the browser's randomUUID when there is one", () => {
    const source = { randomUUID: () => "fixed-id", getRandomValues: <A extends ArrayBufferView | null>(array: A) => array };
    expect(newRef(source as Pick<Crypto, "getRandomValues"> & { randomUUID: () => string })).toBe("fixed-id");
  });

  it("makes a version-4 id from random bytes on an older phone", () => {
    const zeros = { getRandomValues: <A extends ArrayBufferView | null>(array: A) => array };
    expect(newRef(zeros as Pick<Crypto, "getRandomValues">)).toBe("00000000-0000-4000-8000-000000000000");
    const bytes = ((array: Uint8Array) => globalThis.crypto.getRandomValues(array)) as unknown as Crypto["getRandomValues"];
    const real = newRef({ getRandomValues: bytes });
    expect(real).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("WhatsApp's 24 hours", () => {
  it("is open until the parent's window ends, then closed", () => {
    expect(windowState("2026-11-15T07:00:00.000Z", NOW)).toBe("open");
    expect(windowState("2026-11-15T06:00:00.000Z", NOW)).toBe("closed");
    expect(windowState("2026-11-14T06:00:00.000Z", NOW)).toBe("closed");
  });

  it("is never when the parent has not written", () => {
    expect(windowState(null, NOW)).toBe("never");
    expect(windowState("soon", NOW)).toBe("never");
  });
});

describe("a picked file", () => {
  it("is a photo when the browser says image", () => {
    expect(pickedKind("IMG_2001.HEIC", "image/heic")).toEqual({ kind: "photo" });
  });

  it("knows a document by its name when the phone says nothing", () => {
    expect(pickedKind("Fee slip.docx", "")).toEqual({ kind: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(pickedKind("report.PDF", "application/octet-stream")).toEqual({ kind: "document", mime: "application/pdf" });
    expect(pickedKind("scan.jpeg", "")).toEqual({ kind: "photo" });
  });

  it("refuses what is not sent", () => {
    expect(pickedKind("setup.exe", "application/x-msdownload")).toBeNull();
    expect(pickedKind("notes", "")).toBeNull();
  });

  it("names a photo by its day, never the phone's own file name", () => {
    expect(photoName("2026-11-14T19:00:00.000Z")).toBe("Photo 2026-11-15.jpg");
    expect(photoName("")).toBe("Photo.jpg");
  });

  it("says a size the way people do", () => {
    expect(sizeWords(null)).toBe("");
    expect(sizeWords(0)).toBe("");
    expect(sizeWords(300)).toBe("1 KB");
    expect(sizeWords(240 * 1024)).toBe("240 KB");
    expect(sizeWords(1.4 * 1024 * 1024)).toBe("1.4 MB");
  });
});

describe("the parent's language", () => {
  it("offers ready lines in the parent's own language", () => {
    expect(quickReplies("hi")).toBe(QUICK_REPLIES.hi);
    expect(quickReplies("hx")).toBe(QUICK_REPLIES.hx);
    expect(quickReplies("en")).toBe(QUICK_REPLIES.en);
  });

  it("speaks Hindi to Hindi and Hinglish readers, English to English", () => {
    expect(speechLang("hi")).toBe("hi-IN");
    expect(speechLang("hx")).toBe("hi-IN");
    expect(speechLang("en")).toBe("en-IN");
  });

  it("dials the number without its spaces", () => {
    expect(telHref("+91 90000 00010")).toBe("tel:+919000000010");
  });
});

describe("a row of the list", () => {
  const names = new Map([
    [TEACHER_B, "Teacher B"],
    [ADMIN, "Principal"],
  ]);

  it("writes a number as people read it", () => {
    expect(phoneWords("+919000000010")).toBe("+91 90000 00010");
    expect(phoneWords("+447700900000")).toBe("+447700900000");
  });

  it("falls back to the number when WhatsApp gave no name, and shows the first child's letter", () => {
    const item = chatListItem(chat({ fromName: "  " }), { staffId: ME }, { names, unread: 2 });
    expect(item.name).toBe("+91 90000 00010");
    expect(item.initial).toBe("R");
    expect(item.unread).toBe(2);
    expect(item.studentId).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  });

  it("says who is answering a chat somebody took over", () => {
    expect(chatListItem(chat({ takenBy: ME }), { staffId: ME }, { names, unread: 0 }).takenBy).toEqual(T.youAnswering);
    expect(chatListItem(chat({ takenBy: ADMIN }), { staffId: ME }, { names, unread: 0 }).takenBy).toEqual(T.takenBy("Principal"));
    expect(chatListItem(chat({ takenBy: TEACHER_B, classTeacherId: null }), { staffId: ME }, { names: new Map(), unread: 0 }).takenBy).toEqual(T.takenBy("—"));
  });

  it("marks a chat passed up only while the parent still waits", () => {
    expect(chatListItem(chat({ passedUpAt: NOW }), { staffId: ME }, { names, unread: 0 }).passedUp).toBe(true);
    expect(chatListItem(chat({ passedUpAt: NOW, status: "open" }), { staffId: ME }, { names, unread: 0 }).passedUp).toBe(false);
  });
});

describe("a line of a chat", () => {
  const names = new Map([[TEACHER_B, "Teacher B"]]);

  it("shows a parent's line with no tick and no writer", () => {
    const view = messageView(message(), names);
    expect(view).toMatchObject({ direction: "in", by: null, tick: null, ref: null, problem: null });
  });

  it("names the person who wrote from school, and how the parent read it", () => {
    const view = messageView(
      message({ direction: "out", status: "delivered", staffName: "Teacher A", meta: { speaker: { kind: "class_teacher", name: "Teacher A" } }, clientRef: "r1" }),
      names,
    );
    expect(view.by).toEqual({ en: "Teacher A" });
    expect(view.as).toEqual(speakerWords({ kind: "class_teacher", name: "Teacher A" }));
    expect(view.tick).toBe("delivered");
    expect(view.ref).toBe("r1");
  });

  it("says the desk when the writer's name is missing", () => {
    const view = messageView(message({ direction: "out", status: "sent", meta: { speaker: { kind: "accounts" } } }), names);
    expect(view.by).toEqual(speakerWords({ kind: "accounts" }));
  });

  it("gives Veer Patta AI's answers a sent tick", () => {
    const view = messageView(message({ direction: "ai", status: "received" }), names);
    expect(view.by).toEqual(T.ai);
    expect(view.tick).toBe("sent");
  });

  it("says why a message waits or failed", () => {
    expect(messageView(message({ direction: "out", status: "failed", error: "not_owner_test_number" }), names).problem?.en).toMatch(/owner's number/);
    expect(messageView(message({ direction: "out", status: "waiting", error: null }), names).problem?.en).toMatch(/^Waiting/);
  });

  it("opens a file through One, never straight from storage", () => {
    const view = messageView(message({ kind: "image", media: { path: "chats/x/y.jpg", mime: "image/jpeg", bytes: 2048 } }), names);
    expect(view.file).toEqual({ url: "/chats/file/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Photo", mime: "image/jpeg", bytes: 2048, kind: "image", voice: false });
    expect(messageView(message({ kind: "image", media: {} }), names).file).toBeNull();
    expect(messageView(message({ kind: "audio", media: { mediaId: "123" }, meta: { voice: true } }), names).file).toMatchObject({ name: "Voice note", voice: true });
  });

  it("keeps a shared contact's name and numbers, at most five people", () => {
    const contacts = Array.from({ length: 7 }, (_, index) => ({ name: `Person ${index}`, phones: ["+910000000000"] }));
    const view = messageView(message({ kind: "contacts", meta: { contacts: [...contacts, { junk: true }] } }), names);
    expect(view.contacts).toHaveLength(5);
  });

  it("puts a staff note in words, naming the class teacher it went to", () => {
    const passed = message({ direction: "note", kind: "event", staffName: "Principal", meta: { event: "passed", to: "class", to_teacher: TEACHER_B, joined: true } });
    expect(eventWords(passed, names)?.en).toMatch(/^Principal passed it to .*Teacher B.*, where the family already had a chat$/);
    expect(eventWords(message({ direction: "note", meta: { event: "taken" } }), names)?.en).toBe("Someone took this chat over");
    expect(eventWords(message({ direction: "note", meta: { event: "unknown" } }), names)).toBeNull();
    expect(namesWanted([passed, message()])).toEqual([TEACHER_B]);
  });
});
