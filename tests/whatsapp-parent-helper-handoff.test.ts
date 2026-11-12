import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  answererFor,
  answerReadyParams,
  canPassUp,
  followUpBody,
  FOLLOW_UP_WORDS,
  isAcknowledgement,
  isComplaint,
  nextAlertMoment,
  nextStep,
  oneLine,
  parentAnswerText,
  peopleFor,
  ratingKey,
  staffAlertParams,
  staffAlertText,
  staffConfirmText,
  staffLanguage,
  templateLanguage,
  topicWords,
  windowOpen,
  type AlertWords,
  type HandoffState,
} from "@/modules/whatsapp/domain/helper-handoff";
import { ANSWER_READY_TEMPLATE, HELPER_HUB_SUBMISSIONS, HELPER_TEMPLATE_PARAMS, STAFF_ALERT_TEMPLATE } from "@/modules/whatsapp/domain/helper-hub-templates";
import { HUB_TEMPLATE_SUBMISSIONS } from "@/modules/whatsapp/domain/hub-templates";

/**
 * Veer Patta AI, step 2 (D-578): who a parent's message is for, when they are
 * told, and the words on each side. Every name here is made up (rule 6).
 */

/** 12:00 in India. */
const NOON = new Date("2026-11-12T06:30:00Z");
/** 21:30 in India. */
const LATE = new Date("2026-11-12T16:00:00Z");
/** 04:30 in India, the next morning. */
const EARLY = new Date("2026-11-12T23:00:00Z");
/** 06:00 in India on 13 Nov. */
const SIX_NEXT = "2026-11-13T00:30:00.000Z";
const HOUR = 3_600_000;

describe("6 am to 9 pm in India", () => {
  it("tells people straight away in the day", () => {
    expect(nextAlertMoment(NOON).toISOString()).toBe(NOON.toISOString());
    expect(nextAlertMoment(new Date("2026-11-12T00:30:00Z")).toISOString()).toBe("2026-11-12T00:30:00.000Z"); // 06:00
    expect(nextAlertMoment(new Date("2026-11-12T15:29:00Z")).toISOString()).toBe("2026-11-12T15:29:00.000Z"); // 20:59
  });

  it("holds a message from the evening or the small hours until 6 am", () => {
    expect(nextAlertMoment(LATE).toISOString()).toBe(SIX_NEXT);
    expect(nextAlertMoment(new Date("2026-11-12T15:30:00Z")).toISOString()).toBe(SIX_NEXT); // 21:00 sharp
    expect(nextAlertMoment(EARLY).toISOString()).toBe(SIX_NEXT);
    expect(nextAlertMoment(new Date("2026-11-12T18:30:00Z")).toISOString()).toBe(SIX_NEXT); // midnight
  });
});

describe("whether a chat is open (Meta's 24 hours, less half an hour)", () => {
  it("is open for 23.5 hours after the person last wrote", () => {
    expect(windowOpen(new Date(NOON.getTime() - 23 * HOUR).toISOString(), NOON)).toBe(true);
    expect(windowOpen(new Date(NOON.getTime() - 23.6 * HOUR).toISOString(), NOON)).toBe(false);
  });

  it("is closed when nobody knows, or the clock is odd", () => {
    expect(windowOpen(null, NOON)).toBe(false);
    expect(windowOpen("not a date", NOON)).toBe(false);
    expect(windowOpen(new Date(NOON.getTime() + 2 * HOUR).toISOString(), NOON)).toBe(false);
  });
});

