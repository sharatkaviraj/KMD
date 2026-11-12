import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/whatsapp/data/helper-store", () => ({
  finishTurn: vi.fn(),
  readBudget: vi.fn(),
  readHelperSettings: vi.fn(),
  saveChat: vi.fn(),
  startTurn: vi.fn(),
}));
vi.mock("@/platform/whatsapp/store", () => ({ readSwitches: vi.fn(), whatsappDb: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ testAccountFlags: (flag: boolean) => ({ isTestAccount: flag, confined: false }) }));
const academics = vi.hoisted(() => ({ classLabelsForJob: vi.fn(), sessionLabelForStaff: vi.fn() }));
vi.mock("@/modules/academics/data/academics-repo", () => academics);
const notes = vi.hoisted(() => ({ parentNotesOn: vi.fn() }));
vi.mock("@/modules/attendance/data/parent-notes", () => notes);
const duties = vi.hoisted(() => ({ myDutiesOn: vi.fn() }));
vi.mock("@/modules/substitutions/data/duty-repo", () => duties);
const bells = vi.hoisted(() => ({ currentBells: vi.fn() }));
vi.mock("@/modules/substitutions/data/school-rules-repo", () => bells);
const log = vi.hoisted(() => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/platform/observability/log", () => log);

import { readOpenHandoffsFor, type AlertRecord, type OpenHandoff } from "@/modules/whatsapp/data/helper-handoffs";
import type { TurnFinish } from "@/modules/whatsapp/data/helper-store";
import {
  handleStaffCommand,
  readLinkedStaff,
  readStaffAbsent,
  readStaffDay,
  schoolMinutesNow,
  type LinkedStaff,
  type StaffHelperDeps,
  type StaffIdentity,
} from "@/modules/whatsapp/data/staff-helper";
import { helperMessageBody, type HelperMessage } from "@/modules/whatsapp/domain/helper-messages";
import { linkReplyText } from "@/modules/whatsapp/domain/staff-link";
import {
  QUESTIONS_AT_ONCE,
  STAFF_INTENTS,
  absentReply,
  commandText,
  linkFirstReply,
  questionsReply,
  staffButtonId,
  staffCommandIn,
  staffMenuReply,
  staffSorryReply,
  stoppedReply,
  todayReply,
  waitedWords,
  type AbsentFacts,
  type DayFacts,
  type StaffContext,
} from "@/modules/whatsapp/domain/staff-helper";
import type { CoverDuty } from "@/modules/substitutions/data/cover-repo";
import type { BellSchedule } from "@/modules/timetable/domain/bells";
import { FEE_SCHEMA } from "@/platform/env";
import type { WhatsAppConfig } from "@/platform/whatsapp/config";
import type { WhatsAppSwitches } from "@/platform/whatsapp/policy";
import type { ClaimResult, ProviderSendResult } from "@/platform/whatsapp/providers";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";

/**
 * The teachers' own Veer Patta AI (D-591): one word to the school's number,
 * and their own day, questions or class back. Every name and number here is
 * made up (rule 6).
 */

// Thursday 12 November 2026, noon on the school's clock.
const NOW = new Date("2026-11-12T06:30:00Z");
const DAY = "2026-11-12";
const OWNER = "+919000000001";
const TEACHER_PHONE = "+919000000002";
const TEACHER_ID = "22222222-2222-4222-8222-222222222222";
const ABSENT_TEACHER_ID = "33333333-3333-4333-8333-333333333333";
const CLASS_6 = "c0000006-0000-4000-8000-000000000006";
const CLASS_7 = "c0000007-0000-4000-8000-000000000007";
const ORIGIN = "https://one.example.test";
const HUB: WhatsAppConfig = { ok: true, provider: "hub", hubUrl: "https://hub.example.test", hubKey: "k", senderNumber: "+918302207823" };

const TEACHER: LinkedStaff = {
  staffId: TEACHER_ID,
  name: "TEST Teacher One",
  role: "teacher",
  isTest: true,
  language: "en",
  permissions: ["attendance:view", "attendance:mark"],
};

const CTX: StaffContext = { language: "en", name: TEACHER.name, helperName: "Veer Patta AI", practice: true, sessionLabel: "TEST-2026-27", origin: ORIGIN };
const HI: StaffContext = { ...CTX, language: "hi" };

function textOf(message: HelperMessage): string {
  return message.kind === "text" ? message.text : message.kind === "document" ? message.caption : message.body;
}

function bodyText(body: Record<string, unknown> | undefined): string {
  if (!body) return "";
  if (body.type === "text") return String((body.text as { body: string }).body);
  return String((body.interactive as { body: { text: string } }).body.text);
}

beforeEach(() => {
  log.logInfo.mockClear();
  log.logWarn.mockClear();
});

/* ------------------------------------------------------------- the words */

describe("which messages are staff commands", () => {
  const text = (words: string | null, type = "text") => staffCommandIn({ type, text: words, raw: { type } });
  const tap = (id: string) => staffCommandIn({ type: "interactive", text: null, raw: { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "x" } } } });

  it("reads one word in English, Roman Hindi or Hindi, however it is typed", () => {
    for (const words of ["today", "Today", " TODAY! ", "today?", "my periods", "aaj", "आज", "मेरे पीरियड", "Time table"]) expect(text(words), words).toBe("today");
    for (const words of ["questions", "Questions?", "my questions", "sawal", "सवाल", "प्रश्न"]) expect(text(words), words).toBe("questions");
    for (const words of ["absent", "Who is absent?", "who's absent", "kaun absent hai", "अनुपस्थित", "आज कौन नहीं आया"]) expect(text(words), words).toBe("absent");
    for (const words of ["staff", "Staff menu", "स्टाफ़", "स्टाफ"]) expect(text(words), words).toBe("menu");
  });

  it("treats a nukta as the same letter, as people type it both ways", () => {
    expect(commandText("ग़ैरहाज़िर")).toBe(commandText("गैरहाजिर"));
    expect(text("ग़ैरहाज़िर")).toBe("absent");
    expect(text("गैरहाजिर")).toBe("absent");
  });

  it("a sentence is a message, not a command: a teacher who is a parent still writes as one", () => {
    expect(text("my son will be absent today, he has fever")).toBeNull();
    expect(text("today is my daughter's birthday")).toBeNull();
    expect(text("What is the fee for class 6?")).toBeNull();
    expect(text("hi")).toBeNull();
    expect(text("menu")).toBeNull();
    expect(text("")).toBeNull();
    expect(text(null)).toBeNull();
  });

  it("reads a template's quick-reply button by its words, and nothing that is not text", () => {
    expect(text("Today", "button")).toBe("today");
    expect(text("today", "audio")).toBeNull();
    expect(text("today", "image")).toBeNull();
  });

  it("reads a tap on a staff button by its id, and never a parent's button", () => {
    for (const command of ["today", "questions", "absent", "menu"] as const) expect(tap(staffButtonId(command))).toBe(command);
    expect(tap("vpst:fees")).toBeNull();
    expect(tap("vpai:menu")).toBeNull();
    expect(tap("today")).toBeNull();
  });
});

/* ------------------------------------------------------------------ today */

