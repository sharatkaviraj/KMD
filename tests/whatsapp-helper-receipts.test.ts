import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const log = vi.hoisted(() => ({ logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/platform/observability/log", () => log);

import { prepareHelperReceipt, type ReceiptDeps } from "@/modules/whatsapp/data/helper-receipt";
import { childFactsFromRow, receiptByKey, receiptKey, sendableReceipts, type ChildFacts } from "@/modules/whatsapp/domain/helper-facts";
import { fitMessage, helperMessageBody, messageText, plainVersion, WA_LIMITS, type HelperMessage } from "@/modules/whatsapp/domain/helper-messages";
import { EMPTY_CHAT, planTurn, type PlanInput } from "@/modules/whatsapp/domain/helper-plan";
import { receiptCaption, receiptPickList, receiptsCard, receiptUnsentReply, type Family, type ReplyContext } from "@/modules/whatsapp/domain/helper-replies";
import { helperId, readTap, ruleIntent } from "@/modules/whatsapp/domain/helper-text";
import { testRecordReadInContext } from "@/platform/fees-bridge/test-record-read";

/**
 * A parent asking Veer Patta AI for a receipt, and getting the PDF in the
 * chat (D-597). Every name and number here is made up (rule 6).
 */

const TODAY = "2026-11-12";
const NOON = new Date("2026-11-12T06:30:00Z");
const AARAV_ID = "11111111-1111-4111-8111-111111111111";
const MIRA_ID = "33333333-3333-4333-8333-333333333333";

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

const oneChild: Family = { children: [aarav], practice: true };
const twoChildren: Family = { children: [aarav, mira], practice: true };

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

  it("offers no Send receipt when nothing can be sent", () => {
    const reversedOnly = child(AARAV_ID, "AARAV TEST KUMAR", "Class 6", [{ number: "TEST-SVP-0001", date: "2026-04-10", amount: 5000, mode: "cash", reversed: true }]);
    for (const family of [{ children: [nobody], practice: true }, { children: [reversedOnly], practice: true }]) {
      const card = receiptsCard(context("en", family));
      expect(buttonsOf(card).map((button) => button.id)).toEqual(["vpai:fees", "vpai:menu"]);
      expect(card.kind === "buttons" && card.body).toContain("For anything about a receipt, ask the office.");
    }
  });

  it("lists the receipts to pick from, each row the amount and date, with the child and number under it", () => {
    const list = receiptPickList(context("en", twoChildren));
    expect(list.kind).toBe("list");
    if (list.kind !== "list") return;
    expect(list.rows.map((row) => row.title)).toEqual(["₹9,000 · 5 Oct", "₹2,000 · 1 Aug", "₹6,000 · 27 Jul"]);
    expect(list.rows[0].description).toBe("Mira · TEST-SVP-0009 · Cash");
    expect(list.rows[1].description).toBe("Aarav · TEST-SVP-0002 · UPI (Razorpay)");
    expect(list.button).toBe("Choose receipt");
    // Every row fits Meta's limits as it is, so nothing is cut.
    for (const row of list.rows) {
      expect(row.title.length).toBeLessThanOrEqual(WA_LIMITS.rowTitle);
      expect((row.description ?? "").length).toBeLessThanOrEqual(WA_LIMITS.rowDescription);
    }
    expect(list.body).not.toContain("no longer");
    expect(receiptPickList(context("en", twoChildren), twoChildren.children, true).kind === "list" && (receiptPickList(context("en", twoChildren), twoChildren.children, true) as { body: string }).body).toContain("That receipt is no longer on the list.");
  });

  it("captions the PDF with the receipt, the child and the practice mark", () => {
    const caption = receiptCaption(context("en"), aarav, aarav.receipts[0]);
    expect(caption).toBe("🧾 *Receipt TEST-SVP-0002*\n*Aarav* · Class 6\n₹2,000 · 1 Aug · UPI (Razorpay)\n\n_🧪 Practice: test records_");
    expect(receiptCaption(context("hi"), aarav, aarav.receipts[0])).toContain("🧾 *रसीद TEST-SVP-0002*\n*Aarav* · कक्षा 6");
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
      expect(asked.receipt?.receipt.number).toBe("TEST-SVP-0002");
      expect(asked.receipt?.child.studentId).toBe(AARAV_ID);
      expect(asked.receipt?.caption).toContain("TEST-SVP-0002");
      expect(asked.message.kind === "buttons" && asked.message.body).toContain("could not be sent");
    }
    expect(plan({ text: "please send the receipt" })).toMatchObject({ route: "rule" });
    expect(plan({ kind: "tap", tap: { intent: "receipt_send", key: null } })).toMatchObject({ route: "tap" });
    // Asked in Hinglish, answered in Hinglish.
    const hinglish = plan({ text: "receipt bhejo" });
    expect(hinglish).toMatchObject({ action: "reply", intent: "receipt_send", route: "rule", language: "hx" });
    if (hinglish.action === "reply") {
      expect(hinglish.receipt?.caption).toContain("🧾 *Receipt TEST-SVP-0002*");
      expect(hinglish.message.kind === "buttons" && hinglish.message.body).toContain("Receipt ki PDF abhi nahi bheji ja saki");
    }
  });

  it("asks which one when there are several, and sends the one tapped", () => {
    const asked = plan({ text: "send receipt", family: twoChildren });
    expect(asked).toMatchObject({ action: "reply", intent: "receipt_pick" });
    if (asked.action !== "reply" || asked.message.kind !== "list") throw new Error("expected the list");
    expect(asked.receipt).toBeUndefined();
    const row = asked.message.rows[2];
    const tapped = plan({ kind: "tap", tap: tapOn(row.id), family: twoChildren });
    expect(tapped).toMatchObject({ action: "reply", intent: "receipt_send", route: "tap" });
    if (tapped.action !== "reply") return;
    expect(tapped.receipt?.receipt.number).toBe("TEST-SVP-0003");
    expect(tapped.receipt?.child.studentId).toBe(MIRA_ID);
  });

  it("never sends another receipt in place of one that is gone, and says when there is nothing to send", () => {
    const reversed = plan({ kind: "tap", tap: { intent: "receipt_pdf", key: receiptKey(aarav, aarav.receipts[1]) } });
    expect(reversed).toMatchObject({ action: "reply", intent: "receipt_pick" });
    if (reversed.action === "reply") {
      expect(reversed.receipt).toBeUndefined();
      expect(reversed.message.kind === "list" && reversed.message.body).toContain("That receipt is no longer on the list.");
    }
    // A receipt of a family this number does not stand for.
    expect(plan({ kind: "tap", tap: { intent: "receipt_pdf", key: receiptKey(mira, mira.receipts[0]) } })).toMatchObject({ intent: "receipt_pick" });
    const none = plan({ text: "send receipt", family: { children: [nobody], practice: true } });
    expect(none).toMatchObject({ action: "reply", intent: "receipts" });
    if (none.action === "reply") {
      expect(none.receipt).toBeUndefined();
      expect(none.message.kind === "buttons" && none.message.body).toContain("No receipts yet.");
    }
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
