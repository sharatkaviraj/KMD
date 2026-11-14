import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { childKey } from "@/modules/whatsapp/domain/helper-facts";
import { WA_LIMITS } from "@/modules/whatsapp/domain/helper-messages";
import { messageKind, readTap, ruleIntent } from "@/modules/whatsapp/domain/helper-text";
import { readNoteTap } from "@/modules/whatsapp/domain/helper-away-note";
import { HUB_TEMPLATE_SUBMISSIONS, hubExpectedBodies } from "@/modules/whatsapp/domain/hub-templates";
import {
  REPORT_CARD_BUTTON,
  REPORT_CARD_NOTICE_HUB_SUBMISSIONS,
  REPORT_CARD_NOTICE_PARAMS,
  REPORT_CARD_NOTICE_TEMPLATE,
  reportCardNoticeKey,
  reportCardNoticeLanguage,
  reportCardNoticeParams,
  reportCardNoticePayloads,
  reportCardNoticeText,
} from "@/modules/whatsapp/domain/report-card-notice";
import { readStaffAsk } from "@/modules/whatsapp/domain/staff-words";

/**
 * "Results are out" with a Get report card button (D-614; the owner, 14 Nov
 * 2026: "Yes get it for approval"): what goes to Meta, the registry rows it
 * is held to, and what a parent's tap on it says back. Made-up names only
 * (rule 6).
 */

const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261114082332_parent_report_card_notice.sql"), "utf8");
const SEED = /^\s*\('([a-z0-9_]+)', '([a-z0-9_]+)', '(hi|en)', '([a-z_]+)', (\d+), array\[([^\]]*)\]::text\[\], '(none|document)', (true|false), /gm;
const seeded = new Map([...MIGRATION.matchAll(SEED)].map((match) => [match[1]!, { provider: match[2]!, language: match[3]!, feature: match[4]!, params: Number(match[5]), urlButton: match[8] === "true" }]));

