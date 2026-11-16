import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/platform/whatsapp/store", () => ({ whatsappDb: vi.fn() }));

import { forYouFilter } from "@/modules/chats/data/list";
import { chatAccess, chatVisible, deskForHandoff, desksOf, mayHandBack, mayPass, type ChatViewer } from "@/modules/chats/domain/access";
import {
  badgeCount,
  countViews,
  isForYou,
  matchesQuery,
  matchesShow,
  matchesView,
  parseChatFilter,
  sortChats,
  teacherGroups,
} from "@/modules/chats/domain/filters";
import { goCodeFrom, goLinkUrl, isGoCode, safeGoPath, GO_CODE_LENGTH } from "@/modules/chats/domain/go-links";
import { digestParams, mayNudgeAgain, nudgeAfter, nudgeAudience, nudgeText, openOneParams, waitingCount } from "@/modules/chats/domain/nudges";
import { routeInbound } from "@/modules/chats/domain/routing";
import type { ChatDesk, ChatRow } from "@/modules/chats/domain/types";
import { childrenLabel, firstChildName, needsHead, outgoingText, previewFor, previewWords, speakerFor } from "@/modules/chats/domain/words";

/*
 * Chats with parents (D-616): who sees and answers which chat, the admin's
 * calm list, where a parent's message goes, the WhatsApp nudge and the
 * one-tap links. Every name and number here is made up (rule 6).
 */

const TEACHER = "11111111-1111-4111-8111-111111111111";
const OTHER_TEACHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const ACCOUNTANT = "44444444-4444-4444-8444-444444444444";
const OFFICE = "55555555-5555-4555-8555-555555555555";

const teacher: ChatViewer = { staffId: TEACHER, role: "teacher", replies: true, seesAll: false, feesDesk: false, viewingTest: false };
const otherTeacher: ChatViewer = { ...teacher, staffId: OTHER_TEACHER };
// An admin may take fees too: `fees:collect` is theirs, like every permission.
const admin: ChatViewer = { staffId: ADMIN, role: "admin", replies: true, seesAll: true, feesDesk: true, viewingTest: false };
const accountant: ChatViewer = { staffId: ACCOUNTANT, role: "accountant", replies: true, seesAll: false, feesDesk: true, viewingTest: false };
const office: ChatViewer = { staffId: OFFICE, role: "office", replies: true, seesAll: false, feesDesk: false, viewingTest: false };
const viewOnly: ChatViewer = { staffId: OFFICE, role: "view_only", replies: false, seesAll: false, feesDesk: false, viewingTest: false };

function chat(over: Partial<ChatRow> = {}): ChatRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    parentE164: "+919000000010",
    desk: "class",
    classTeacherId: TEACHER,
    practice: false,
    sessionLabel: "2026-27",
    fromName: "Test Parent",
    studentIds: [],
    studentLabel: "Riya · Class 6",
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
    lastPreview: "Hello",
    lastDirection: "in",
    nudgeStep: null,
    nextNudgeAt: null,
    passedUpAt: null,
    doneAt: null,
    doneBy: null,
    doneReason: null,
    mergedInto: null,
    createdAt: "2026-11-15T05:00:00.000Z",
    ...over,
  };
}

