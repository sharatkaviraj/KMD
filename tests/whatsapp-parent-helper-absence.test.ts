import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { absenceDays, absenceNote, MAX_ABSENCE_DAYS } from "@/modules/whatsapp/domain/helper-absence";
import { helperAnswerSchema, helperSystemPrompt, planFromAnswer, type HelperAnswer } from "@/modules/whatsapp/domain/helper-ai";
import { childFactsFromRow, type ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import type { HelperMessage } from "@/modules/whatsapp/domain/helper-messages";
import { absenceLines, handoffAck, type Family, type ReplyContext } from "@/modules/whatsapp/domain/helper-replies";

/**
 * Sick-day notes (D-588): "Riya bimar hai, aaj nahi aayegi" becomes the days
 * the register shows "Parent informed" on, once the class teacher has applied
 * it (D-598). Every name and number here is made up (rule 6).
 */

/** Thursday 12 November 2026, 12:00 in India. */
const NOON = new Date("2026-11-12T06:30:00Z");
const AARAV_ID = "11111111-1111-4111-8111-111111111111";
const MIRA_ID = "33333333-3333-4333-8333-333333333333";

function child(id: string, fullName: string, className: string, teacher: string | null): ChildFacts {
  return childFactsFromRow({
    today: "2026-11-12",
    student: { id, full_name: fullName, class_id: "c", status: "active", session_label: "TEST-2026-27", class_name: className, section: null, stream_name: null },
    installments: [],
    receipts: [],
    attendance: null,
    days: [],
    results: [],
    class_teacher: teacher ? { staff_id: "22222222-2222-4222-8222-222222222222", name: teacher, is_test: true } : null,
    calendar: [],
  }) as ChildFacts;
}

const aarav = child(AARAV_ID, "TEST AARAV KUMAR", "Class 6", "TEST Teacher One");
const mira = child(MIRA_ID, "TEST MIRA DEVI", "Class 1", "TEST Teacher Two");
const oneChild: Family = { children: [aarav], practice: true };
const twoChildren: Family = { children: [aarav, mira], practice: true };

function context(language: ReplyContext["language"], family: Family = oneChild): ReplyContext {
  return { language, helperName: "Veer Patta AI", family, firstContact: false };
}

function bodyOf(message: HelperMessage): string {
  return message.kind === "text" ? message.text : message.kind === "document" ? message.caption : message.body;
}

function answer(over: Partial<HelperAnswer>): HelperAnswer {
  return { language: "en", topic: "leave", reply: "Get well soon.", show: "none", handoff: "class_teacher", child: null, needs_care: false, summary: null, absence: null, change: null, receipt_pdf: null, school_answer: null, unanswered: null, ...over };
}

/* -------------------------------------------------------------- the days */

describe("which days a note covers", () => {
  it("is today, or tomorrow, in India", () => {
    expect(absenceDays({ from: "today", days: 1 }, NOON)).toEqual(["2026-11-12"]);
    expect(absenceDays({ from: "tomorrow", days: 1 }, NOON)).toEqual(["2026-11-13"]);
    // 00:30 on Friday in India is still Thursday in UTC.
    expect(absenceDays({ from: "today", days: 1 }, new Date("2026-11-12T19:00:00Z"))).toEqual(["2026-11-13"]);
  });

  it("counts school days: a Sunday is never one of them", () => {
    expect(absenceDays({ from: "today", days: 3 }, NOON)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
    expect(absenceDays({ from: "today", days: 4 }, NOON)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-16"]);
    // Saturday's "kal se teen din" starts on Monday.
    expect(absenceDays({ from: "tomorrow", days: 3 }, new Date("2026-11-14T04:30:00Z"))).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
  });

  it("is at least one day and at most a week, whatever Claude read", () => {
    expect(absenceDays({ from: "today", days: 0 }, NOON)).toHaveLength(1);
    expect(absenceDays({ from: "today", days: -4 }, NOON)).toHaveLength(1);
    expect(absenceDays({ from: "today", days: 2.6 }, NOON)).toHaveLength(3);
    expect(absenceDays({ from: "today", days: 30 }, NOON)).toHaveLength(MAX_ABSENCE_DAYS);
    expect(absenceDays({ from: "today", days: Number.NaN }, NOON)).toHaveLength(1);
    expect(absenceDays({ from: "today", days: Number.POSITIVE_INFINITY }, NOON)).toHaveLength(1);
  });

  it("makes no note when Claude read no absence, and keeps the reason to a word", () => {
    expect(absenceNote(null, NOON)).toBeNull();
    expect(absenceNote(undefined, NOON)).toBeNull();
    expect(absenceNote({ from: "today", days: 1, reason: "sick" }, NOON)).toEqual({ days: ["2026-11-12"], reason: "sick" });
    expect(absenceNote({ from: "tomorrow", days: 2, reason: "other" }, NOON)).toEqual({ days: ["2026-11-13", "2026-11-14"], reason: "other" });
    expect(absenceNote({ from: "today", days: 1, reason: "wedding" as never }, NOON)?.reason).toBe("other");
  });
});

/* ------------------------------------------------------- what is said */

describe("what the parent is told", () => {
  it("names today's register in all three languages, once the class teacher has checked it", () => {
    const note = { days: ["2026-11-12"], reason: "other" as const };
    expect(absenceLines(aarav, note, "en")).toBe("📋 When the class teacher has checked it, today's register will show that you told the school.");
    expect(absenceLines(aarav, note, "hx")).toBe("📋 Class teacher ke check karne ke baad, aaj ki hazri mein likha rahega ki aapne school ko bata diya tha.");
    expect(absenceLines(aarav, note, "hi")).toBe("📋 कक्षा अध्यापक के जाँचने के बाद, आज की हाज़िरी में लिखा रहेगा कि आपने स्कूल को बता दिया था।");
  });

  it("says the school checks it when the class has no class teacher", () => {
    const note = { days: ["2026-11-12"], reason: "other" as const };
    expect(absenceLines(aarav, note, "en", "office")).toBe("📋 When the school has checked it, today's register will show that you told the school.");
    expect(absenceLines(aarav, note, "hx", "office")).toContain("School ke check karne ke baad");
    expect(absenceLines(aarav, note, "hi", "office")).toContain("स्कूल के जाँचने के बाद");
  });

  it("names the day, or the first and last day, when it is not today", () => {
    expect(absenceLines(aarav, { days: ["2026-11-13"], reason: "other" }, "en")).toBe("📋 When the class teacher has checked it, the register for 13 Nov will show that you told the school.");
    expect(absenceLines(aarav, { days: ["2026-11-13"], reason: "other" }, "hi")).toBe("📋 कक्षा अध्यापक के जाँचने के बाद, 13 नवंबर की हाज़िरी में लिखा रहेगा कि आपने स्कूल को बता दिया था।");
    const span = { days: ["2026-11-13", "2026-11-14", "2026-11-16"], reason: "other" as const };
    expect(absenceLines(aarav, span, "en")).toBe("📋 When the class teacher has checked it, the register from 13 Nov to 16 Nov will show that you told the school.");
    expect(absenceLines(aarav, span, "hx")).toBe("📋 Class teacher ke check karne ke baad, 13 Nov se 16 Nov tak ki hazri mein likha rahega ki aapne school ko bata diya tha.");
    expect(absenceLines(aarav, span, "hi")).toBe("📋 कक्षा अध्यापक के जाँचने के बाद, 13 नवंबर से 16 नवंबर तक की हाज़िरी में लिखा रहेगा कि आपने स्कूल को बता दिया था।");
  });

  it("never says the register already shows it: a person decides first (D-598)", () => {
    for (const language of ["en", "hx", "hi"] as const) {
      const line = absenceLines(aarav, { days: ["2026-11-12"], reason: "sick" }, language);
      expect(line).not.toMatch(/has been (marked|noted)|marked (leave|absent)|shows that/i);
    }
  });

  it("wishes a child who is ill well, by first name only", () => {
    const sick = { days: ["2026-11-12"], reason: "sick" as const };
    expect(absenceLines(aarav, sick, "en")).toContain(`🌼 We hope *${aarav.firstName}* feels better soon.`);
    expect(absenceLines(aarav, sick, "hx")).toContain(`🌼 *${aarav.firstName}* jaldi theek ho jaye, yahi kaamna hai.`);
    expect(absenceLines(aarav, sick, "hi")).toContain(`🌼 *${aarav.firstName}* जल्दी ठीक हो जाए, यही कामना है।`);
    expect(absenceLines(aarav, sick, "en")).not.toContain("KUMAR");
    expect(absenceLines(aarav, { days: ["2026-11-12"], reason: "other" }, "en")).not.toContain("🌼");
  });

  it("says the register line in place of 'the school will get back to you', and keeps the late-hour line", () => {
    const plain = bodyOf(handoffAck(context("en"), "class_teacher", { child: aarav, teacherName: "TEST Teacher One", lateHour: false }));
    expect(plain).toContain("The school will get back to you.");
    const noted = bodyOf(
      handoffAck(context("en"), "class_teacher", { child: aarav, teacherName: "TEST Teacher One", lateHour: true, absence: { days: ["2026-11-12"], reason: "sick" } }),
    );
    expect(noted).toContain(`✅ Your message has been passed to *${aarav.firstName}*'s class teacher (TEST Teacher One).`);
    expect(noted).toContain("\n📋 When the class teacher has checked it, today's register will show that you told the school.");
    expect(noted).not.toContain("The school will get back to you.");
    expect(noted).toContain("after 6 am");
  });
});

/* ------------------------------------------------------- Claude's part */

describe("Claude's reading of an absence", () => {
  const input = (family: Family, text: string) => ({ family, helperName: "Veer Patta AI", text, now: NOON });

  it("is told when to set it, and when not to", () => {
    const prompt = helperSystemPrompt("Veer Patta AI");
    expect(prompt).toContain('A CHILD WHO WILL BE AWAY (set "absence")');
    expect(prompt).toContain('"kal" with a future verb is tomorrow');
    expect(prompt).toContain("a child who was away on a day that has passed");
  });

  it("checks the shape: null, or from, days and one of two reasons", () => {
    expect(helperAnswerSchema.safeParse(answer({})).success).toBe(true);
    expect(helperAnswerSchema.safeParse(answer({ absence: { from: "tomorrow", days: 2, reason: "sick" } })).success).toBe(true);
    expect(helperAnswerSchema.safeParse({ ...answer({}), absence: { from: "yesterday", days: 1, reason: "sick" } }).success).toBe(false);
    expect(helperAnswerSchema.safeParse({ ...answer({}), absence: { from: "today", days: "2", reason: "sick" } }).success).toBe(false);
    expect(helperAnswerSchema.safeParse({ ...answer({}), absence: { from: "today", days: 1, reason: "holiday" } }).success).toBe(false);
    const missing: Record<string, unknown> = { ...answer({}) };
    delete missing.absence;
    expect(helperAnswerSchema.safeParse(missing).success).toBe(false);
  });

  it("hands the note to the class teacher, says which register shows it, and keeps a reply for when it is not kept", () => {
    const text = "Aarav bimar hai, aaj nahi aayega";
    const planned = planFromAnswer(answer({ language: "hx", reply: "Aarav jaldi theek ho jaye.", absence: { from: "today", days: 1, reason: "sick" } }), input(oneChild, text));
    expect(planned.intent).toBe("leave");
    expect(planned.handoff).toMatchObject({ target: "class_teacher", topic: "leave", body: text, absence: { days: ["2026-11-12"], reason: "sick" } });
    expect(planned.handoff?.child?.studentId).toBe(AARAV_ID);
    expect(bodyOf(planned.message)).toContain("Class teacher ke check karne ke baad, aaj ki hazri mein likha rahega");
    const unsaved = bodyOf(planned.handoff!.absence!.unsaved);
    expect(unsaved).toContain("class teacher (TEST Teacher One) tak pahuncha diya gaya hai");
    expect(unsaved).not.toContain("hazri");
    expect(unsaved).toContain("School aapse sampark karega.");
  });

  it("hands an absence to the class teacher even when Claude asked for no hand-off", () => {
    const planned = planFromAnswer(answer({ topic: "other", handoff: "none", absence: { from: "tomorrow", days: 1, reason: "other" } }), input(oneChild, "kal shaadi mein jaana hai"));
    expect(planned.handoff).toMatchObject({ target: "class_teacher", topic: "leave", absence: { days: ["2026-11-13"], reason: "other" } });
    expect(bodyOf(planned.message)).toContain("the register for 13 Nov will show that you told the school.");
  });

  it("keeps the note with whoever Claude handed it to", () => {
    const planned = planFromAnswer(
      answer({ topic: "complaint", handoff: "accounts", child: aarav.key, absence: { from: "today", days: 1, reason: "other" } }),
      input(twoChildren, "fees ki baat karni hai, aaj Aarav nahi aayega"),
    );
    expect(planned.handoff).toMatchObject({ target: "accounts", absence: { days: ["2026-11-12"] } });
    expect(planned.handoff?.child?.studentId).toBe(AARAV_ID);
  });

  it("notes nothing when it cannot tell which child, or Claude read no absence", () => {
    const unsure = planFromAnswer(answer({ absence: { from: "today", days: 1, reason: "sick" } }), input(twoChildren, "bachcha bimar hai"));
    expect(unsure.handoff?.absence).toBeUndefined();
    expect(bodyOf(unsure.message)).not.toContain("register");
    const named = planFromAnswer(answer({ child: mira.key, absence: { from: "today", days: 1, reason: "sick" } }), input(twoChildren, "Mira bimar hai"));
    expect(named.handoff?.child?.studentId).toBe(MIRA_ID);
    expect(named.handoff?.absence?.days).toEqual(["2026-11-12"]);
    const none = planFromAnswer(answer({ topic: "attendance", handoff: "none", reply: "Aarav was present today.", absence: null }), input(oneChild, "aaj aaya tha?"));
    expect(none.handoff).toBeNull();
  });
});

/* ------------------------------------------------------- the migration */

describe("the sick-day notes migration (D-588)", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).filter((name) => name.endsWith("_parent_absence_notes.sql"));
  const sql = readFileSync(join(dir, file[0] ?? "missing"), "utf8").replace(/--[^\n]*/g, "");

  it("is one file that only adds, in a transaction that gives up rather than waits", () => {
    expect(file).toHaveLength(1);
    expect(sql).not.toMatch(/\b(drop|truncate|rename)\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\bpublic\./);
    expect(sql).toMatch(/^\s*begin;/);
    expect(sql).toContain("set local lock_timeout = '5s';");
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("keeps the days and a word for why, never the parent's words", () => {
    expect(sql).toContain("create table vppsone.parent_absence_notes (");
    expect(sql).toContain("constraint parent_absence_notes_reason_known check (reason in ('sick', 'other'))");
    expect(sql).toContain("constraint parent_absence_notes_one_per_day unique (student_id, day)");
    expect(sql).toContain("parent_reply_id uuid references vppsone.parent_replies(id) on delete set null");
    expect(sql).not.toMatch(/\b(body|text|message|words|phone)\s+text\b/i);
  });

  it("is for the service role only", () => {
    expect(sql).toContain("alter table vppsone.parent_absence_notes enable row level security;");
    expect(sql).toContain("revoke all on vppsone.parent_absence_notes from anon, authenticated;");
    expect(sql).toContain("grant all on vppsone.parent_absence_notes to service_role;");
    expect(sql).not.toMatch(/grant [a-z, ]+ on vppsone\.parent_absence_notes to (anon|authenticated)/i);
  });

  it("matches what applying a suggestion writes and the register reads (D-598)", () => {
    const suggestions = readdirSync(dir).filter((name) => name.endsWith("_parent_suggestions.sql"));
    expect(suggestions).toHaveLength(1);
    const applying = readFileSync(join(dir, suggestions[0]), "utf8");
    const register = readFileSync(join(process.cwd(), "src/modules/attendance/data/parent-notes.ts"), "utf8");
    for (const column of ["student_id", "session_label", "day", "reason", "parent_reply_id", "practice"]) {
      expect(sql).toMatch(new RegExp(`\\n\\s+${column} `));
    }
    expect(applying).toContain("insert into vppsone.parent_absence_notes (student_id, session_label, day, reason, parent_reply_id, practice, suggestion_id, mark)");
    expect(register).toContain('.select("student_id, reason, mark")');
    // Nothing in the helper writes a note any more: only a person applying a suggestion does.
    const helper = ["helper-store.ts", "helper-turn.ts", "helper-visit.ts"].map((name) => readFileSync(join(process.cwd(), "src/modules/whatsapp/data", name), "utf8")).join("\n");
    expect(helper).not.toContain('from("parent_absence_notes")');
    expect(helper).not.toContain('from("enquiries")');
  });
});
