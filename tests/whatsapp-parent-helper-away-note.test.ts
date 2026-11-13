import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  awayLine,
  awayNoteMessage,
  awayNoteParams,
  NOTE_CHOICES,
  noteButtonId,
  noteButtonPayloads,
  noteButtonTitles,
  noteConfirmText,
  readNoteTap,
  type NoteResult,
} from "@/modules/whatsapp/domain/helper-away-note";
import { staffAlertText, type AlertWords } from "@/modules/whatsapp/domain/helper-handoff";
import { AWAY_NOTE_HUB_SUBMISSIONS, AWAY_NOTE_TEMPLATE, HELPER_HUB_SUBMISSIONS, HELPER_TEMPLATE_PARAMS } from "@/modules/whatsapp/domain/helper-hub-templates";
import { helperMessageBody, WA_LIMITS } from "@/modules/whatsapp/domain/helper-messages";
import { HUB_TEMPLATE_SUBMISSIONS } from "@/modules/whatsapp/domain/hub-templates";
import { templateMessageBody } from "@/platform/whatsapp/payload";

/**
 * Deciding a parent's note from WhatsApp (D-602; the owner's idea 4): Mark
 * Leave, Mark Absent and Not now under the class teacher's alert. These are
 * the ids, the reading of a tap, the words, and the approved away note. Every
 * name and number here is made up (rule 6).
 */

const NOTE = "88888888-8888-4888-8888-888888888888";
const TODAY = "2026-11-12";

const words = (over: Partial<AlertWords & { away: string }> = {}): AlertWords & { away: string } => ({
  kind: "alert",
  language: "en",
  staffName: "TEST Teacher One",
  studentLabel: "Aarav · Class 6",
  topic: "leave",
  complaint: false,
  words: "Aarav has a fever, please give leave for today.",
  helperName: "Veer Patta AI",
  practice: false,
  away: "Today · Sick",
  ...over,
});

const tapped = (id: string, title = "Mark Leave") => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const quickReply = (payload: string, text: string) => ({ type: "button", button: { payload, text } });

describe("the buttons and what a tap says back", () => {
  it("are Mark Leave, Mark Absent and Not now, in both languages, short enough for WhatsApp", () => {
    expect(NOTE_CHOICES).toEqual(["leave", "absent", "dismiss"]);
    expect(noteButtonTitles("en")).toEqual(["Mark Leave", "Mark Absent", "Not now"]);
    expect(noteButtonTitles("hi")).toEqual(["छुट्टी लगाएँ", "अनुपस्थित लगाएँ", "अभी नहीं"]);
    for (const title of [...noteButtonTitles("en"), ...noteButtonTitles("hi")]) expect(title.length).toBeLessThanOrEqual(WA_LIMITS.buttonTitle);
  });

  it("each names its choice and its note, and nothing else", () => {
    expect(noteButtonId("leave", NOTE.toUpperCase())).toBe(`vpnote:leave:${NOTE}`);
    expect(noteButtonPayloads(NOTE)).toEqual([`vpnote:leave:${NOTE}`, `vpnote:absent:${NOTE}`, `vpnote:dismiss:${NOTE}`]);
    for (const id of noteButtonPayloads(NOTE)) expect(id.length).toBeLessThanOrEqual(WA_LIMITS.id);
  });

  it("reads a reply button on the typed alert and a quick reply on the approved one alike", () => {
    expect(readNoteTap(tapped(`vpnote:absent:${NOTE}`))).toEqual({ choice: "absent", suggestionId: NOTE });
    expect(readNoteTap(tapped(`VPNOTE:LEAVE:${NOTE.toUpperCase()}`))).toEqual({ choice: "leave", suggestionId: NOTE });
    expect(readNoteTap(quickReply(`vpnote:dismiss:${NOTE}`, "Not now"))).toEqual({ choice: "dismiss", suggestionId: NOTE });
  });

  it("a quick reply that came back with no payload of ours is read by its words alone, in either language, naming no note", () => {
    expect(readNoteTap(quickReply("", "Mark Absent"))).toEqual({ choice: "absent", suggestionId: null });
    expect(readNoteTap(quickReply("", "छुट्टी लगाएँ"))).toEqual({ choice: "leave", suggestionId: null });
    expect(readNoteTap(quickReply("something else", "अभी नहीं"))).toEqual({ choice: "dismiss", suggestionId: null });
  });

  it("anything else is not a tap: typed words, the parent helper's own buttons, a made-up id, other words", () => {
    expect(readNoteTap({ type: "text", text: { body: "Mark Leave" } })).toBeNull();
    expect(readNoteTap(tapped("vpai:rate:abc:helped"))).toBeNull();
    expect(readNoteTap(tapped(`vpnote:present:${NOTE}`))).toBeNull();
    expect(readNoteTap(tapped("vpnote:leave:not-a-note"))).toBeNull();
    // A reply button is only ever ours by its id: its title alone decides nothing.
    expect(readNoteTap(tapped("other", "Mark Leave"))).toBeNull();
    expect(readNoteTap(quickReply("", "Yes please"))).toBeNull();
    expect(readNoteTap(null)).toBeNull();
    expect(readNoteTap({ type: "interactive" })).toBeNull();
  });
});