describe("who sees and answers a chat", () => {
  it("gives a class teacher their own class's chats and nobody else's", () => {
    expect(chatAccess(teacher, chat())).toBe("reply");
    expect(chatAccess(otherTeacher, chat())).toBe("none");
    expect(chatVisible(otherTeacher, chat())).toBe(false);
  });

  it("lets an admin see every chat, write on the office desk, and take a teacher's or the accounts chat over first", () => {
    expect(chatAccess(admin, chat({ desk: "admin", classTeacherId: null }))).toBe("reply");
    expect(chatAccess(admin, chat())).toBe("take_over");
    // Even though an admin may take fees, the accountant must see that they stepped in.
    expect(chatAccess(admin, chat({ desk: "accounts", classTeacherId: null }))).toBe("take_over");
  });

  it("lets only the person who took a chat over write in it; its desk reads until it is handed back", () => {
    const taken = chat({ takenBy: ADMIN, takenAt: "2026-11-15T05:10:00.000Z" });
    expect(chatAccess(admin, taken)).toBe("reply");
    expect(chatAccess(teacher, taken)).toBe("watch");
    expect(mayPass(teacher, taken)).toBe(false);
    expect(mayHandBack(admin, taken)).toBe(true);
    expect(mayHandBack(teacher, taken)).toBe(false);
  });

  it("gives the fee desk the accounts chats, and the office its own desk unless the parent asked for the principal", () => {
    expect(chatAccess(accountant, chat({ desk: "accounts", classTeacherId: null }))).toBe("reply");
    expect(chatAccess(accountant, chat())).toBe("none");
    expect(chatAccess(office, chat({ desk: "admin", classTeacherId: null }))).toBe("reply");
    expect(chatAccess(office, chat({ desk: "admin", classTeacherId: null, wantsAdmin: true }))).toBe("none");
    expect(chatAccess(admin, chat({ desk: "admin", classTeacherId: null, wantsAdmin: true }))).toBe("reply");
  });

  it("shows practice chats only in the test year and real ones only in the real year, whoever looks", () => {
    expect(chatVisible(admin, chat({ practice: true }))).toBe(false);
    expect(chatVisible({ ...admin, viewingTest: true }, chat({ practice: true }))).toBe(true);
    expect(chatVisible({ ...teacher, viewingTest: true }, chat())).toBe(false);
  });

  it("shows nothing to someone without the chats", () => {
    expect(chatAccess(viewOnly, chat({ desk: "admin", classTeacherId: null }))).toBe("none");
    expect(desksOf(viewOnly)).toEqual(["class"].filter(() => false));
  });

  it("names each person's desks for the tabs", () => {
    expect(desksOf(teacher)).toEqual(["class"]);
    expect(desksOf(accountant)).toEqual(["class", "accounts"]);
    expect(desksOf(office)).toEqual(["class", "admin"]);
    expect(desksOf(admin)).toEqual(["class", "accounts", "admin"]);
  });

  it("puts a hand-off on the right desk, and a class with no teacher on file on the office's", () => {
    expect(deskForHandoff("class_teacher", TEACHER)).toEqual({ desk: "class", wantsAdmin: false, classTeacherId: TEACHER });
    expect(deskForHandoff("class_teacher", null)).toEqual({ desk: "admin", wantsAdmin: false, classTeacherId: null });
    expect(deskForHandoff("accounts", TEACHER)).toEqual({ desk: "accounts", wantsAdmin: false, classTeacherId: null });
    expect(deskForHandoff("principal", null)).toEqual({ desk: "admin", wantsAdmin: true, classTeacherId: null });
  });
});

describe("the admin's calm list", () => {
  it("reads the filter from the address, and gives the tabs and teacher chips to an admin only", () => {
    const params = { view: "class", show: "done", teacher: TEACHER, dues: "1", q: "  riya  " };
    expect(parseChatFilter(params, admin)).toEqual({ view: "class", show: "done", teacherId: TEACHER, dues: true, query: "riya" });
    expect(parseChatFilter(params, teacher)).toEqual({ view: "you", show: "done", teacherId: null, dues: false, query: "riya" });
    expect(parseChatFilter({ dues: "1" }, accountant).dues).toBe(true);
    expect(parseChatFilter({ view: "nonsense", show: "x", teacher: "not-an-id" }, admin)).toEqual({ view: "you", show: "active", teacherId: null, dues: false, query: "" });
  });

  it("opens an admin on For you: the office desk, parents asking for the principal, chats passed up, and what they took", () => {
    expect(isForYou(admin, chat({ desk: "admin", classTeacherId: null }))).toBe(true);
    expect(isForYou(admin, chat({ wantsAdmin: true }))).toBe(true);
    expect(isForYou(admin, chat({ passedUpAt: "2026-11-16T05:00:00.000Z" }))).toBe(true);
    expect(isForYou(admin, chat({ takenBy: ADMIN }))).toBe(true);
    expect(isForYou(admin, chat())).toBe(false);
    expect(isForYou(admin, chat({ desk: "admin", classTeacherId: null, takenBy: OFFICE }))).toBe(false);
  });

  it("sorts the longest wait to the top, then the rest newest first", () => {
    const rows = [
      chat({ id: "1", status: "open", waitingSince: null, lastMessageAt: "2026-11-15T04:00:00.000Z" }),
      chat({ id: "2", status: "waiting", waitingSince: "2026-11-15T03:00:00.000Z" }),
      chat({ id: "3", status: "open", waitingSince: null, lastMessageAt: "2026-11-15T06:00:00.000Z" }),
      chat({ id: "4", status: "waiting", waitingSince: "2026-11-15T01:00:00.000Z" }),
    ];
    expect(sortChats(rows).map((row) => row.id)).toEqual(["4", "2", "3", "1"]);
  });

  it("counts each tab, leaves finished talks out, and groups the class teachers most-waiting first", () => {
    const rows = [
      chat({ id: "a" }),
      chat({ id: "b", classTeacherId: OTHER_TEACHER }),
      chat({ id: "c", classTeacherId: OTHER_TEACHER, status: "open" }),
      chat({ id: "d", desk: "accounts", classTeacherId: null }),
      chat({ id: "e", desk: "admin", classTeacherId: null }),
      chat({ id: "f", status: "done" }),
    ];
    const counts = countViews(admin, rows);
    expect(counts.all).toEqual({ waiting: 4, total: 5 });
    expect(counts.class).toEqual({ waiting: 2, total: 3 });
    expect(counts.accounts).toEqual({ waiting: 1, total: 1 });
    expect(counts.you).toEqual({ waiting: 1, total: 1 });
    const names = new Map([
      [TEACHER, "Teacher A"],
      [OTHER_TEACHER, "Teacher B"],
    ]);
    expect(teacherGroups(rows, names)).toEqual([
      { staffId: OTHER_TEACHER, name: "Teacher B", waiting: 1, total: 2 },
      { staffId: TEACHER, name: "Teacher A", waiting: 1, total: 1 },
    ]);
    expect(badgeCount(admin, rows)).toBe(1);
    expect(badgeCount(teacher, rows)).toBe(1);
  });

  it("keeps one list for everyone who is not an admin, and splits an admin's by tab", () => {
    expect(matchesView(teacher, chat(), "accounts")).toBe(true);
    expect(matchesView(admin, chat(), "accounts")).toBe(false);
    expect(matchesView(admin, chat(), "class")).toBe(true);
    expect(matchesShow(chat({ status: "open" }), "active")).toBe(true);
    expect(matchesShow(chat({ status: "done" }), "active")).toBe(false);
    expect(matchesShow(chat({ status: "open" }), "waiting")).toBe(false);
  });

  it("finds a chat by the parent's number, a child's admission number, or names", () => {
    const extra = { names: ["Riya Test"], admissionNos: ["SR-1042"] };
    expect(matchesQuery(chat(), "0010", extra)).toBe(true);
    expect(matchesQuery(chat(), "+91 90000 00010", extra)).toBe(true);
    expect(matchesQuery(chat(), "1042", extra)).toBe(true);
    expect(matchesQuery(chat(), "5555", extra)).toBe(false);
    expect(matchesQuery(chat(), "riya class", extra)).toBe(true);
    expect(matchesQuery(chat(), "sr-1042", extra)).toBe(true);
    expect(matchesQuery(chat(), "aman", extra)).toBe(false);
  });
});

