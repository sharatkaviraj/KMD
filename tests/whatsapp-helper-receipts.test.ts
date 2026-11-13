import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const log = vi.hoisted(() => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/platform/observability/log", () => log);

import { prepareHelperReceipt, type ReceiptDeps } from "@/modules/whatsapp/data/helper-receipt";
import { childFactsFromRow, receiptByKey, receiptKey, sendableReceipts, type ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import { fitMessage, helperMessageBody, messageText, plainVersion, WA_LIMITS, type HelperMessage } from "@/modules/whatsapp/domain/helper-messages";
import { helperAnswerSchema, helperSystemPrompt, planFromAnswer, type HelperAnswer } from "@/modules/whatsapp/domain/helper-ai";
import { EMPTY_CHAT, MAX_RECEIPTS_PER_ASK, planTurn, receiptAsk, type PlanInput } from "@/modules/whatsapp/domain/helper-plan";
import { receiptCaption, receiptPickList, receiptsCard, receiptUnsentReply, type Family, type ReplyContext } from "@/modules/whatsapp/domain/helper-replies";
import { detectLanguage, helperId, readTap, ruleIntent } from "@/modules/whatsapp/domain/helper-text";
import { testRecordReadInContext } from "@/platform/fees-bridge/test-record-read";

/**
 * A parent asking Veer Patta AI for a receipt, and getting the PDF in the
 * chat (D-597), at once when asked in words (D-606). Every name and number
 * here is made up (rule 6).
 */

const TODAY = "2026-11-12";
const NOON = new Date("2026-11-12T06:30:00Z");
const AARAV_ID = "11111111-1111-4111-8111-111111111111";
const MIRA_ID = "33333333-3333-4333-8333-333333333333";
const KABIR_ID = "55555555-5555-4555-8555-555555555555";

function child(id: string, name: string, className: string, receipts: unknown[]): ChildFacts {
  return childFactsFromRow({
    today: TODAY,
    student: { id, full_name: name, class_id: "c", status: "active", session_label: "TEST-2026-27", class_name: className, section: null, stream_name: null },
    installments: [],
    receipts,
    attendance: null,
    days: [],
    results: [],
    class_teacher: null,
    calendar: [],
  }) as ChildFacts;
}

const aarav = child(AARAV_ID, "AARAV TEST KUMAR", "Class 6", [
  { number: "TEST-SVP-0002", date: "2026-08-01", amount: 2000, mode: "online", reversed: false },
  { number: "TEST-SVP-0001", date: "2026-04-10", amount: 5000, mode: "cash", reversed: true },
]);
const mira = child(MIRA_ID, "MIRA TEST DEVI", "Class 1", [
  { number: "TEST-SVP-0009", date: "2026-10-05", amount: 9000, mode: "cash", reversed: false },
  { number: "TEST-SVP-0003", date: "2026-07-27", amount: 6000, mode: "upi", reversed: false },
]);
const nobody = child("44444444-4444-4444-8444-444444444444", "NEEL TEST", "Class 2", []);
/** Paid for on the same day as Mira's latest: the two receipts of one visit to the desk. */
const kabir = child(KABIR_ID, "KABIR TEST SINGH", "Class 3", [{ number: "TEST-SVP-0010", date: "2026-10-05", amount: 7000, mode: "cash", reversed: false }]);

const oneChild: Family = { children: [aarav], practice: true };
const twoChildren: Family = { children: [aarav, mira], practice: true };
const paidTogether: Family = { children: [mira, kabir], practice: true };
const threeChildren: Family = { children: [aarav, mira, kabir], practice: true };

function answer(over: Partial<HelperAnswer> = {}): HelperAnswer {
  return { language: "en", topic: "receipts", reply: "Here is your receipt 🙏", show: "none", handoff: "none", child: null, needs_care: false, summary: null, absence: null, change: null, receipt_pdf: { receipts: [] }, school_answer: null, unanswered: null, ...over };
}

function numbersOf(receipts: ReadonlyArray<{ receipt: { number: string } }> | null | undefined): string[] {
  return (receipts ?? []).map(({ receipt }) => receipt.number);
}

function bodyOf(message: HelperMessage): string {
  return message.kind === "buttons" || message.kind === "list" ? message.body : message.kind === "text" ? message.text : message.caption;
}

function context(language: ReplyContext["language"], family: Family = oneChild): ReplyContext {
  return { language, helperName: "Veer Patta AI", family, firstContact: false };
}

function plan(over: Partial<PlanInput>) {
  return planTurn({
    kind: "text",
    text: "",
    tap: null,
    chat: { ...EMPTY_CHAT, greetedAt: "2026-11-12T01:00:00Z", lastTurnAt: "2026-11-12T01:00:00Z", language: "en" },
    family: oneChild,
    helperName: "Veer Patta AI",
    now: NOON,
    aiAvailable: true,
    ...over,
  });
}

function tapOn(id: string) {
  return readTap({ type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: "x" } } });
}

