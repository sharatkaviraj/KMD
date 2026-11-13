import { MAX_AGE_YEARS, MIN_AGE_YEARS } from "@/modules/collection/domain/fields";
import { addDays } from "@/platform/dates";
import { shortDayP } from "@/vx/format";
import { p, type Pair } from "@/vx/text";

import type { AbsenceReason } from "./helper-absence";
import type { VisitPart } from "./helper-visit";
import { MARK_LABELS, SUGGESTION_WORDS, type RegisterMark } from "./parent-suggestion-words";

/**
 * A parent's WhatsApp never changes a child's record or the school's on its
 * own (D-598; the owner, 12 Nov 2026: "Don't let parents responses affect
 * the data of the student or school"). What Veer Patta AI reads that
 * belongs in a record becomes a suggestion, and a person at school applies
 * it or lets it go:
 *
 *  - absence: a child the parent says will be away (D-588). The class
 *    teacher decides it, Leave or Absent on the register; so may whoever
 *    corrects attendance, and the office when the class has no class teacher.
 *  - visit: a school visit a family asked for (D-592), for the office to put
 *    on the Admissions board.
 *  - record: a detail the parent asks the school to change (a phone number,
 *    an address), for the office to check first.
 *
 * Pure: the shapes, the checks and the words. The rules that matter live in
 * the database (`supabase/migrations/*_parent_suggestions.sql`): who may
 * decide, when a suggestion stops waiting, and that only a decision writes.
 */

export type SuggestionKind = "absence" | "visit" | "record";
export type SuggestionStatus = "pending" | "applied" | "dismissed" | "undone";
export type SuggestionRoute = "class_teacher" | "office";
/** Where a person decided it. */
export type DecidedVia = "needs_you" | "teacher_home" | "register" | "whatsapp";
export { MARK_LABELS, markAllLabel, SUGGESTION_WORDS, type RegisterMark } from "./parent-suggestion-words";

/** The details a parent may ask the school to change, as One's collected fields name them. */
export const CHANGE_FIELDS = ["guardian_phone", "mother_phone", "date_of_birth", "blood_group", "address"] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];
export type ChangeRequest = { field: ChangeField; value: string };

/** The fields' own labels (`collection_fields.label_en`, `label_hi`). */
export const FIELD_LABELS: Record<ChangeField, Pair> = {
  guardian_phone: p("Guardian phone", "अभिभावक का फ़ोन"),
  mother_phone: p("Mother phone", "माता का फ़ोन"),
  date_of_birth: p("Date of birth", "जन्म तिथि"),
  blood_group: p("Blood group", "रक्त समूह"),
  address: p("Address", "पता"),
};

/** The blood group field's own choices. */
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export const ADDRESS_CHARS = { min: 10, max: 200 } as const;

/**
 * What the helper hands the database. Never the parent's words: those stay
 * in the hand-off (`parent_replies`), where every hand-off's are.
 */
export type SuggestionDraft =
  | { kind: "absence"; sessionLabel: string; studentId: string; parentReplyId: string; practice: boolean; payload: { days: string[]; reason: AbsenceReason } }
  | {
      kind: "visit";
      sessionLabel: string;
      studentId: null;
      parentReplyId: string;
      practice: boolean;
      payload: { day: string; part: VisitPart; child_name: string; class_label: string | null };
    }
  | { kind: "record"; sessionLabel: string; studentId: string; parentReplyId: string; practice: boolean; payload: ChangeRequest };

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DMY = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;

/** "2015-03-09" from "2015-03-09" or "9/3/2015" (day first, as dates are written here); null when it is no date. */
function isoDate(raw: string): string | null {
  const iso = ISO.exec(raw);
  const dmy = iso ? null : DMY.exec(raw);
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!year || !month || !day) return null;
  const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(at.getTime()) || at.getUTCMonth() !== Number(month) - 1 || at.getUTCDate() !== Number(day)) return null;
  return at.toISOString().slice(0, 10);
}

function bloodGroup(raw: string): string | null {
  const compact = raw
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^0/, "O")
    .replace(/(POSITIVE|POS|\+VE|VE\+)$/, "+")
    .replace(/(NEGATIVE|NEG|-VE|VE-)$/, "-");
  return (BLOOD_GROUPS as readonly string[]).includes(compact) ? compact : null;
}

/**
 * A change Claude read in a parent's message, in the form the record keeps,
 * or null when it is not one the school would take: a phone that is not a
 * whole Indian mobile number, a date of birth outside a school child's age,
 * a blood group that is not one of the eight, an address too short to be
 * one. Strict on purpose: a person still checks it, but a wrong number
 * should never reach that person looking right.
 */
