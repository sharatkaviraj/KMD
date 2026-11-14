import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/assist/data/settings", () => ({ getAssistSettings: vi.fn() }));
vi.mock("@/modules/whatsapp/data/helper-claude", () => ({ askHelperClaude: vi.fn(), hasClaudeKey: vi.fn(() => false) }));
vi.mock("@/modules/whatsapp/data/helper-store", () => ({
  finishTurn: vi.fn(),
  insertHandoff: vi.fn(),
  pickHandoffStaff: vi.fn(),
  readBudget: vi.fn(),
  readChat: vi.fn(),
  readChildFacts: vi.fn(),
  readHelperSettings: vi.fn(),
  saveChat: vi.fn(),
  startTurn: vi.fn(),
}));
vi.mock("@/modules/whatsapp/data/parent-suggestions", () => ({ addParentSuggestion: vi.fn() }));
vi.mock("@/platform/whatsapp/store", () => ({ readSwitches: vi.fn() }));
const log = vi.hoisted(() => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/platform/observability/log", () => log);

import type { ReportCard } from "@/modules/assessments/domain/report-card";
import type { TurnFinish } from "@/modules/whatsapp/data/helper-store";
import { prepareHelperReportCard, type ReportCardDeps, type ReportCardRequest } from "@/modules/whatsapp/data/helper-report-card";
import { runHelperTurn, type HelperDeps } from "@/modules/whatsapp/data/helper-turn";
import { factsText, planFromAnswer, type HelperAnswer } from "@/modules/whatsapp/domain/helper-ai";
import { cardExamCodes, cardReleased, childFactsFromRow, sendableCard, type ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import type { HelperMessage } from "@/modules/whatsapp/domain/helper-messages";
import { EMPTY_CHAT, MAX_REPORT_CARDS_PER_ASK, planTurn, resultsAsk, type ChatState, type PlanInput } from "@/modules/whatsapp/domain/helper-plan";
import { resultsCard, type Family, type ReplyContext } from "@/modules/whatsapp/domain/helper-replies";
import { helperId, readTap, ruleIntent } from "@/modules/whatsapp/domain/helper-text";
import type { WhatsAppConfig } from "@/platform/whatsapp/config";
import type { ClaimResult, ProviderSendResult } from "@/platform/whatsapp/providers";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";

/**
 * A parent asking Veer Patta AI for results, and getting each child's report
 * card as its PDF (D-613): only a card the school issued, only once every
 * exam on it is released, and the day results come when they are not out.
 * Every name and number here is made up (rule 6).
 */

const TODAY = "2026-11-14";
const NOW = new Date("2026-11-14T06:30:00Z");
const OWNER = "+919000000001";
const AARAV_ID = "11111111-1111-4111-8111-111111111111";
const MIRA_ID = "33333333-3333-4333-8333-333333333333";
const NEEL_ID = "44444444-4444-4444-8444-444444444444";

const SUBJECTS = [
  { name: "Maths", name_hi: "गणित", code: "MATH", max: 60, value: "54.0000", absent: false, exempt: false },
  { name: "Hindi", name_hi: "हिंदी", code: "HIN", max: 60, value: 21, absent: false, exempt: false },
  { name: "English", name_hi: "अंग्रेज़ी", code: "ENG", max: 60, value: 45, absent: false, exempt: false },
];

const ISSUED = {
  revision: 2,
  percent: 82.4,
  grade: "A2",
  status: "complete",
  passed: true,
  rank: 3,
  rank_of: 32,
  strengths: ["MATH"],
  focus: ["HIN"],
  trend: "up",
  growth: 6.2,
  codes: ["FA1", "SA1"],
};

function child(id: string, name: string, className: string, over: Record<string, unknown> = {}): ChildFacts {
  return childFactsFromRow({
    today: TODAY,
    student: { id, full_name: name, class_id: "c", status: "active", session_label: "TEST-2026-27", class_name: className, section: null, stream_name: null },
    installments: [],
    receipts: [],
    attendance: null,
    days: [],
    results: [],
    released_codes: [],
    pending_results: [],
    class_teacher: { staff_id: "22222222-2222-4222-8222-222222222222", name: "TEST Teacher One", is_test: true },
    calendar: [],
    ...over,
  }) as ChildFacts;
}

/** Half yearly released for the class, and the Term 1 card issued with both Term 1 exams on it. */
const aarav = child(AARAV_ID, "AARAV TEST KUMAR", "Class 6", {
  results: [{ label: "Half yearly", label_hi: "अर्धवार्षिक", term: "Term 1", code: "SA1", subjects: SUBJECTS, card: ISSUED }],
  released_codes: ["FA1", "SA1"],
});
/** Also a card, for two children. */
const mira = child(MIRA_ID, "MIRA TEST DEVI", "Class 1", {
  results: [{ label: "Half yearly", label_hi: "अर्धवार्षिक", term: "Term 1", code: "SA1", subjects: SUBJECTS, card: { ...ISSUED, rank: 1, strengths: [], focus: [], trend: "steady" } }],
  released_codes: ["FA1", "SA1"],
});
/** Sat the Half Yearly; its results are shared on Saturday 21 Nov. */
const neel = child(NEEL_ID, "NEEL TEST", "Class 2", {
  pending_results: [{ label: "Half yearly", label_hi: "अर्धवार्षिक परीक्षा", term: "Term 1", results_on: "2026-11-25", publish_at: "2026-11-20T20:30:00+00:00" }],
});

const RETURNING: ChatState = { ...EMPTY_CHAT, language: "en", greetedAt: "2026-11-14T04:00:00.000Z", lastTurnAt: "2026-11-14T04:00:00.000Z" };

function context(family: Family, language: ReplyContext["language"] = "en"): ReplyContext {
  return { language, helperName: "Veer Patta AI", family, firstContact: false };
}

function plan(over: Partial<PlanInput>) {
  return planTurn({
    kind: "text",
    text: "",
    tap: null,
    chat: RETURNING,
    family: { children: [aarav], practice: true },
    helperName: "Veer Patta AI",
    now: NOW,
    aiAvailable: true,
    ...over,
  });
}

function bodyOf(message: HelperMessage | null | undefined): string {
  if (!message) return "";
  return message.kind === "buttons" || message.kind === "list" ? message.body : message.kind === "text" ? message.text : message.caption;
}

/* -------------------------------------------------------------- the facts */

describe("what the records say about a report card (D-613)", () => {
  it("reads the issued card, the released exams and the exams still to come", () => {
    const result = aarav.results[0];
    expect(result).toMatchObject({ exam: "Half yearly", code: "SA1", term: "Term 1", got: 120, max: 180 });
    expect(result.subjects.map((subject) => subject.code)).toEqual(["MATH", "HIN", "ENG"]);
    expect(result.card).toEqual({
      revision: 2,
      percent: 82.4,
      grade: "A2",
      status: "complete",
      passed: true,
      rank: 3,
      rankOf: 32,
      strengths: ["MATH"],
      focus: ["HIN"],
      trend: "up",
      growth: 6.2,
      codes: ["FA1", "SA1"],
    });
    expect(aarav.releasedCodes).toEqual(["FA1", "SA1"]);
    // A release time is the day it falls on in India: 20:30 UTC on the 20th is the 21st there.
    expect(neel.pendingResults).toEqual([{ exam: "Half yearly", examHi: "अर्धवार्षिक परीक्षा", on: "2026-11-21" }]);
  });

  it("never takes something that is not an issued card for one", () => {
    for (const card of [null, "card", [], { revision: 0 }, { percent: 90 }]) {
      const facts = child(AARAV_ID, "AARAV TEST", "Class 6", { results: [{ label: "Half yearly", term: "Term 1", code: "SA1", subjects: SUBJECTS, card }], released_codes: ["SA1"] });
      expect(facts.results[0].card).toBeNull();
      expect(sendableCard(facts)).toBeNull();
    }
  });

  it("sends a card only when every exam on it is released for the class", () => {
    expect(sendableCard(aarav)).toMatchObject({ term: "Term 1", card: { revision: 2 } });
    // Reissued after a later exam whose results are not out: it waits.
    const early = child(AARAV_ID, "AARAV TEST", "Class 6", {
      results: [{ label: "Half yearly", term: "Term 1", code: "SA1", subjects: SUBJECTS, card: { ...ISSUED, codes: ["FA1", "SA1", "UT2"] } }],
      released_codes: ["FA1", "SA1"],
    });
    expect(sendableCard(early)).toBeNull();
    // A card that names no exam is never one to send; nor one with no term.
    expect(cardReleased([], ["SA1"])).toBe(false);
    const termless = child(AARAV_ID, "AARAV TEST", "Class 6", { results: [{ label: "Half yearly", code: "SA1", subjects: SUBJECTS, card: ISSUED }], released_codes: ["FA1", "SA1"] });
    expect(sendableCard(termless)).toBeNull();
  });

  it("reads the exams a card carries from every row, the rows printed apart too", () => {
    const rows = [
      { marks: [{ assessmentCode: "SA1" }, { assessmentCode: "FA1" }] },
      { marks: [{ assessmentCode: "FA1" }] },
    ];
    expect(cardExamCodes({ rows, apart: [{ marks: [{ assessmentCode: "ROBO" }] }] })).toEqual(["FA1", "ROBO", "SA1"]);
    expect(cardExamCodes({ rows: null })).toEqual([]);
  });
});

/* -------------------------------------------------------------- the words */

describe("the results a parent is sent (D-613)", () => {
  it("sends the issued card as a PDF with its one line under it", () => {
    const asked = resultsAsk(context({ children: [aarav], practice: true }));
    expect(asked.intent).toBe("report_card");
    expect(asked.trailing).toBeNull();
    expect(asked.reportCards).toHaveLength(1);
    const [card] = asked.reportCards;
    expect(card).toMatchObject({ term: "Term 1", revision: 2, releasedCodes: ["FA1", "SA1"], title: { en: "Half yearly", hi: "अर्धवार्षिक" } });
    expect(card.child.studentId).toBe(AARAV_ID);
    expect(card.caption).toContain("📄 *Report card · Half yearly*");
    expect(card.caption).toContain("*Aarav* · Class 6");
    expect(card.caption).toContain("*82.4%* · Grade A2 · Rank 3 of 32 · 📈 Improving");
    expect(card.caption).toContain("Best in Maths · More practice in Hindi");
    expect(card.caption).toContain("Practice: test records");
    // The words for when the PDF cannot be sent are the message, with the card's line and a button to try again.
    expect(asked.message).toBe(card.unsent);
    expect(bodyOf(card.unsent)).toContain("could not be sent");
    expect(bodyOf(card.unsent)).toContain("*82.4%* · Grade A2");
    expect(card.unsent.kind === "buttons" ? card.unsent.buttons[0].id : null).toBe(helperId("report_card", aarav.key));
  });

  it("speaks Hindi and Hinglish, neutral about the child", () => {
    const hindi = resultsAsk(context({ children: [aarav], practice: true }, "hi")).reportCards[0].caption;
    expect(hindi).toContain("📄 *प्रगति पत्र · अर्धवार्षिक*");
    expect(hindi).toContain("ग्रेड A2 · कक्षा में स्थान 3/32 · 📈 सुधार");
    expect(hindi).toContain("सबसे अच्छा: गणित · और अभ्यास: हिंदी");
    const hinglish = resultsAsk(context({ children: [aarav], practice: true }, "hx")).reportCards[0].caption;
    expect(hinglish).toContain("Class mein rank 3/32");
    expect(hinglish).toContain("Sabse achha: Maths · Aur abhyaas: Hindi");
  });

  it("says a result held back is pending, never a percentage for it", () => {
    const held = child(AARAV_ID, "AARAV TEST", "Class 6", {
      results: [{ label: "Half yearly", term: "Term 1", code: "SA1", subjects: SUBJECTS, card: { ...ISSUED, status: "pending", percent: null, grade: null } }],
      released_codes: ["FA1", "SA1"],
    });
    const caption = resultsAsk(context({ children: [held], practice: true })).reportCards[0].caption;
    expect(caption).toContain("Result pending");
    expect(caption).not.toContain("%");
  });

  it("sends two children's two cards, and the other children's results after them", () => {
    const both = resultsAsk(context({ children: [aarav, mira], practice: true }));
    expect(both.reportCards.map((item) => item.child.firstName)).toEqual(["Aarav", "Mira"]);
    expect(both.trailing).toBeNull();
    // Only the first says who the helper is.
    const first = resultsAsk({ ...context({ children: [aarav, mira], practice: true }), firstContact: true });
    expect(first.reportCards[0].caption).toContain("Veer Patta AI");
    expect(first.reportCards[1].caption).not.toContain("Veer Patta AI");

    const mixed = resultsAsk(context({ children: [aarav, neel], practice: true }));
    expect(mixed.reportCards.map((item) => item.child.firstName)).toEqual(["Aarav"]);
    expect(bodyOf(mixed.trailing)).toContain("*Neel* · Class 2");
    expect(bodyOf(mixed.trailing)).toContain("Half yearly results are not out yet. They are shared on *Sat 21 Nov*.");
    expect(bodyOf(mixed.trailing)).not.toContain("Aarav");
  });

  it("sends at most three cards in one go", () => {
    const four = [aarav, mira, { ...aarav, key: "kkkkkkk", firstName: "Kabir" }, { ...mira, key: "zzzzzzz", firstName: "Zoya" }];
    const asked = resultsAsk(context({ children: four, practice: true }));
    expect(asked.reportCards).toHaveLength(MAX_REPORT_CARDS_PER_ASK);
    expect(bodyOf(asked.trailing)).toContain("*Zoya*");
  });

  it("before results are out, says the day the plan gives, or that they come soon", () => {
    expect(bodyOf(resultsCard(context({ children: [neel], practice: true })))).toContain("They are shared on *Sat 21 Nov*.");
    expect(bodyOf(resultsCard(context({ children: [neel], practice: true }, "hi"))))
      .toContain("अर्धवार्षिक परीक्षा का परिणाम अभी जारी नहीं हुआ। यह *शनिवार, 21 नवंबर* को दिया जाएगा।");
    const passed = child(NEEL_ID, "NEEL TEST", "Class 2", { pending_results: [{ label: "Half yearly", label_hi: null, results_on: "2026-10-17", publish_at: null }] });
    expect(bodyOf(resultsCard(context({ children: [passed], practice: true })))).toContain("Half yearly results are not out yet. The school will share them soon.");
    // The school released the exam this morning for the classes it locked; this class is not one, so no day is promised.
    const releasedElsewhere = child(NEEL_ID, "NEEL TEST", "Class 2", { pending_results: [{ label: "Half yearly", label_hi: null, results_on: "2026-11-25", publish_at: "2026-11-14T03:00:00+00:00" }] });
    expect(bodyOf(resultsCard(context({ children: [releasedElsewhere], practice: true })))).toContain("Half yearly results are not out yet. The school will share them soon.");
    const undated = child(NEEL_ID, "NEEL TEST", "Class 2", { pending_results: [{ label: "Half yearly", label_hi: null, results_on: null, publish_at: null }] });
    expect(bodyOf(resultsCard(context({ children: [undated], practice: true }, "hx")))).toContain("Half yearly ka result abhi jari nahi hua. School jald hi dega.");
    const nothing = child(NEEL_ID, "NEEL TEST", "Class 2");
    expect(bodyOf(resultsCard(context({ children: [nothing], practice: true })))).toContain("No results have been released yet.");
  });

  it("shows a released exam's marks when no card is issued yet, and sends no file", () => {
    const marksOnly = child(AARAV_ID, "AARAV TEST", "Class 6", { results: [{ label: "Half yearly", term: "Term 1", code: "SA1", subjects: SUBJECTS }], released_codes: ["SA1"] });
    const asked = resultsAsk(context({ children: [marksOnly], practice: true }));
    expect(asked).toMatchObject({ intent: "results", reportCards: [], trailing: null });
    expect(bodyOf(asked.message)).toContain("Maths 54/60 · Hindi 21/60 · English 45/60");
  });
});

/* -------------------------------------------------------------- the plan */

describe("when the report card goes (D-613)", () => {
  it("goes at once for results asked in words, in any spelling", () => {
    for (const text of ["result bhejo", "report card", "रिजल्ट", "Marks"]) {
      expect(ruleIntent(text)).toBe("results");
      const turn = plan({ text });
      expect(turn).toMatchObject({ action: "reply", intent: "report_card", route: "rule" });
      expect(turn.action === "reply" ? turn.reportCards?.map((item) => item.child.studentId) : null).toEqual([AARAV_ID]);
    }
  });

  it("goes for the menu's Results, and Try again sends that child's card only", () => {
    const family: Family = { children: [aarav, mira], practice: true };
    const menu = plan({ kind: "tap", text: null, tap: { intent: "results", key: null }, family });
    expect(menu.action === "reply" ? menu.reportCards?.length : null).toBe(2);
    const again = plan({ kind: "tap", text: null, tap: readTap({ type: "interactive", interactive: { button_reply: { id: helperId("report_card", mira.key) } } }), family });
    expect(again).toMatchObject({ action: "reply", intent: "report_card", route: "tap" });
    expect(again.action === "reply" ? again.reportCards?.map((item) => item.child.firstName) : null).toEqual(["Mira"]);
    // "Try again" always names its child.
    expect(readTap({ type: "interactive", interactive: { button_reply: { id: "vpai:report_card" } } })).toBeNull();
  });

  it("goes for Get report card on the results notice: that child's card only (D-614)", () => {
    const family: Family = { children: [aarav, mira], practice: true };
    const raw = { type: "button", button: { payload: helperId("report_card", mira.key), text: "Get report card" } };
    const turn = plan({ kind: "tap", text: "Get report card", tap: readTap(raw), family });
    expect(turn).toMatchObject({ action: "reply", intent: "report_card", route: "tap" });
    expect(turn.action === "reply" ? turn.reportCards?.map((item) => item.child.firstName) : null).toEqual(["Mira"]);
    // The Hindi button's words alone are a result ask: every child's card.
    const words = plan({ text: "रिपोर्ट कार्ड भेजें", family });
    expect(words.action === "reply" ? words.reportCards?.length : null).toBe(2);
  });

  it("sends the results card, not a file, when no card can go", () => {
    const turn = plan({ text: "result", family: { children: [neel], practice: true } });
    expect(turn).toMatchObject({ action: "reply", intent: "results" });
    expect(turn.action === "reply" ? turn.reportCards : "x").toBeUndefined();
  });

  it("puts Claude's words above the first card when Claude shows results", () => {
    const answer: HelperAnswer = { language: "en", topic: "results", reply: "Here is Aarav's report card 🙏", show: "results", handoff: "none", child: null, needs_care: false, summary: null, absence: null, change: null, receipt_pdf: null, school_answer: null, unanswered: null };
    const turn = planFromAnswer(answer, { family: { children: [aarav, neel], practice: true }, helperName: "Veer Patta AI", text: "half yearly ka result?", now: NOW });
    expect(turn.intent).toBe("report_card");
    expect(turn.reportCards?.[0].caption.startsWith("Here is Aarav's report card 🙏")).toBe(true);
    expect(bodyOf(turn.trailing)).toContain("*Neel*");
    // Without a card, Claude's words go above the results card.
    const none = planFromAnswer(answer, { family: { children: [neel], practice: true }, helperName: "Veer Patta AI", text: "result?", now: NOW });
    expect(none.reportCards).toBeUndefined();
    expect(bodyOf(none.message).startsWith("Here is Aarav's report card 🙏")).toBe(true);
  });

  it("tells Claude which card is issued and when results come, never a mark still being entered", () => {
    const facts = factsText({ children: [aarav, neel], practice: true }, NOW);
    expect(facts).toContain("Report card issued for Term 1: it is sent as a PDF with the results card.");
    expect(facts).toContain("Results not out yet: Half yearly (shared on 2026-11-21).");
  });
});

/* ------------------------------------------------------- making the PDF */

function issuedCard(over: Partial<ReportCard> = {}): ReportCard {
  return {
    sessionLabel: "TEST-2026-27",
    term: "Term 1",
    studentId: AARAV_ID,
    studentName: "AARAV TEST KUMAR",
    rows: [{ subjectCode: "MATH", marks: [{ assessmentCode: "FA1" }, { assessmentCode: "SA1" }] }],
    ...over,
  } as unknown as ReportCard;
}

function request(over: Partial<ReportCardRequest> = {}): ReportCardRequest {
  return {
    studentId: AARAV_ID,
    sessionLabel: "TEST-2026-27",
    term: "Term 1",
    revision: 2,
    releasedCodes: ["FA1", "SA1"],
    title: { en: "Half yearly", hi: "अर्धवार्षिक" },
    classTeacher: "TEST Teacher One",
    practice: true,
    ...over,
  };
}

function cardDeps(over: Partial<ReportCardDeps> = {}): { deps: ReportCardDeps; rendered: unknown[]; stored: unknown[] } {
  const rendered: unknown[] = [];
  const stored: unknown[] = [];
  const deps: ReportCardDeps = {
    readIssued: async () => ({ revision: 2, card: issuedCard() }),
    render: async (input) => {
      rendered.push(input);
      return new Uint8Array([37, 80, 68, 70]);
    },
    store: async (input) => {
      stored.push(input);
      return { signedUrl: "https://files.example.test/card.pdf?token=t" };
    },
    ...over,
  };
  return { deps, rendered, stored };
}

describe("the report card's PDF (D-613)", () => {
  it("makes the issued card, puts it on the shelf and names it for the parent", async () => {
    const { deps, rendered, stored } = cardDeps();
    expect(await prepareHelperReportCard(request(), deps)).toEqual({
      link: "https://files.example.test/card.pdf?token=t",
      filename: "Report-Card-Half-yearly-AARAV-TEST-KUMAR.pdf",
    });
    expect(rendered).toHaveLength(1);
    expect(stored).toEqual([{ sessionLabel: "TEST-2026-27", id: `${AARAV_ID}-Term 1`, pdf: new Uint8Array([37, 80, 68, 70]) }]);
  });

  it("makes nothing for a real year or a real family, while the helper practises", async () => {
    const { deps, rendered } = cardDeps();
    expect(await prepareHelperReportCard(request({ practice: false }), deps)).toBeNull();
    expect(await prepareHelperReportCard(request({ sessionLabel: "2026-27" }), deps)).toBeNull();
    expect(await prepareHelperReportCard(request({ studentId: "not-a-child" }), deps)).toBeNull();
    expect(rendered).toHaveLength(0);
  });

  it("makes nothing from a card reissued since, or one with an exam not released", async () => {
    const reissued = cardDeps({ readIssued: async () => ({ revision: 3, card: issuedCard() }) });
    expect(await prepareHelperReportCard(request(), reissued.deps)).toBeNull();
    const early = cardDeps({ readIssued: async () => ({ revision: 2, card: issuedCard({ apart: [{ marks: [{ assessmentCode: "UT2" }] }] } as Partial<ReportCard>) }) });
    expect(await prepareHelperReportCard(request(), early.deps)).toBeNull();
    const none = cardDeps({ readIssued: async () => null });
    expect(await prepareHelperReportCard(request(), none.deps)).toBeNull();
    expect([...reissued.rendered, ...early.rendered, ...none.rendered]).toHaveLength(0);
  });

  it("never throws: a render or a shelf that fails is null", async () => {
    expect(await prepareHelperReportCard(request(), cardDeps({ render: async () => Promise.reject(new Error("font")) }).deps)).toBeNull();
    expect(await prepareHelperReportCard(request(), cardDeps({ render: async () => new Uint8Array() }).deps)).toBeNull();
    expect(await prepareHelperReportCard(request(), cardDeps({ store: async () => null }).deps)).toBeNull();
    expect(log.logWarn).toHaveBeenCalledWith("whatsapp.helper.report_card_failed", { error: "font" });
  });
});

/* ------------------------------------------------------------- the turn */

const HUB: WhatsAppConfig = { ok: true, provider: "hub", hubUrl: "https://hub.example.test", hubKey: "k", senderNumber: "+918302207823" };
const CLAIMED: ClaimResult = { ok: true, claimed: true, typing: true, staff: false, stale: false, takenBy: null };
const MADE = { link: "https://files.example.test/card.pdf?token=t", filename: "Report-Card-Half-yearly-AARAV-TEST-KUMAR.pdf" };

function inbound(text: string): WebhookInbound {
  return { providerMessageId: "wamid.TEST1", from: OWNER, fromName: "TEST Parent", type: "text", text, replyTo: null, at: new Date(NOW.getTime() - 3_000).toISOString(), raw: { type: "text" } };
}

function turnDeps(children: ChildFacts[], over: Partial<HelperDeps> = {}): { deps: HelperDeps; sent: Record<string, unknown>[]; finished: TurnFinish[] } {
  const sent: Record<string, unknown>[] = [];
  const finished: TurnFinish[] = [];
  const deps: HelperDeps = {
    now: () => NOW,
    readConfig: () => HUB,
    readSwitches: async () => ({ dryRun: false, features: { parent_helper: true }, realRecipients: false, ownerTestNumber: OWNER, dailyLimit: 250 }),
    readSettings: async () => ({ helperName: "Veer Patta AI", practiceStudentIds: children.map((item) => item.studentId) }),
    readChildFacts: async () => children,
    readChat: async () => RETURNING,
    saveChat: async () => undefined,
    readBudget: async () => ({ spentUsd: 0, turnsToday: 1 }),
    readAiSettings: async () => ({ enabled: true, monthlyBudgetUsd: 25 }),
    hasClaudeKey: () => false,
    askClaude: vi.fn(),
    startTurn: async () => "started",
    finishTurn: async (_id, finish) => {
      finished.push(finish);
    },
    claim: async () => CLAIMED,
    send: async (body): Promise<ProviderSendResult> => {
      sent.push(body);
      return { outcome: "accepted", messageId: `wamid.REPLY${sent.length}`, httpStatus: 200 };
    },
    pickHandoffStaff: async () => null,
    insertHandoff: async () => null,
    ...over,
  };
  return { deps, sent, finished };
}

describe("a report card in the chat (D-613)", () => {
  it("sends each child's card as a document, then the other children's results", async () => {
    const asks: ReportCardRequest[] = [];
    const { deps, sent, finished } = turnDeps([aarav, neel], {
      prepareReportCard: async (input) => {
        asks.push(input);
        return MADE;
      },
    });
    expect(await runHelperTurn(inbound("result bhejo"), deps)).toEqual({ outcome: "answered", route: "rule", intent: "report_card", handoff: null });
    expect(asks).toEqual([
      {
        studentId: AARAV_ID,
        sessionLabel: "TEST-2026-27",
        term: "Term 1",
        revision: 2,
        releasedCodes: ["FA1", "SA1"],
        title: { en: "Half yearly", hi: "अर्धवार्षिक" },
        classTeacher: "TEST Teacher One",
        practice: true,
      },
    ]);
    expect(sent.map((body) => body.type)).toEqual(["document", "interactive"]);
    expect(sent[0].document).toMatchObject({ link: MADE.link, filename: MADE.filename });
    expect(String((sent[0].document as { caption: string }).caption)).toContain("*82.4%* · Grade A2");
    expect(JSON.stringify(sent[1])).toContain("Neel");
    expect(finished[0]).toMatchObject({ status: "answered", intent: "report_card", reason: null, replyMessageId: "wamid.REPLY1" });
    expect(finished[0].stages?.reportCard).toBe(0);
  });

  it("sends the card for a tap on the results notice's Get report card (D-614)", async () => {
    const asks: ReportCardRequest[] = [];
    const { deps, sent } = turnDeps([aarav], {
      prepareReportCard: async (input) => {
        asks.push(input);
        return MADE;
      },
    });
    const message: WebhookInbound = {
      ...inbound("Get report card"),
      type: "button",
      raw: { type: "button", button: { payload: helperId("report_card", aarav.key), text: "Get report card" } },
    };
    expect(await runHelperTurn(message, deps)).toEqual({ outcome: "answered", route: "tap", intent: "report_card", handoff: null });
    expect(asks.map((ask) => ask.studentId)).toEqual([AARAV_ID]);
    expect(sent.map((body) => body.type)).toEqual(["document"]);
  });

  it("says the card could not be sent, with its line and Try again, when the PDF cannot be made", async () => {
    for (const prepareReportCard of [async () => null, async () => Promise.reject(new Error("down")), undefined]) {
      const { deps, sent, finished } = turnDeps([aarav], { prepareReportCard });
      expect(await runHelperTurn(inbound("report card"), deps)).toMatchObject({ outcome: "answered", intent: "report_card" });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ type: "interactive" });
      expect(JSON.stringify(sent[0])).toContain("could not be sent");
      expect(JSON.stringify(sent[0])).toContain(helperId("report_card", aarav.key));
      expect(finished[0]).toMatchObject({ status: "answered", reason: "report_card_not_made" });
    }
  });

  it("makes no PDF for results not out yet", async () => {
    const prepareReportCard = vi.fn(async () => MADE);
    const { deps, sent } = turnDeps([neel], { prepareReportCard });
    expect(await runHelperTurn(inbound("result"), deps)).toMatchObject({ outcome: "answered", intent: "results" });
    expect(prepareReportCard).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain("Sat 21 Nov");
  });
});