describe("the alert that carries them", () => {
  it("names the days and the reason the way a teacher reads them", () => {
    expect(awayLine({ days: [TODAY], reason: "sick" }, "en", TODAY)).toBe("Today · Sick");
    expect(awayLine({ days: ["2026-11-13"], reason: "other" }, "en", TODAY)).toBe("Tomorrow · Other reason");
    expect(awayLine({ days: [TODAY], reason: "sick" }, "hi", TODAY)).toBe("आज · बीमार");
    expect(awayLine({ days: ["2026-11-13", "2026-11-14", "2026-11-16"], reason: "sick" }, "en", TODAY)).toMatch(/^Tomorrow – .*16 Nov · Sick$/);
  });

  it("typed: the parent's words, the days, what each button does, and still how to answer the parent", () => {
    const message = awayNoteMessage(words(), NOTE);
    expect(message.kind).toBe("buttons");
    if (message.kind !== "buttons") return;
    expect(message.buttons).toEqual([
      { id: `vpnote:leave:${NOTE}`, title: "Mark Leave" },
      { id: `vpnote:absent:${NOTE}`, title: "Mark Absent" },
      { id: `vpnote:dismiss:${NOTE}`, title: "Not now" },
    ]);
    expect(message.body).toBe(
      [
        "🔔 *A parent's message for you*",
        "Aarav · Class 6 · Leave",
        "🗓️ Today · Sick",
        "",
        "“Aarav has a fever, please give leave for today.”",
        "",
        "👇 Mark Leave or Mark Absent: the register starts the child that way on those days, and no absent message goes to the parent. Not now changes nothing.",
        "↩️ Swipe right on this message and type your answer. Veer Patta AI sends it to the parent from the school's number.",
      ].join("\n"),
    );
    const sent = helperMessageBody("+919000000002", message) as { type: string; interactive: { action: { buttons: unknown[] } } };
    expect(sent.type).toBe("interactive");
    expect(sent.interactive.action.buttons).toHaveLength(3);
  });

  it("in Hindi, with the words on the Hindi buttons", () => {
    const message = awayNoteMessage(words({ language: "hi", away: "आज · बीमार" }), NOTE);
    if (message.kind !== "buttons") throw new Error("expected buttons");
    expect(message.body).toContain("🗓️ आज · बीमार");
    expect(message.body).toContain("👇 छुट्टी लगाएँ या अनुपस्थित लगाएँ:");
    expect(message.body).toContain("अभी नहीं से कुछ नहीं बदलता।");
    expect(message.buttons.map((button) => button.title)).toEqual(["छुट्टी लगाएँ", "अनुपस्थित लगाएँ", "अभी नहीं"]);
  });

  it("stays one message with its buttons however long the parent wrote: their words give way", () => {
    for (const language of ["en", "hi"] as const) {
      const long = words({ language, practice: true, kind: "reminder", words: "बहुत लंबा संदेश ".repeat(200), studentLabel: "A".repeat(200), staffName: "B".repeat(200) });
      const message = awayNoteMessage(long, NOTE);
      if (message.kind !== "buttons") throw new Error("expected buttons");
      expect(message.body.length).toBeLessThanOrEqual(WA_LIMITS.body);
      expect((helperMessageBody("+919000000002", message) as { type: string }).type).toBe("interactive");
    }
  });

  it("without a note, the alert is word for word what it always was", () => {
    const plain = staffAlertText({ ...words(), away: null });
    expect(plain).not.toContain("🗓️");
    expect(plain).not.toContain("👇");
    expect(plain.split("\n")).toHaveLength(6);
    expect(staffAlertText({ ...words(), away: undefined })).toBe(plain);
  });

  it("the approved note's four blanks: name, student, days and why, the parent's words; a reminder says so", () => {
    expect(awayNoteParams(words())).toEqual(["TEST Teacher One", "Aarav · Class 6", "Today · Sick", "Aarav has a fever, please give leave for today."]);
    expect(awayNoteParams(words({ kind: "reminder" }))[2]).toBe("Today · Sick · reminder");
    expect(awayNoteParams(words({ kind: "reminder", language: "hi", away: "आज · बीमार" }))[2]).toBe("आज · बीमार · याद दिला रहे हैं");
    for (const value of awayNoteParams(words({ words: "line one\nline two\t  and more" }))) expect(value).not.toMatch(/[\n\t]| {4,}/);
  });
});