function buttonsOf(message: HelperMessage) {
  return message.kind === "buttons" ? message.buttons : [];
}

describe("asking for a receipt", () => {
  it("sends the receipt itself when the parent asks for it to be sent, and lists them otherwise", () => {
    for (const text of ["receipt bhejo", "रसीद भेजो", "रसीद भेज दीजिए", "send receipt", "please send the receipt", "receipt ki copy chahiye", "receipt pdf", "rasid de do", "Receipt download"]) {
      expect(ruleIntent(text), text).toBe("receipt_send");
    }
    for (const text of ["receipt", "receipts", "receipt dikhao", "रसीदें", "fees receipt", "receipt dono bachon ki"]) {
      expect(ruleIntent(text), text).toBe("receipts");
    }
    // Longer than a rule reads: Claude answers, with the receipts card and its button.
    expect(ruleIntent("please send me the receipt of last month for my son")).toBeNull();
    // A question or a why is likely a complaint: Claude reads it, and nothing is sent unasked.
    for (const text of ["receipt kyu nahi bheji?", "receipt nahi bheji kyon", "why send receipt again", "receipt bhejoge?", "रसीद क्यों नहीं भेजी"]) {
      expect(ruleIntent(text), text).toBeNull();
    }
  });

  it("sends the receipt for a bare PDF ask, and leaves one named by its date, month or amount to Claude (D-606)", () => {
    // The only PDF the helper sends is a receipt.
    for (const text of ["pdf", "PDF", "pdf bhejo", "pdf please", "pdf bhej do", "पीडीएफ भेजो"]) {
      expect(ruleIntent(text), text).toBe("receipt_send");
    }
    // A question ("Pdf mil jaegi?") is Claude's, who sends it at once.
    expect(ruleIntent("Pdf mil jaegi?")).toBeNull();
    expect(ruleIntent("pdf mil jayegi")).toBeNull();
    // One receipt in particular: Claude finds which.
    for (const text of ["5 Oct wali receipt", "July ki raseed bhejo", "receipt 9000 wali", "अक्टूबर की रसीद भेजो", "send the august receipt"]) {
      expect(ruleIntent(text), text).toBeNull();
    }
    // Without Claude the rules still know it is about receipts.
    expect(ruleIntent("5 Oct wali receipt", { claude: false })).toBe("receipts");
    expect(ruleIntent("July ki raseed bhejo", { claude: false })).toBe("receipt_send");
    expect(ruleIntent("fees kyun?", { claude: false })).toBe("fees");
  });

  it("reads a tap on a receipt only when it names one", () => {
    expect(tapOn("vpai:receipt_send")).toEqual({ intent: "receipt_send", key: null });
    const key = receiptKey(aarav, aarav.receipts[0]);
    expect(tapOn(`vpai:receipt_pdf:${key}`)).toEqual({ intent: "receipt_pdf", key });
    expect(tapOn("vpai:receipt_pdf")).toBeNull();
  });

  it("names a receipt in a button with fourteen letters and digits, never its number", () => {
    const keys = [...aarav.receipts, ...mira.receipts].map((receipt, index) => receiptKey(index < 2 ? aarav : mira, receipt));
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9]{14}$/);
      expect(key).not.toContain("svp");
      // The id the list row carries reads back as the same receipt.
      expect(tapOn(helperId("receipt_pdf", key))?.key).toBe(key);
    }
    expect(new Set(keys).size).toBe(keys.length);
    // The same receipt number on another child is another key.
    expect(receiptKey(aarav, { number: "TEST-SVP-0009" })).not.toBe(receiptKey(mira, { number: "TEST-SVP-0009" }));
  });

  it("offers only receipts that were not reversed, latest first, and finds one only among the family's own", () => {
    expect(sendableReceipts([aarav, mira]).map(({ receipt }) => receipt.number)).toEqual(["TEST-SVP-0009", "TEST-SVP-0002", "TEST-SVP-0003"]);
    const reversedKey = receiptKey(aarav, aarav.receipts[1]);
    expect(receiptByKey([aarav, mira], reversedKey)).toBeNull();
    const miraKey = receiptKey(mira, mira.receipts[0]);
    expect(receiptByKey([aarav, mira], miraKey)?.receipt.number).toBe("TEST-SVP-0009");
    // Another family's receipt is not this family's, whatever the key.
    expect(receiptByKey([aarav], miraKey)).toBeNull();
    expect(receiptByKey([aarav], null)).toBeNull();
  });
});