describe("who is told (the owner, 12 Nov 2026)", () => {
  it("the class teacher; the accountant and an admin for fees; an admin for the principal; the office", () => {
    expect(peopleFor("class_teacher", 0)).toEqual({ classTeacher: true, roles: [] });
    expect(peopleFor("accounts", 0)).toEqual({ classTeacher: false, roles: ["accountant", "admin"] });
    expect(peopleFor("principal", 0)).toEqual({ classTeacher: false, roles: ["admin"] });
    expect(peopleFor("office", 0)).toEqual({ classTeacher: false, roles: ["office"] });
  });

  it("an admin once a complaint has gone up", () => {
    for (const target of ["class_teacher", "accounts", "office", "principal"] as const) {
      expect(peopleFor(target, 1)).toEqual({ classTeacher: false, roles: ["admin"] });
    }
  });

  it("a complaint is one the parent made, or one for the principal; only the class teacher's and the office's go up", () => {
    expect(isComplaint("class_teacher", "complaint")).toBe(true);
    expect(isComplaint("principal", "request")).toBe(true);
    expect(isComplaint("class_teacher", "homework")).toBe(false);
    // A "no" to an answer (D-584) is the office's, and goes up to an admin when it is left a day.
    expect(isComplaint("office", "not_helped")).toBe(true);
    expect(canPassUp("class_teacher", true)).toBe(true);
    expect(canPassUp("office", true)).toBe(true);
    // Fees go to an admin with the accountant from the start; the principal's are an admin's already.
    expect(canPassUp("accounts", true)).toBe(false);
    expect(canPassUp("principal", true)).toBe(false);
    expect(canPassUp("class_teacher", false)).toBe(false);
  });
});

describe("what is due after each step", () => {
  const base: HandoffState = {
    target: "class_teacher",
    complaint: false,
    level: 0,
    reminders: 0,
    levelAlertedAt: NOON.toISOString(),
    answeredAt: null,
    closedAt: null,
  };

  it("one reminder three hours after the alert", () => {
    expect(nextStep(base, "alert", NOON)).toEqual({ action: "remind", at: new Date(NOON.getTime() + 3 * HOUR) });
  });

  it("a reminder that would fall at night waits until 6 am", () => {
    const evening = new Date("2026-11-12T14:00:00Z"); // 19:30
    expect(nextStep({ ...base, levelAlertedAt: evening.toISOString() }, "alert", evening)?.at.toISOString()).toBe(SIX_NEXT);
  });

  it("a complaint still unanswered a day after it reached the class teacher goes up to an admin", () => {
    const after = { ...base, complaint: true, reminders: 1 };
    expect(nextStep(after, "remind", new Date(NOON.getTime() + 3 * HOUR))).toEqual({ action: "pass_up", at: new Date(NOON.getTime() + 24 * HOUR) });
  });

  it("anything else gets a second reminder the next day, and then nothing more", () => {
    expect(nextStep({ ...base, reminders: 1 }, "remind", NOON)).toEqual({ action: "remind", at: new Date(NOON.getTime() + 24 * HOUR) });
    expect(nextStep({ ...base, reminders: 2 }, "remind", NOON)).toBeNull();
  });

  it("an admin a complaint went up to gets one reminder, and then it stays with them", () => {
    const passed = { ...base, complaint: true, level: 1, reminders: 0, levelAlertedAt: NOON.toISOString() };
    expect(nextStep(passed, "pass_up", NOON)).toEqual({ action: "remind", at: new Date(NOON.getTime() + 3 * HOUR) });
    expect(nextStep({ ...passed, reminders: 1 }, "remind", NOON)).toBeNull();
  });

  it("nothing once it is answered or closed", () => {
    expect(nextStep({ ...base, answeredAt: NOON.toISOString() }, "alert", NOON)).toBeNull();
    expect(nextStep({ ...base, closedAt: NOON.toISOString() }, "alert", NOON)).toBeNull();
  });
});