export function normaliseChange(change: { field: string; value: string } | null | undefined, today: string): ChangeRequest | null {
  if (!change || !(CHANGE_FIELDS as readonly string[]).includes(change.field)) return null;
  const field = change.field as ChangeField;
  const raw = String(change.value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  switch (field) {
    case "guardian_phone":
    case "mother_phone": {
      const digits = raw.replace(/\D/g, "");
      // Ten digits, or ten behind +91 or a 0: never a number cut down to fit.
      const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
      return /^[6-9]\d{9}$/.test(ten) ? { field, value: ten } : null;
    }
    case "date_of_birth": {
      const day = isoDate(raw);
      if (!day || day > today) return null;
      const years = (Date.parse(today) - Date.parse(day)) / (365.25 * 86_400_000);
      return years >= MIN_AGE_YEARS && years <= MAX_AGE_YEARS ? { field, value: day } : null;
    }
    case "blood_group": {
      const group = bloodGroup(raw);
      return group ? { field, value: group } : null;
    }
    case "address":
      return raw.length >= ADDRESS_CHARS.min && raw.length <= ADDRESS_CHARS.max ? { field, value: raw } : null;
  }
}

/* ------------------------------------------------------------ for staff */

/** "Today", "Tomorrow", "Fri 14 Nov", or "Thu 13 Nov – Sat 15 Nov". */
export function daysLabel(days: readonly string[], today: string): Pair {
  const one = (day: string): Pair => (day === today ? p("Today", "आज") : day === addDays(today, 1) ? p("Tomorrow", "कल") : shortDayP(day));
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return p("—");
  if (first === last) return one(first);
  const a = one(first);
  const b = one(last);
  return p(`${a.en} – ${b.en}`, `${a.hi ?? a.en} – ${b.hi ?? b.en}`);
}

export const REASON_LABELS: Record<AbsenceReason, Pair> = {
  sick: p("Sick", "बीमार"),
  other: p("Other reason", "अन्य कारण"),
};

export const PART_LABELS: Record<VisitPart, Pair> = {
  morning: p("Morning", "सुबह"),
  afternoon: p("Afternoon", "दोपहर"),
};

/** The one line that says what the parent told the school, naming the child. Never a gendered verb. */
export function suggestionTitle(input: { kind: SuggestionKind; childName: string; reason?: AbsenceReason | null; field?: ChangeField | null }): Pair {
  const name = input.childName || "—";
  if (input.kind === "absence") {
    return input.reason === "sick"
      ? p(`Parent says ${name} is sick`, `${name} बीमार · अभिभावक ने बताया`)
      : p(`Parent says ${name} will be away`, `${name} की छुट्टी · अभिभावक ने बताया`);
  }
  if (input.kind === "visit") return p(`School visit · ${name}`, `स्कूल देखने आना · ${name}`);
  const label = FIELD_LABELS[input.field ?? "address"];
  return p(`Change ${label.en.toLowerCase()}? · ${name}`, `${label.hi ?? label.en} बदलें? · ${name}`);
}

/** What each kind's buttons do, said under them. */
export const SUGGESTION_FOOTNOTES: Record<SuggestionKind, Pair> = {
  absence: p(
    "Leave or Absent is how the register starts the child on those days, and no absent message goes to the parent for them. A register already saved keeps its marks. Not now changes nothing. You can undo either.",
    "छुट्टी या अनुपस्थित चुनने पर उन दिनों रजिस्टर में बच्चा वैसा ही शुरू होगा, और अभिभावक को अनुपस्थिति का संदेश नहीं जाएगा। पहले से सहेजा रजिस्टर नहीं बदलता। अभी नहीं से कुछ नहीं बदलता। दोनों को वापस ले सकते हैं।",
  ),
  visit: p(
    "Add to Admissions puts the visit on the Admissions board with the parent's number, for the office to call. Not now changes nothing.",
    "प्रवेश में जोड़ने पर यह मुलाक़ात अभिभावक के नंबर के साथ प्रवेश बोर्ड पर आ जाएगी, ताकि ऑफ़िस फ़ोन कर सके। अभी नहीं से कुछ नहीं बदलता।",
  ),
  record: p(
    "Check with the family before you change a phone number. Apply writes the new value to the child's record in One and keeps the old one in its history. Not now changes nothing.",
    "फ़ोन नंबर बदलने से पहले परिवार से पुष्टि कर लें। लागू करने पर नया मान One में बच्चे के रिकॉर्ड में लिखा जाएगा और पुराना उसके इतिहास में रहेगा। अभी नहीं से कुछ नहीं बदलता।",
  ),
};

/**
 * What a person is told once a decision went through. Never that the
 * register is saved: applying an absence says how the register starts the
 * child, and a register already saved keeps its marks.
 */
export function decidedMessage(input: { decision: "apply" | "dismiss"; kind: SuggestionKind; mark?: RegisterMark | null; count: number; childName?: string | null }): Pair {
  const name = input.count === 1 && input.childName ? ` · ${input.childName}` : "";
  if (input.decision === "dismiss") {
    return input.count === 1 ? p(`Let go · nothing was changed${name}`, `छोड़ दिया · कुछ नहीं बदला${name}`) : p(`${input.count} let go · nothing was changed`, `${input.count} छोड़े · कुछ नहीं बदला`);
  }
  if (input.kind === "absence") {
    const mark = MARK_LABELS[input.mark ?? "leave"];
    return input.count === 1
      ? p(`${mark.en} noted for the register${name}`, `रजिस्टर के लिए ${mark.hi ?? mark.en} दर्ज${name}`)
      : p(`${input.count} noted as ${mark.en} for the register`, `${input.count} बच्चों की ${mark.hi ?? mark.en} रजिस्टर के लिए दर्ज`);
  }
  if (input.kind === "visit") return input.count === 1 ? p("Added to Admissions", "प्रवेश में जोड़ा") : p(`${input.count} added to Admissions`, `${input.count} प्रवेश में जोड़े`);
  return input.count === 1 ? p(`Changed in the child's record${name}`, `बच्चे के रिकॉर्ड में बदला${name}`) : p(`${input.count} records changed`, `${input.count} रिकॉर्ड बदले`);
}

/** What a person is told once an undo went through: it waits again, or its time has passed. */
export function undoneMessage(status: "pending" | "undone", count = 1): Pair {
  if (count > 1) return p(`${count} undone`, `${count} वापस लिए`);
  return status === "pending"
    ? p("Undone · it waits for a decision again", "वापस लिया · यह फिर फ़ैसले का इंतज़ार कर रहा है")
    : p("Undone · its day has passed, so it no longer waits", "वापस लिया · इसका दिन बीत गया, इसलिए अब इंतज़ार में नहीं है");
}

/**
 * Who sees a waiting suggestion in Needs you (D-598; the owner: "attendance
 * and leave go to the class teacher, contact details and visits to the
 * office, and the admin sees them all in one list"). A class teacher decides
 * their own class's on Today; Needs you shows an absence to the office only
 * when the class has no class teacher. The database still decides who may
 * apply each one.
 */
export type SuggestionReader = { admin: boolean; correctsAttendance: boolean; office: boolean; feeDesk: boolean };

export function inNeedsYou(row: { kind: SuggestionKind; route: SuggestionRoute }, reader: SuggestionReader): boolean {
  if (reader.admin) return true;
  switch (row.kind) {
    case "absence":
      return row.route === "office" && reader.correctsAttendance;
    case "visit":
      return reader.office || reader.feeDesk;
    case "record":
      return reader.office;
  }
}

/* ------------------------------------------------------------ one card */

export type SuggestionCardInput = {
  kind: SuggestionKind;
  payload: Record<string, unknown>;
  /** The child's name from the roll; for a visit, the name the parent typed. */
  childName: string;
  classLabel: string | null;
  /** School's own day, "YYYY-MM-DD". */
  today: string;
};

export type SuggestionCard = {
  title: Pair;
  /** One line under the title: the days and why, the visit's day and time, or the detail. */
  line: Pair;
  /** A record change: the value now and the one the parent asks for, side by side. */
  change: { field: Pair; was: string | null; becomes: string } | null;
  /** An absence that covers today: the register is marked this morning. */
  urgent: boolean;
};

const stringOf = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The days an absence suggestion holds, as written by the database: whole "YYYY-MM-DD" strings, in order. */
export function suggestionDays(payload: Record<string, unknown>): string[] {
  const days = Array.isArray(payload.days) ? payload.days : [];
  return days.filter((day): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
}

/** "Today · Sick · Class 6", "Mon 16 Nov · Morning · Class 3", "Guardian phone · Class 6". */
export function suggestionCard(input: SuggestionCardInput): SuggestionCard {
  const join = (parts: Array<Pair | string | null>): Pair => {
    const kept = parts.filter((part): part is Pair | string => part !== null && part !== "");
    return p(kept.map((part) => (typeof part === "string" ? part : part.en)).join(" · "), kept.map((part) => (typeof part === "string" ? part : (part.hi ?? part.en))).join(" · "));
  };
  if (input.kind === "absence") {
    const days = suggestionDays(input.payload);
    const reason: AbsenceReason = input.payload.reason === "sick" ? "sick" : "other";
    return {
      title: suggestionTitle({ kind: "absence", childName: input.childName, reason }),
      line: join([daysLabel(days, input.today), REASON_LABELS[reason], input.classLabel]),
      change: null,
      urgent: days.includes(input.today),
    };
  }
  if (input.kind === "visit") {
    const day = stringOf(input.payload.day);
    const part: VisitPart = input.payload.part === "afternoon" ? "afternoon" : "morning";
    return {
      title: suggestionTitle({ kind: "visit", childName: input.childName }),
      line: join([day ? daysLabel([day], input.today) : null, PART_LABELS[part], stringOf(input.payload.class_label)]),
      change: null,
      urgent: false,
    };
  }
  const field = (CHANGE_FIELDS as readonly string[]).includes(String(input.payload.field)) ? (input.payload.field as ChangeField) : "address";
  return {
    title: suggestionTitle({ kind: "record", childName: input.childName, field }),
    line: join([FIELD_LABELS[field], input.classLabel]),
    change: { field: FIELD_LABELS[field], was: stringOf(input.payload.was), becomes: stringOf(input.payload.value) ?? "—" },
    urgent: false,
  };
}

/**
 * The line beside a child on the register while their parent's note still
 * waits (D-601): "Parent says sick", "Parent says away · till Fri 14 Nov".
 * Never "informed": nobody at school has applied it yet. The parent's own
 * words stay on the Needs you and Today cards.
 */
export function registerAskLine(input: { payload: Record<string, unknown>; day: string; practice: boolean }): Pair {
  const said = input.payload.reason === "sick" ? p("Parent says sick", "अभिभावक कहते हैं: बीमार") : p("Parent says away", "अभिभावक कहते हैं: छुट्टी");
  const last = suggestionDays(input.payload).at(-1);
  const till = last && last > input.day ? shortDayP(last) : null;
  const parts = [said, ...(till ? [p(`till ${till.en}`, `${till.hi} तक`)] : []), ...(input.practice ? [SUGGESTION_WORDS.practice] : [])];
  return p(parts.map((part) => part.en).join(" · "), parts.map((part) => part.hi ?? part.en).join(" · "));
}

/** The parent's own words for a card: one paragraph, at most `max` characters. */
export function wordsForCard(body: string | null | undefined, max = 280): string | null {
  const flat = String(body ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** "Leave · Test Teacher · 9:10 am": what was decided and by whom, for the undo list. */
export function decidedLabel(input: { status: SuggestionStatus; kind: SuggestionKind; mark?: RegisterMark | null; by: string | null }): Pair {
  const what: Pair =
    input.status === "dismissed"
      ? SUGGESTION_WORDS.notNow
      : input.kind === "absence"
        ? MARK_LABELS[input.mark ?? "absent"]
        : input.kind === "visit"
          ? p("Added to Admissions", "प्रवेश में जोड़ा")
          : p("Applied", "लागू किया");
  const by = input.by ? ` · ${input.by}` : "";
  return p(`${what.en}${by}`, `${what.hi ?? what.en}${by}`);
}

/** Why a decision did not go through, in words a person can act on. */
export function decideRefusal(outcome: string, reason?: string | null): Pair {
  switch (outcome) {
    case "already":
      return p("Someone has already decided this one.", "इसे पहले ही कोई तय कर चुका है।");
    case "expired":
      return p("Its day has passed, so it no longer waits. Nothing was changed.", "इसका दिन बीत गया, इसलिए यह अब इंतज़ार में नहीं है। कुछ नहीं बदला।");
    case "not_permitted":
      return p("This one is for someone else to decide. Nothing was changed.", "इसे कोई और तय करेगा। कुछ नहीं बदला।");
    case "not_found":
      return p("It is no longer there. Nothing was changed.", "यह अब नहीं है। कुछ नहीं बदला।");
    default:
      return reason === "handoff_gone"
        ? p("The parent's message is gone, so the visit could not be added.", "अभिभावक का संदेश नहीं रहा, इसलिए मुलाक़ात नहीं जुड़ सकी।")
        : p("That did not go through. Nothing was changed.", "यह नहीं हो पाया। कुछ नहीं बदला।");
  }
}

/** Why an undo did not go through. */
export function undoRefusal(reason: string): Pair {
  switch (reason) {
    case "enquiry_moved":
      return p("The office has already started on this enquiry, so it stays. Change it on the Admissions board.", "ऑफ़िस इस पूछताछ पर काम शुरू कर चुका है, इसलिए यह रहेगी। बदलाव प्रवेश बोर्ड पर करें।");
    case "record_moved":
      return p("Someone has changed this detail since, so it stays as it is now.", "इसके बाद किसी ने यह जानकारी बदल दी है, इसलिए यह अभी जैसी है वैसी रहेगी।");
    case "not_permitted":
      return p("Only someone who may decide it can undo it.", "इसे वही वापस ले सकता है जो इसे तय कर सकता है।");
    case "not_decided":
      return p("It has not been decided, so there is nothing to undo.", "यह अभी तय नहीं हुआ, इसलिए वापस लेने को कुछ नहीं है।");
    default:
      return p("That did not go through. Nothing was changed.", "यह नहीं हो पाया। कुछ नहीं बदला।");
  }
}