const BELLS: BellSchedule = {
  id: null,
  label: "Regular",
  revision: 1,
  periods: [
    { index: 0, starts: "08:00", ends: "08:40" },
    { index: 1, starts: "08:40", ends: "09:20" },
    { index: 2, starts: "09:20", ends: "10:00" },
    { index: 3, starts: "10:00", ends: "10:40" },
    { index: 4, starts: "11:00", ends: "11:40" },
    { index: 5, starts: "11:40", ends: "12:20" },
    { index: 6, starts: "12:20", ends: "13:00" },
    { index: 7, starts: "13:00", ends: "13:40" },
  ],
};

function dayFacts(over: Partial<DayFacts> = {}): DayFacts {
  return {
    day: DAY,
    calendar: null,
    open: true,
    runs: true,
    published: true,
    lessons: [
      { number: 1, starts: "08:00", ends: "08:40", subject: { en: "Maths", hi: "गणित" }, classes: ["Class 6"] },
      { number: 6, starts: "11:40", ends: "12:20", subject: { en: "Maths", hi: "गणित" }, classes: ["Class 7", "Class 7B"] },
    ],
    covers: [{ number: 4, starts: "10:00", ends: "10:40", subject: { en: "English", hi: "अंग्रेज़ी" }, classes: ["Class 8"], forNames: ["TEST Teacher Two"], seen: false }],
    freePeriods: [2, 3, 5, 7, 8],
    leave: null,
    nowMinutes: 12 * 60,
    ...over,
  };
}

describe("the reply to *today*", () => {
  it("lists their periods with the bells, points at the one on now, and adds cover and free periods", () => {
    const message = todayReply(dayFacts(), CTX);
    const body = textOf(message);
    expect(body).toContain("📅 *Your day · Thursday, 12 November*");
    expect(body).toContain("🧪 Practice: TEST-2026-27 test records");
    expect(body).toContain("*Your periods (2)*");
    expect(body).toContain("• P1 · 8:00–8:40 · Maths · Class 6");
    expect(body).toContain("👉 P6 · 11:40–12:20 · Maths · Class 7, Class 7B (now)");
    expect(body).toContain("Free: periods 2, 3, 5, 7, 8");
    expect(body).toContain("*Cover you are taking (1)*");
    expect(body).toContain("🔁 P4 · 10:00–10:40 · English · Class 8 (for TEST Teacher Two)");
    expect(body).toContain("Open Today in One and tap Seen");
    expect(body).toContain(`${ORIGIN}/teach`);
    expect(message.kind === "buttons" && message.buttons.map((button) => button.id)).toEqual(["vpst:questions", "vpst:absent"]);
  });

  it("writes a run of free periods as a range, and says nothing about Seen once it is seen", () => {
    const body = textOf(todayReply(dayFacts({ freePeriods: [2, 3, 4, 5, 8], covers: [{ ...dayFacts().covers![0]!, seen: true }] }), CTX));
    expect(body).toContain("Free: periods 2–5, 8");
    expect(body).not.toContain("tap Seen");
    expect(textOf(todayReply(dayFacts({ freePeriods: [6] }), CTX))).toContain("Free: period 6\n");
    expect(textOf(todayReply(dayFacts({ leave: { state: "waiting", periods: [3], fullDay: false } }), CTX))).toContain("Your leave for period 3 today");
  });

  it("speaks Hindi to a Hindi reader", () => {
    const body = textOf(todayReply(dayFacts(), HI));
    expect(body).toContain("📅 *आपका दिन · गुरुवार, 12 नवंबर*");
    expect(body).toContain("• P1 · 8:00–8:40 · गणित · Class 6");
    expect(body).toContain("(अभी)");
    expect(body).toContain("(TEST Teacher Two की जगह)");
  });

  it("no practice line for a real member of staff", () => {
    expect(textOf(todayReply(dayFacts(), { ...CTX, practice: false, sessionLabel: "2026-27" }))).not.toContain("Practice");
  });

  it("a closed day says so, with the calendar's name, and offers only the questions", () => {
    const message = todayReply(dayFacts({ open: false, runs: false, calendar: { kind: "holiday", name: { en: "TEST Festival", hi: "टेस्ट त्योहार" } } }), CTX);
    expect(textOf(message)).toContain("🏠 School is closed today (TEST Festival). There are no periods today.");
    expect(textOf(message)).not.toContain("Your periods");
    expect(message.kind === "buttons" && message.buttons.map((button) => button.id)).toEqual(["vpst:questions"]);
  });

  it("an exam or event day has no usual periods, but cover is still shown", () => {
    const exam = textOf(todayReply(dayFacts({ runs: false, lessons: [], calendar: { kind: "exam", name: null } }), CTX));
    expect(exam).toContain("📝 Today is an exam day, so the usual periods do not run.");
    expect(exam).toContain("*Cover you are taking (1)*");
    const event = textOf(todayReply(dayFacts({ runs: false, lessons: [], covers: [], calendar: { kind: "event", name: { en: "Sports Day", hi: null } } }), CTX));
    expect(event).toContain("🎉 Today is an event day (Sports Day)");
  });

  it("no published timetable, no periods, and cover that could not be read each say so", () => {
    expect(textOf(todayReply(dayFacts({ published: false, lessons: [] }), CTX))).toContain("timetable is not published in One yet");
    expect(textOf(todayReply(dayFacts({ lessons: [], freePeriods: [], covers: [] }), CTX))).toContain("☕ You have no periods in the timetable today.");
    expect(textOf(todayReply(dayFacts({ covers: null }), CTX))).toContain("Today's cover could not be read just now");
  });

  it("says when their leave is approved or still waiting", () => {
    expect(textOf(todayReply(dayFacts({ leave: { state: "approved", periods: [1, 2, 3, 4, 5, 6, 7, 8], fullDay: true } }), CTX))).toContain("🌴 You are on leave today (approved).");
    expect(textOf(todayReply(dayFacts({ leave: { state: "waiting", periods: [1, 2, 3, 4], fullDay: false } }), CTX))).toContain(
      "⏳ Your leave for periods 1–4 today is waiting for the office.",
    );
  });
});

/* -------------------------------------------------------------- questions */