describe("the alert", () => {
  const words: AlertWords = {
    kind: "alert",
    language: "en",
    staffName: "TEST Teacher One",
    studentLabel: "Aarav · Class 6",
    topic: "message_teacher",
    complaint: false,
    words: "Aarav was unwell yesterday.\nPlease share   today's homework.",
    helperName: "Veer Patta AI",
    practice: false,
  };

  it("fills the approved template's four blanks on one line each", () => {
    expect(staffAlertParams(words)).toEqual(["TEST Teacher One", "Aarav · Class 6", "Message for the class teacher", "Aarav was unwell yesterday. Please share today's homework."]);
    expect(staffAlertParams({ ...words, kind: "reminder" })[2]).toBe("Message for the class teacher · reminder");
    expect(staffAlertParams({ ...words, kind: "passed_up", topic: "complaint", language: "hi" })[2]).toBe("शिकायत · एक दिन से जवाब नहीं");
    expect(staffAlertParams({ ...words, words: "x".repeat(900) })[3]!.length).toBeLessThanOrEqual(300);
  });

  it("as a typed message: who it is about, the parent's words, and how to answer", () => {
    const text = staffAlertText(words);
    expect(text).toContain("A parent's message for you");
    expect(text).toContain("Aarav · Class 6");
    expect(text).toContain("Swipe right on this message");
    expect(text).toContain("Veer Patta AI");
    expect(text).not.toContain("Practice");
    expect(staffAlertText({ ...words, kind: "reminder", language: "hi" })).toContain("याद दिला रहे हैं");
    expect(staffAlertText({ ...words, kind: "passed_up", complaint: true })).toContain("Not answered for a day: a parent's complaint");
  });

  it("a practice alert says it is practice, and whose place the owner's number takes", () => {
    expect(staffAlertText({ ...words, practice: true })).toContain("Practice: test records, sent to you in place of TEST Teacher One");
    expect(staffAlertText({ ...words, practice: true, language: "hi" })).toContain("TEST Teacher One की जगह आपको भेजा गया");
  });

  it("reads a teacher's language from their account: English only when they chose English", () => {
    expect(staffLanguage("en")).toBe("en");
    expect(staffLanguage("hi")).toBe("hi");
    expect(staffLanguage("both")).toBe("hi");
    expect(staffLanguage(null)).toBe("hi");
  });
});

describe("the answer, as the parent reads it", () => {
  it("names who answered and quotes what the parent asked", () => {
    const text = parentAnswerText({
      language: "en",
      who: answererFor("teacher", true, "TEST Teacher One"),
      aboutName: "Aarav",
      quote: "Please share today's homework",
      answer: "Pages 12 and 13 of the maths book.",
    });
    expect(text).toBe(
      "💬 *Answer from TEST Teacher One, class teacher*\n_Your message about Aarav: “Please share today's homework”_\n\nPages 12 and 13 of the maths book.",
    );
  });

  it("in the parent's own language, and without a child when none was named", () => {
    const hindi = parentAnswerText({ language: "hi", who: answererFor("accountant", false, "X"), aboutName: null, quote: "रसीद चाहिए", answer: "भेज दी है।" });
    expect(hindi).toContain("स्कूल के अकाउंट्स विभाग का जवाब");
    expect(hindi).toContain("_आपका संदेश: “रसीद चाहिए”_");
    const hinglish = parentAnswerText({ language: "hx", who: answererFor("admin", false, "X"), aboutName: "Aarav", quote: "q", answer: "a" });
    expect(hinglish).toContain("Principal office ka jawab");
  });

  it("knows who answered: the class teacher by name, else the office they speak for", () => {
    expect(answererFor("teacher", true, "TEST Teacher One")).toEqual({ kind: "class_teacher", name: "TEST Teacher One" });
    expect(answererFor("teacher", false, "TEST Teacher Two")).toEqual({ kind: "office" });
    expect(answererFor("accountant", false, "A")).toEqual({ kind: "accounts" });
    expect(answererFor("admin", false, "A")).toEqual({ kind: "principal" });
    expect(answererFor("office", false, "A")).toEqual({ kind: "office" });
  });

  it("the 'your answer is ready' note's two blanks", () => {
    const teacher = answererFor("teacher", true, "TEST Teacher One");
    expect(answerReadyParams(teacher, { childName: "Aarav", topic: "fees" }, "en")).toEqual(["Class teacher TEST Teacher One", "Aarav"]);
    expect(answerReadyParams(teacher, { childName: null, topic: "fees" }, "en")).toEqual(["Class teacher TEST Teacher One", "fees"]);
    expect(answerReadyParams({ kind: "accounts" }, { childName: null, topic: "something_else" }, "hx")).toEqual(["स्कूल के अकाउंट्स विभाग", "आपके अनुरोध"]);
    expect(templateLanguage("hx")).toBe("hi");
  });

  it("tells the person who answered what became of it", () => {
    expect(staffConfirmText("sent", "en", "Aarav · Class 6")).toBe("✅ Your answer has gone to the parent of Aarav · Class 6. Thank you!");
    expect(staffConfirmText("waiting", "en", "Aarav")).toContain("they get yours the moment they reply");
    expect(staffConfirmText("failed", "hi", "Aarav")).toContain("ऑफ़िस इसे आगे पहुँचाएगा");
    expect(staffConfirmText("not_text", "en", "Aarav")).toContain("type your answer as words");
  });

  it("a bare 'ok' or 'thanks' after a waiting answer needs nothing more", () => {
    for (const ok of ["ok", "Thank you sir", "ठीक है, धन्यवाद", "theek hai ji", "👍", "🙏🙏", "  "]) expect(isAcknowledgement(ok), ok).toBe(true);
    // One word can be a question all by itself.
    for (const more of ["fees", "attendance", "ok but when is the exam?", "ok thanks, and the result?", "Please also send the receipt for August payment", "123"]) {
      expect(isAcknowledgement(more), more).toBe(false);
    }
  });

  it("one line, never empty", () => {
    expect(oneLine("  a\n\nb  ", 10)).toBe("a b");
    expect(oneLine("", 10)).toBe("-");
  });
});