/*
 * The database's "for you" (`forYouFilter`, a PostgREST `or=` string behind
 * the menu's number and the pop-up) must say what the list's `isForYou`
 * says, or the badge and the list disagree. A small reader for the filter's
 * own grammar checks the two against every kind of waiting chat.
 */
type Row = Record<string, string | boolean | null>;

function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") depth -= 1;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function holds(term: string, row: Row): boolean {
  const group = /^(and|or)\((.*)\)$/.exec(term);
  if (group) {
    const terms = splitTop(group[2]);
    return group[1] === "and" ? terms.every((t) => holds(t, row)) : terms.some((t) => holds(t, row));
  }
  const negated = /^(\w+)\.not\.(.+)$/.exec(term);
  if (negated) return !holds(`${negated[1]}.${negated[2]}`, row);
  const match = /^(\w+)\.(eq|is)\.(.+)$/.exec(term);
  if (!match) throw new Error(`Unread filter term: ${term}`);
  const value = row[match[1]];
  if (match[2] === "is") return match[3] === "null" ? value === null : value === (match[3] === "true");
  return String(value) === match[3];
}

function rowOf(c: ChatRow): Row {
  return { taken_by: c.takenBy, desk: c.desk, class_teacher_id: c.classTeacherId, wants_admin: c.wantsAdmin, passed_up_at: c.passedUpAt };
}

describe("the menu's number and the list agree on For you", () => {
  const desks: ChatDesk[] = ["class", "accounts", "admin"];
  const teachers = [TEACHER, OTHER_TEACHER, null];
  const takers = [null, TEACHER, ADMIN, ACCOUNTANT, OFFICE];
  const all: ChatRow[] = [];
  for (const desk of desks)
    for (const classTeacherId of teachers)
      for (const takenBy of takers)
        for (const wantsAdmin of [false, true])
          for (const passedUpAt of [null, "2026-11-16T05:00:00.000Z"]) all.push(chat({ desk, classTeacherId, takenBy, wantsAdmin, passedUpAt }));

  it.each([
    ["the admin", admin],
    ["a class teacher", teacher],
    ["the accountant", accountant],
    ["the office", office],
  ] as const)("for %s", (_name, viewer) => {
    const filter = forYouFilter(viewer);
    expect(filter).not.toBeNull();
    const term = `or(${filter})`;
    for (const row of all) expect(holds(term, rowOf(row)), JSON.stringify(rowOf(row))).toBe(isForYou(viewer, row));
  });

  it("asks nothing for a reader with no proper id", () => {
    expect(forYouFilter({ ...teacher, staffId: "not-a-uuid" })).toBeNull();
  });
});