describe("the reply to *questions*", () => {
  const facts = { count: 0, shown: 0, oldestAt: null, now: NOW, canOpenMessages: false };

  it("nobody waiting: says so, and when the questions come", () => {
    const body = textOf(questionsReply(facts, CTX));
    expect(body).toContain("✅ *No parent is waiting for your answer.*");
    expect(body).toContain("between 6 am and 9 pm");
  });

  it("one waiting: how long, and that it comes next to swipe on", () => {
    const body = textOf(questionsReply({ ...facts, count: 1, shown: 1, oldestAt: "2026-11-12T04:30:00Z" }, CTX));
    expect(body).toContain("📝 *1 parent is waiting for your answer*");
    expect(body).toContain("Waiting for 2 hours.");
    expect(body).toContain("It comes next, as its own message.");
    expect(body).toContain("Swipe right on one and type your answer.");
    expect(body).not.toContain("/messages");
  });

  it("more than come at once: a teacher asks again, the office opens Messages", () => {
    const many = { ...facts, count: 5, shown: QUESTIONS_AT_ONCE, oldestAt: "2026-11-10T06:30:00Z" };
    const teacher = textOf(questionsReply(many, CTX));
    expect(teacher).toContain("📝 *5 parents are waiting for your answer*");
    expect(teacher).toContain("The oldest has waited 2 days.");
    expect(teacher).toContain("The oldest 3 come next, each as its own message.");
    expect(teacher).toContain("write *questions* again");
    const office = textOf(questionsReply({ ...many, canOpenMessages: true }, CTX));
    expect(office).toContain(`${ORIGIN}/messages?view=replies`);
    expect(textOf(questionsReply(many, HI))).toContain("5 अभिभावक आपके जवाब की राह देख रहे हैं");
  });

  it("counts the wait in minutes, hours or days", () => {
    expect(waitedWords("2026-11-12T06:29:30Z", NOW, "en")).toBe("1 minute");
    expect(waitedWords("2026-11-12T06:05:00Z", NOW, "en")).toBe("25 minutes");
    expect(waitedWords("2026-11-12T05:30:00Z", NOW, "en")).toBe("1 hour");
    expect(waitedWords("2026-11-11T06:30:00Z", NOW, "hi")).toBe("1 दिन");
    expect(waitedWords(null, NOW, "en")).toBeNull();
    expect(waitedWords("not a time", NOW, "en")).toBeNull();
  });
});

/* ----------------------------------------------------------------- absent */

describe("the reply to *absent*", () => {
  const marked: AbsentFacts = {
    kind: "classes",
    day: DAY,
    classes: [
      {
        classLabel: "Class 6",
        classId: CLASS_6,
        marked: true,
        present: 38,
        total: 41,
        away: [
          { name: "TEST Child Two", rollNo: "2", status: "absent", parentNote: "sick" },
          { name: "TEST Child Ten", rollNo: "10", status: "absent", parentNote: null },
          { name: "TEST Child Five", rollNo: "5", status: "leave", parentNote: null },
          { name: "TEST Child Seven", rollNo: "7", status: "late", parentNote: null },
        ],
        told: [],
      },
    ],
  };

  it("a marked register: how many came, then who did not, grouped, with the parents who told the school", () => {
    const body = textOf(absentReply(marked, CTX));
    expect(body).toContain("📋 *Today's register · Thursday, 12 November*");
    expect(body).toContain("📋 *Class 6* · 38 of 41 present");
    expect(body).toContain("❌ Absent (2):\n• 2. TEST Child Two 📱 unwell\n• 10. TEST Child Ten");
    expect(body).toContain("🌴 On leave (1):\n• 5. TEST Child Five");
    expect(body).toContain("⏰ Late (1):\n• 7. TEST Child Seven");
    expect(body).toContain("📱 = the parent told the school on WhatsApp");
  });

  it("everyone here says so", () => {
    const all: AbsentFacts = { kind: "classes", day: DAY, classes: [{ classLabel: "Class 6", classId: CLASS_6, marked: true, present: 41, total: 41, away: [], told: [] }] };
    expect(textOf(absentReply(all, CTX))).toContain("🎉 Everyone is here today.");
  });

  it("not marked yet: the parents who told the school, and the link to mark it", () => {
    const body = textOf(
      absentReply({ kind: "classes", day: DAY, classes: [{ classLabel: "Class 7", classId: CLASS_7, marked: false, present: 0, total: 0, away: [], told: [{ name: "TEST Child Three", rollNo: "3", reason: "other" }] }] }, CTX),
    );
    expect(body).toContain("📋 *Class 7* · today's register is not marked yet.");
    expect(body).toContain("📱 These parents told the school their child is away today:\n• 3. TEST Child Three (told us)");
    expect(body).toContain(`Mark it: ${ORIGIN}/teach/attendance?class=${CLASS_7}&day=${DAY}`);
  });

  it("not a class teacher, a role without attendance, and a closed day each say so", () => {
    expect(textOf(absentReply({ kind: "no_class" }, CTX))).toContain("In One you are not a class teacher this year.");
    expect(textOf(absentReply({ kind: "not_allowed" }, CTX))).toContain("Your role in One does not include seeing attendance.");
    expect(textOf(absentReply({ kind: "closed", day: DAY, calendar: { kind: "holiday", name: { en: "TEST Festival", hi: null } } }, CTX))).toContain(
      "🏠 School is closed today (TEST Festival), so there is no register today.",
    );
  });

  it("two classes of fifty away still go: counted past twenty-five names, and as plain text when too long for buttons", () => {
    const away = Array.from({ length: 50 }, (_, i) => ({ name: `TEST Child Number ${i + 1}`, rollNo: String(i + 1), status: "absent" as const, parentNote: null }));
    const message = absentReply(
      {
        kind: "classes",
        day: DAY,
        classes: [
          { classLabel: "Class 6", classId: CLASS_6, marked: true, present: 0, total: 50, away, told: [] },
          { classLabel: "Class 7", classId: CLASS_7, marked: true, present: 0, total: 50, away, told: [] },
        ],
      },
      CTX,
    );
    expect(textOf(message)).toContain("…and 25 more");
    expect(textOf(message)).not.toContain("TEST Child Number 26");
    const body = helperMessageBody(TEACHER_PHONE, message);
    expect(body.type).toBe("text");
    expect(bodyText(body).length).toBeLessThanOrEqual(4096);
    expect(bodyText(body)).toContain("📋 *Class 7*");
  });
});

/* ------------------------------------------------------------ the others */

describe("the other replies", () => {
  it("*staff* shows the three as buttons, every title inside WhatsApp's 20 letters", () => {
    for (const ctx of [CTX, HI]) {
      const message = staffMenuReply(ctx);
      expect(message.kind).toBe("buttons");
      if (message.kind !== "buttons") continue;
      expect(message.buttons.map((button) => button.id)).toEqual(["vpst:today", "vpst:questions", "vpst:absent"]);
      for (const button of message.buttons) expect(button.title.length).toBeLessThanOrEqual(20);
      expect(message.body.length).toBeLessThanOrEqual(1024);
    }
    expect(textOf(staffMenuReply(CTX))).toContain("Namaste, TEST Teacher One!");
    expect(textOf(staffMenuReply(CTX))).toContain("To write to the school as a parent, write your message in full.");
  });

  it("an unlinked number is told how to link, a stopped one how to turn it on, in its language", () => {
    expect(textOf(linkFirstReply("en", "Veer Patta AI"))).toContain("Link my WhatsApp");
    expect(textOf(linkFirstReply("hi", "Veer Patta AI"))).toContain("मेरा WhatsApp जोड़ें");
    expect(textOf(stoppedReply("en"))).toContain("Turn on again");
    expect(textOf(stoppedReply("hi"))).toContain("फिर से चालू करें");
    expect(textOf(staffSorryReply("en", ORIGIN))).toContain(`${ORIGIN}/teach`);
  });

  it("a newly linked number is told the three words", () => {
    expect(linkReplyText("linked", "en", "TEST Teacher One", "Veer Patta AI")).toContain("*today*");
    expect(linkReplyText("linked", "hi", "TEST Teacher One", "Veer Patta AI")).toContain("*अनुपस्थित*");
    expect(linkReplyText("already_linked", "en", null, "Veer Patta AI")).toContain("*questions*");
  });

  it("none of the staff turns is a parent's question in the week's report", () => {
    expect(Object.values(STAFF_INTENTS).every((intent) => /^staff_[a-z_]+$/.test(intent))).toBe(true);
  });
});