describe("a no to an answer (D-584)", () => {
  it("the button carries twelve letters of the hand-off's id, which is all a tap is matched by", () => {
    expect(ratingKey("9F8E7D6C-5B4A-4321-8FED-CBA987654321")).toBe("9f8e7d6c5b4a");
    expect(ratingKey("h1")).toBe("h100");
    expect(ratingKey("9f8e7d6c-5b4a-4321-8fed-cba987654321")).toMatch(/^[a-z0-9]{4,16}$/);
  });

  it("the office is given what the parent asked and the answer that did not help, in both languages' labels", () => {
    expect(
      followUpBody({ parentWords: "Please share   today's homework", answer: " Pages 12 and 13. ", who: { kind: "class_teacher", name: "TEST Teacher One" } }),
    ).toBe("अभिभावक / Parent: “Please share today's homework”\nजवाब / Answer (कक्षा अध्यापक / Class teacher TEST Teacher One): “Pages 12 and 13.”");
    expect(followUpBody({ parentWords: "रसीद चाहिए", answer: "भेज दी है।", who: { kind: "accounts" } })).toBe(
      "अभिभावक / Parent: “रसीद चाहिए”\nजवाब / Answer (अकाउंट्स / Accounts): “भेज दी है।”",
    );
    // No answer to be found: the parent's words on their own.
    expect(followUpBody({ parentWords: "q", answer: null, who: null })).toBe("अभिभावक / Parent: “q”");
    expect(followUpBody({ parentWords: "q", answer: "   ", who: null })).toBe("अभिभावक / Parent: “q”");
    // Long words are cut, not the note.
    const long = followUpBody({ parentWords: "a".repeat(900), answer: "b".repeat(900), who: { kind: "office" } });
    expect(long.length).toBeLessThan(FOLLOW_UP_WORDS.parent + FOLLOW_UP_WORDS.answer + 80);
  });

  it("is called what it is, for the person told", () => {
    expect(topicWords("not_helped", "en")).toBe("The answer did not help");
    expect(topicWords("not_helped", "hi")).toBe("जवाब से मदद नहीं हुई");
    expect(answerReadyParams({ kind: "office" }, { childName: null, topic: "not_helped" }, "en")).toEqual(["The school office", "your question"]);
  });
});