describe("the receipt cards", () => {
  it("puts Send receipt on the receipts card when there is a receipt to send", () => {
    const card = receiptsCard(context("en"));
    expect(buttonsOf(card).map((button) => button.id)).toEqual(["vpai:receipt_send", "vpai:fees", "vpai:menu"]);
    expect(card.kind === "buttons" && card.body).toContain("Tap *Send receipt* and the receipt comes here as a PDF.");
    expect(buttonsOf(receiptsCard(context("hi"))).map((button) => button.title)[0]).toBe("📄 रसीद भेजें");
    expect(buttonsOf(receiptsCard(context("hx"))).map((button) => button.title)[0]).toBe("📄 Receipt bhejiye");
  });

  it("gives each of two receipts its own button, so its PDF is one tap away (D-606)", () => {
    const card = receiptsCard(context("en", { children: [aarav, kabir], practice: true }));
    expect(buttonsOf(card).map((button) => button.id)).toEqual([
      helperId("receipt_pdf", receiptKey(kabir, kabir.receipts[0])),
      helperId("receipt_pdf", receiptKey(aarav, aarav.receipts[0])),
      "vpai:menu",
    ]);
    // Three keep the one Send receipt button, which offers them to pick.
    expect(buttonsOf(receiptsCard(context("en", paidTogether)))[0].id).toBe("vpai:receipt_send");
    // Mira has two: her card alone is the same.
    expect(buttonsOf(receiptsCard(context("en", { children: [mira], practice: true }))).map((button) => button.title)).toEqual(["📄 ₹9,000 · 5 Oct", "📄 ₹6,000 · 27 Jul", "📋 Menu"]);
    expect(bodyOf(card)).toContain("Tap a receipt below and its PDF comes right here.");
    // "₹9,000 · 5 अक्टूबर" leaves no room for the 📄; every title still fits.
    const hindi = buttonsOf(receiptsCard(context("hi", { children: [mira], practice: true })));
    expect(hindi.slice(0, 2).map((button) => button.title)).toEqual(["₹9,000 · 5 अक्टूबर", "₹6,000 · 27 जुलाई"]);
    for (const button of hindi) expect(button.title.length).toBeLessThanOrEqual(WA_LIMITS.buttonTitle);
    // Two receipts whose buttons would read the same keep the one Send receipt button.
    const twin = child(KABIR_ID, "KABIR TEST SINGH", "Class 3", [{ number: "TEST-SVP-0010", date: "2026-10-05", amount: 9000, mode: "cash", reversed: false }]);
    expect(buttonsOf(receiptsCard(context("en", { children: [mira, twin], practice: true }))).map((button) => button.id)[0]).toBe("vpai:receipt_send");
  });

  it("offers no Send receipt when nothing can be sent", () => {
    const reversedOnly = child(AARAV_ID, "AARAV TEST KUMAR", "Class 6", [{ number: "TEST-SVP-0001", date: "2026-04-10", amount: 5000, mode: "cash", reversed: true }]);
    for (const family of [{ children: [nobody], practice: true }, { children: [reversedOnly], practice: true }]) {
      const card = receiptsCard(context("en", family));
      expect(buttonsOf(card).map((button) => button.id)).toEqual(["vpai:fees", "vpai:menu"]);
      expect(card.kind === "buttons" && card.body).toContain("For anything about a receipt, ask the office.");
    }
  });

  it("offers up to three receipts to pick from as a button each, saying whose and which above them (D-606)", () => {
    const pick = receiptPickList(context("en", twoChildren));
    expect(pick.kind).toBe("buttons");
    expect(buttonsOf(pick).map((button) => button.title)).toEqual(["📄 ₹9,000 · 5 Oct", "📄 ₹2,000 · 1 Aug", "📄 ₹6,000 · 27 Jul"]);
    expect(buttonsOf(pick).map((button) => button.id)).toEqual([
      helperId("receipt_pdf", receiptKey(mira, mira.receipts[0])),
      helperId("receipt_pdf", receiptKey(aarav, aarav.receipts[0])),
      helperId("receipt_pdf", receiptKey(mira, mira.receipts[1])),
    ]);
    expect(bodyOf(pick)).toContain("• *Mira* · Class 1 · TEST-SVP-0009\n   ₹9,000 · 5 Oct");
    expect(bodyOf(pick)).not.toContain("no longer");
    expect(bodyOf(receiptPickList(context("en", twoChildren), twoChildren.children, true))).toContain("That receipt is no longer on the list.");
  });

  it("lists more than three to pick from, each row the amount and date, with the child and number under it", () => {
    const list = receiptPickList(context("en", threeChildren));
    expect(list.kind).toBe("list");
    if (list.kind !== "list") return;
    expect(list.rows.map((row) => row.title)).toEqual(["₹7,000 · 5 Oct", "₹9,000 · 5 Oct", "₹2,000 · 1 Aug", "₹6,000 · 27 Jul"]);
    expect(list.rows[1].description).toBe("Mira · TEST-SVP-0009 · Cash");
    expect(list.rows[2].description).toBe("Aarav · TEST-SVP-0002 · UPI (Razorpay)");
    expect(list.button).toBe("Choose receipt");
    // Every row fits Meta's limits as it is, so nothing is cut.
    for (const row of list.rows) {
      expect(row.title.length).toBeLessThanOrEqual(WA_LIMITS.rowTitle);
      expect((row.description ?? "").length).toBeLessThanOrEqual(WA_LIMITS.rowDescription);
    }
    expect(list.body).not.toContain("no longer");
    expect(bodyOf(receiptPickList(context("en", threeChildren), threeChildren.children, true))).toContain("That receipt is no longer on the list.");
  });

  it("captions the PDF with the receipt, the child and the practice mark", () => {
    const caption = receiptCaption(context("en"), aarav, aarav.receipts[0]);
    expect(caption).toBe("🧾 *Receipt TEST-SVP-0002*\n*Aarav* · Class 6\n₹2,000 · 1 Aug · UPI (Razorpay)\n\n_🧪 Practice: test records_");
    expect(receiptCaption(context("hi"), aarav, aarav.receipts[0])).toContain("🧾 *रसीद TEST-SVP-0002*\n*Aarav* · कक्षा 6");
  });

  it("puts Veer Patta AI's words above the receipt, and says how to ask for another (D-606)", () => {
    const another = { child: mira, receipt: mira.receipts[1] };
    expect(receiptCaption(context("en"), mira, mira.receipts[0], { words: "Here is your receipt 🙏", another })).toBe(
      "Here is your receipt 🙏\n\n🧾 *Receipt TEST-SVP-0009*\n*Mira* · Class 1\n₹9,000 · 5 Oct · Cash\n\nNeed another one? Just write which, like “the 27 Jul receipt”.\n\n_🧪 Practice: test records_",
    );
    expect(receiptCaption(context("hx"), mira, mira.receipts[0], { another })).toContain("Koi aur receipt chahiye to likhiye, jaise “27 Jul wali receipt”.");
    expect(receiptCaption(context("hi"), mira, mira.receipts[0], { another })).toContain("कोई और रसीद चाहिए तो लिखें, जैसे “27 जुलाई वाली रसीद”।");
    // Blank words add nothing.
    expect(receiptCaption(context("en"), aarav, aarav.receipts[0], { words: "  " })).toBe(receiptCaption(context("en"), aarav, aarav.receipts[0]));
  });

  it("says plainly when the PDF could not be sent, with the office's number and a button to try again", () => {
    const reply = receiptUnsentReply(context("en"), aarav, aarav.receipts[0]);
    expect(reply.kind === "buttons" && reply.body).toContain("ask the office for a copy: 9352205884");
    expect(reply.kind === "buttons" && reply.body).toContain("TEST-SVP-0002 · 1 Aug · ₹2,000");
    expect(buttonsOf(reply).map((button) => button.id)).toEqual([`vpai:receipt_pdf:${receiptKey(aarav, aarav.receipts[0])}`, "vpai:menu"]);
  });
});

