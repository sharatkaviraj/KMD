import { p, type Pair } from "@/vx/text";

import type { AbsenceNote } from "./helper-absence";
import { oneLine, staffAlertText, WORDS_IN_ALERT, type AlertKind, type AlertWords, type StaffLanguage } from "./helper-handoff";
import type { HelperMessage } from "./helper-messages";
import { daysLabel, decidedMessage, decideRefusal, REASON_LABELS, SUGGESTION_WORDS, type RegisterMark } from "./parent-suggestions";

/**
 * Deciding a parent's note from WhatsApp (D-602; the owner's idea 4, 12 Nov
 * 2026). When Veer Patta AI tells a class teacher that a parent says their
 * child will be away, the alert carries three buttons: Mark Leave, Mark
 * Absent and Not now. A tap decides the note as that teacher, exactly as the
 * same button on Today does (`decide_parent_suggestions`, `via: "whatsapp"`):
 * the database checks again that they may, and that it still waits. Nothing
 * is applied on a parent's word, and nothing by a tap the alert did not
 * offer.
 *
 * While the teacher's chat with the school is open the alert is typed, with
 * reply buttons whose ids are `vpnote:<choice>:<suggestion>`. Otherwise it is
 * the approved `vpps_staff_away_note_<hi|en>_v1`, whose quick replies carry
 * the same ids back as their payload. Alerts go only from 6 am to 9 pm, as
 * every hand-off's do (D-578).
 *
 * Pure: the ids, the reading of a tap, and the words.
 */

export type NoteChoice = RegisterMark | "dismiss";

/** In the order the buttons show. */
export const NOTE_CHOICES: readonly NoteChoice[] = ["leave", "absent", "dismiss"];

const BUTTON_WORDS: Record<NoteChoice, Pair> = {
  leave: SUGGESTION_WORDS.leave,
  absent: SUGGESTION_WORDS.absent,
  dismiss: SUGGESTION_WORDS.notNow,
};

/** A pair in a member of staff's WhatsApp language. */
export function inLanguage(pair: Pair, language: StaffLanguage): string {
  return language === "hi" ? (pair.hi ?? pair.en) : pair.en;
}

const NOTE_ID = /^vpnote:(leave|absent|dismiss):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** What a button says back when tapped: the choice and the note, and nothing else. */
export function noteButtonId(choice: NoteChoice, suggestionId: string): string {
  return `vpnote:${choice}:${suggestionId.toLowerCase()}`;
}

/** The three buttons' words, which the approved note's quick replies say too. */
export function noteButtonTitles(language: StaffLanguage): string[] {
  return NOTE_CHOICES.map((choice) => inLanguage(BUTTON_WORDS[choice], language));
}

/** Each quick reply's payload, in the buttons' order. */
export function noteButtonPayloads(suggestionId: string): string[] {
  return NOTE_CHOICES.map((choice) => noteButtonId(choice, suggestionId));
}

/** "Today · Sick", "Thu 13 Nov – Sat 15 Nov · Other reason": the note's days and why. */
export function awayLine(note: AbsenceNote, language: StaffLanguage, today: string): string {
  return `${inLanguage(daysLabel(note.days, today), language)} · ${inLanguage(REASON_LABELS[note.reason], language)}`;
}

/** The typed alert with its three buttons, for a person whose chat with the school is open. */
export function awayNoteMessage(words: AlertWords & { away: string }, suggestionId: string): HelperMessage {
  return {
    kind: "buttons",
    body: staffAlertText(words),
    buttons: NOTE_CHOICES.map((choice) => ({ id: noteButtonId(choice, suggestionId), title: inLanguage(BUTTON_WORDS[choice], words.language) })),
  };
}

const KIND_SUFFIX: Record<AlertKind, Pair | null> = {
  alert: null,
  reminder: p("reminder", "याद दिला रहे हैं"),
  passed_up: p("not answered for a day", "एक दिन से जवाब नहीं"),
};

/**
 * The approved note's four blanks, in order: the person's name, the student,
 * the days and why ("· reminder" on a reminder), and the parent's words.
 */
export function awayNoteParams(words: AlertWords & { away: string }): string[] {
  const suffix = KIND_SUFFIX[words.kind];
  const away = suffix ? `${words.away} · ${inLanguage(suffix, words.language)}` : words.away;
  return [oneLine(words.staffName, 40), oneLine(words.studentLabel, 60), oneLine(away, 60), oneLine(words.words, WORDS_IN_ALERT)];
}

