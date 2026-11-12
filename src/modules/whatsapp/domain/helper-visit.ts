import { isSchoolOpen, type CalendarDayKind } from "@/modules/academics/domain/calendar";
import { addDays, isIsoDay, weekdayIndex } from "@/platform/dates";

import type { HelperButton, HelperMessage, HelperRow } from "./helper-messages";
import { CANCEL_BUTTON, dateText, footer, intro, MENU_BUTTON, OFFICE_BUTTON, OFFICE_PHONE, say, type ReplyContext, type Words } from "./helper-replies";
import { helperId, QUESTION_WORDS, type HelperLanguage } from "./helper-text";

/**
 * Booking a school visit on WhatsApp (D-592): a family that wants a child
 * admitted picks a day, then morning or afternoon, then types the child's
 * name and class. The office is told the way every hand-off tells it
 * (Messages, and WhatsApp between 6 am and 9 pm), and the visit shows on the
 * Admissions board as an enquiry with its day.
 *
 * Pure. The days come from the school's own calendar, read by the data
 * layer: a holiday or the vacation is never offered, and neither is Sunday
 * unless the calendar opens it. The helper never promises a time: the office
 * calls to fix one.
 */

export type VisitPart = "morning" | "afternoon";
export const VISIT_PARTS: readonly VisitPart[] = ["morning", "afternoon"];

/** Days in the list, the soonest first. */
export const VISIT_DAYS_SHOWN = 6;
/** How far ahead a visit can be booked. */
export const VISIT_LOOKAHEAD_DAYS = 21;

/** Today in the school's day, and the calendar's own word for the days ahead (none for an ordinary day). */
export type VisitCalendar = { today: string; kinds: Map<string, CalendarDayKind> };

export type VisitSlot = { day: string; part: VisitPart };

/** What the parent asked for: the slot, and the child as they typed it (either may be missing). */
export type VisitBooking = VisitSlot & { childName: string | null; classLabel: string | null };

/**
 * An enquiry always has a child's name (`enquiries.child_name` is required).
 * A parent who typed only the class gets this, and the Admissions board
 * shows "Name not given" for it.
 */
export const VISIT_NAME_NOT_GIVEN = "-";

/* ---------------------------------------------------------------- days */

/** The days a visit can be booked for: open days from tomorrow, within three weeks. */
export function visitDays(calendar: VisitCalendar, count: number = VISIT_DAYS_SHOWN): string[] {
  const days: string[] = [];
  for (let offset = 1; offset <= VISIT_LOOKAHEAD_DAYS && days.length < count; offset += 1) {
    const day = addDays(calendar.today, offset);
    if (isSchoolOpen(day, calendar.kinds)) days.push(day);
  }
  return days;
}

/** Whether a day from an earlier list can still be booked. */
export function canVisitOn(day: string, calendar: VisitCalendar): boolean {
  return visitDays(calendar, VISIT_LOOKAHEAD_DAYS).includes(day);
}

/* ---------------------------------------------------------------- keys */

const DAY_KEY = /^(\d{4})(\d{2})(\d{2})$/;
const SLOT_KEY = /^(\d{8})(am|pm)$/;
const PART_KEY: Record<VisitPart, "am" | "pm"> = { morning: "am", afternoon: "pm" };

/** "2026-11-16" -> "20261116": a button id carries no dashes (`helperId`). */
export function dayKey(day: string): string {
  return day.replace(/-/g, "");
}

export function dayFromKey(key: string | null | undefined): string | null {
  const match = DAY_KEY.exec(key ?? "");
  if (!match) return null;
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  return isIsoDay(day) ? day : null;
}

/** "20261116am": the day and the part, in one button id or one chat memory. */
export function slotKey(slot: VisitSlot): string {
  return `${dayKey(slot.day)}${PART_KEY[slot.part]}`;
}

export function readSlotKey(key: string | null | undefined): VisitSlot | null {
  const match = SLOT_KEY.exec(key ?? "");
  if (!match) return null;
  const day = dayFromKey(match[1]);
  return day ? { day, part: match[2] === "am" ? "morning" : "afternoon" } : null;
}