describe("what the helper does when a receipt is asked for", () => {
  it("sends the one receipt at once, with the words for when it cannot be sent as the message", () => {
    for (const asked of [plan({ text: "please send the receipt" }), plan({ kind: "tap", tap: { intent: "receipt_send", key: null } })]) {
      expect(asked).toMatchObject({ action: "reply", intent: "receipt_send" });
      if (asked.action !== "reply") return;
      expect(numbersOf(asked.receipts)).toEqual(["TEST-SVP-0002"]);
      expect(asked.receipts?.[0].child.studentId).toBe(AARAV_ID);
      expect(asked.receipts?.[0].caption).toContain("TEST-SVP-0002");
      // Nothing else to ask for, so no word about asking for another.
      expect(asked.receipts?.[0].caption).not.toContain("another");
      expect(asked.message).toEqual(asked.receipts?.[0].unsent);
      expect(bodyOf(asked.message)).toContain("could not be sent");
    }
    expect(plan({ text: "please send the receipt" })).toMatchObject({ route: "rule" });
    expect(plan({ kind: "tap", tap: { intent: "receipt_send", key: null } })).toMatchObject({ route: "tap" });
    // Asked in Hinglish, answered in Hinglish.
    const hinglish = plan({ text: "receipt bhejo" });
    expect(hinglish).toMatchObject({ action: "reply", intent: "receipt_send", route: "rule", language: "hx" });
    if (hinglish.action === "reply") {
      expect(hinglish.receipts?.[0].caption).toContain("🧾 *Receipt TEST-SVP-0002*");
      expect(bodyOf(hinglish.message)).toContain("Receipt ki PDF abhi nahi bheji ja saki");
    }
  });

  it("asked in words, sends the latest at once, never a button to press first (D-606)", () => {
    for (const text of ["send receipt", "pdf", "receipt bhejo"]) {
      const asked = plan({ text, family: twoChildren });
      expect(asked, text).toMatchObject({ action: "reply", intent: "receipt_send", route: "rule" });
      if (asked.action !== "reply") return;
      expect(numbersOf(asked.receipts)).toEqual(["TEST-SVP-0009"]);
      expect(asked.receipts?.[0].child.studentId).toBe(MIRA_ID);
    }
    // The caption says how to ask for another, naming the next one as the example.
    const asked = plan({ text: "send receipt", family: twoChildren });
    if (asked.action === "reply") expect(asked.receipts?.[0].caption).toContain("Need another one? Just write which, like “the 1 Aug receipt”.");
  });

  it("sends both receipts of a day two children were paid for together, the last saying how to ask for another", () => {
    const asked = plan({ text: "send receipt", family: paidTogether });
    expect(asked).toMatchObject({ action: "reply", intent: "receipt_send" });
    if (asked.action !== "reply") return;
    expect(numbersOf(asked.receipts)).toEqual(["TEST-SVP-0010", "TEST-SVP-0009"]);
    expect(asked.receipts?.[0].caption).not.toContain("Need another");
    expect(asked.receipts?.[1].caption).toContain("Need another one? Just write which, like “the 27 Jul receipt”.");
    // Each has its own words for when its PDF cannot be sent, and its own button to try again.
    expect(buttonsOf(asked.receipts?.[1].unsent as HelperMessage)[0].id).toBe(helperId("receipt_pdf", receiptKey(mira, mira.receipts[0])));
  });

  it("offers the receipts to pick, one tap each, when Send receipt is tapped with several to send, and sends the one tapped", () => {
    const asked = plan({ kind: "tap", tap: { intent: "receipt_send", key: null }, family: twoChildren });
    expect(asked).toMatchObject({ action: "reply", intent: "receipt_pick", route: "tap" });
    if (asked.action !== "reply") return;
    expect(asked.receipts).toBeUndefined();
    const third = buttonsOf(asked.message)[2];
    const tapped = plan({ kind: "tap", tap: tapOn(third.id), family: twoChildren });
    expect(tapped).toMatchObject({ action: "reply", intent: "receipt_send", route: "tap" });
    if (tapped.action !== "reply") return;
    expect(numbersOf(tapped.receipts)).toEqual(["TEST-SVP-0003"]);
    expect(tapped.receipts?.[0].child.studentId).toBe(MIRA_ID);
    // A receipt picked by its button needs no word about another.
    expect(tapped.receipts?.[0].caption).not.toContain("another");
  });

  it("never sends another receipt in place of one that is gone, and says when there is nothing to send", () => {
    const reversed = plan({ kind: "tap", tap: { intent: "receipt_pdf", key: receiptKey(aarav, aarav.receipts[1]) } });
    expect(reversed).toMatchObject({ action: "reply", intent: "receipt_pick" });
    if (reversed.action === "reply") {
      expect(reversed.receipts).toBeUndefined();
      expect(bodyOf(reversed.message)).toContain("That receipt is no longer on the list.");
    }
    // A receipt of a family this number does not stand for.
    expect(plan({ kind: "tap", tap: { intent: "receipt_pdf", key: receiptKey(mira, mira.receipts[0]) } })).toMatchObject({ intent: "receipt_pick" });
    const none = plan({ text: "send receipt", family: { children: [nobody], practice: true } });
    expect(none).toMatchObject({ action: "reply", intent: "receipts" });
    if (none.action === "reply") {
      expect(none.receipts).toBeUndefined();
      expect(bodyOf(none.message)).toContain("No receipts yet.");
    }
  });

  it("without Claude, shows the receipts card for a receipt named by its date, not the menu", () => {
    for (const text of ["5 Oct wali receipt", "July ki raseed bhejo"]) {
      expect(plan({ text, family: twoChildren, aiAvailable: false }), text).toMatchObject({ action: "reply", intent: "receipts", route: "rule" });
    }
    expect(plan({ text: "5 Oct wali receipt", family: twoChildren })).toMatchObject({ action: "ask_ai" });
  });
});