const STUDENT = "11111111-1111-4111-8111-111111111111";
const placeholders = (body: string) => [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
const quickReply = (payload: string, text: string) => ({ type: "button", button: { payload, text } });

describe("the notice Meta is asked to approve (D-614)", () => {
  it("is one Hindi and one English copy, UTILITY, each with a Get report card quick reply", () => {
    expect(REPORT_CARD_NOTICE_HUB_SUBMISSIONS.map((submission) => [submission.name, submission.language])).toEqual([
      ["vpps_parent_report_card_hi_v1", "hi"],
      ["vpps_parent_report_card_en_v1", "en"],
    ]);
    for (const submission of REPORT_CARD_NOTICE_HUB_SUBMISSIONS) {
      expect(submission.category).toBe("UTILITY");
      const language = submission.language as "hi" | "en";
      expect(submission.buttons).toEqual([{ type: "QUICK_REPLY", text: REPORT_CARD_BUTTON[language] }]);
      expect(REPORT_CARD_BUTTON[language].length).toBeLessThanOrEqual(WA_LIMITS.buttonTitle);
      // The body tells the parent which button to press, in its own words.
      expect(submission.body).toContain(language === "en" ? "Tap Get report card" : '"रिपोर्ट कार्ड भेजें"');
    }
  });

  it("has the shape Meta checks before it reads the words", () => {
    for (const submission of REPORT_CARD_NOTICE_HUB_SUBMISSIONS) {
      const found = placeholders(submission.body);
      expect(found).toEqual([1, 2, 3]);
      expect(submission.examples).toHaveLength(REPORT_CARD_NOTICE_PARAMS);
      expect(submission.body).not.toMatch(/^\s*\{\{\d+\}\}/);
      expect(submission.body).not.toMatch(/\{\{\d+\}\}\s*$/);
      expect(submission.body).not.toMatch(/\}\}\s*\{\{/);
      expect(submission.body.length).toBeLessThanOrEqual(1024);
      for (const example of submission.examples) expect(example.trim()).not.toBe("");
      // A notice about one child, never an announcement: no price, offer or link.
      expect(submission.body).not.toMatch(/https?:|offer|discount|admission|₹/i);
      expect(submission.body.split("\n")[0]).toMatch(/^\*.+\*$/);
    }
  });

  it("is on the list the hub carries, held to its own wording", () => {
    const expected = hubExpectedBodies();
    for (const submission of REPORT_CARD_NOTICE_HUB_SUBMISSIONS) {
      expect(HUB_TEMPLATE_SUBMISSIONS).toContainEqual(submission);
      expect(expected.get(submission.name)).toBe(submission.body);
    }
  });

  it("has a registry row each, under Report cards, with three blanks and no link button", () => {
    for (const language of ["hi", "en"] as const) {
      const name = REPORT_CARD_NOTICE_TEMPLATE[language];
      expect(seeded.get(name)).toEqual({ provider: name, language, feature: "report_delivery", params: 3, urlButton: false });
    }
    expect(MIGRATION).toMatch(/on conflict \(key\) do nothing/);
    expect(MIGRATION).not.toMatch(/\b(delete|drop|truncate)\b/i);
  });
});

describe("the blanks and the button's payload (D-614)", () => {
  it("fills the child, the class and the exam, never empty and on one line", () => {
    expect(reportCardNoticeParams({ studentName: "Aarav Test", className: "Class 6", exam: "Half yearly" })).toEqual(["Aarav Test", "Class 6", "Half yearly"]);
    expect(reportCardNoticeParams({ studentName: "  ", className: "Class\n6", exam: "" })).toEqual(["-", "Class 6", "-"]);
    const long = reportCardNoticeParams({ studentName: "A".repeat(80), className: "Class 6", exam: "Half yearly" })[0]!;
    expect(long.length).toBe(60);
    expect(long.endsWith("…")).toBe(true);
  });

  it("names the child, as Try again under a card does", () => {
    const [payload] = reportCardNoticePayloads(STUDENT);
    expect(payload).toBe(`vpai:report_card:${childKey(STUDENT)}`);
    expect(payload!.length).toBeLessThanOrEqual(WA_LIMITS.id);
  });
});

describe("a parent's tap on Get report card (D-614)", () => {
  const [payload] = reportCardNoticePayloads(STUDENT);

  it("is the helper's tap for that child's report card", () => {
    const raw = quickReply(payload!, "Get report card");
    expect(readTap(raw)).toEqual({ intent: "report_card", key: childKey(STUDENT) });
    expect(messageKind("button", raw)).toBe("tap");
    // Never a teacher's Mark Leave / Mark Absent.
    expect(readNoteTap(raw)).toBeNull();
    expect(readNoteTap(quickReply(payload!, "रिपोर्ट कार्ड भेजें"))).toBeNull();
  });

  it("without our payload, is read by its words, which ask for results in either language", () => {
    for (const words of [REPORT_CARD_BUTTON.en, REPORT_CARD_BUTTON.hi]) {
      const raw = quickReply("", words);
      expect(readTap(raw)).toBeNull();
      expect(messageKind("button", raw)).toBe("text");
      expect(ruleIntent(words)).toBe("results");
    }
    // Somebody else's quick reply is words too.
    expect(messageKind("button", quickReply("vpnote:leave:abc", "Mark Leave"))).toBe("text");
  });

  it("goes to the parents' helper whatever role the number is in, while other quick replies stay words for staff", () => {
    expect(readStaffAsk({ type: "button", text: "Get report card", raw: quickReply(payload!, "Get report card") })).toEqual({ kind: "foreign" });
    expect(readStaffAsk({ type: "button", text: "Get report card", raw: quickReply("", "Get report card") }).kind).not.toBe("foreign");
  });
});

describe("the office's Tell parents (D-615)", () => {
  it("writes English to a family that writes English, and Hindi to everyone else", () => {
    expect(reportCardNoticeLanguage("en")).toBe("en");
    for (const language of ["hi", "hx", null, undefined, "xx"]) expect(reportCardNoticeLanguage(language)).toBe("hi");
  });

  it("previews the very words Meta was asked to approve, blanks filled", () => {
    for (const submission of REPORT_CARD_NOTICE_HUB_SUBMISSIONS) {
      const language = submission.language as "hi" | "en";
      const text = reportCardNoticeText(language, ["Aarav Test", "Class 6", "Half Yearly"]);
      expect(text).toBe(submission.body.replace("{{1}}", "Aarav Test").replace("{{2}}", "Class 6").replace("{{3}}", "Half Yearly"));
      expect(text).not.toMatch(/\{\{\d+\}\}/);
    }
  });

  it("tells a child once per issued card, and again after a reissue", () => {
    const key = reportCardNoticeKey({ studentId: STUDENT, term: "Term 1", revision: 2, to: "+919999900001" });
    expect(key).toBe(`results-out:${STUDENT}:Term_1:2:+919999900001`);
    expect(reportCardNoticeKey({ studentId: STUDENT, term: "Term 1", revision: 3, to: "+919999900001" })).not.toBe(key);
    // The board reads the child back out of the key.
    expect(key.split(":")[1]).toBe(STUDENT);
  });

  it("is a button under Exam office → Results, wired to its action", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(app)/exam-office/results/page.tsx"), "utf8");
    const board = readFileSync(join(process.cwd(), "src/vx/screens/exams/results-board.tsx"), "utf8");
    const actions = readFileSync(join(process.cwd(), "src/app/(app)/exam-office/results/actions.ts"), "utf8");
    expect(page).toMatch(/tellParents: tellParentsAction/);
    expect(page).toMatch(/readResultsNoticeBoard\(sessionLabel\)/);
    expect(board).toMatch(/function TellParents\(/);
    expect(board).toMatch(/<TellParents /);
    // The old made-up preview ("… result is attached") is gone: the preview is the approved message.
    expect(board).not.toMatch(/result is attached/);
    expect(actions).toMatch(/export async function tellParentsAction/);
    expect(actions).toMatch(/assertPermission\("assessments:manage"\)[\s\S]*previewRefusal\(\)[\s\S]*sendResultsOutNotices/);
  });
});