describe("the ratings migration (D-584)", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).filter((name) => name.endsWith("_parent_helper_ratings.sql"));
  const sql = readFileSync(join(dir, file[0] ?? "missing"), "utf8").replace(/--[^\n]*/g, "");

  it("is one file, and only adds: it applies without anybody standing by to confirm", () => {
    expect(file).toHaveLength(1);
    expect(sql).not.toMatch(/\b(drop|truncate|rename)\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql.match(/alter table [a-z_.]+/gi)).toEqual(["alter table vppsone.parent_helper_handoffs"]);
    expect(sql).not.toMatch(/\b(grant|revoke)\b/i);
  });

  it("adds every column the helper reads and writes, with its rules", () => {
    for (const column of ["rating_asked_at timestamptz", "rating text", "rated_at timestamptz", "follow_up_of uuid references vppsone.parent_helper_handoffs(id) on delete set null"]) {
      expect(sql).toContain(`add column ${column}`);
    }
    expect(sql).toContain("check (rating is null or rating in ('helped', 'not_helped'))");
    expect(sql).toContain("check ((rating is null) = (rated_at is null))");
    expect(sql).toMatch(/create unique index parent_helper_handoffs_one_follow_up on vppsone\.parent_helper_handoffs \(follow_up_of\)\s+where follow_up_of is not null;/);
    const source = readFileSync(join(process.cwd(), "src/modules/whatsapp/data/helper-handoffs.ts"), "utf8");
    for (const column of ["rating_asked_at", "rating", "rated_at", "follow_up_of"]) expect(source).toContain(column);
  });
});

describe("the two approved messages on the school's hub", () => {
  const migration = readdirSync(join(process.cwd(), "supabase/migrations")).find((file) => file.endsWith("_parent_helper_handoffs.sql"));
  const sql = readFileSync(join(process.cwd(), "supabase/migrations", migration!), "utf8");

  it("are four: the staff alert and the answer-ready note, Hindi and English, all asked of the hub", () => {
    expect(HELPER_HUB_SUBMISSIONS.map((submission) => submission.name).sort()).toEqual(
      [...Object.values(STAFF_ALERT_TEMPLATE), ...Object.values(ANSWER_READY_TEMPLATE)].sort(),
    );
    const all = new Set(HUB_TEMPLATE_SUBMISSIONS.map((submission) => submission.name));
    for (const submission of HELPER_HUB_SUBMISSIONS) expect(all.has(submission.name)).toBe(true);
  });

  it.each(HELPER_HUB_SUBMISSIONS.map((submission) => [submission.name, submission] as const))("%s is shaped the way Meta checks", (_name, submission) => {
    const blanks = [...submission.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
    const count = submission.name.includes("staff") ? HELPER_TEMPLATE_PARAMS.staffAlert : HELPER_TEMPLATE_PARAMS.answerReady;
    expect(blanks).toEqual(Array.from({ length: count }, (_, index) => index + 1));
    expect(submission.examples).toHaveLength(count);
    expect(submission.body).not.toMatch(/^\s*\{\{/);
    expect(submission.body).not.toMatch(/\}\}\s*$/);
    expect(submission.category).toBe("UTILITY");
    expect(submission.buttons).toEqual([]);
    expect(submission.body.length).toBeLessThanOrEqual(1024);
    // Never the fees app's number, never a link.
    expect(submission.body).not.toMatch(/8047136289|https?:/);
  });

  it.each(HELPER_HUB_SUBMISSIONS.map((submission) => [submission.name, submission] as const))("%s has its registry row, not yet submitted", (name, submission) => {
    const blanks = submission.name.includes("staff") ? 4 : 2;
    expect(sql).toContain(`('${name}', '${name}', '${submission.language}', 'parent_helper', ${blanks}, `);
  });
});
