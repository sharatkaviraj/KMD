import { describe, expect, it } from "vitest";

import {
  CHAT_HUB_SUBMISSIONS,
  CHAT_TEMPLATE_PARAMS,
  OPEN_ONE_BUTTON_LABEL,
  OPEN_ONE_BUTTON_URL,
  OPEN_ONE_TEMPLATE,
  SCHOOL_MESSAGE_TEMPLATE,
  schoolMessageParams,
  speakerSubject,
  templateLanguageOf,
} from "@/modules/chats/domain/templates";
import { HUB_TEMPLATE_SUBMISSIONS, hubExpectedBodies } from "@/modules/whatsapp/domain/hub-templates";

/**
 * The chats' own approved messages (D-616; the owner, 15 Nov 2026: "Yes, yes,
 * go ahead"): "parents are waiting for your reply" for a member of staff,
 * with an Open chats button that opens their Chats in One, and "a message
 * from the school" for a parent the school writes to first. What goes to
 * Meta, and the blanks One fills. Made-up names only (rule 6).
 */

const placeholders = (body: string) => [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
const byName = new Map(CHAT_HUB_SUBMISSIONS.map((submission) => [submission.name, submission]));

describe("the four Meta is asked to approve (D-616)", () => {
  it("are Open chats and the school message, Hindi and English, all UTILITY", () => {
    expect(CHAT_HUB_SUBMISSIONS.map((submission) => [submission.name, submission.language])).toEqual([
      ["vpps_staff_open_one_hi_v1", "hi"],
      ["vpps_parent_school_message_hi_v1", "hi"],
      ["vpps_staff_open_one_en_v1", "en"],
      ["vpps_parent_school_message_en_v1", "en"],
    ]);
    for (const submission of CHAT_HUB_SUBMISSIONS) expect(submission.category).toBe("UTILITY");
  });

  it("have the shape Meta checks before it reads the words", () => {
    for (const submission of CHAT_HUB_SUBMISSIONS) {
      expect(placeholders(submission.body)).toEqual([1, 2]);
      expect(submission.examples).toHaveLength(2);
      expect(submission.body).not.toMatch(/^\s*\{\{\d+\}\}/);
      expect(submission.body).not.toMatch(/\{\{\d+\}\}\s*$/);
      expect(submission.body).not.toMatch(/\}\}\s*\{\{/);
      expect(submission.body).not.toMatch(/\n\n\n/);
      expect(submission.body.length).toBeLessThanOrEqual(1024);
      for (const example of submission.examples) expect(example.trim()).not.toBe("");
      // A bold title, then the school's name, as the staff set is written.
      const [title, school] = submission.body.split("\n");
      expect(title).toMatch(/^\*.+\*$/);
      expect(school).toBe(submission.language === "hi" ? "श्री वीर पत्ता सी. सै. स्कूल" : "Shri Veer Patta Sr. Sec. School");
      // Never an announcement: no price, offer or link in the words.
      expect(submission.body).not.toMatch(/https?:|offer|discount|₹/i);
    }
    expect(CHAT_TEMPLATE_PARAMS).toEqual({ openOne: 2, schoolMessage: 2 });
  });

  it("give staff one button, Open chats, to their Chats through a one-tap link, and name it in the words", () => {
    for (const language of ["hi", "en"] as const) {
      const submission = byName.get(OPEN_ONE_TEMPLATE[language])!;
      expect(submission.buttons).toEqual([{ type: "URL", text: OPEN_ONE_BUTTON_LABEL[language], url: OPEN_ONE_BUTTON_URL }]);
      expect(OPEN_ONE_BUTTON_LABEL[language].length).toBeLessThanOrEqual(25);
      expect(submission.body).toContain(OPEN_ONE_BUTTON_LABEL[language]);
    }
    // Only the link's code changes: the address is the school's own, ending in the blank.
    expect(OPEN_ONE_BUTTON_URL).toBe("https://one.vpps.co.in/go/{{1}}");
  });

  it("give a parent no button: they read the message by replying", () => {
    for (const language of ["hi", "en"] as const) {
      const submission = byName.get(SCHOOL_MESSAGE_TEMPLATE[language])!;
      expect(submission.buttons).toEqual([]);
      expect(submission.body).toContain(language === "hi" ? "उत्तर दें" : "Reply to this message");
    }
  });

  it("are on the list the hub carries, each held to its own wording", () => {
    const expected = hubExpectedBodies();
    for (const submission of CHAT_HUB_SUBMISSIONS) {
      expect(HUB_TEMPLATE_SUBMISSIONS).toContainEqual(submission);
      expect(expected.get(submission.name)).toBe(submission.body);
    }
  });
});

describe("the school message's blanks (D-616)", () => {
  it("go in Hindi for Hindi and Hinglish readers, English for English", () => {
    expect(templateLanguageOf("hi")).toBe("hi");
    expect(templateLanguageOf("hx")).toBe("hi");
    expect(templateLanguageOf("en")).toBe("en");
  });

  it("say who wrote, as the parent knows them", () => {
    expect(speakerSubject({ kind: "class_teacher", name: "Anita Test" }, "en")).toBe("Class teacher Anita Test");
    expect(speakerSubject({ kind: "class_teacher", name: "Anita Test" }, "hi")).toBe("कक्षा अध्यापक Anita Test");
    expect(speakerSubject({ kind: "accounts" }, "en")).toBe("The school's accounts office");
    expect(speakerSubject({ kind: "principal" }, "hi")).toBe("प्रधानाचार्य कार्यालय");
    expect(speakerSubject({ kind: "office" }, "en")).toBe("The school office");
  });

  it("name the child, or say 'your child' when none is known", () => {
    expect(schoolMessageParams({ kind: "accounts" }, "Aarav", "en")).toEqual(["The school's accounts office", "Aarav"]);
    expect(schoolMessageParams({ kind: "office" }, null, "en")).toEqual(["The school office", "your child"]);
    expect(schoolMessageParams({ kind: "office" }, "  ", "hx")).toEqual(["स्कूल ऑफ़िस", "आपके बच्चे"]);
  });

  it("stay on one line and within a blank's length", () => {
    const [who, child] = schoolMessageParams({ kind: "class_teacher", name: `Anita\n${"B".repeat(80)}` }, "C".repeat(60), "en");
    expect(who).not.toMatch(/\n/);
    expect(who!.length).toBe(60);
    expect(who!.endsWith("…")).toBe(true);
    expect(child!.length).toBe(40);
    expect(child!.endsWith("…")).toBe(true);
  });
});