describe("what the person who tapped is told", () => {
  const told = (result: NoteResult, over: Partial<Parameters<typeof noteConfirmText>[0]> = {}) =>
    noteConfirmText({ result, language: "en", studentLabel: "Aarav · Class 6", days: "Today", practiceFor: null, ...over });

  it("applied: how the register starts the child, that no absent message goes, and where to undo it", () => {
    expect(told({ outcome: "applied", mark: "leave" })).toBe(
      [
        "✅ Leave noted for the register · Aarav · Class 6 · Today",
        "The parent gets no absent message for those days.",
        "↩️ Changed your mind? Open One and press Undo under Decided today.",
      ].join("\n"),
    );
    expect(told({ outcome: "applied", mark: "absent" })).toMatch(/^✅ Absent noted for the register/);
  });

  it("never that the register is saved", () => {
    for (const language of ["en", "hi"] as const) {
      for (const mark of ["leave", "absent"] as const) {
        const text = told({ outcome: "applied", mark }, { language });
        expect(text).not.toMatch(/saved|marked absent|marked on leave|सहेज/i);
      }
    }
  });

  it("let go: nothing changed, and still undoable", () => {
    expect(told({ outcome: "dismissed" })).toBe("👍 Let go · nothing was changed · Aarav · Class 6\n↩️ Changed your mind? Open One and press Undo under Decided today.");
  });

  it("already decided: says how, and by whom, when it is known", () => {
    expect(told({ outcome: "already", decided: { en: "Leave · TEST Teacher One", hi: "छुट्टी · TEST Teacher One" } })).toBe(
      "ℹ️ Someone has already decided this one.\nLeave · TEST Teacher One · Aarav · Class 6",
    );
    expect(told({ outcome: "already", decided: null })).toBe("ℹ️ Someone has already decided this one.");
  });

  it("past its day, not theirs, gone or failed: nothing was changed, and a failure points to One", () => {
    expect(told({ outcome: "expired" })).toBe("⏱️ Its day has passed, so it no longer waits. Nothing was changed.");
    expect(told({ outcome: "not_permitted" })).toBe("🚫 This one is for someone else to decide. Nothing was changed.");
    expect(told({ outcome: "gone" })).toBe("⚠️ It is no longer there. Nothing was changed.");
    expect(told({ outcome: "failed" })).toBe("⚠️ That did not go through. Nothing was changed.\nPlease decide it in One instead.");
  });

  it("in Hindi", () => {
    const text = told({ outcome: "applied", mark: "leave" }, { language: "hi", days: "आज" });
    expect(text).toContain("रजिस्टर के लिए छुट्टी दर्ज · Aarav · Class 6 · आज");
    expect(text).toContain("उन दिनों अभिभावक को अनुपस्थिति का संदेश नहीं जाएगा।");
    expect(told({ outcome: "failed" }, { language: "hi" })).toContain("कृपया इसे One में तय करें।");
  });

  it("practice: which test account the owner's number decided as", () => {
    expect(told({ outcome: "applied", mark: "leave" }, { practiceFor: "TEST Teacher One" }).split("\n").at(-1)).toBe(
      "🧪 Practice: decided as TEST Teacher One, on test records.",
    );
  });
});

