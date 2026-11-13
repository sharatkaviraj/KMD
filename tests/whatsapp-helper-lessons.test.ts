import { describe, expect, it } from "vitest";

import { factsText, helperAnswerSchema, helperSystemPrompt, helperUserText } from "@/modules/whatsapp/domain/helper-ai";
import { childFactsFromRow, type ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import {
  KNOWLEDGE_CAPS,
  NO_KNOWLEDGE,
  cleanAnswer,
  cleanQuestion,
  cleanTaughtQuestion,
  familyWords,
  knowledgeEntry,
  knowledgeLines,
  lessonNoteFor,
  questionFingerprint,
  schoolKnowledge,
  type Lesson,
  type LessonSignal,
  type SchoolKnowledge,
} from "@/modules/whatsapp/domain/helper-lessons";
import type { Family } from "@/modules/whatsapp/domain/helper-replies";

/**
 * Teach it once (D-589): what the helper reads from the school's answers,
 * and what it may keep for the list from a question it could not answer.
 * Every name and number here is made up (rule 6).
 */

const NOON = new Date("2026-11-12T06:30:00Z");

function lesson(over: Partial<Lesson> & { id: string }): Lesson {
  return {
    practice: true,
    question: "What are the winter school timings?",
    answer: null,
    status: "waiting",
    topic: "calendar",
    askedCount: 1,
    firstAskedAt: "2026-11-10T04:00:00.000Z",
    lastAskedAt: "2026-11-10T04:00:00.000Z",
    usedCount: 0,
    lastUsedAt: null,
    answeredBy: null,
    answeredAt: null,
    closedAt: null,
    ...over,
  };
}

const child = childFactsFromRow({
  today: "2026-11-12",
  student: { id: "11111111-1111-4111-8111-111111111111", full_name: "MEERA JOSHI", class_id: "c6", status: "active", session_label: "TEST-2026-27", class_name: "Class 6", section: null, stream_name: null },
  installments: [],
  receipts: [],
  attendance: null,
  days: [],
  results: [],
  class_teacher: { staff_id: "22222222-2222-4222-8222-222222222222", name: "Mrs Kavita Rathore", is_test: true },
  calendar: [],
}) as ChildFacts;

describe("the school's answers, as the helper reads them", () => {
  it("takes only what an admin has seen: answered questions and the ones a person answers", () => {
    const knowledge = schoolKnowledge([
      lesson({ id: "w1", status: "waiting", askedCount: 50 }),
      lesson({ id: "a1", status: "answered", answer: "9 am to 3 pm from 1 November.", askedCount: 2 }),
      lesson({ id: "a2", status: "answered", answer: null }),
      lesson({ id: "p1", status: "by_people", question: "Can a child change section?" }),
    ]);
    expect(knowledge.answers.map((entry) => [entry.key, entry.id])).toEqual([["A1", "a1"]]);
    expect(knowledge.byPeople.map((entry) => [entry.key, entry.id])).toEqual([["P1", "p1"]]);
  });

  it("puts the most asked first, and keeps to the caps", () => {
    const many = Array.from({ length: KNOWLEDGE_CAPS.answers + 5 }, (_, n) =>
      lesson({ id: `a${String(n).padStart(2, "0")}`, status: "answered", answer: "Yes.", askedCount: n, usedCount: n % 3 }),
    );
    const knowledge = schoolKnowledge(many);
    expect(knowledge.answers).toHaveLength(KNOWLEDGE_CAPS.answers);
    expect(knowledge.answers[0].id).toBe("a34");
    expect(knowledge.answers.map((entry) => entry.key).slice(0, 3)).toEqual(["A1", "A2", "A3"]);
    const people = schoolKnowledge(Array.from({ length: 20 }, (_, n) => lesson({ id: `p${n}`, status: "by_people" })));
    expect(people.byPeople).toHaveLength(KNOWLEDGE_CAPS.byPeople);
  });

  it("writes them into FACTS on one line each, so nothing the school wrote can open or close the parent's fence", () => {
    expect(knowledgeLines(NO_KNOWLEDGE)).toEqual(["SCHOOL ANSWERS: none yet."]);
    const lines = knowledgeLines({
      answers: [{ key: "A1", id: "a1", question: "What are the «winter» timings?", answer: "9 am to 3 pm.\n\nSaturdays 9 am to 12 noon." }],
      byPeople: [{ key: "P1", id: "p1", question: "Can a child change section?" }],
    });
    expect(lines).toEqual([
      "SCHOOL ANSWERS, written by the school (key: question -> answer):",
      '- A1: What are the "winter" timings? -> 9 am to 3 pm. / Saturdays 9 am to 12 noon.',
      "QUESTIONS A PERSON AT THE SCHOOL ALWAYS ANSWERS (key: question):",
      "- P1: Can a child change section?",
    ]);
  });

  it("finds the entry Claude names, and nothing it makes up", () => {
    const knowledge: SchoolKnowledge = {
      answers: [{ key: "A1", id: "a1", question: "q", answer: "a" }],
      byPeople: [{ key: "P1", id: "p1", question: "q" }],
    };
    expect(knowledgeEntry(knowledge, "A1")).toEqual({ role: "answer", id: "a1" });
    expect(knowledgeEntry(knowledge, " a1 ")).toEqual({ role: "answer", id: "a1" });
    expect(knowledgeEntry(knowledge, "P1")).toEqual({ role: "people", id: "p1" });
    for (const key of ["A2", "P9", "Q1", "A", "1", "A1;drop", null, undefined, ""]) expect(knowledgeEntry(knowledge, key)).toBeNull();
  });

  it("is part of FACTS and of what Claude is told to do", () => {
    const family: Family = { children: [child], practice: true };
    const knowledge: SchoolKnowledge = { answers: [{ key: "A1", id: "a1", question: "What are the winter school timings?", answer: "9 am to 3 pm." }], byPeople: [] };
    expect(factsText(family, NOON)).toContain("SCHOOL ANSWERS: none yet.");
    expect(factsText(family, NOON, knowledge)).toContain("- A1: What are the winter school timings? -> 9 am to 3 pm.");
    expect(helperUserText({ family, text: "winter timing?", language: "en", firstContact: false, now: NOON, knowledge })).toContain("A1: What are the winter school timings?");
    const prompt = helperSystemPrompt("Veer Patta AI");
    expect(prompt).toContain("SCHOOL ANSWERS (in FACTS)");
    expect(prompt).toContain('set "unanswered"');
    expect(prompt).toContain("no name, no number, nothing about this child or family");
    const shape = { language: "en", topic: "calendar", reply: "x", show: "none", handoff: "office", child: null, needs_care: false, summary: null, absence: null, change: null };
    expect(helperAnswerSchema.safeParse({ ...shape, school_answer: null, unanswered: { question: "When is sports day?", same_as: null } }).success).toBe(true);
    expect(helperAnswerSchema.safeParse(shape).success).toBe(false);
  });
});

describe("a question's fingerprint", () => {
  it("is the same for the same words, however written", () => {
    expect(questionFingerprint("What are the WINTER school timings?")).toBe("what are the winter school timings");
    expect(questionFingerprint("  what are the winter school-timings ??")).toBe("what are the winter school timings");
    expect(questionFingerprint("सर्दी में स्कूल का समय क्या है?")).toBe("सर्दी में स्कूल का समय क्या है");
  });
});

describe("what the helper may keep from a question it could not answer", () => {
  const avoid = familyWords([child], "Sunil Joshi Home");

  it("knows the family's names, and not the words around them", () => {
    expect(avoid.sort()).toEqual(["joshi", "kavita", "meera", "rathore", "sunil"].sort());
    const practice = familyWords(
      [{ firstName: "Test", classTeacher: { staffId: "x", name: "TEST Teacher One", isTest: true } } as Pick<ChildFacts, "firstName" | "classTeacher">],
      "Papa Ji",
    );
    expect(practice).toEqual([]);
  });

  it("keeps a general question in Claude's words", () => {
    expect(cleanQuestion("  What are the  “winter” school timings? ", avoid)).toBe("What are the winter school timings?");
    expect(cleanQuestion("When is the parent-teacher meeting?", familyWords([], "TEST Teacher One"))).toBe("When is the parent-teacher meeting?");
  });

  it("keeps nothing that names the family or their teacher", () => {
    expect(cleanQuestion("Why was Meera absent on Monday?", avoid)).toBeNull();
    expect(cleanQuestion("Can I meet Kavita ma'am?", avoid)).toBeNull();
    expect(cleanQuestion("Can Sunil pay at the bank?", avoid)).toBeNull();
  });

  it("keeps nothing with a long number, an address or a link", () => {
    expect(cleanQuestion("Is receipt 202611120001 valid?", [])).toBeNull();
    expect(cleanQuestion("Can I call 98290 12345 for the bus?", [])).toBeNull();
    expect(cleanQuestion("Can I write to office@example.com?", [])).toBeNull();
    expect(cleanQuestion("Is https://example.com the school site?", [])).toBeNull();
    expect(cleanQuestion("Is the fee 1,500 for Class 9 books?", [])).toBe("Is the fee 1,500 for Class 9 books?");
  });

  it("keeps nothing too short to be a question, and cuts a long one on a word", () => {
    expect(cleanQuestion("Hm?", [])).toBeNull();
    expect(cleanQuestion(null, [])).toBeNull();
    expect(cleanQuestion("?!?!?!?!", [])).toBeNull();
    const long = cleanQuestion(`${"Which books and notebooks does the school need ".repeat(5)}?`, []);
    expect(long?.length).toBeLessThanOrEqual(160);
    expect(long?.endsWith("…")).toBe(true);
  });
});

describe("the answer an admin writes", () => {
  it("is tidied and kept within its bounds", () => {
    expect(cleanAnswer("  From 1 November:\r\n9 am  to 3 pm.\n\n\n\nSaturdays\u0007 till noon. ")).toBe("From 1 November:\n9 am to 3 pm.\n\nSaturdays till noon.");
    expect(cleanAnswer("x")).toBeNull();
    expect(cleanAnswer("y".repeat(601))).toBeNull();
    expect(cleanAnswer(undefined)).toBeNull();
  });

  it("may reword the question, within the same bounds", () => {
    expect(cleanTaughtQuestion("  What are the «winter» timings? ")).toBe('What are the "winter" timings?');
    expect(cleanTaughtQuestion("Hm")).toBeNull();
    expect(cleanTaughtQuestion("z".repeat(161))).toBeNull();
  });
});

describe("what one answer writes to the list", () => {
  const knowledge: SchoolKnowledge = {
    answers: [{ key: "A1", id: "lesson-a", question: "q", answer: "a" }],
    byPeople: [{ key: "P1", id: "lesson-p", question: "q" }],
  };
  const signal = (over: Partial<LessonSignal>): LessonSignal => ({ school_answer: null, unanswered: null, handoff: "none", ...over });

  it("counts an answer given from a school answer, only when nobody else had to answer", () => {
    expect(lessonNoteFor(signal({ school_answer: "A1" }), knowledge, [])).toEqual({ role: "used", lessonId: "lesson-a" });
    expect(lessonNoteFor(signal({ school_answer: "A1", handoff: "office" }), knowledge, [])).toBeNull();
    expect(lessonNoteFor(signal({ school_answer: "P1" }), knowledge, [])).toBeNull();
    expect(lessonNoteFor(signal({ school_answer: "A7" }), knowledge, [])).toBeNull();
  });

  it("lists a question it could not answer by its own words", () => {
    expect(lessonNoteFor(signal({ handoff: "office", unanswered: { question: "When is sports day this year?", same_as: null } }), knowledge, [])).toEqual({
      role: "asked",
      lessonId: null,
      question: "When is sports day this year?",
      fingerprint: "when is sports day this year",
    });
  });

  it("counts it on the question a person always answers, when Claude says it is that one", () => {
    expect(lessonNoteFor(signal({ handoff: "office", unanswered: { question: "Can a child move to another section?", same_as: "P1" } }), knowledge, [])).toMatchObject({
      role: "asked",
      lessonId: "lesson-p",
    });
    // An answered question is not counted as unanswered: its words are listed afresh instead.
    expect(lessonNoteFor(signal({ handoff: "office", unanswered: { question: "Is the canteen open on Saturday?", same_as: "A1" } }), knowledge, [])).toMatchObject({
      role: "asked",
      lessonId: null,
    });
  });

  it("keeps the count but not the words when the words name the family", () => {
    expect(lessonNoteFor(signal({ handoff: "office", unanswered: { question: "Can Meera change section?", same_as: "P1" } }), knowledge, ["meera"])).toEqual({
      role: "asked",
      lessonId: "lesson-p",
      question: null,
      fingerprint: null,
    });
    expect(lessonNoteFor(signal({ handoff: "office", unanswered: { question: "Can Meera change section?", same_as: null } }), knowledge, ["meera"])).toBeNull();
  });
});