describe("where a parent's message goes", () => {
  const now = new Date("2026-11-15T06:00:00.000Z");
  const candidate = (over: Partial<Parameters<typeof routeInbound>[0]["candidates"][number]> = {}) => ({
    id: "c1",
    status: "open" as const,
    liveUntil: null,
    lastStaffAt: null,
    waitingOut: 0,
    ...over,
  });

  it("follows a swiped reply into its chat, even a finished one", () => {
    expect(routeInbound({ quotedChatId: "quoted", candidates: [], now })).toEqual({ chatId: "quoted", why: "reply" });
  });

  it("brings the parent's words to the chat holding a message that waits for them", () => {
    const route = routeInbound({ quotedChatId: null, candidates: [candidate({ id: "live", liveUntil: "2026-11-15T07:00:00.000Z" }), candidate({ id: "held", waitingOut: 1 })], now });
    expect(route).toEqual({ chatId: "held", why: "waiting" });
  });

  it("carries on with the person answering right now, and otherwise leaves it to Veer Patta AI", () => {
    expect(routeInbound({ quotedChatId: null, candidates: [candidate({ liveUntil: "2026-11-15T06:10:00.000Z" })], now })).toEqual({ chatId: "c1", why: "live" });
    expect(routeInbound({ quotedChatId: null, candidates: [candidate({ liveUntil: "2026-11-15T05:59:00.000Z" })], now })).toBeNull();
    expect(routeInbound({ quotedChatId: null, candidates: [candidate({ status: "done", liveUntil: "2026-11-15T06:10:00.000Z" })], now })).toBeNull();
  });
});

describe("the WhatsApp nudge to staff", () => {
  const at = new Date("2026-11-15T06:00:00.000Z");
  const HOUR = 3_600_000;

  it("reminds three hours later, and puts a desk's chat in front of the admins a day after the parent wrote", () => {
    expect(nudgeAfter("first", { at, desk: "class", waitingSince: null })).toEqual({ step: "remind", at: new Date(at.getTime() + 3 * HOUR) });
    const since = new Date(at.getTime() - 4 * HOUR);
    expect(nudgeAfter("remind", { at, desk: "class", waitingSince: since })).toEqual({ step: "pass_up", at: new Date(since.getTime() + 24 * HOUR) });
    // Never sooner than an hour after the reminder.
    const long = new Date(at.getTime() - 30 * HOUR);
    expect(nudgeAfter("remind", { at, desk: "accounts", waitingSince: long })).toEqual({ step: "pass_up", at: new Date(at.getTime() + HOUR) });
    expect(nudgeAfter("remind", { at, desk: "admin", waitingSince: since })).toBeNull();
    expect(nudgeAfter("pass_up", { at, desk: "class", waitingSince: since })).toBeNull();
    expect(nudgeAudience("pass_up")).toBe("admins");
    expect(nudgeAudience("first")).toBe("desk");
  });

  it("nudges one person at most once in half an hour", () => {
    expect(mayNudgeAgain(null, at)).toBe(true);
    expect(mayNudgeAgain(new Date(at.getTime() - 10 * 60_000).toISOString(), at)).toBe(false);
    expect(mayNudgeAgain(new Date(at.getTime() - 31 * 60_000).toISOString(), at)).toBe(true);
  });

  it("says how many parents wait, who, and the link, and names the test account a practice nudge stands for", () => {
    expect(waitingCount(1, "en")).toBe("1 parent");
    expect(waitingCount(3, "en")).toBe("3 parents");
    expect(waitingCount(2, "hi")).toBe("2 अभिभावक");
    const text = nudgeText({
      language: "en",
      name: "Teacher A",
      waiting: 5,
      about: ["Riya · Class 6", "Aman · Class 3", "Kavya · Class 1", "Dev · Class 2", "Isha · Class 4"],
      link: "https://one.vpps.co.in/go/AbCdEfGhJk",
      passedUp: false,
      practice: true,
    });
    expect(text).toContain("5 parents waiting for your answer");
    expect(text).toContain("• Riya · Class 6");
    expect(text).toContain("• and 2 more");
    expect(text).not.toContain("Dev");
    expect(text).toContain("https://one.vpps.co.in/go/AbCdEfGhJk");
    expect(text).toContain("Practice: this message is for Teacher A.");
    expect(nudgeText({ language: "hi", name: "A", waiting: 1, about: [], link: "L", passedUp: true, practice: false })).toContain("एक दिन से जवाब नहीं मिला");
  });

  it("fills the approved messages' blanks", () => {
    expect(openOneParams({ language: "en", name: "  Teacher A ", waiting: 2 })).toEqual(["Teacher A", "2 parents"]);
    expect(digestParams({ language: "en", name: "", waiting: 0, link: "L", passedUp: false })).toEqual(["-", "1", "Parents' messages waiting for your answer", "L"]);
  });
});