describe("the approved away note on the school's hub", () => {
  const migration = readdirSync(join(process.cwd(), "supabase/migrations")).find((file) => file.endsWith("_parent_helper_away_note.sql"));
  const sql = readFileSync(join(process.cwd(), "supabase/migrations", migration!), "utf8");

  it("is Hindi and English, asked of the hub, and kept apart from Veer Patta AI's other four", () => {
    expect(AWAY_NOTE_HUB_SUBMISSIONS.map((submission) => submission.name).sort()).toEqual(Object.values(AWAY_NOTE_TEMPLATE).sort());
    const all = new Set(HUB_TEMPLATE_SUBMISSIONS.map((submission) => submission.name));
    for (const submission of AWAY_NOTE_HUB_SUBMISSIONS) expect(all.has(submission.name)).toBe(true);
    expect(HELPER_HUB_SUBMISSIONS.some((submission) => submission.name.includes("away"))).toBe(false);
  });

  it.each(AWAY_NOTE_HUB_SUBMISSIONS.map((submission) => [submission.name, submission] as const))("%s is shaped the way Meta checks", (_name, submission) => {
    const blanks = [...submission.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
    expect(blanks).toEqual([1, 2, 3, 4]);
    expect(HELPER_TEMPLATE_PARAMS.awayNote).toBe(4);
    expect(submission.examples).toHaveLength(4);
    for (const example of submission.examples) expect(example.trim()).not.toBe("");
    expect(submission.body).not.toMatch(/^\s*\{\{/);
    expect(submission.body).not.toMatch(/\}\}\s*$/);
    expect(submission.body).not.toMatch(/\}\}\s*\{\{/);
    expect(submission.category).toBe("UTILITY");
    expect(submission.body.length).toBeLessThanOrEqual(1024);
    // Never the fees app's number, never a link.
    expect(submission.body).not.toMatch(/8047136289|https?:/);
  });

  it.each(AWAY_NOTE_HUB_SUBMISSIONS.map((submission) => [submission.name, submission] as const))("%s has the three quick replies, in the buttons' words", (_name, submission) => {
    const language = submission.language === "hi" ? "hi" : "en";
    expect(submission.buttons).toEqual(noteButtonTitles(language).map((text) => ({ type: "QUICK_REPLY", text })));
    for (const button of submission.buttons) expect(button.text.length).toBeLessThanOrEqual(25);
    // The body names each button by its own words.
    for (const title of noteButtonTitles(language).slice(0, 2)) expect(submission.body).toContain(title);
  });

  it.each(AWAY_NOTE_HUB_SUBMISSIONS.map((submission) => [submission.name, submission] as const))("%s has its registry row, not yet submitted", (name, submission) => {
    expect(sql).toContain(`('${name}', '${name}', '${submission.language}', 'parent_helper', 4, array['name', 'student', 'away', 'message']::text[], 'none', false, `);
    // Never approved by hand: Meta's answer sets that.
    expect(sql).not.toContain("'approved'");
  });

  it("is sent with each quick reply carrying the note's own payload, in the buttons' order", () => {
    const body = templateMessageBody({
      to: "+919000000002",
      name: AWAY_NOTE_TEMPLATE.en,
      languageCode: "en",
      bodyParams: awayNoteParams(words()),
      quickReplies: noteButtonPayloads(NOTE),
    }) as { template: { components: unknown[] } };
    expect(body.template.components).toEqual([
      { type: "body", parameters: awayNoteParams(words()).map((text) => ({ type: "text", text })) },
      { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: `vpnote:leave:${NOTE}` }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: `vpnote:absent:${NOTE}` }] },
      { type: "button", sub_type: "quick_reply", index: "2", parameters: [{ type: "payload", payload: `vpnote:dismiss:${NOTE}` }] },
    ]);
  });
});