/* ---------------------------------------------------------- a fake database */

type Row = Record<string, unknown>;

/**
 * Just enough of the Supabase query builder for these reads, filtering the
 * rows it was given the way PostgREST would. `failing` tables answer an error.
 */
function fakeDb(tables: Record<string, Row[]>, failing: string[] = []) {
  const reads: Array<{ schema: string; table: string; filters: string[] }> = [];
  const query = (schema: string, table: string) => {
    const tests: Array<(row: Row) => boolean> = [];
    const filters: string[] = [];
    let limit = Number.POSITIVE_INFINITY;
    let order: { column: string; ascending: boolean } | null = null;
    reads.push({ schema, table, filters });
    const run = () => {
      if (failing.includes(table)) return { data: null, error: { message: "down", code: "XX000" } };
      let rows = (tables[table] ?? []).filter((row) => tests.every((test) => test(row)));
      if (order) {
        const { column, ascending } = order;
        rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
      }
      return { data: rows.slice(0, limit), error: null };
    };
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push(`eq:${column}`);
        tests.push((row) => row[column] === value);
        return chain;
      },
      in: (column: string, values: readonly unknown[]) => {
        filters.push(`in:${column}:${values.length}`);
        tests.push((row) => values.includes(row[column]));
        return chain;
      },
      is: (column: string, value: unknown) => {
        filters.push(`is:${column}`);
        tests.push((row) => (row[column] ?? null) === value);
        return chain;
      },
      not: (column: string, _operator: string, value: unknown) => {
        filters.push(`not:${column}`);
        tests.push((row) => (row[column] ?? null) !== value);
        return chain;
      },
      lte: (column: string, value: string) => {
        tests.push((row) => String(row[column]) <= value);
        return chain;
      },
      gte: (column: string, value: string) => {
        tests.push((row) => String(row[column]) >= value);
        return chain;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        order = { column, ascending: options?.ascending !== false };
        return chain;
      },
      limit: (count: number) => {
        limit = count;
        return chain;
      },
      returns: () => chain,
      maybeSingle: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  };
  const db = { from: (table: string) => query("vppsone", table), schema: (name: string) => ({ from: (table: string) => query(name, table) }) };
  return { db: db as never, reads };
}

/* ------------------------------------------------------- who is writing */

function profile(over: Row = {}): Row {
  return {
    id: TEACHER_ID,
    display_name: "TEST Teacher One",
    short_name: "TT1",
    role: "teacher",
    is_active: true,
    is_test_account: true,
    preferred_language: "en",
    whatsapp_phone: TEACHER_PHONE.slice(-10),
    whatsapp_opt_in_at: "2026-11-12T05:00:00Z",
    whatsapp_opt_out_at: null,
    ...over,
  };
}

const USED_LINK: Row = { staff_profile_id: TEACHER_ID, used_from: TEACHER_PHONE, used_at: "2026-11-12T05:00:00Z" };
const GRANTS: Row[] = [
  { role: "teacher", permission: "attendance:view" },
  { role: "teacher", permission: "attendance:mark" },
  { role: "admin", permission: "messages:send" },
];

describe("who a number is, as staff", () => {
  it("a number linked from its own phone is that person, with their role's permissions", async () => {
    const { db } = fakeDb({ staff_profiles: [profile()], staff_whatsapp_links: [USED_LINK], role_permissions: GRANTS });
    expect(await readLinkedStaff(TEACHER_PHONE, db)).toEqual({ state: "linked", staff: TEACHER });
  });

  it("a number on a staff record that never linked itself is only asked to link", async () => {
    const typed = fakeDb({ staff_profiles: [profile()], staff_whatsapp_links: [], role_permissions: GRANTS });
    expect(await readLinkedStaff(TEACHER_PHONE, typed.db)).toEqual({ state: "unproven", language: "en", isTest: true });
    // A code used from another phone proves nothing about this one.
    const elsewhere = fakeDb({ staff_profiles: [profile()], staff_whatsapp_links: [{ ...USED_LINK, used_from: OWNER }], role_permissions: GRANTS });
    expect(await readLinkedStaff(TEACHER_PHONE, elsewhere.db)).toEqual({ state: "unproven", language: "en", isTest: true });
    // An open code nobody sent proves nothing either.
    const unused = fakeDb({ staff_profiles: [profile()], staff_whatsapp_links: [{ ...USED_LINK, used_at: null }], role_permissions: GRANTS });
    expect(await readLinkedStaff(TEACHER_PHONE, unused.db)).toEqual({ state: "unproven", language: "en", isTest: true });
  });

  it("a person who turned WhatsApp off is stopped, and an inactive one is nobody", async () => {
    const off = fakeDb({ staff_profiles: [profile({ whatsapp_opt_out_at: "2026-11-12T05:30:00Z" })], staff_whatsapp_links: [USED_LINK], role_permissions: GRANTS });
    expect(await readLinkedStaff(TEACHER_PHONE, off.db)).toEqual({ state: "stopped", language: "en", isTest: true });
    const left = fakeDb({ staff_profiles: [profile({ is_active: false })], staff_whatsapp_links: [USED_LINK], role_permissions: GRANTS });
    expect(await readLinkedStaff(TEACHER_PHONE, left.db)).toEqual({ state: "none" });
  });

  it("a number on no staff record, or not an Indian mobile, is nobody; an unreadable table is null", async () => {
    expect(await readLinkedStaff(OWNER, fakeDb({ staff_profiles: [profile()] }).db)).toEqual({ state: "none" });
    expect(await readLinkedStaff("+447700900123", fakeDb({ staff_profiles: [profile()] }).db)).toEqual({ state: "none" });
    expect(await readLinkedStaff(TEACHER_PHONE, fakeDb({ staff_profiles: [profile()] }, ["staff_profiles"]).db)).toBeNull();
    expect(await readLinkedStaff(TEACHER_PHONE, fakeDb({ staff_profiles: [profile()], staff_whatsapp_links: [USED_LINK] }, ["role_permissions"]).db)).toBeNull();
  });

  it("when one phone linked two profiles, the newest link stands", async () => {
    const REAL_ID = "99999999-9999-4999-8999-999999999999";
    const { db } = fakeDb({
      staff_profiles: [profile(), profile({ id: REAL_ID, display_name: "TEST Real Person", role: "admin", is_test_account: false })],
      staff_whatsapp_links: [USED_LINK, { staff_profile_id: REAL_ID, used_from: TEACHER_PHONE, used_at: "2026-11-12T06:00:00Z" }],
      role_permissions: GRANTS,
    });
    const who = (await readLinkedStaff(TEACHER_PHONE, db)) as Extract<StaffIdentity, { state: "linked" }>;
    expect(who.staff).toMatchObject({ staffId: REAL_ID, role: "admin", isTest: false, permissions: ["messages:send"] });
  });
});

/* --------------------------------------------------------- reading the day */