describe("which receipts an ask in words sends (D-606)", () => {
  const en = (family: Family) => context("en", family);

  it("sends the receipts named, among this family's own only, at most three", () => {
    expect(numbersOf(receiptAsk(en(twoChildren), twoChildren.children, ["TEST-SVP-0003"]).receipts)).toEqual(["TEST-SVP-0003"]);
    // However Claude wrote the number.
    expect(numbersOf(receiptAsk(en(twoChildren), twoChildren.children, [" test-svp-0002 ", "TEST-SVP-0002"]).receipts)).toEqual(["TEST-SVP-0002"]);
    // Named, it is found in the family whichever child the ask was about.
    expect(numbersOf(receiptAsk(en(twoChildren), [aarav], ["TEST-SVP-0009"]).receipts)).toEqual(["TEST-SVP-0009"]);
    const many = receiptAsk(en(threeChildren), threeChildren.children, ["TEST-SVP-0010", "TEST-SVP-0009", "TEST-SVP-0002", "TEST-SVP-0003"]);
    expect(many.receipts).toHaveLength(MAX_RECEIPTS_PER_ASK);
    // Named, the parent knows how to ask: no word about another.
    expect(many.receipts.map((item) => item.caption).join("\n")).not.toContain("another");
  });

  it("never sends a reversed receipt or another family's, and offers the receipts to pick instead", () => {
    for (const wanted of [["TEST-SVP-0001"], ["TEST-SVP-9999"]]) {
      const asked = receiptAsk(en(twoChildren), twoChildren.children, wanted);
      expect(asked.intent).toBe("receipt_pick");
      expect(asked.receipts).toEqual([]);
      expect(bodyOf(asked.message)).toContain("That receipt is no longer on the list.");
    }
  });

  it("sends the latest of the child the ask is about", () => {
    expect(numbersOf(receiptAsk(en(twoChildren), [aarav]).receipts)).toEqual(["TEST-SVP-0002"]);
    // That child has none: the card says so, Claude's words above it.
    const none = receiptAsk(en({ children: [aarav, nobody], practice: true }), [nobody], [], "Let me check.");
    expect(none.intent).toBe("receipts");
    expect(bodyOf(none.message)).toContain("Let me check.");
    expect(bodyOf(none.message)).toContain("No receipts yet.");
  });

  it("says who the helper is only once, above the first", () => {
    const first = { ...en(paidTogether), firstContact: true };
    const asked = receiptAsk(first, paidTogether.children);
    expect(asked.receipts[0].caption).toContain("I'm *Veer Patta AI*");
    expect(asked.receipts[1].caption).not.toContain("I'm *Veer Patta AI*");
    expect(bodyOf(asked.receipts[1].unsent)).not.toContain("I'm *Veer Patta AI*");
  });
});