/** A tap on one of a note's buttons. No note named: the alert it answers says which. */
export type NoteTap = { choice: NoteChoice; suggestionId: string | null };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The tap, from the raw WhatsApp message: a reply button on the typed alert
 * (`interactive.button_reply.id`) or a quick reply on the approved one
 * (`button.payload`). A quick reply that came back with no payload of ours is
 * read by its words alone, in either language. Null for anything else,
 * typed words included: those are an answer for the parent.
 */
export function readNoteTap(raw: Record<string, unknown> | null | undefined): NoteTap | null {
  if (!raw) return null;
  const quickReply = raw.type === "button";
  if (!quickReply && raw.type !== "interactive") return null;
  const reply = quickReply ? record(raw.button) : record(record(raw.interactive).button_reply);
  const id = text(quickReply ? reply.payload : reply.id);
  const match = NOTE_ID.exec(id);
  if (match) return { choice: match[1]!.toLowerCase() as NoteChoice, suggestionId: match[2]!.toLowerCase() };
  if (!quickReply) return null;
  const words = (text(reply.text) || id).toLowerCase();
  const choice = NOTE_CHOICES.find((candidate) => {
    const pair = BUTTON_WORDS[candidate];
    return words === pair.en.toLowerCase() || words === (pair.hi ?? pair.en).toLowerCase();
  });
  return choice ? { choice, suggestionId: null } : null;
}

/** What became of a tap. `gone`: the alert's note could not be found, or the tap named another. */
export type NoteResult =
  | { outcome: "applied"; mark: RegisterMark }
  | { outcome: "dismissed" }
  | { outcome: "already"; decided: Pair | null }
  | { outcome: "expired" | "not_permitted" | "failed" | "gone" };

const UNDO = p("↩️ Changed your mind? Open One and press Undo under Decided today.", "↩️ बदलना हो तो One खोलें और 'आज तय हुए' में वापस लें दबाएँ।");
const NO_ALERT = p("The parent gets no absent message for those days.", "उन दिनों अभिभावक को अनुपस्थिति का संदेश नहीं जाएगा।");
const TRY_IN_ONE = p("Please decide it in One instead.", "कृपया इसे One में तय करें।");

/**
 * What the person who tapped is told, in their language. Never that the
 * register is saved: an applied note says how the register starts the child,
 * and a register already saved keeps its marks.
 */
export function noteConfirmText(input: {
  result: NoteResult;
  language: StaffLanguage;
  /** "Aarav · Class 6". */
  studentLabel: string;
  /** "Today", "Thu 13 Nov – Sat 15 Nov", when the note's days are known. */
  days: string | null;
  /** Practice: the test account the owner's number decided as. */
  practiceFor: string | null;
}): string {
  const say = (pair: Pair) => inLanguage(pair, input.language);
  const student = oneLine(input.studentLabel, 60);
  const days = input.days ? ` · ${oneLine(input.days, 40)}` : "";
  const { result } = input;
  let lines: string[];
  switch (result.outcome) {
    case "applied":
      lines = [`✅ ${say(decidedMessage({ decision: "apply", kind: "absence", mark: result.mark, count: 1, childName: student }))}${days}`, say(NO_ALERT), say(UNDO)];
      break;
    case "dismissed":
      lines = [`👍 ${say(decidedMessage({ decision: "dismiss", kind: "absence", count: 1, childName: student }))}`, say(UNDO)];
      break;
    case "already":
      lines = [`ℹ️ ${say(decideRefusal("already"))}`, ...(result.decided ? [`${say(result.decided)} · ${student}`] : [])];
      break;
    case "expired":
      lines = [`⏱️ ${say(decideRefusal("expired"))}`];
      break;
    case "not_permitted":
      lines = [`🚫 ${say(decideRefusal("not_permitted"))}`];
      break;
    case "gone":
      lines = [`⚠️ ${say(decideRefusal("not_found"))}`];
      break;
    case "failed":
      lines = [`⚠️ ${say(decideRefusal("failed"))}`, say(TRY_IN_ONE)];
      break;
  }
  if (input.practiceFor) {
    const name = oneLine(input.practiceFor, 40);
    lines.push(say(p(`🧪 Practice: decided as ${name}, on test records.`, `🧪 अभ्यास: ${name} की ओर से, परीक्षण रिकॉर्ड पर।`)));
  }
  return lines.join("\n");
}