function duty(over: Partial<CoverDuty> = {}): CoverDuty {
  return {
    id: "d1",
    needKey: "n1",
    period: 3,
    eventKind: "ordinary",
    classIds: ["c8"],
    classLabels: ["Class 8"],
    subjectCode: "ENG",
    absentStaffIds: [ABSENT_TEACHER_ID],
    status: "assigned",
    coveringStaffId: TEACHER_ID,
    suggestedStaffId: null,
    reason: null,
    source: "auto",
    pinned: false,
    matchTier: null,
    warnings: [],
    revision: 1,
    supersedes: null,
    dayRevision: 1,
    createdAt: "2026-11-12T02:00:00Z",
    endedAt: null,
    acknowledgedAt: null,
    cannotCoverAt: null,
    cannotCoverNote: null,
    day: DAY,
    sessionLabel: "TEST-2026-27",
    ...over,
  };
}

const VERSION = "v0000001-0000-4000-8000-000000000001";

function dayTables(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    academic_calendar_days: [],
    timetable_versions: [{ id: VERSION, session_label: "TEST-2026-27", status: "published" }],
    teacher_leave: [],
    timetable_slots: [
      { version_id: VERSION, staff_profile_id: TEACHER_ID, day: "Thu", period: 0, class_id: CLASS_6, class_label: "Class 6", subject_code: "MATH" },
      { version_id: VERSION, staff_profile_id: TEACHER_ID, day: "Thu", period: 5, class_id: CLASS_7, class_label: "Class 7", subject_code: "MATH" },
      { version_id: VERSION, staff_profile_id: TEACHER_ID, day: "Fri", period: 1, class_id: CLASS_7, class_label: "Class 7", subject_code: "SCI" },
      // Somebody else's period is never theirs.
      { version_id: VERSION, staff_profile_id: ABSENT_TEACHER_ID, day: "Thu", period: 1, class_id: CLASS_6, class_label: "Class 6", subject_code: "HIN" },
    ],
    subjects: [
      { code: "MATH", name_en: "Maths", name_hi: "गणित" },
      { code: "ENG", name_en: "English", name_hi: "अंग्रेज़ी" },
    ],
    staff_profiles: [{ id: ABSENT_TEACHER_ID, display_name: "TEST Teacher Two", short_name: null }],
    ...over,
  };
}

describe("reading a teacher's day from One", () => {
  beforeEach(() => {
    bells.currentBells.mockReset().mockResolvedValue(BELLS);
    duties.myDutiesOn.mockReset().mockResolvedValue([duty()]);
  });

  it("their own periods on today's sheet, their cover with who it is for, and the periods left free", async () => {
    const facts = await readStaffDay(TEACHER, "TEST-2026-27", NOW, fakeDb(dayTables()).db);
    expect(facts).toMatchObject({ day: DAY, open: true, runs: true, published: true, leave: null, nowMinutes: 720 });
    expect(facts!.lessons).toEqual([
      { number: 1, starts: "08:00", ends: "08:40", subject: expect.objectContaining({ hi: "गणित" }), classes: ["Class 6"] },
      { number: 6, starts: "11:40", ends: "12:20", subject: expect.objectContaining({ hi: "गणित" }), classes: ["Class 7"] },
    ]);
    expect(facts!.covers).toEqual([
      { number: 4, starts: "10:00", ends: "10:40", subject: expect.objectContaining({ hi: "अंग्रेज़ी" }), classes: ["Class 8"], forNames: ["TEST Teacher Two"], seen: false },
    ]);
    expect(facts!.freePeriods).toEqual([2, 3, 5, 7, 8]);
    expect(duties.myDutiesOn).toHaveBeenCalledWith(TEACHER_ID, "TEST-2026-27", DAY);
  });

  it("a holiday reads no periods and no cover", async () => {
    const facts = await readStaffDay(TEACHER, "TEST-2026-27", NOW, fakeDb(dayTables({ academic_calendar_days: [{ session_label: "TEST-2026-27", day: DAY, kind: "holiday", label_en: "TEST Festival", label_hi: null }] })).db);
    expect(facts).toMatchObject({ open: false, lessons: [], covers: [], freePeriods: [] });
    expect(facts!.calendar).toEqual({ kind: "holiday", name: { en: "TEST Festival", hi: null } });
  });

  it("their approved leave for the day, and cover that could not be read", async () => {
    duties.myDutiesOn.mockRejectedValue(new Error("down"));
    const facts = await readStaffDay(
      TEACHER,
      "TEST-2026-27",
      NOW,
      fakeDb(dayTables({ teacher_leave: [{ staff_profile_id: TEACHER_ID, session_label: "TEST-2026-27", from_day: DAY, to_day: DAY, span: "first_half", status: "approved" }] })).db,
    );
    expect(facts!.leave).toMatchObject({ state: "approved", fullDay: false });
    expect(facts!.leave!.periods.length).toBeGreaterThan(0);
    expect(facts!.covers).toBeNull();
  });

  it("no published sheet reads as not published; an unreadable sheet is null", async () => {
    expect(await readStaffDay(TEACHER, "TEST-2026-27", NOW, fakeDb(dayTables({ timetable_versions: [] })).db)).toMatchObject({ published: false, lessons: [] });
    expect(await readStaffDay(TEACHER, "TEST-2026-27", NOW, fakeDb(dayTables(), ["timetable_slots"]).db)).toBeNull();
    expect(await readStaffDay(TEACHER, "TEST-2026-27", NOW, fakeDb(dayTables(), ["academic_calendar_days"]).db)).toBeNull();
  });

  it("knows the school's clock", () => {
    expect(schoolMinutesNow(NOW)).toBe(720);
    expect(schoolMinutesNow(new Date("2026-11-12T20:00:00Z"))).toBe(90);
  });
});

/* ------------------------------------------------------ reading the class */

function classTables(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    class_teachers: [{ staff_profile_id: TEACHER_ID, session_label: "TEST-2026-27", class_id: CLASS_6, effective_from: "2026-04-01", effective_to: null }],
    academic_calendar_days: [],
    attendance_registers: [{ id: "r6", session_label: "TEST-2026-27", day: DAY, period: null, class_id: CLASS_6, status: "submitted", revision: 1 }],
    enrolments: [
      { student_id: "s1", class_id: CLASS_6, roll_no: "1", session_label: "TEST-2026-27", status: "enrolled" },
      { student_id: "s2", class_id: CLASS_6, roll_no: "2", session_label: "TEST-2026-27", status: "enrolled" },
      { student_id: "s3", class_id: CLASS_6, roll_no: "10", session_label: "TEST-2026-27", status: "enrolled" },
      { student_id: "s4", class_id: CLASS_6, roll_no: "4", session_label: "TEST-2026-27", status: "enrolled" },
    ],
    attendance_marks: [
      { register_id: "r6", student_id: "s1", status: "present" },
      { register_id: "r6", student_id: "s2", status: "absent" },
      { register_id: "r6", student_id: "s3", status: "absent" },
      { register_id: "r6", student_id: "s4", status: "late" },
    ],
    students: [
      { id: "s1", full_name: "TEST Child One" },
      { id: "s2", full_name: "TEST Child Two" },
      { id: "s3", full_name: "TEST Child Ten" },
      { id: "s4", full_name: "TEST Child Four" },
    ],
    ...over,
  };
}