describe("Claude asked for a receipt (D-606)", () => {
  const input = (family: Family, text = "Pdf mil jaegi?") => ({ family, helperName: "Veer Patta AI", text, now: NOON });

  it("sends the latest at once, Claude's words above it", () => {
    const answered = planFromAnswer(answer({ language: "hx", reply: "Yeh rahi aapki receipt 🙏" }), input(twoChildren));
    expect(answered).toMatchObject({ intent: "receipt_send", route: "ai", language: "hx", handoff: null });
    expect(numbersOf(answered.receipts)).toEqual(["TEST-SVP-0009"]);
    expect(answered.receipts?.[0].caption.startsWith("Yeh rahi aapki receipt 🙏\n\n🧾 *Receipt TEST-SVP-0009*")).toBe(true);
    expect(answered.receipts?.[0].caption).toContain("Koi aur receipt chahiye to likhiye");
    expect(answered.message).toEqual(answered.receipts?.[0].unsent);
  });

  it("sends the one Claude named, or the latest of the child Claude named", () => {
    expect(numbersOf(planFromAnswer(answer({ receipt_pdf: { receipts: ["TEST-SVP-0003"] } }), input(twoChildren, "July wali receipt")).receipts)).toEqual(["TEST-SVP-0003"]);
    expect(numbersOf(planFromAnswer(answer({ child: aarav.key }), input(twoChildren, "Aarav ki receipt")).receipts)).toEqual(["TEST-SVP-0002"]);
    // Sent even when Claude wrote no words.
    expect(numbersOf(planFromAnswer(answer({ reply: "" }), input(oneChild)).receipts)).toEqual(["TEST-SVP-0002"]);
  });

  it("hands off before sending anything when the parent needs a person", () => {
    const answered = planFromAnswer(answer({ handoff: "accounts", topic: "fees", summary: "Payment not showing." }), input(oneChild, "I paid but the receipt is not showing"));
    expect(answered.handoff?.target).toBe("accounts");
    expect(answered.receipts).toBeUndefined();
  });

  it("is told to send it, never to tell the parent to tap", () => {
    const prompt = helperSystemPrompt("Veer Patta AI");
    expect(prompt).toContain('set "receipt_pdf" and the PDF is sent here at once');
    expect(prompt).toContain("Never tell them to tap, press or choose something to get what you can give them yourself.");
    expect(prompt).not.toContain('"Send receipt" button');
    expect(helperAnswerSchema.safeParse(answer()).success).toBe(true);
    expect(helperAnswerSchema.safeParse(answer({ receipt_pdf: null })).success).toBe(true);
  });
});

