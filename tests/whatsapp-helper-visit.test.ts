import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CalendarDayKind } from "@/modules/academics/domain/calendar";
import { planFromAnswer, type HelperAnswer } from "@/modules/whatsapp/domain/helper-ai";
import { childFactsFromRow, type ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import { topicOf } from "@/modules/whatsapp/domain/helper-week";
import { fitMessage, type HelperButton, type HelperMessage } from "@/modules/whatsapp/domain/helper-messages";
import { AWAIT_MINUTES, EMPTY_CHAT, needsVisitCalendar, planTurn, type ChatState, type PlanInput } from "@/modules/whatsapp/domain/helper-plan";
import { welcomeCard, type Family, type ReplyContext } from "@/modules/whatsapp/domain/helper-replies";
import { helperId, looksLikeQuestion, readTap, ruleIntent, type HelperLanguage } from "@/modules/whatsapp/domain/helper-text";
import {
  awaitingVisit,
  canVisitOn,
  dayFromKey,
  dayKey,
  readSlotKey,
  readVisitChild,
  slotKey,
  VISIT_NAME_NOT_GIVEN,
  visitAwaiting,
  visitBookedReply,
  visitClosedReply,
  visitDays,
  visitDaysReply,
  visitDayText,
  visitDetailsPrompt,
  visitHandoffBody,
  visitPartReply,
  visitSummary,
  withVisitButton,
  type VisitBooking,
  type VisitCalendar,
} from "@/modules/whatsapp/domain/helper-visit";
import { visitWhen } from "@/vx/screens/admissions/logic";

/**
 * A school visit booked on WhatsApp (D-592): the days, the taps, what the
 * parent types, and what the office reads. Every name and number here is
 * made up (rule 6).
 */

/** Thursday. */
const TODAY = "2026-11-12";
/** 12:00 in India. */
const NOON = new Date("2026-11-12T06:30:00Z");
/** 21:30 in India: after the alerts stop. */
const LATE = new Date("2026-11-12T16:00:00Z");
const LANGUAGES: HelperLanguage[] = ["hi", "hx", "en"];

const aarav = childFactsFromRow({
  today: TODAY,
  student: { id: "11111111-1111-4111-8111-111111111111", full_name: "TEST AARAV KUMAR", class_id: "c6", status: "active", session_label: "TEST-2026-27", class_name: "Class 6", section: null, stream_name: null },
  installments: [],
  receipts: [],
  attendance: null,
  days: [],
  results: [],
  class_teacher: null,
  calendar: [],
}) as ChildFacts;
const family: Family = { children: [aarav], practice: true };

function context(language: HelperLanguage, firstContact = false): ReplyContext {
  return { language, helperName: "Veer Patta AI", family, firstContact };
}

function calendar(kinds: Record<string, CalendarDayKind> = {}, today = TODAY): VisitCalendar {
  return { today, kinds: new Map(Object.entries(kinds)) };
}

function bodyOf(message: HelperMessage): string {
  return message.kind === "text" ? message.text : message.kind === "document" ? message.caption : message.body;
}

function buttonsOf(message: HelperMessage): HelperButton[] {
  return message.kind === "buttons" ? message.buttons : [];
}

function rowIds(message: HelperMessage): string[] {
  return message.kind === "list" ? message.rows.map((row) => row.id) : [];
}

const RETURNING: ChatState = { ...EMPTY_CHAT, greetedAt: "2026-11-12T01:00:00Z", lastTurnAt: "2026-11-12T01:00:00Z", language: "en" };

function plan(over: Partial<PlanInput>) {
  return planTurn({ kind: "text", text: "", tap: null, chat: RETURNING, family, helperName: "Veer Patta AI", now: NOON, aiAvailable: true, visit: calendar(), ...over });
}

/** A chat waiting for the child's name and class after Monday morning was picked. */
function waiting(minutesLeft = 20): ChatState {
  return { ...RETURNING, awaiting: "visit:20261116am", awaitingUntil: new Date(NOON.getTime() + minutesLeft * 60_000).toISOString() };
}

/* ---------------------------------------------------------------- days */

describe("the days a visit can be booked for", () => {
  it("offers open days from tomorrow, never today or a Sunday", () => {
    expect(visitDays(calendar())).toEqual(["2026-11-13", "2026-11-14", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(visitDays(calendar(), 2)).toEqual(["2026-11-13", "2026-11-14"]);
  });

  it("follows the school's calendar: a holiday is left out, a Sunday event is offered", () => {
    expect(visitDays(calendar({ "2026-11-13": "holiday", "2026-11-15": "event", "2026-11-16": "exam" }))).toEqual([
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
    ]);
  });

  it("offers nothing when the school is closed for three weeks", () => {
    const vacation: Record<string, CalendarDayKind> = {};
    for (let day = 13; day <= 30; day += 1) vacation[`2026-11-${day}`] = "vacation";
    for (let day = 1; day <= 3; day += 1) vacation[`2026-12-0${day}`] = "vacation";
    expect(visitDays(calendar(vacation))).toEqual([]);
  });

  it("still takes a day from an earlier list only while it can be booked", () => {
    expect(canVisitOn("2026-11-13", calendar())).toBe(true);
    expect(canVisitOn("2026-12-03", calendar())).toBe(true);
    expect(canVisitOn(TODAY, calendar())).toBe(false);
    expect(canVisitOn("2026-11-15", calendar())).toBe(false);
    expect(canVisitOn("2026-12-04", calendar())).toBe(false);
    expect(canVisitOn("2026-11-13", calendar({ "2026-11-13": "holiday" }))).toBe(false);
  });
});

/* ---------------------------------------------------------------- keys */

describe("the keys in a button id and in the chat's memory", () => {
  it("carry the day and the part without dashes, and read back only what they wrote", () => {
    expect(dayKey("2026-11-16")).toBe("20261116");
    expect(dayFromKey("20261116")).toBe("2026-11-16");
    expect(dayFromKey("20261131")).toBeNull();
    expect(dayFromKey("2026-11-16")).toBeNull();
    expect(dayFromKey(null)).toBeNull();
    expect(slotKey({ day: "2026-11-16", part: "morning" })).toBe("20261116am");
    expect(slotKey({ day: "2026-11-16", part: "afternoon" })).toBe("20261116pm");
    expect(readSlotKey("20261116pm")).toEqual({ day: "2026-11-16", part: "afternoon" });
    expect(readSlotKey("20261116xx")).toBeNull();
    expect(visitAwaiting({ day: "2026-11-16", part: "morning" })).toBe("visit:20261116am");
    expect(awaitingVisit("visit:20261116am")).toEqual({ day: "2026-11-16", part: "morning" });
    expect(awaitingVisit("office")).toBeNull();
    expect(awaitingVisit("teacher:ab12cd34")).toBeNull();
    expect(awaitingVisit(null)).toBeNull();
  });

  it("fit the shape every helper button has, and the chat check in the database", () => {
    const tap = (id: string) => readTap({ type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: "x" } } });
    expect(tap(helperId("visit_day", "20261116"))).toEqual({ intent: "visit_day", key: "20261116" });
    expect(tap(helperId("visit_part", "20261116am"))).toEqual({ intent: "visit_part", key: "20261116am" });
    expect(tap(helperId("visit"))).toEqual({ intent: "visit", key: null });
    expect(tap("vpai:visit_day")).toBeNull();
    const check = /^(teacher:[a-z0-9]{4,16}|office|visit:[0-9]{8}(am|pm))$/;
    expect(check.test(visitAwaiting({ day: "2026-11-16", part: "afternoon" }))).toBe(true);
  });
});

/* -------------------------------------------------------- the child typed */

describe("reading the child's name and class", () => {
  it.each<[string, string | null, string | null]>([
    ["Riya, Class 3", "Riya", "Class 3"],
    ["riya class 3", "Riya", "Class 3"],
    ["Aarav 5th", "Aarav", "Class 5"],
    ["mera beta Aarav hai, 5th me admission", "Aarav", "Class 5"],
    ["Kabir UKG", "Kabir", "SKG"],
    ["Mira LKG", "Mira", "JKG"],
    ["Ishaan nursery", "Ishaan", "Nursery"],
    ["Dev class v", "Dev", "Class 5"],
    ["Anya std 9", "Anya", "Class 9"],
    ["Rohan 11th science", "Rohan", "11 Science"],
    ["Tara class 12 commerce", "Tara", "12 Commerce"],
    ["Neel class five", "Neel", "Class 5"],
    ["Priya panchvi kaksha", "Priya", "Class 5"],
    ["आरव, कक्षा 5", "आरव", "Class 5"],
    ["आरव कक्षा ५", "आरव", "Class 5"],
    ["कबीर 5वीं", "कबीर", "Class 5"],
    ["अंकित 5", "अंकित", "Class 5"],
    ["कक्षा पाँचवीं में रिया", "रिया", "Class 5"],
    ["Riya 3", "Riya", "Class 3"],
    ["Riya", "Riya", null],
    ["class 3", null, "Class 3"],
    ["5th", null, "Class 5"],
    ["Riya 8 saal ki hai", "Riya", null],
    ["Aarav 5th class fees kitni hai", "Aarav", "Class 5"],
    ["", null, null],
  ])("%s", (text, childName, classLabel) => {
    expect(readVisitChild(text)).toEqual({ childName, classLabel });
  });

  it("never takes a whole sentence for a name", () => {
    const read = readVisitChild("hello sir my daughter name is Riya Sharma and she will come in class 4 next session thank you");
    expect(read).toEqual({ childName: "Riya Sharma", classLabel: "Class 4" });
    expect(readVisitChild("a b c d e f g h").childName?.split(" ").length ?? 0).toBeLessThanOrEqual(4);
  });

  it("tells a question word from a name in either script", () => {
    expect(looksLikeQuestion("दाखिला कब से है")).toBe(true);
    expect(looksLikeQuestion("कबीर")).toBe(false);
    expect(looksLikeQuestion("admission kab se")).toBe(true);
    expect(looksLikeQuestion("Kabir")).toBe(false);
    expect(looksLikeQuestion("सीटें बची हैं")).toBe(true);
  });
});

/* ------------------------------------------------------------ the words */

describe("what the parent reads", () => {
  it("names the day the way the family says it", () => {
    expect(visitDayText("2026-11-16", "en", TODAY)).toBe("Monday, 16 Nov");
    expect(visitDayText("2026-11-16", "hi", TODAY)).toBe("सोमवार, 16 नवंबर");
    expect(visitDayText("2026-11-16", "hx", TODAY)).toBe("Somvar, 16 Nov");
    expect(visitDayText("2027-01-04", "en", "2026-12-28")).toBe("Monday, 4 Jan 2027");
  });

  it.each(LANGUAGES)("keeps every step inside WhatsApp's limits (%s)", (language) => {
    const days = visitDays(calendar());
    const booking: VisitBooking = { day: "2026-11-16", part: "afternoon", childName: "Riya Sharma", classLabel: "11 Commerce" };
    const messages = [
      visitDaysReply(context(language, true), days, TODAY),
      visitDaysReply(context(language), days, TODAY, true),
      visitClosedReply(context(language), "closed"),
      visitClosedReply(context(language), "unreadable"),
      visitPartReply(context(language), "2026-11-16", TODAY),
      visitDetailsPrompt(context(language), { day: "2026-11-16", part: "morning" }, TODAY),
      visitBookedReply(context(language), booking, TODAY, true),
      visitBookedReply(context(language), { ...booking, childName: null, classLabel: null }, TODAY, false),
    ];
    // Nothing is cut on the way (a list gains only an empty section heading).
    for (const message of messages) expect(fitMessage(message)).toMatchObject(message);
    // A year-end list, with the year in every row.
    const december = visitDaysReply(context(language), visitDays(calendar({}, "2026-12-28")), "2026-12-28");
    expect(fitMessage(december)).toMatchObject(december);
  });

  it("lists the days, tomorrow by name, and a way to ask the office for another", () => {
    const list = visitDaysReply(context("en"), visitDays(calendar()), TODAY);
    expect(list.kind).toBe("list");
    if (list.kind !== "list") return;
    expect(list.body).toContain("Come and see the school");
    expect(list.body).toContain("The office will call you to fix the time.");
    expect(list.button).toBe("Pick a day");
    expect(list.rows.map((row) => row.title)).toEqual(["Friday, 13 Nov", "Saturday, 14 Nov", "Monday, 16 Nov", "Tuesday, 17 Nov", "Wednesday, 18 Nov", "Thursday, 19 Nov", "📞 Another day"]);
    expect(list.rows[0].description).toBe("Tomorrow");
    expect(list.rows[1].description).toBeNull();
    expect(rowIds(list)).toEqual(["vpai:visit_day:20261113", "vpai:visit_day:20261114", "vpai:visit_day:20261116", "vpai:visit_day:20261117", "vpai:visit_day:20261118", "vpai:visit_day:20261119", "vpai:office"]);
    expect(bodyOf(visitDaysReply(context("en"), ["2026-11-13"], TODAY, true))).toContain("That day can no longer be booked");
    expect(bodyOf(visitDaysReply(context("en", true), ["2026-11-13"], TODAY))).toMatch(/^Namaste 🙏 I'm \*Veer Patta AI\*/);
  });

  it("asks morning or afternoon, then the name and class, with a way back", () => {
    const part = visitPartReply(context("hi"), "2026-11-16", TODAY);
    expect(bodyOf(part)).toBe("📅 *सोमवार, 16 नवंबर*\nकिस समय: सुबह या दोपहर?");
    expect(buttonsOf(part).map((button) => button.id)).toEqual(["vpai:visit_part:20261116am", "vpai:visit_part:20261116pm", "vpai:visit"]);
    const ask = visitDetailsPrompt(context("en"), { day: "2026-11-16", part: "afternoon" }, TODAY);
    expect(bodyOf(ask)).toContain("📅 Monday, 16 Nov · afternoon");
    expect(bodyOf(ask)).toContain("Now type the child's *name* and the *class*");
    expect(buttonsOf(ask).map((button) => button.id)).toEqual(["vpai:menu"]);
  });

  it("says the request is with the office, never that the visit is confirmed", () => {
    const booking: VisitBooking = { day: "2026-11-16", part: "morning", childName: "Riya", classLabel: "Class 3" };
    const en = bodyOf(visitBookedReply(context("en"), booking, TODAY, false));
    expect(en).toBe(
      "✅ *Your visit request has been passed to the school office*\n📅 Monday, 16 Nov · morning\n🧒 Riya · Class 3\n\nThe office will call you to fix the time. We look forward to meeting you 🙏",
    );
    expect(en).not.toMatch(/confirm|booked/i);
    expect(bodyOf(visitBookedReply(context("hi"), booking, TODAY, false))).toContain("🧒 Riya · कक्षा 3");
    expect(bodyOf(visitBookedReply(context("en"), booking, TODAY, true))).toContain("🌙 It is late now, so the office will see it after 6 am.");
    expect(bodyOf(visitBookedReply(context("en"), { ...booking, childName: null, classLabel: null }, TODAY, false))).not.toContain("🧒");
  });

  it("gives the office's number when no day can be booked here", () => {
    const closed = visitClosedReply(context("en"), "closed");
    expect(bodyOf(closed)).toContain("closed for the next few weeks");
    expect(bodyOf(closed)).toContain("9352205884");
    expect(buttonsOf(closed).map((button) => button.id)).toEqual(["vpai:office", "vpai:menu"]);
    expect(bodyOf(visitClosedReply(context("hx"), "unreadable"))).toContain("Maaf kijiye");
  });

  it("adds the visit button under an answer about admission, once, when there is room", () => {
    const answer: HelperMessage = { kind: "buttons", body: "Admissions are open.", buttons: [{ id: "vpai:menu", title: "📋 Menu" }] };
    const added = withVisitButton(answer, "en");
    expect(buttonsOf(added).map((button) => button.id)).toEqual(["vpai:visit", "vpai:menu"]);
    expect(buttonsOf(added)[0].title).toBe("📅 Book a visit");
    expect(withVisitButton(added, "en")).toEqual(added);
    const full: HelperMessage = { kind: "buttons", body: "x", buttons: [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }] };
    expect(withVisitButton(full, "en")).toEqual(full);
    expect(withVisitButton({ kind: "text", text: "x" }, "en")).toEqual({ kind: "text", text: "x" });
  });

  it("puts the visit in the menu", () => {
    const menu = welcomeCard(context("en"));
    expect(rowIds(menu)).toContain("vpai:visit");
    expect(fitMessage(menu)).toMatchObject(menu);
  });
});

/* --------------------------------------------------------- for the office */

describe("what the office reads", () => {
  it("shows the day, the child and the parent's own words, in both languages' labels", () => {
    const booking: VisitBooking = { day: "2026-11-16", part: "afternoon", childName: "Riya", classLabel: "Class 3" };
    expect(visitHandoffBody(booking, "  Riya,\n class 3 ", TODAY)).toBe("📅 स्कूल देखने आना / School visit: Mon 16 Nov · afternoon / दोपहर\n🧒 Riya · Class 3\nअभिभावक / Parent: “Riya, class 3”");
    expect(visitHandoffBody({ ...booking, childName: null, classLabel: null }, "x".repeat(400), TODAY)).toBe(
      `📅 स्कूल देखने आना / School visit: Mon 16 Nov · afternoon / दोपहर\nअभिभावक / Parent: “${"x".repeat(300)}”`,
    );
    expect(visitSummary(booking, TODAY)).toBe("Mon 16 Nov afternoon · Riya, Class 3");
    expect(visitSummary({ ...booking, childName: null }, TODAY)).toBe("Mon 16 Nov afternoon · Class 3");
    expect(visitSummary({ ...booking, childName: null, classLabel: null }, TODAY)).toBe("Mon 16 Nov afternoon");
  });

  it("keeps a required name on the board even when none was given", () => {
    expect(VISIT_NAME_NOT_GIVEN.trim().length).toBeGreaterThanOrEqual(1);
  });

  it("counts a visit with admission in the weekly report", () => {
    expect(topicOf("visit")).toBe("admission");
    expect(topicOf("visit_booked")).toBe("admission");
    expect(topicOf("visit_closed")).toBe("admission");
  });
});

/* ------------------------------------------------------------- planning */

describe("booking a visit, message by message", () => {
  it("knows which messages need the calendar, so no other turn reads it", () => {
    expect(needsVisitCalendar({ kind: "text", text: "admission", tap: null })).toBe(true);
    expect(needsVisitCalendar({ kind: "text", text: "दाखिला", tap: null })).toBe(true);
    expect(needsVisitCalendar({ kind: "text", text: "fees", tap: null })).toBe(false);
    expect(needsVisitCalendar({ kind: "text", text: "Riya class 3", tap: null })).toBe(false);
    expect(needsVisitCalendar({ kind: "tap", text: null, tap: { intent: "visit", key: null } })).toBe(true);
    expect(needsVisitCalendar({ kind: "tap", text: null, tap: { intent: "visit_day", key: "20261116" } })).toBe(true);
    expect(needsVisitCalendar({ kind: "tap", text: null, tap: { intent: "visit_part", key: "20261116am" } })).toBe(true);
    expect(needsVisitCalendar({ kind: "tap", text: null, tap: { intent: "fees", key: null } })).toBe(false);
  });

  it("reads admission as a booking, and a question about admission as one for Claude", () => {
    expect(ruleIntent("admission")).toBe("visit");
    expect(ruleIntent("Admission chahiye")).toBe("visit");
    expect(ruleIntent("दाखिला")).toBe("visit");
    expect(ruleIntent("school visit")).toBe("visit");
    expect(ruleIntent("admission fees kitni hai")).toBeNull();
    expect(ruleIntent("admission kab se")).toBeNull();
    expect(ruleIntent("admission?")).toBeNull();
    // An exam's admit card is not an admission; a receipt for one is a receipt.
    expect(ruleIntent("pravesh patra")).not.toBe("visit");
    expect(ruleIntent("प्रवेश पत्र")).not.toBe("visit");
    expect(ruleIntent("admission ki receipt")).toBe("receipts");
  });

  it("shows the days when the parent writes admission, or taps the button", () => {
    for (const turn of [plan({ text: "admission" }), plan({ kind: "tap", text: null, tap: { intent: "visit", key: null } })]) {
      expect(turn).toMatchObject({ action: "reply", intent: "visit", handoff: null, chat: { awaiting: null, awaitingUntil: null } });
      if (turn.action === "reply") expect(rowIds(turn.message)[0]).toBe("vpai:visit_day:20261113");
    }
    expect(plan({ text: "admission" })).toMatchObject({ route: "rule" });
    expect(plan({ kind: "tap", text: null, tap: { intent: "visit", key: null } })).toMatchObject({ route: "tap" });
  });

  it("says why when no day can be shown", () => {
    expect(plan({ text: "admission", visit: null })).toMatchObject({ action: "reply", intent: "visit_closed" });
    const shut: Record<string, CalendarDayKind> = {};
    for (let offset = 13; offset <= 30; offset += 1) shut[`2026-11-${offset}`] = "vacation";
    for (const day of ["2026-12-01", "2026-12-02", "2026-12-03"]) shut[day] = "vacation";
    const closed = plan({ text: "admission", visit: calendar(shut) });
    expect(closed).toMatchObject({ action: "reply", intent: "visit_closed" });
    if (closed.action === "reply") expect(bodyOf(closed.message)).toContain("closed for the next few weeks");
  });

  it("asks morning or afternoon for a day that can still be booked, and the list again for one that cannot", () => {
    const day = plan({ kind: "tap", text: null, tap: { intent: "visit_day", key: "20261116" } });
    expect(day).toMatchObject({ action: "reply", intent: "visit_day", route: "tap" });
    if (day.action === "reply") expect(buttonsOf(day.message).map((button) => button.id)).toContain("vpai:visit_part:20261116am");
    for (const key of ["20261115", "20261112", "20261131", null]) {
      const gone = plan({ kind: "tap", text: null, tap: { intent: "visit_day", key } });
      expect(gone, String(key)).toMatchObject({ action: "reply", intent: "visit" });
      if (gone.action === "reply") expect(bodyOf(gone.message)).toContain("That day can no longer be booked");
    }
    expect(plan({ kind: "tap", text: null, tap: { intent: "visit_day", key: "20261116" }, visit: null })).toMatchObject({ intent: "visit_closed" });
  });

  it("waits half an hour for the name and class once a part of the day is picked", () => {
    const part = plan({ kind: "tap", text: null, tap: { intent: "visit_part", key: "20261116am" } });
    expect(part).toMatchObject({ action: "reply", intent: "visit_part", chat: { awaiting: "visit:20261116am", awaitingUntil: new Date(NOON.getTime() + AWAIT_MINUTES * 60_000).toISOString() } });
    expect(plan({ kind: "tap", text: null, tap: { intent: "visit_part", key: "20261115pm" } })).toMatchObject({ intent: "visit", chat: { awaiting: null } });
    expect(plan({ kind: "tap", text: null, tap: { intent: "visit_part", key: "bad" } })).toMatchObject({ intent: "visit" });
  });

  it("hands the booking to the office with the day, the child and the parent's words", () => {
    const booked = plan({ text: "Riya, class 3", chat: waiting() });
    expect(booked).toMatchObject({
      action: "reply",
      intent: "visit_booked",
      route: "rule",
      chat: { awaiting: null, awaitingUntil: null },
      handoff: {
        target: "office",
        child: null,
        topic: "visit",
        summary: "Mon 16 Nov morning · Riya, Class 3",
        visit: { day: "2026-11-16", part: "morning", childName: "Riya", classLabel: "Class 3" },
      },
    });
    if (booked.action !== "reply") return;
    expect(booked.handoff?.body).toContain("अभिभावक / Parent: “Riya, class 3”");
    expect(bodyOf(booked.message)).toContain("Your visit request has been passed to the school office");
    expect(bodyOf(booked.message)).not.toContain("after 6 am");
  });

  it("tells the family the office sees a late booking after 6 am", () => {
    const late = plan({ text: "Riya, class 3", chat: { ...waiting(), awaitingUntil: new Date(LATE.getTime() + 10 * 60_000).toISOString() }, now: LATE });
    expect(late).toMatchObject({ action: "reply", intent: "visit_booked" });
    if (late.action === "reply") expect(bodyOf(late.message)).toContain("after 6 am");
  });

  it("books what it can read, and passes on the rest in the parent's words", () => {
    for (const [text, childName, classLabel] of [
      ["Ankit 5", "Ankit", "Class 5"],
      ["अंकित 5", "अंकित", "Class 5"],
      ["Mark 5th", "Mark", "Class 5"],
      ["Riya", "Riya", null],
      ["class 3", null, "Class 3"],
      ["admission Riya class 3", "Riya", "Class 3"],
    ] as const) {
      expect(plan({ text, chat: waiting() }), text).toMatchObject({ intent: "visit_booked", handoff: { visit: { childName, classLabel } } });
    }
  });

  it("lets the parent change their mind, or go back to the days", () => {
    expect(plan({ text: "fees", chat: waiting() })).toMatchObject({ intent: "fees", chat: { awaiting: null }, handoff: null });
    expect(plan({ text: "menu", chat: waiting() })).toMatchObject({ intent: "menu", chat: { awaiting: null } });
    expect(plan({ text: "cancel", chat: waiting() })).toMatchObject({ intent: "menu", chat: { awaiting: null }, handoff: null });
    expect(plan({ text: "रहने दें", chat: waiting() })).toMatchObject({ intent: "menu", handoff: null });
    expect(plan({ text: "admission", chat: waiting() })).toMatchObject({ intent: "visit", chat: { awaiting: null }, handoff: null });
    expect(plan({ kind: "tap", text: null, tap: { intent: "menu", key: null }, chat: waiting() })).toMatchObject({ intent: "menu", chat: { awaiting: null } });
  });

  it("asks once more after an ok, and keeps waiting", () => {
    for (const text of ["ok", "accha", "👍"]) {
      const again = plan({ text, chat: waiting(5) });
      expect(again, text).toMatchObject({ action: "reply", intent: "visit_part", handoff: null, chat: { awaiting: "visit:20261116am", awaitingUntil: new Date(NOON.getTime() + AWAIT_MINUTES * 60_000).toISOString() } });
    }
  });

  it("leaves a question to Claude, and ends the wait", () => {
    expect(plan({ text: "admission fees kitni hai?", chat: waiting() })).toMatchObject({ action: "ask_ai", chat: { awaiting: null } });
    expect(plan({ text: "दाखिला कब से है", chat: waiting() })).toMatchObject({ action: "ask_ai", chat: { awaiting: null } });
  });

  it("treats a late answer as a new message", () => {
    const expired: ChatState = { ...waiting(), awaitingUntil: new Date(NOON.getTime() - 60_000).toISOString() };
    expect(plan({ text: "Riya, class 3", chat: expired })).toMatchObject({ action: "ask_ai" });
  });

  it("puts the button under Claude's answers about admission", () => {
    const answer: HelperAnswer = {
      language: "en",
      topic: "admission",
      reply: "Admissions for next year open in January.",
      show: "none",
      handoff: "none",
      child: null,
      needs_care: false,
      summary: null,
      absence: null,
      school_answer: null,
      unanswered: null,
    };
    const answered = planFromAnswer(answer, { family, helperName: "Veer Patta AI", text: "When do admissions open?", now: NOON });
    expect(buttonsOf(answered.message).map((button) => button.id)).toEqual(["vpai:visit", "vpai:menu"]);
    const handed = planFromAnswer({ ...answer, handoff: "office" }, { family, helperName: "Veer Patta AI", text: "What documents do you need?", now: NOON });
    expect(buttonsOf(handed.message).map((button) => button.id)[0]).toBe("vpai:visit");
    expect(handed.handoff).toMatchObject({ target: "office" });
    const fees = planFromAnswer({ ...answer, topic: "fees" }, { family, helperName: "Veer Patta AI", text: "x", now: NOON });
    expect(buttonsOf(fees.message).map((button) => button.id)).not.toContain("vpai:visit");
  });
});

/* -------------------------------------------------------- on the board */

describe("the visit chip on the Admissions board (D-593)", () => {
  it("says today, tomorrow, a later day, or that the day has passed", () => {
    expect(visitWhen("2026-11-12", TODAY)).toBe("today");
    expect(visitWhen("2026-11-13", TODAY)).toBe("tomorrow");
    expect(visitWhen("2026-11-16", TODAY)).toBe("later");
    expect(visitWhen("2026-11-11", TODAY)).toBe("passed");
    expect(visitWhen("2026-12-01", "2026-11-30")).toBe("tomorrow");
    expect(visitWhen(null, TODAY)).toBeNull();
    expect(visitWhen("16 Nov", TODAY)).toBeNull();
  });
});

/* ------------------------------------------------------------ the database */

describe("the database change", () => {
  const files = readdirSync("supabase/migrations").filter((file) => file.endsWith("_parent_helper_visits.sql"));
  const sql = files.length === 1 ? readFileSync(path.join("supabase/migrations", files[0]), "utf8") : "";
  /** What runs: the rollback in the header is a comment. */
  const run = sql.replace(/^\s*--.*$/gm, "");

  it("is one migration, in vppsone only, in one transaction, and drops nothing but the old chat check", () => {
    expect(files).toHaveLength(1);
    expect(run).toMatch(/^begin;$/m);
    expect(run).toMatch(/^commit;$/m);
    expect(run).not.toMatch(/\bpublic\./);
    expect(run).not.toMatch(/\bdrop\s+(table|column|view|function)\b/i);
    expect([...run.matchAll(/\bdrop\s+constraint\s+(\w+)/gi)].map((match) => match[1])).toEqual(["parent_helper_chats_awaiting_check"]);
  });

  it("adds the visit, where it came from and its hand-off, one enquiry per hand-off", () => {
    expect(sql).toContain("add column visit_on date");
    expect(sql).toContain("add column visit_part text");
    expect(sql).toContain("add column source text not null default 'office'");
    expect(sql).toContain("add column parent_reply_id uuid references vppsone.parent_replies(id) on delete set null");
    expect(sql).toContain("check ((visit_on is null) = (visit_part is null))");
    expect(sql).toContain("add constraint enquiries_one_per_handoff unique (parent_reply_id)");
  });

  it("lets the chat wait for exactly the slot the planner writes", () => {
    const check = run.match(/awaiting ~ '([^']+)'/)?.[1];
    expect(check).toBe("^(teacher:[a-z0-9]{4,16}|office|visit:[0-9]{8}(am|pm))$");
    const pattern = new RegExp(check ?? "x");
    expect(pattern.test(visitAwaiting({ day: "2026-11-16", part: "morning" }))).toBe(true);
    expect(pattern.test("teacher:ab12cd34")).toBe(true);
    expect(pattern.test("office")).toBe(true);
    expect(pattern.test("visit:2026111am")).toBe(false);
  });
});