describe("reading the class they hold", () => {
  beforeEach(() => {
    academics.classLabelsForJob.mockReset().mockResolvedValue(new Map([[CLASS_6, "Class 6"], [CLASS_7, "Class 7"]]));
    notes.parentNotesOn.mockReset().mockResolvedValue(new Map([["s2", "sick"]]));
  });

  it("today's marked register: present counts the late ones, the rest listed by roll, with the parent's note", async () => {
    const { db, reads } = fakeDb(classTables());
    const facts = await readStaffAbsent(TEACHER, "TEST-2026-27", DAY, db);
    expect(facts).toEqual({
      kind: "classes",
      day: DAY,
      classes: [
        {
          classLabel: "Class 6",
          classId: CLASS_6,
          marked: true,
          present: 2,
          total: 4,
          away: [
            { name: "TEST Child Two", rollNo: "2", status: "absent", parentNote: "sick" },
            { name: "TEST Child Four", rollNo: "4", status: "late", parentNote: null },
            { name: "TEST Child Ten", rollNo: "10", status: "absent", parentNote: null },
          ],
          told: [],
        },
      ],
    });
    // Names come from the fee schema's students, read only and only for the children named.
    expect(reads.find((read) => read.table === "students")).toEqual({ schema: FEE_SCHEMA, table: "students", filters: ["in:id:3"] });
  });

  it("before it is marked: the children whose parents told the school", async () => {
    const facts = await readStaffAbsent(TEACHER, "TEST-2026-27", DAY, fakeDb(classTables({ attendance_registers: [] })).db);
    expect(facts).toMatchObject({ kind: "classes", classes: [{ marked: false, told: [{ name: "TEST Child Two", rollNo: "2", reason: "sick" }] }] });
    // A draft nobody saved is not a register yet.
    const draft = await readStaffAbsent(TEACHER, "TEST-2026-27", DAY, fakeDb(classTables({ attendance_registers: [{ id: "r6", session_label: "TEST-2026-27", day: DAY, period: null, class_id: CLASS_6, status: "draft", revision: 0 }] })).db);
    expect(draft).toMatchObject({ kind: "classes", classes: [{ marked: false }] });
  });

  it("not a class teacher today, a role without attendance, a closed day, and an unreadable read", async () => {
    const ended = classTables({ class_teachers: [{ staff_profile_id: TEACHER_ID, session_label: "TEST-2026-27", class_id: CLASS_6, effective_from: "2026-04-01", effective_to: "2026-10-31" }] });
    expect(await readStaffAbsent(TEACHER, "TEST-2026-27", DAY, fakeDb(ended).db)).toEqual({ kind: "no_class" });
    expect(await readStaffAbsent({ ...TEACHER, permissions: [] }, "TEST-2026-27", DAY, fakeDb(classTables()).db)).toEqual({ kind: "not_allowed" });
    const holiday = classTables({ academic_calendar_days: [{ session_label: "TEST-2026-27", day: DAY, kind: "holiday", label_en: null, label_hi: null }] });
    expect(await readStaffAbsent(TEACHER, "TEST-2026-27", DAY, fakeDb(holiday).db)).toEqual({ kind: "closed", day: DAY, calendar: { kind: "holiday", name: null } });
    expect(await readStaffAbsent(TEACHER, "TEST-2026-27", DAY, fakeDb(classTables(), ["attendance_marks"]).db)).toBeNull();
    expect(await readStaffAbsent(TEACHER, "TEST-2026-27", DAY, fakeDb(classTables(), ["class_teachers"]).db)).toBeNull();
  });
});

/* ------------------------------------------------- their waiting questions */

function handoffRow(id: string, over: Row = {}, reply: Row = {}): Row {
  return {
    id,
    parent_reply_id: `reply-${id}`,
    parent_e164: OWNER,
    language: "en",
    target: "class_teacher",
    topic: "fees",
    complaint: false,
    practice: true,
    class_teacher_id: null,
    about_name: "TEST Child Two",
    level: 1,
    reminders: 0,
    level_alerted_at: null,
    next_action: null,
    next_action_at: null,
    answered_at: null,
    closed_at: null,
    rating_asked_at: null,
    rating: null,
    follow_up_of: null,
    created_at: "2026-11-12T05:00:00Z",
    parent_replies: { session_label: "TEST-2026-27", student_id: "s2", student_label: "TEST Child Two (Class 6)", from_name: "TEST Parent", body: "When is the PTM?", status: "new", ...reply },
    ...over,
  };
}

describe("the questions waiting for them", () => {
  it("the open hand-offs they were alerted to or hold as class teacher, oldest first, from their own year only", async () => {
    const { db } = fakeDb({
      parent_helper_alerts: [
        { staff_id: TEACHER_ID, handoff_id: "h1", created_at: "2026-11-12T05:00:00Z" },
        { staff_id: TEACHER_ID, handoff_id: "h2", created_at: "2026-11-12T04:00:00Z" },
        { staff_id: TEACHER_ID, handoff_id: "h3", created_at: "2026-11-12T03:00:00Z" },
        { staff_id: TEACHER_ID, handoff_id: "h5", created_at: "2026-11-12T03:00:00Z" },
        { staff_id: ABSENT_TEACHER_ID, handoff_id: "h6", created_at: "2026-11-12T03:00:00Z" },
      ],
      parent_helper_handoffs: [
        handoffRow("h1", { created_at: "2026-11-12T05:00:00Z" }),
        handoffRow("h2", { created_at: "2026-11-12T02:00:00Z" }),
        // Answered, done in Messages, or the real year's: not theirs to answer now.
        handoffRow("h3", { answered_at: "2026-11-12T05:30:00Z" }),
        handoffRow("h5", {}, { session_label: "2026-27" }),
        handoffRow("h6"),
        handoffRow("h4", { class_teacher_id: TEACHER_ID, created_at: "2026-11-12T04:30:00Z" }),
        handoffRow("h7", { class_teacher_id: TEACHER_ID }, { status: "done" }),
      ],
    });
    const open = (await readOpenHandoffsFor(TEACHER_ID, true, db)) as OpenHandoff[];
    expect(open.map((handoff) => handoff.id)).toEqual(["h2", "h4", "h1"]);
    expect(open[0]).toMatchObject({ createdAt: "2026-11-12T02:00:00Z", studentLabel: "TEST Child Two (Class 6)", body: "When is the PTM?" });
  });

  it("null when it could not be read", async () => {
    expect(await readOpenHandoffsFor(TEACHER_ID, true, fakeDb({}, ["parent_helper_alerts"]).db)).toBeNull();
  });
});

/* -------------------------------------------------- from WhatsApp, end to end */

function switches(over: Partial<WhatsAppSwitches> = {}): WhatsAppSwitches {
  return { dryRun: false, features: { parent_helper: true }, realRecipients: true, ownerTestNumber: OWNER, dailyLimit: 250, ...over };
}

function inbound(over: Partial<WebhookInbound> = {}): WebhookInbound {
  return {
    providerMessageId: "wamid.STAFF1",
    from: TEACHER_PHONE,
    fromName: "TEST Teacher",
    type: "text",
    text: "today",
    replyTo: null,
    at: new Date(NOW.getTime() - 4_000).toISOString(),
    raw: { type: "text" },
    ...over,
  };
}