const AWAIT_PREFIX = "visit:";

/** What the chat waits for once a slot is picked: the child's name and class. */
export function visitAwaiting(slot: VisitSlot): string {
  return `${AWAIT_PREFIX}${slotKey(slot)}`;
}

/** The slot a chat is waiting on, or null when it waits for something else. */
export function awaitingVisit(awaiting: string | null | undefined): VisitSlot | null {
  if (!awaiting?.startsWith(AWAIT_PREFIX)) return null;
  return readSlotKey(awaiting.slice(AWAIT_PREFIX.length));
}

/* -------------------------------------------------------- the child typed */

const DEVANAGARI_DIGIT = /[०-९]/g;

function westernDigits(text: string): string {
  return text.replace(DEVANAGARI_DIGIT, (digit) => String(digit.charCodeAt(0) - 0x0966));
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

/**
 * A class said in words: "class five", "panchvi kaksha", "कक्षा पाँचवीं".
 * Only beside the word for class: "dusri school" is another school, and
 * "pehli baar" is the first time.
 */
const CLASS_WORDS: Array<[string[], number]> = [
  [["pehli", "pahli", "first", "one", "पहली"], 1],
  [["dusri", "doosri", "dusari", "second", "two", "दूसरी"], 2],
  [["tisri", "teesri", "tisari", "third", "three", "तीसरी"], 3],
  [["chauthi", "chouthi", "fourth", "four", "चौथी"], 4],
  [["panchvi", "paanchvi", "panchwi", "panchvin", "fifth", "five", "पाँचवीं", "पांचवीं", "पाँचवी", "पांचवी"], 5],
  [["chhathi", "chhati", "chathi", "chhatvi", "sixth", "six", "छठी", "छटी"], 6],
  [["satvi", "saatvi", "satwi", "seventh", "seven", "सातवीं", "सातवी"], 7],
  [["athvi", "aathvi", "aathwi", "eighth", "eight", "आठवीं", "आठवी"], 8],
  [["nauvi", "nouvi", "nanvi", "nauwi", "ninth", "nine", "नौवीं", "नौवी", "नवीं", "नवी"], 9],
  [["dasvi", "daswi", "dasvin", "tenth", "ten", "दसवीं", "दसवी"], 10],
  [["gyarahvi", "gyarvi", "gyarahwi", "eleventh", "eleven", "ग्यारहवीं", "ग्यारहवी", "ग्यारवीं"], 11],
  [["barahvi", "barvi", "barahwi", "twelfth", "twelve", "बारहवीं", "बारहवी", "बारवीं"], 12],
];

/** The school's own pre-primary labels: Nursery, JKG, SKG. */
const PRE_PRIMARY: Array<[RegExp, string]> = [
  [/\b(nursery|nursary|nursury|nersary)\b|नर्सरी/i, "Nursery"],
  [/\b(lkg|jkg|junior\s?kg|kg\s?-?\s?(1|i))\b|एलकेजी|जेकेजी/i, "JKG"],
  [/\b(ukg|skg|senior\s?kg|kg\s?-?\s?(2|ii))\b|यूकेजी|एसकेजी/i, "SKG"],
  [/\bk\.?g\b|केजी/i, "KG"],
];

const STREAMS: Array<[RegExp, string]> = [
  [/\b(science|sci|biology|bio|maths?|pcm|pcb)\b|विज्ञान|साइंस/i, "Science"],
  [/\b(commerce|comm)\b|वाणिज्य|कॉमर्स/i, "Commerce"],
  [/\b(arts?|humanities)\b|कला|आर्ट्स/i, "Arts"],
  [/\b(agriculture|agri)\b|कृषि/i, "Agriculture"],
];

const CLASS_WORD = "(?:class|cls|std|standard|grade|kaksha|kaksa)";
/** Letters of either script: what a word boundary means for "कक्षा" as much as for "class". */
const NOT_LETTER = "[^a-z\u0900-\u097f]";
const CLASS_NOUN = `(?:${CLASS_WORD}|कक्षा)`;
/**
 * "class 5", "class-v", "kaksha 5", "कक्षा 5". The separator is spelled as
 * alternatives, not a bracketed set: Tailwind scans src/ and reads a bracketed
 * dash-colon-dot as a CSS property, which breaks the CSS build.
 */
const CLASS_THEN_NUMBER = new RegExp(`\\b${CLASS_WORD}\\s*(?:-|:|\\.)?\\s*(\\d{1,2}|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)(?:st|nd|rd|th)?\\b`, "i");
const HINDI_CLASS_THEN_NUMBER = /कक्षा\s*[-:]?\s*(\d{1,2})/;
/** "5th", "5th class", "5 class", "5vi", "5वीं", "5 वी कक्षा". */
const NUMBER_THEN_CLASS = new RegExp(`\\b(\\d{1,2})\\s*(?:st|nd|rd|th|vi|vin|wi)?\\s*${CLASS_WORD}\\b`, "i");
const ORDINAL = /\b(\d{1,2})\s*(?:st|nd|rd|th)\b/i;
const HINDI_ORDINAL = /(\d{1,2})\s*(?:वीं|वी|वीँ)/;
/** An age, not a class: "8 saal", "6 years". */
const AGE_AFTER = /^\s*(?:saal|sal|years?|yrs?|yr|varsh|mahine|months?|साल|वर्ष|महीने)/i;

type ClassMatch = { label: string; text: string };

function classLabelFor(grade: number, text: string): string | null {
  if (!Number.isInteger(grade) || grade < 1 || grade > 12) return null;
  if (grade >= 11) {
    const stream = STREAMS.find(([pattern]) => pattern.test(text))?.[1];
    if (stream) return `${grade} ${stream}`;
  }
  return `Class ${grade}`;
}

function gradeOf(raw: string): number {
  return ROMAN[raw.toLowerCase()] ?? Number(raw);
}

function findClass(text: string): ClassMatch | null {
  for (const [pattern, label] of PRE_PRIMARY) {
    const match = pattern.exec(text);
    if (match) return { label, text: match[0] };
  }
  for (const pattern of [CLASS_THEN_NUMBER, HINDI_CLASS_THEN_NUMBER, NUMBER_THEN_CLASS, ORDINAL, HINDI_ORDINAL]) {
    const match = pattern.exec(text);
    const label = match ? classLabelFor(gradeOf(match[1]), text) : null;
    if (match && label) return { label, text: match[0] };
  }
  for (const [words, grade] of CLASS_WORDS) {
    const said = words.join("|");
    const pattern = new RegExp(`(?:^|${NOT_LETTER})(?:${CLASS_NOUN}\\s*(?:${said})|(?:${said})\\s*${CLASS_NOUN})(?=$|${NOT_LETTER})`, "i");
    const match = pattern.exec(text);
    const label = match ? classLabelFor(grade, text) : null;
    if (match && label) return { label, text: match[0] };
  }
  // A number on its own, 1 to 12, and not an age.
  const bare = /(?:^|[\s,.;:])(\d{1,2})(?=$|[\s,.;:])/g;
  for (const match of text.matchAll(bare)) {
    const after = text.slice((match.index ?? 0) + match[0].length);
    if (AGE_AFTER.test(after)) continue;
    const label = classLabelFor(Number(match[1]), text);
    if (label) return { label, text: match[1] };
  }
  return null;
}

/** Words that are never part of a child's name, in the ways parents write, and the question words. */
const NOT_A_NAME = new Set<string>([
  ...QUESTION_WORDS,
  "name", "naam", "nam", "is", "my", "our", "son", "daughter", "child", "kid", "baby", "boy", "girl", "beta", "beti", "bachcha",
  "bachche", "baccha", "bacche", "bachchi", "bacchi", "mera", "meri", "mere", "hamara", "hamari", "hamare", "ka", "ki", "ke", "ko",
  "hai", "he", "h", "hain", "hy", "for", "in", "of", "the", "a", "an", "and", "aur", "or", "ya", "admission", "admissions", "admisson",
  "addmission", "admision", "dakhila", "daakhila", "dakhla", "pravesh", "chahiye", "chahie", "chaiye", "chahte", "chahta", "chahti",
  "karna", "karwana", "karana", "karwani", "karvana", "me", "mein", "mai", "main", "mujhe", "hume", "humein", "want", "wants",
  "need", "needs", "to", "take", "school", "visit", "please", "plz", "pls", "sir", "madam", "mam", "maam", "ji", "class", "cls",
  "kaksha", "kaksa", "std", "standard", "grade", "wala", "wali", "liye", "lie", "se", "from", "age", "years", "year", "yrs", "yr",
  "saal", "sal", "old", "umar", "umra", "new", "naya", "nayi", "sibling", "brother", "sister", "bhai", "behen", "bahan", "chhota",
  "chhoti", "bada", "badi", "younger", "elder", "will", "be", "come", "coming", "aayega", "aayegi", "ayega", "ayegi", "hoga", "hogi",
  "tha", "thi", "bhi", "abhi", "next", "session", "agle", "agla", "ok", "okay", "thanks", "thank", "you", "dhanyavad", "hello",
  "hi", "namaste", "st", "nd", "rd", "th", "vi", "vin", "kg", "she", "his", "her", "him", "i", "am", "are", "was", "has", "have",
  "this", "that", "it", "we", "they", "wo", "woh", "vo", "yeh", "ye", "uska", "uski", "unka", "unki", "apna", "apni", "apne",
  "नाम", "मेरा", "मेरी", "मेरे", "हमारा", "हमारी", "हमारे", "बेटा", "बेटी", "बच्चा", "बच्चे", "बच्ची", "का", "की", "के", "को", "है",
  "हैं", "में", "और", "या", "लिए", "दाखिला", "दाख़िला", "दाखिले", "प्रवेश", "एडमिशन", "चाहिए", "करना", "करवाना", "कराना", "कक्षा", "जी",
  "स्कूल", "वाला", "वाली", "से", "साल", "वर्ष", "उम्र", "नया", "नई", "भाई", "बहन", "छोटा", "छोटी", "बड़ा", "बड़ी", "भी", "अगले", "सत्र",
  "आएगा", "आएगी", "होगा", "होगी", "था", "थी", "धन्यवाद", "नमस्ते", "वीं", "वी",
]);

const LETTER = /[a-zऀ-ॿ]/i;
const MAX_NAME_WORDS = 4;
export const MAX_VISIT_NAME = 60;

function titleCase(word: string): string {
  return /^[a-z]/i.test(word) ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

/**
 * The child's name and class, as well as a typed line says them:
 * "Riya class 3", "mera beta Aarav hai, 5th me admission", "आरव, कक्षा 5",
 * "Kabir UKG". Either may be null. The office calls the family, so a wrong
 * guess costs a question on the phone, never a seat.
 */
export function readVisitChild(text: string | null | undefined): { childName: string | null; classLabel: string | null } {
  const value = westernDigits(String(text ?? "")).replace(/\s+/g, " ").trim();
  if (!value) return { childName: null, classLabel: null };
  const found = findClass(value);
  let rest = found ? value.replace(found.text, " ") : value;
  for (const [pattern] of STREAMS) rest = rest.replace(new RegExp(pattern.source, "gi"), " ");
  const words = rest
    .split(/[\s,.;:!?।|/\\()[\]{}"'“”‘’\-–—_*~+=&]+/u)
    .filter((word) => word && LETTER.test(word) && !/\d/.test(word) && !NOT_A_NAME.has(word.toLowerCase()))
    .slice(0, MAX_NAME_WORDS)
    .map(titleCase);
  const name = words.join(" ").slice(0, MAX_VISIT_NAME).trim();
  return { childName: name.length >= 2 ? name : null, classLabel: found?.label ?? null };
}

/* -------------------------------------------------------------- the words */

const WEEKDAYS: Record<HelperLanguage, readonly string[]> = {
  hi: ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"],
  hx: ["Ravivar", "Somvar", "Mangalvar", "Budhvar", "Guruvar", "Shukravar", "Shanivar"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

/** "Monday, 16 Nov" / "सोमवार, 16 नवंबर" / "Somvar, 16 Nov". */
export function visitDayText(day: string, language: HelperLanguage, today: string): string {
  return `${WEEKDAYS[language][weekdayIndex(day)]}, ${dateText(day, language, today)}`;
}

const PART_WORDS: Record<VisitPart, Words> = {
  morning: { hi: "सुबह", hx: "subah", en: "morning" },
  afternoon: { hi: "दोपहर", hx: "dopahar", en: "afternoon" },
};

export function visitPartText(part: VisitPart, language: HelperLanguage): string {
  return say(language, PART_WORDS[part]);
}

/** Under an answer about admission (Claude's, or the office's hand-off): start a booking. */
export const VISIT_BUTTON = (language: HelperLanguage): HelperButton => ({
  id: helperId("visit"),
  title: say(language, { hi: "📅 स्कूल देखने आएँ", hx: "📅 School visit", en: "📅 Book a visit" }),
});

/** The message with the visit button added, when it has buttons and room for one more. */
export function withVisitButton(message: HelperMessage, language: HelperLanguage): HelperMessage {
  if (message.kind !== "buttons" || message.buttons.length >= 3) return message;
  if (message.buttons.some((button) => button.id === helperId("visit"))) return message;
  return { ...message, buttons: [VISIT_BUTTON(language), ...message.buttons] };
}

/** Back to the list of days. */
const CHANGE_DAY = (language: HelperLanguage): HelperButton => ({
  id: helperId("visit"),
  title: say(language, { hi: "📅 दिन बदलें", hx: "📅 Din badliye", en: "📅 Change day" }),
});

/** Step 1: the days to choose from. `gone` when the day they tapped can no longer be booked. */
export function visitDaysReply(context: ReplyContext, days: readonly string[], today: string, gone = false): HelperMessage {
  const { language } = context;
  const sorry = gone
    ? `${say(language, {
        hi: "वह दिन अब नहीं चुना जा सकता 🙏 कृपया दूसरा दिन चुनें।",
        hx: "Woh din ab nahi chuna ja sakta 🙏 Kripya doosra din chuniye.",
        en: "That day can no longer be booked 🙏 Please pick another.",
      })}\n\n`
    : "";
  const body = say(language, {
    hi: "🏫 *स्कूल देखने आइए*\n\nआने का दिन चुनें 👇 फिर सुबह या दोपहर चुनें। ऑफ़िस आपको फ़ोन करके समय पक्का करेगा।",
    hx: "🏫 *School dekhne aaiye*\n\nAane ka din chuniye 👇 Phir subah ya dopahar chuniye. Office aapko phone karke samay pakka karega.",
    en: "🏫 *Come and see the school*\n\nPick a day 👇 then morning or afternoon. The office will call you to fix the time.",
  });
  const tomorrow = addDays(today, 1);
  const rows: HelperRow[] = days.slice(0, VISIT_DAYS_SHOWN).map((day) => ({
    id: helperId("visit_day", dayKey(day)),
    title: visitDayText(day, language, today),
    description: day === tomorrow ? say(language, { hi: "कल", hx: "Kal", en: "Tomorrow" }) : null,
  }));
  rows.push({
    id: helperId("office"),
    title: say(language, { hi: "📞 कोई और दिन", hx: "📞 Koi aur din", en: "📞 Another day" }),
    description: say(language, { hi: "ऑफ़िस को लिखें, वे दिन तय करेंगे", hx: "Office ko likhiye, woh din tay karenge", en: "Write to the office and they will fix one" }),
  });
  return {
    kind: "list",
    body: `${intro(context)}${sorry}${body}`,
    button: say(language, { hi: "दिन चुनें", hx: "Din chuniye", en: "Pick a day" }),
    rows,
    footer: footer(context),
  };
}

/** No day can be booked here: the school is closed for weeks, or its calendar could not be read. */
export function visitClosedReply(context: ReplyContext, why: "closed" | "unreadable"): HelperMessage {
  const { language } = context;
  const body =
    why === "closed"
      ? say(language, {
          hi: `🏫 अगले कुछ हफ़्ते स्कूल बंद है, इसलिए अभी यहाँ आने का दिन नहीं चुना जा सकता। ऑफ़िस को लिखें, वे आपके साथ दिन तय करेंगे, या फ़ोन करें: ${OFFICE_PHONE}`,
          hx: `🏫 Agle kuch hafte school band hai, isliye abhi yahan aane ka din nahi chuna ja sakta. Office ko likhiye, woh aapke saath din tay karenge, ya phone kariye: ${OFFICE_PHONE}`,
          en: `🏫 The school is closed for the next few weeks, so a visit cannot be booked here just now. Write to the office and they will fix a day with you, or call: ${OFFICE_PHONE}`,
        })
      : say(language, {
          hi: `🏫 माफ़ कीजिए, अभी यहाँ आने का दिन नहीं चुना जा सकता 🙏 ऑफ़िस को लिखें, वे दिन तय करेंगे, या फ़ोन करें: ${OFFICE_PHONE}`,
          hx: `🏫 Maaf kijiye, abhi yahan aane ka din nahi chuna ja sakta 🙏 Office ko likhiye, woh din tay karenge, ya phone kariye: ${OFFICE_PHONE}`,
          en: `🏫 Sorry, a visit cannot be booked here just now 🙏 Write to the office and they will fix a day, or call: ${OFFICE_PHONE}`,
        });
  return { kind: "buttons", body: `${intro(context)}${body}`, buttons: [OFFICE_BUTTON(language), MENU_BUTTON(language)], footer: footer(context) };
}

/** Step 2: morning or afternoon, on the day they picked. */
export function visitPartReply(context: ReplyContext, day: string, today: string): HelperMessage {
  const { language } = context;
  const body = say(language, {
    hi: `📅 *${visitDayText(day, "hi", today)}*\nकिस समय: सुबह या दोपहर?`,
    hx: `📅 *${visitDayText(day, "hx", today)}*\nKis samay: subah ya dopahar?`,
    en: `📅 *${visitDayText(day, "en", today)}*\nMorning or afternoon?`,
  });
  const part = (value: VisitPart, title: Words): HelperButton => ({ id: helperId("visit_part", slotKey({ day, part: value })), title: say(language, title) });
  return {
    kind: "buttons",
    body,
    buttons: [part("morning", { hi: "🌅 सुबह", hx: "🌅 Subah", en: "🌅 Morning" }), part("afternoon", { hi: "☀️ दोपहर", hx: "☀️ Dopahar", en: "☀️ Afternoon" }), CHANGE_DAY(language)],
    footer: footer(context),
  };
}

function slotLine(slot: VisitSlot, language: HelperLanguage, today: string): string {
  return `📅 ${visitDayText(slot.day, language, today)} · ${visitPartText(slot.part, language)}`;
}

/** Step 3: the child's name and class, typed. */
export function visitDetailsPrompt(context: ReplyContext, slot: VisitSlot, today: string): HelperMessage {
  const { language } = context;
  const ask = say(language, {
    hi: "✍️ अब बच्चे का *नाम* और जिस *कक्षा* में दाख़िला चाहिए, वह लिखें।\nजैसे: _रिया, कक्षा 3_",
    hx: "✍️ Ab bachche ka *naam* aur jis *class* mein admission chahiye, woh likhiye.\nJaise: _Riya, Class 3_",
    en: "✍️ Now type the child's *name* and the *class* you would like admission in.\nFor example: _Riya, Class 3_",
  });
  return { kind: "buttons", body: `${slotLine(slot, language, today)}\n\n${ask}`, buttons: [CANCEL_BUTTON(language)], footer: footer(context) };
}

function childLine(booking: VisitBooking, language: HelperLanguage): string | null {
  const klass = booking.classLabel ? (language === "hi" ? booking.classLabel.replace(/^Class\b/, "कक्षा") : booking.classLabel) : null;
  const parts = [booking.childName, klass].filter((part): part is string => Boolean(part));
  return parts.length ? `🧒 ${parts.join(" · ")}` : null;
}

/**
 * The end: the request is with the office. Never "booked" or "confirmed":
 * the office has not seen it yet, and it calls to fix the time.
 */
export function visitBookedReply(context: ReplyContext, booking: VisitBooking, today: string, lateHour: boolean): HelperMessage {
  const { language } = context;
  const head = say(language, {
    hi: "✅ *आपके आने का अनुरोध स्कूल ऑफ़िस तक पहुँचा दिया गया है*",
    hx: "✅ *Aapke aane ka anurodh school office tak pahuncha diya gaya hai*",
    en: "✅ *Your visit request has been passed to the school office*",
  });
  const next = say(language, {
    hi: "ऑफ़िस आपको फ़ोन करके समय पक्का करेगा। आपसे मिलकर ख़ुशी होगी 🙏",
    hx: "Office aapko phone karke samay pakka karega. Aapse milkar khushi hogi 🙏",
    en: "The office will call you to fix the time. We look forward to meeting you 🙏",
  });
  const late = lateHour
    ? `\n${say(language, {
        hi: "🌙 अभी देर हो चुकी है, इसलिए ऑफ़िस इसे सुबह 6 बजे के बाद देखेगा।",
        hx: "🌙 Abhi der ho chuki hai, isliye office ise subah 6 baje ke baad dekhega.",
        en: "🌙 It is late now, so the office will see it after 6 am.",
      })}`
    : "";
  const lines = [head, slotLine(booking, language, today), childLine(booking, language)].filter((line): line is string => Boolean(line));
  return { kind: "buttons", body: `${lines.join("\n")}\n\n${next}${late}`, buttons: [MENU_BUTTON(language)], footer: footer(context) };
}

/* ------------------------------------------------------------ for the office */

const EN_PART: Record<VisitPart, string> = { morning: "morning", afternoon: "afternoon" };
const HI_PART: Record<VisitPart, string> = { morning: "सुबह", afternoon: "दोपहर" };

/** "Mon 16 Nov": short enough for a template's blank. */
function shortDay(day: string, today: string): string {
  return `${WEEKDAYS.en[weekdayIndex(day)].slice(0, 3)} ${dateText(day, "en", today)}`;
}

/**
 * What the office reads, in Messages and in the WhatsApp alert: the day,
 * the child, and the parent's own words, so a wrong guess at the name is
 * plain to see. Messages is read in Hindi and English alike, so the labels
 * carry both (as `followUpBody` does).
 */
export function visitHandoffBody(booking: VisitBooking, parentWords: string, today: string): string {
  const child = [booking.childName, booking.classLabel].filter(Boolean).join(" · ");
  const words = parentWords.replace(/\s+/g, " ").trim().slice(0, 300);
  return [
    `📅 स्कूल देखने आना / School visit: ${shortDay(booking.day, today)} · ${EN_PART[booking.part]} / ${HI_PART[booking.part]}`,
    child ? `🧒 ${child}` : null,
    `अभिभावक / Parent: “${words}”`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

/**
 * One English line for the subject in Messages, after the topic:
 * "Veer Patta AI · visit: Mon 16 Nov morning · Riya, Class 3".
 */
export function visitSummary(booking: VisitBooking, today: string): string {
  const child = [booking.childName, booking.classLabel].filter(Boolean).join(", ");
  return `${shortDay(booking.day, today)} ${EN_PART[booking.part]}${child ? ` · ${child}` : ""}`;
}