describe("one-tap links", () => {
  it("makes ten-character codes with no letters that read alike", () => {
    const code = goCodeFrom(new Uint8Array(Array.from({ length: 10 }, (_, i) => i * 37)));
    expect(code).toHaveLength(GO_CODE_LENGTH);
    expect(code).not.toMatch(/[0O1lI]/);
    expect(isGoCode(code)).toBe(true);
    expect(() => goCodeFrom(new Uint8Array(4))).toThrow();
  });

  it("opens only a place inside One, never another site", () => {
    expect(safeGoPath("/chats?c=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe("/chats?c=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    for (const bad of ["//evil.example", "https://evil.example", "chats", "/a b", "/x\\y", "/go/AbCdEfGhJk", `/${"x".repeat(300)}`]) {
      expect(safeGoPath(bad), bad).toBeNull();
    }
    expect(isGoCode("abc")).toBe(false);
    expect(isGoCode("AbCd/EfGh")).toBe(false);
    expect(goLinkUrl("AbCdEfGhJk")).toBe("https://one.vpps.co.in/go/AbCdEfGhJk");
    expect(goLinkUrl("AbCdEfGhJk", "https://one.example/go")).toBe("https://one.example/go/AbCdEfGhJk");
  });
});

describe("the words a parent reads", () => {
  it("heads a message with who is writing, in the parent's language, and only when the writer changes or after a pause", () => {
    const speaker = speakerFor({ desk: "class", role: "teacher", isClassTeacher: true, name: "Teacher A" });
    expect(speaker).toEqual({ kind: "class_teacher", name: "Teacher A" });
    expect(speakerFor({ desk: "class", role: "admin", isClassTeacher: false, name: "Admin" })).toEqual({ kind: "principal" });
    expect(speakerFor({ desk: "accounts", role: "accountant", isClassTeacher: false, name: "X" })).toEqual({ kind: "accounts" });
    expect(speakerFor({ desk: "admin", role: "office", isClassTeacher: false, name: "X" })).toEqual({ kind: "office" });
    expect(outgoingText({ speaker, language: "en", text: " Yes, tomorrow. ", head: true })).toBe("💬 *Teacher A, class teacher*\nYes, tomorrow.");
    expect(outgoingText({ speaker, language: "hi", text: "ठीक है", head: false })).toBe("ठीक है");
    const now = new Date("2026-11-15T06:00:00.000Z");
    expect(needsHead(null, speaker, now)).toBe(true);
    expect(needsHead({ speaker: "class_teacher:Teacher A", at: "2026-11-15T05:50:00.000Z" }, speaker, now)).toBe(false);
    expect(needsHead({ speaker: "class_teacher:Teacher A", at: "2026-11-15T05:00:00.000Z" }, speaker, now)).toBe(true);
    expect(needsHead({ speaker: "accounts", at: "2026-11-15T05:59:00.000Z" }, speaker, now)).toBe(true);
  });

  it("labels the children and finds the first one's name", () => {
    expect(childrenLabel([{ firstName: "Riya", className: "Class 6" }, { firstName: "Aman", className: "Class 3" }])).toBe("Riya · Class 6, Aman · Class 3");
    expect(childrenLabel([])).toBeNull();
    expect(firstChildName("Riya · Class 6, Aman · Class 3")).toBe("Riya");
    expect(firstChildName(null)).toBeNull();
  });

  it("keeps a sign for a photo or a voice note, and says it in words on screen", () => {
    expect(previewFor("image", null, null)).toBe("📷");
    expect(previewFor("image", "fee slip", null)).toBe("📷 fee slip");
    expect(previewFor("document", null, { filename: "fees.pdf" })).toBe("📄 fees.pdf");
    expect(previewWords("📷")).toEqual({ en: "📷 Photo", hi: "📷 फ़ोटो" });
    expect(previewWords("When is the exam?")).toEqual({ en: "When is the exam?" });
    expect(previewWords(null).en).toBe("No messages yet");
  });
});