function waiting(id: string, createdAt: string): OpenHandoff {
  return {
    id,
    parentReplyId: `reply-${id}`,
    parentE164: OWNER,
    language: "en",
    target: "class_teacher",
    topic: "fees",
    complaint: false,
    practice: true,
    classTeacherId: TEACHER_ID,
    aboutName: "TEST Child Two",
    level: 1,
    reminders: 0,
    levelAlertedAt: null,
    nextAction: null,
    nextActionAt: null,
    answeredAt: null,
    closedAt: null,
    sessionLabel: "TEST-2026-27",
    studentLabel: "TEST Child Two (Class 6)",
    fromName: "TEST Parent",
    body: `Question ${id}`,
    replyDone: false,
    studentId: "s2",
    ratingAskedAt: null,
    rating: null,
    followUpOf: null,
    createdAt,
  } as OpenHandoff;
}

type Calls = {
  sent: Array<Record<string, unknown>>;
  started: Array<Parameters<StaffHelperDeps["startTurn"]>[0]>;
  claims: string[];
  finished: Array<[string, TurnFinish]>;
  saved: string[];
  alerts: AlertRecord[];
};

function fakes(over: Partial<StaffHelperDeps> = {}) {
  const calls: Calls = { sent: [], started: [], claims: [], finished: [], saved: [], alerts: [] };
  const deps: StaffHelperDeps = {
    now: () => NOW,
    readIdentity: async () => ({ state: "linked", staff: TEACHER }),
    readSession: async () => "TEST-2026-27",
    readDay: async () => dayFacts(),
    readQuestions: async () => [],
    readAbsent: async () => ({ kind: "no_class" }),
    readSwitches: async () => switches(),
    readConfig: () => HUB,
    readHelperName: async () => "Veer Patta AI",
    readBudget: async () => ({ spentUsd: 0, turnsToday: 2 }),
    claim: async (wamid): Promise<ClaimResult> => {
      calls.claims.push(wamid);
      return { ok: true, claimed: true, typing: true, staff: false, stale: false, takenBy: null };
    },
    send: async (body): Promise<ProviderSendResult> => {
      calls.sent.push(body);
      return { outcome: "accepted", messageId: `wamid.OUT${calls.sent.length}`, httpStatus: 200 };
    },
    startTurn: async (row) => {
      if (calls.started.some((started) => started.providerMessageId === row.providerMessageId)) return "duplicate";
      calls.started.push(row);
      return "started";
    },
    finishTurn: async (id, finish) => {
      calls.finished.push([id, finish]);
    },
    saveChat: async (from) => {
      calls.saved.push(from);
    },
    insertAlert: async (row) => {
      calls.alerts.push(row);
      return true;
    },
    origin: () => ORIGIN,
    ...over,
  };
  return { deps, calls };
}