describe("the language of a short message (D-606)", () => {
  it("reads Hinglish from its small words", () => {
    for (const text of ["Pdf mil jaegi?", "pdf mil jayegi", "receipt kab tak milegi", "fees ho gayi"]) {
      expect(detectLanguage(text), text).toBe("hx");
    }
    expect(plan({ text: "Pdf mil jaegi?", family: twoChildren })).toMatchObject({ action: "ask_ai", language: "hx" });
  });

  it("keeps the chat's language for words that do not show one, and English only where they do", () => {
    expect(detectLanguage("Aarav absent", "hx")).toBe("hx");
    expect(detectLanguage("Aarav absent")).toBe("en");
    expect(detectLanguage("please send the receipt", "hx")).toBe("en");
    expect(detectLanguage("ok", "hx")).toBeNull();
    expect(detectLanguage("रसीद", "en")).toBe("hi");
  });
});

describe("a receipt in WhatsApp's own format", () => {
  const document: HelperMessage = { kind: "document", link: "https://files.example.test/r.pdf?token=t", filename: "Receipt-TEST-SVP-0002-TEST-AARAV-KUMAR.pdf", caption: "🧾 *Receipt TEST-SVP-0002*" };

  it("goes as a document Meta fetches from the link", () => {
    expect(helperMessageBody("+919000000001", document)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919000000001",
      type: "document",
      document: { link: "https://files.example.test/r.pdf?token=t", filename: "Receipt-TEST-SVP-0002-TEST-AARAV-KUMAR.pdf", caption: "🧾 *Receipt TEST-SVP-0002*" },
    });
  });

  it("keeps the caption and the file name to Meta's limits", () => {
    const fitted = fitMessage({ ...document, caption: "x".repeat(2000), filename: `${"y".repeat(300)}.pdf` });
    expect(fitted.kind).toBe("document");
    if (fitted.kind !== "document") return;
    expect(fitted.caption.length).toBe(WA_LIMITS.caption);
    expect(fitted.filename.length).toBeLessThanOrEqual(WA_LIMITS.filename);
    expect(messageText(document)).toContain("[📄 Receipt-TEST-SVP-0002-TEST-AARAV-KUMAR.pdf]");
    expect(plainVersion(document)).toEqual({ kind: "text", text: "🧾 *Receipt TEST-SVP-0002*" });
  });
});