describe("a staff command arriving on WhatsApp", () => {
  it("answers *today* with their day, writes the turn down as theirs, and opens their chat", async () => {
    const { deps, calls } = fakes();
    expect(await handleStaffCommand(inbound(), deps)).toEqual({ outcome: "answered", route: "rule", intent: "staff_today", handoff: null });
    expect(calls.claims).toEqual(["wamid.STAFF1"]);
    expect(calls.started).toEqual([{ providerMessageId: "wamid.STAFF1", from: TEACHER_PHONE, receivedAt: "2026-11-12T06:29:56.000Z", kind: "text", practice: true }]);
    expect(calls.sent).toHaveLength(1);
    expect(calls.sent[0]!.to).toBe("919000000002");
    expect(bodyText(calls.sent[0])).toContain("Your day · Thursday, 12 November");
    expect(calls.finished).toEqual([
      ["wamid.STAFF1", { status: "answered", reason: null, intent: "staff_today", route: "rule", replyMessageId: "wamid.OUT1", latencyMs: 4_000 }],
    ]);
    expect(calls.saved).toEqual([TEACHER_PHONE]);
    expect(calls.alerts).toEqual([]);
  });

  it("a tap on a staff button is a tap in the ledger; a real member of staff's turn is the real year's", async () => {
    const real: LinkedStaff = { ...TEACHER, isTest: false };
    const { deps, calls } = fakes({ readIdentity: async () => ({ state: "linked", staff: real }) });
    const tap = inbound({ type: "interactive", text: null, raw: { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "vpst:absent", title: "📋 Absent" } } } });
    expect(await handleStaffCommand(tap, deps)).toMatchObject({ outcome: "answered", intent: "staff_absent" });
    expect(calls.started[0]).toMatchObject({ kind: "tap", practice: false });
  });

  it("*questions* says how many wait, then sends the oldest again, each an alert a swipe answers", async () => {
    const open = [waiting("h1", "2026-11-12T02:00:00Z"), waiting("h2", "2026-11-12T03:00:00Z"), waiting("h3", "2026-11-12T04:00:00Z"), waiting("h4", "2026-11-12T05:00:00Z")];
    const { deps, calls } = fakes({ readQuestions: async () => open });
    expect(await handleStaffCommand(inbound({ text: "questions" }), deps)).toMatchObject({ outcome: "answered", intent: "staff_questions" });
    expect(calls.sent).toHaveLength(1 + QUESTIONS_AT_ONCE);
    expect(bodyText(calls.sent[0])).toContain("4 parents are waiting for your answer");
    expect(bodyText(calls.sent[0])).toContain("write *questions* again");
    expect(bodyText(calls.sent[1])).toContain("Question h1");
    expect(bodyText(calls.sent[3])).toContain("Question h3");
    expect(calls.sent.slice(1).every((body) => body.type === "text")).toBe(true);
    expect(calls.alerts).toEqual(
      ["h1", "h2", "h3"].map((handoffId, i) => ({
        handoffId,
        staffId: TEACHER_ID,
        toE164: TEACHER_PHONE,
        kind: "reminder",
        via: "text",
        status: "sent",
        reason: "asked_questions",
        messageId: `wamid.OUT${i + 2}`,
      })),
    );
    expect(calls.finished[0]![1]).toMatchObject({ status: "answered", reason: null, replyMessageId: "wamid.OUT1" });
  });

  it("a question that did not go is written down as failed, and the turn says how many went", async () => {
    const open = [waiting("h1", "2026-11-12T02:00:00Z"), waiting("h2", "2026-11-12T03:00:00Z")];
    let n = 0;
    const { deps, calls } = fakes({
      readQuestions: async () => open,
      send: async (body): Promise<ProviderSendResult> => {
        n += 1;
        calls.sent.push(body);
        return n === 3 ? { outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "down" } : { outcome: "accepted", messageId: `wamid.OUT${n}`, httpStatus: 200 };
      },
    });
    await handleStaffCommand(inbound({ text: "questions" }), deps);
    expect(calls.alerts.map((alert) => [alert.handoffId, alert.status, alert.messageId])).toEqual([
      ["h1", "sent", "wamid.OUT2"],
      ["h2", "failed", null],
    ]);
    expect(calls.finished[0]![1]).toMatchObject({ status: "answered", reason: "questions_sent:1/2" });
  });

  it("an ordinary message, or a number no member of staff has, is left for the parents' helper", async () => {
    const reads = vi.fn(async (): Promise<StaffIdentity | null> => ({ state: "none" }));
    const { deps, calls } = fakes({ readIdentity: reads });
    expect(await handleStaffCommand(inbound({ text: "When is the PTM?" }), deps)).toBeNull();
    expect(reads).not.toHaveBeenCalled();
    expect(await handleStaffCommand(inbound(), deps)).toBeNull();
    expect(await handleStaffCommand(inbound(), fakes({ readIdentity: async () => null }).deps)).toBeNull();
    expect(await handleStaffCommand(inbound({ from: "not a number" }), deps)).toBeNull();
    expect(calls.sent).toEqual([]);
    expect(calls.started).toEqual([]);
  });

  it("a number on a staff record that never linked itself is told to link, and shown nothing", async () => {
    const day = vi.fn(async () => dayFacts());
    const { deps, calls } = fakes({ readIdentity: async () => ({ state: "unproven", language: "hi", isTest: false }), readDay: day });
    expect(await handleStaffCommand(inbound(), deps)).toMatchObject({ outcome: "answered", intent: "staff_link_first" });
    expect(bodyText(calls.sent[0])).toContain("मेरा WhatsApp जोड़ें");
    expect(day).not.toHaveBeenCalled();
    expect(calls.started[0]).toMatchObject({ practice: false });
  });

  it("a person who turned WhatsApp off is told how to turn it on, and shown nothing", async () => {
    const day = vi.fn(async () => dayFacts());
    const { deps, calls } = fakes({ readIdentity: async () => ({ state: "stopped", language: "en", isTest: true }), readDay: day });
    expect(await handleStaffCommand(inbound(), deps)).toMatchObject({ outcome: "answered", intent: "staff_stopped" });
    expect(bodyText(calls.sent[0])).toContain("Turn on again");
    expect(day).not.toHaveBeenCalled();
  });

  it("stays quiet in practice mode, with the helper off, and to anybody but the owner while testing", async () => {
    for (const [quiet, reason] of [
      [switches({ dryRun: true }), "practice_mode"],
      [switches({ features: {} }), "feature_off"],
      [switches({ realRecipients: false }), "not_owner_test_number"],
      [null, "read_failed"],
    ] as const) {
      const { deps, calls } = fakes({ readSwitches: async () => quiet });
      expect(await handleStaffCommand(inbound(), deps)).toEqual({ outcome: "skipped", reason });
      expect(calls.claims).toEqual([]);
      expect(calls.sent).toEqual([]);
      expect(calls.started).toEqual([]);
    }
  });

  it("while testing, answers the owner's own number when it is linked to a test teacher", async () => {
    const { deps, calls } = fakes({ readSwitches: async () => switches({ realRecipients: false }) });
    expect(await handleStaffCommand(inbound({ from: OWNER }), deps)).toMatchObject({ outcome: "answered", intent: "staff_today" });
    expect(calls.sent[0]!.to).toBe("919000000001");
  });

  it("leaves the message to the hub when it cannot claim it, over the day's cap, or seen before", async () => {
    expect(await handleStaffCommand(inbound(), fakes({ claim: null }).deps)).toEqual({ outcome: "skipped", reason: "cannot_claim" });
    expect(await handleStaffCommand(inbound(), fakes({ readBudget: async () => null }).deps)).toEqual({ outcome: "skipped", reason: "budget_unreadable" });
    expect(await handleStaffCommand(inbound(), fakes({ readBudget: async () => ({ spentUsd: 0, turnsToday: 40 }) }).deps)).toEqual({ outcome: "skipped", reason: "daily_cap" });
    const { deps } = fakes();
    await handleStaffCommand(inbound(), deps);
    expect(await handleStaffCommand(inbound(), deps)).toEqual({ outcome: "skipped", reason: "duplicate" });
    expect(await handleStaffCommand(inbound(), fakes({ startTurn: async () => "failed" }).deps)).toEqual({ outcome: "skipped", reason: "ledger_failed" });
  });

  it("when a person in the office has the chat, writes it down and says nothing", async () => {
    const { deps, calls } = fakes({ claim: async () => ({ ok: true, claimed: false, typing: false, staff: true, stale: false, takenBy: null }) });
    expect(await handleStaffCommand(inbound(), deps)).toEqual({ outcome: "not_claimed", reason: "staff_handling" });
    expect(calls.sent).toEqual([]);
    expect(calls.finished).toEqual([["wamid.STAFF1", { status: "not_claimed", reason: "staff_handling", intent: "staff_today" }]]);
  });

  it("after the claim it always answers: a read that fails says sorry, and the ledger says why", async () => {
    for (const [over, text, note] of [
      [{ readSession: async () => null }, "today", "session_unreadable"],
      [{ readDay: async () => null }, "today", "day_unreadable"],
      [{ readDay: async () => { throw new Error("down"); } }, "today", "day_unreadable"],
      [{ readQuestions: async () => null }, "questions", "questions_unreadable"],
      [{ readAbsent: async () => null }, "absent", "absent_unreadable"],
    ] as const) {
      const { deps, calls } = fakes(over as Partial<StaffHelperDeps>);
      expect(await handleStaffCommand(inbound({ text }), deps)).toMatchObject({ outcome: "answered" });
      expect(bodyText(calls.sent[0])).toContain("Sorry, that could not be read just now");
      expect(calls.finished[0]![1]).toMatchObject({ status: "answered", reason: note });
    }
  });

  it("an interactive message Meta refuses goes again as plain words", async () => {
    let n = 0;
    const { deps, calls } = fakes({
      send: async (body): Promise<ProviderSendResult> => {
        n += 1;
        calls.sent.push(body);
        return n === 1 ? { outcome: "rejected", httpStatus: 400, errorCode: "131009", errorTitle: "Parameter value is not valid", errorDetail: null } : { outcome: "accepted", messageId: "wamid.PLAIN", httpStatus: 200 };
      },
    });
    expect(await handleStaffCommand(inbound({ text: "staff" }), deps)).toMatchObject({ outcome: "answered", intent: "staff_menu" });
    expect(calls.sent.map((body) => body.type)).toEqual(["interactive", "text"]);
    expect(calls.finished[0]![1]).toMatchObject({ reason: "sent_as_plain_text", replyMessageId: "wamid.PLAIN" });
  });

  it("a reply that does not go is a failed turn, and no question is sent after it", async () => {
    const { deps, calls } = fakes({
      readQuestions: async () => [waiting("h1", "2026-11-12T02:00:00Z")],
      send: async (body): Promise<ProviderSendResult> => {
        calls.sent.push(body);
        throw new Error("socket hang up");
      },
    });
    expect(await handleStaffCommand(inbound({ text: "questions" }), deps)).toEqual({ outcome: "failed", reason: "send_unknown:network" });
    expect(calls.sent).toHaveLength(1);
    expect(calls.alerts).toEqual([]);
    expect(calls.finished[0]![1]).toMatchObject({ status: "failed", reason: "send_unknown:network", intent: "staff_questions" });
    expect(calls.saved).toEqual([]);
  });

  it("never logs the number whole", async () => {
    await handleStaffCommand(inbound(), fakes().deps);
    const logged = JSON.stringify(log.logInfo.mock.calls);
    expect(logged).toContain("whatsapp.staff_helper");
    expect(logged).not.toContain("9000000002");
  });
});