/* ------------------------------------------------------------ the PDF */

type Row = { id: string; student_id: string; payment_mode: string | null };

function receiptDeps(rows: Row[] | null, made: Awaited<ReturnType<ReceiptDeps["render"]>> = { document: { path: "TEST-2026-27/receipt/r1.pdf", signedUrl: "https://files.example.test/signed" }, filename: "Receipt-TEST-SVP-0002-TEST-AARAV-KUMAR.pdf" }) {
  const filters: Array<[string, string]> = [];
  const renders: Array<{ receiptId: string; sessionLabel: string; scope: unknown }> = [];
  let selected = "";
  const query = {
    select(columns: string) {
      selected = columns;
      return query;
    },
    eq(column: string, value: string) {
      filters.push([column, value]);
      return query;
    },
    limit: async () => ({ data: rows, error: rows ? null : { message: "boom" } }),
  };
  const client = { from: vi.fn(() => query) };
  const deps: ReceiptDeps = {
    client: () => client as never,
    render: vi.fn(async (args: { receiptId: string; sessionLabel: string }) => {
      renders.push({ receiptId: args.receiptId, sessionLabel: args.sessionLabel, scope: testRecordReadInContext() });
      return made;
    }) as never,
  };
  return { deps, client, filters, renders, selected: () => selected };
}

const ASK = { studentId: AARAV_ID, sessionLabel: "TEST-2026-27", receiptNumber: "TEST-SVP-0002", practice: true };

describe("making the receipt's PDF", () => {
  it("finds the receipt by the child AND the number, and makes the school's own PDF inside a TEST read", async () => {
    const fake = receiptDeps([{ id: "r1", student_id: AARAV_ID, payment_mode: "online" }]);
    expect(await prepareHelperReceipt(ASK, fake.deps)).toEqual({ link: "https://files.example.test/signed", filename: "Receipt-TEST-SVP-0002-TEST-AARAV-KUMAR.pdf" });
    expect(fake.client.from).toHaveBeenCalledWith("receipts");
    expect(fake.filters).toEqual([["receipt_number", "TEST-SVP-0002"], ["student_id", AARAV_ID]]);
    expect(fake.renders).toEqual([{ receiptId: "r1", sessionLabel: "TEST-2026-27", scope: { studentId: AARAV_ID, sessionLabel: "TEST-2026-27" } }]);
    // Outside the read, nothing is in the context.
    expect(testRecordReadInContext()).toBeNull();
  });

  it("makes nothing for a real year, a family that is not practice, or a request that names nothing", async () => {
    for (const ask of [
      { ...ASK, sessionLabel: "2026-27" },
      { ...ASK, practice: false },
      { ...ASK, studentId: "not-an-id" },
      { ...ASK, receiptNumber: "  " },
    ]) {
      const fake = receiptDeps([{ id: "r1", student_id: AARAV_ID, payment_mode: "cash" }]);
      expect(await prepareHelperReceipt(ask, fake.deps)).toBeNull();
      expect(fake.client.from).not.toHaveBeenCalled();
      expect(fake.renders).toEqual([]);
    }
  });

  it("makes nothing unless exactly one receipt of this child's matches, and never for a write-off", async () => {
    for (const rows of [
      [],
      [{ id: "r1", student_id: AARAV_ID, payment_mode: "cash" }, { id: "r2", student_id: AARAV_ID, payment_mode: "cash" }],
      [{ id: "r1", student_id: MIRA_ID, payment_mode: "cash" }],
      [{ id: "r1", student_id: AARAV_ID, payment_mode: "discount" }],
      null,
    ]) {
      const fake = receiptDeps(rows);
      expect(await prepareHelperReceipt(ASK, fake.deps)).toBeNull();
      expect(fake.renders).toEqual([]);
    }
  });

  it("says could not be made when the PDF could not be made or put on the shelf, and never throws", async () => {
    expect(await prepareHelperReceipt(ASK, receiptDeps([{ id: "r1", student_id: AARAV_ID, payment_mode: "cash" }], null).deps)).toBeNull();
    const broken = receiptDeps([{ id: "r1", student_id: AARAV_ID, payment_mode: "cash" }]);
    broken.deps.render = vi.fn(async () => {
      throw new Error("font missing");
    }) as never;
    expect(await prepareHelperReceipt(ASK, broken.deps)).toBeNull();
    expect(log.logWarn).toHaveBeenCalledWith("whatsapp.helper.receipt_failed", { error: "font missing" });
  });
});
