import { clip } from "./helper-messages";
import { ALERT_HOURS } from "./helper-plan";
import { istHour } from "./helper-facts";
import type { HandoffTarget } from "./helper-replies";
import type { HelperLanguage } from "./helper-text";

/**
 * Veer Patta AI, step 2: a hand-off reaches a person (D-578).
 *
 * Step 1 put a parent's message in One's Messages inbox. Step 2 tells the
 * person it is for, on WhatsApp, and carries their answer back:
 *
 *  - The class teacher, the accountant (with an admin, for anything about
 *    fees: the owner, 12 Nov 2026, "fee related complaints go to accountant
 *    and admin"), an admin for the principal, the office for the office.
 *  - Only between 6 am and 9 pm in India. A message that comes at night is
 *    told to them at 6 am.
 *  - They answer by swiping right on that WhatsApp message and typing. The
 *    answer goes to the parent from the school's number: as it is while the
 *    parent's chat is open (they wrote in the last 24 hours), or as a short
 *    approved note ("your answer is ready, reply to read it") when it is not,
 *    with the answer itself following the moment the parent replies.
 *  - Nobody answers in 3 hours: one reminder. A complaint still unanswered a
 *    day after it reached the class teacher or the office goes up to an
 *    admin ("if the complaints cannot be solved by class teacher it goes to
 *    admin or principal"); anything else gets a second reminder instead.
 *
 * Everything here is decided without a database or a network, and tested.
 */

const HOUR = 3_600_000;
const IST_OFFSET_MS = 330 * 60_000;

/** One reminder this long after a person is told, if nobody has answered. */
export const REMIND_AFTER_HOURS = 3;
/** A complaint unanswered this long after it first reached someone goes up to an admin. */
export const PASS_UP_AFTER_HOURS = 24;
/** Meta's customer-service window, less a margin for clocks and queues. */
export const OPEN_WINDOW_HOURS = 23.5;
/** Nobody is told about one message by more people than this. */
export const MAX_PEOPLE_PER_ALERT = 3;
/** The parent's words in a staff alert: enough to answer from, short enough for Meta. */
export const WORDS_IN_ALERT = 300;
/** The parent's words quoted back to them above an answer. */
export const WORDS_IN_QUOTE = 90;
/** The longest answer a person can send through the helper in one go. */
export const MAX_ANSWER_CHARS = 1500;

export type StaffLanguage = "hi" | "en";
export type AlertKind = "alert" | "reminder" | "passed_up";
export type HandoffAction = "alert" | "remind" | "pass_up";

/** A staff member's `preferred_language` ('hi', 'en', 'both') as the language their WhatsApp is in. */
export function staffLanguage(preferred: string | null | undefined): StaffLanguage {
  return preferred === "en" ? "en" : "hi";
}

/** A parent's language as an approved template's: Hinglish readers get Hindi. */
export function templateLanguage(language: HelperLanguage): StaffLanguage {
  return language === "en" ? "en" : "hi";
}

function inAlertHours(at: Date): boolean {
  const hour = istHour(at);
  return hour >= ALERT_HOURS.from && hour < ALERT_HOURS.to;
}

/** The first moment at or after `at` when people may be told: `at` itself, or 6 am in India. */
export function nextAlertMoment(at: Date): Date {
  if (inAlertHours(at)) return at;
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  const midnightIst = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS;
  const sixToday = midnightIst + ALERT_HOURS.from * HOUR;
  return new Date(istHour(at) < ALERT_HOURS.from ? sixToday : sixToday + 24 * HOUR);
}

/** Whether a person who last wrote at `lastWroteAt` can still be sent a typed message. */
export function windowOpen(lastWroteAt: string | null | undefined, now: Date): boolean {
  if (!lastWroteAt) return false;
  const at = Date.parse(lastWroteAt);
  if (!Number.isFinite(at) || at > now.getTime() + 60_000) return false;
  return now.getTime() - at < OPEN_WINDOW_HOURS * HOUR;
}

/**
 * The topic of the office's hand-off made when a parent says an answer did
 * not help (D-584). It is handled as a complaint: a "no" the office has not
 * answered in a day goes up to an admin.
 */
export const NOT_HELPED_TOPIC = "not_helped";

/** Whether a hand-off is a complaint: one the AI called that, one asking for the principal, or a "no" to an answer. */
export function isComplaint(target: HandoffTarget, topic: string): boolean {
  return target === "principal" || topic === "complaint" || topic === NOT_HELPED_TOPIC;
}

/**
 * The hand-off a "Did this answer help?" button rates, as its id carries it
 * (D-584): twelve letters and digits of the hand-off's id. A tap is matched
 * only against the tapping number's own hand-offs, so the key never needs to
 * be secret, only distinct among one family's.
 */
export function ratingKey(handoffId: string): string {
  return handoffId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12).padEnd(4, "0");
}

/** Who is told, by role, at each level. `class_teacher` means the child's own class teacher. */
export type PeopleRule = { classTeacher: boolean; roles: Array<"accountant" | "admin" | "office"> };

export function peopleFor(target: HandoffTarget, level: number): PeopleRule {
  if (level > 0) return { classTeacher: false, roles: ["admin"] };
  switch (target) {
    case "class_teacher":
      return { classTeacher: true, roles: [] };
    case "accounts":
      return { classTeacher: false, roles: ["accountant", "admin"] };
    case "principal":
      return { classTeacher: false, roles: ["admin"] };
    case "office":
      return { classTeacher: false, roles: ["office"] };
  }
}

/** A complaint left with the class teacher or the office can go up; the rest already reached an admin. */
export function canPassUp(target: HandoffTarget, complaint: boolean): boolean {
  return complaint && (target === "class_teacher" || target === "office");
}

export type HandoffState = {
  target: HandoffTarget;
  complaint: boolean;
  level: number;
  /** Reminders sent at the current level. */
  reminders: number;
  /** When the current level was first told. Null before anyone was. */
  levelAlertedAt: string | null;
  answeredAt: string | null;
  closedAt: string | null;
};

/**
 * What happens next to a hand-off, and when, after `done` just happened at
 * `doneAt`. Null when nothing more will: it was answered, closed, or every
 * reminder has gone.
 */
export function nextStep(state: HandoffState, done: HandoffAction, doneAt: Date): { action: HandoffAction; at: Date } | null {
  if (state.answeredAt || state.closedAt) return null;
  const since = state.levelAlertedAt ? Date.parse(state.levelAlertedAt) : doneAt.getTime();
  const later = (hours: number) => nextAlertMoment(new Date(since + hours * HOUR));
  if (done === "alert" || done === "pass_up") return { action: "remind", at: later(REMIND_AFTER_HOURS) };
  // After a reminder.
  if (state.level > 0) return null;
  if (state.reminders >= 2) return null;
  if (canPassUp(state.target, state.complaint)) return { action: "pass_up", at: later(PASS_UP_AFTER_HOURS) };
  return { action: "remind", at: later(PASS_UP_AFTER_HOURS) };
}

/* ---------------------------------------------------------------- words */

type Pair = { hi: string; en: string };
type Three = { hi: string; hx: string; en: string };

const TOPIC_WORDS: Record<string, Pair> = {
  fees: { hi: "फ़ीस", en: "Fees" },
  receipts: { hi: "रसीद", en: "Receipts" },
  attendance: { hi: "हाज़िरी", en: "Attendance" },
  results: { hi: "परिणाम", en: "Results" },
  teacher: { hi: "कक्षा अध्यापक", en: "Class teacher" },
  calendar: { hi: "छुट्टियाँ और तारीख़ें", en: "Holidays and dates" },
  leave: { hi: "छुट्टी", en: "Leave" },
  complaint: { hi: "शिकायत", en: "Complaint" },
  request: { hi: "अनुरोध", en: "Request" },
  admission: { hi: "प्रवेश", en: "Admission" },
  message_teacher: { hi: "कक्षा अध्यापक के लिए संदेश", en: "Message for the class teacher" },
  office: { hi: "ऑफ़िस के लिए संदेश", en: "Message for the office" },
  [NOT_HELPED_TOPIC]: { hi: "जवाब से मदद नहीं हुई", en: "The answer did not help" },
};

/** What a hand-off is about, in a word or three, for the person told. */
export function topicWords(topic: string, language: StaffLanguage): string {
  const words = TOPIC_WORDS[topic] ?? { hi: "संदेश", en: "Message" };
  return words[language];
}

/** One line for a template's blank or a quote: no line breaks, no runs of spaces, cut to `max`. */
export function oneLine(text: string | null | undefined, max: number): string {
  return clip(String(text ?? "").replace(/\s+/g, " ").trim(), max) || "-";
}

export type AlertWords = {
  kind: AlertKind;
  language: StaffLanguage;
  staffName: string;
  /** "Aarav · Class 5 A", or the parent's name when no child was named. */
  studentLabel: string;
  topic: string;
  complaint: boolean;
  /** What the parent wrote. */
  words: string;
  helperName: string;
  practice: boolean;
};

function aboutLine(input: AlertWords): string {
  const about = topicWords(input.topic, input.language);
  if (input.kind === "reminder") return input.language === "hi" ? `${about} · याद दिला रहे हैं` : `${about} · reminder`;
  if (input.kind === "passed_up") {
    return input.language === "hi" ? `${about} · एक दिन से जवाब नहीं` : `${about} · not answered for a day`;
  }
  return about;
}

/**
 * The approved staff template's four blanks, in order: the person's name,
 * the student, what it is about, the parent's words (`helper-hub-templates.ts`).
 */
export function staffAlertParams(input: AlertWords): string[] {
  return [oneLine(input.staffName, 40), oneLine(input.studentLabel, 60), oneLine(aboutLine(input), 60), oneLine(input.words, WORDS_IN_ALERT)];
}

/** The same alert as a typed message, for a person whose WhatsApp chat with the school is open. */
export function staffAlertText(input: AlertWords): string {
  const hi = input.language === "hi";
  const head =
    input.kind === "reminder"
      ? hi
        ? "⏰ *याद दिला रहे हैं: एक अभिभावक आपके जवाब की राह देख रहे हैं*"
        : "⏰ *Reminder: a parent is waiting for your answer*"
      : input.kind === "passed_up"
        ? hi
          ? `📣 *एक दिन से बिना जवाब: अभिभावक की ${input.complaint ? "शिकायत" : "बात"}*`
          : `📣 *Not answered for a day: a parent's ${input.complaint ? "complaint" : "message"}*`
        : hi
          ? "🔔 *आपके लिए एक अभिभावक का संदेश*"
          : "🔔 *A parent's message for you*";
  const standIn = oneLine(input.staffName, 40);
  const practice = input.practice
    ? hi
      ? `\n🧪 अभ्यास: परीक्षण रिकॉर्ड, ${standIn} की जगह आपको भेजा गया`
      : `\n🧪 Practice: test records, sent to you in place of ${standIn}`
    : "";
  const how = hi
    ? `↩️ जवाब देने के लिए इस संदेश को दाईं ओर स्वाइप करें और लिखें। ${input.helperName} उसे स्कूल के नंबर से अभिभावक को भेज देगा।`
    : `↩️ Swipe right on this message and type your answer. ${input.helperName} sends it to the parent from the school's number.`;
  return [
    head,
    `${oneLine(input.studentLabel, 60)} · ${topicWords(input.topic, input.language)}${practice}`,
    "",
    `“${clip(input.words.trim(), 600)}”`,
    "",
    how,
  ].join("\n");
}

/** Who answered, as the parent reads it. */
export type Answerer =
  | { kind: "class_teacher"; name: string }
  | { kind: "accounts" }
  | { kind: "principal" }
  | { kind: "office" };

export function answererFor(role: string | null | undefined, isClassTeacher: boolean, name: string): Answerer {
  if (isClassTeacher && name.trim()) return { kind: "class_teacher", name: name.trim() };
  if (role === "accountant") return { kind: "accounts" };
  if (role === "admin") return { kind: "principal" };
  return { kind: "office" };
}

/** Who answered, as the subject of "… has answered your message" in the approved note. */
function answererSubject(who: Answerer, language: StaffLanguage): string {
  switch (who.kind) {
    case "class_teacher":
      return language === "hi" ? `कक्षा अध्यापक ${who.name}` : `Class teacher ${who.name}`;
    case "accounts":
      return language === "hi" ? "स्कूल के अकाउंट्स विभाग" : "The school's accounts office";
    case "principal":
      return language === "hi" ? "प्रधानाचार्य कार्यालय" : "The principal's office";
    case "office":
      return language === "hi" ? "स्कूल ऑफ़िस" : "The school office";
  }
}

/** The first line above an answer: whose answer it is. */
function answerHead(who: Answerer, language: HelperLanguage): string {
  const words: Three =
    who.kind === "class_teacher"
      ? { hi: `कक्षा अध्यापक ${who.name} का जवाब`, hx: `Class teacher ${who.name} ka jawab`, en: `Answer from ${who.name}, class teacher` }
      : who.kind === "accounts"
        ? { hi: "स्कूल के अकाउंट्स विभाग का जवाब", hx: "School ke accounts vibhag ka jawab", en: "Answer from the school's accounts office" }
        : who.kind === "principal"
          ? { hi: "प्रधानाचार्य कार्यालय का जवाब", hx: "Principal office ka jawab", en: "Answer from the principal's office" }
          : { hi: "स्कूल ऑफ़िस का जवाब", hx: "School office ka jawab", en: "Answer from the school office" };
  return words[language];
}

/** What the parent's message was about, mid-sentence, when they named no child. */
const ABOUT_WORDS: Record<string, Pair> = {
  fees: { hi: "फ़ीस", en: "fees" },
  receipts: { hi: "रसीद", en: "receipts" },
  attendance: { hi: "हाज़िरी", en: "attendance" },
  results: { hi: "परिणाम", en: "results" },
  calendar: { hi: "छुट्टियों और तारीख़ों", en: "holidays and dates" },
  leave: { hi: "छुट्टी", en: "leave" },
  complaint: { hi: "शिकायत", en: "your complaint" },
  admission: { hi: "प्रवेश", en: "admission" },
  [NOT_HELPED_TOPIC]: { hi: "आपके सवाल", en: "your question" },
};

/**
 * The approved "your answer is ready" note's two blanks: who answered, and
 * what the message was about: the child, or its topic when no child was named.
 */
export function answerReadyParams(who: Answerer, about: { childName: string | null; topic: string }, language: HelperLanguage): string[] {
  const lang = templateLanguage(language);
  const subject = about.childName?.trim() ? about.childName : (ABOUT_WORDS[about.topic]?.[lang] ?? (lang === "hi" ? "आपके अनुरोध" : "your request"));
  return [oneLine(answererSubject(who, lang), 60), oneLine(subject, 40)];
}

export type ParentAnswerWords = {
  language: HelperLanguage;
  who: Answerer;
  /** The child's first name, or null when the parent named no child. */
  aboutName: string | null;
  /** What the parent wrote, quoted back so they know which message this answers. */
  quote: string;
  answer: string;
};

/** The answer as the parent reads it, sent as a typed message inside their open chat. */
export function parentAnswerText(input: ParentAnswerWords): string {
  const quote = oneLine(input.quote, WORDS_IN_QUOTE);
  const name = input.aboutName?.trim() ? oneLine(input.aboutName, 40) : null;
  const about: Three = name
    ? {
        hi: `_${name} के बारे में आपका संदेश: “${quote}”_`,
        hx: `_${name} ke baare mein aapka sandesh: “${quote}”_`,
        en: `_Your message about ${name}: “${quote}”_`,
      }
    : { hi: `_आपका संदेश: “${quote}”_`, hx: `_Aapka sandesh: “${quote}”_`, en: `_Your message: “${quote}”_` };
  return `💬 *${answerHead(input.who, input.language)}*\n${about[input.language]}\n\n${clip(input.answer.trim(), MAX_ANSWER_CHARS)}`;
}

/** Who gave an answer, as a member of staff reads it, in both languages. */
function answererLabel(who: Answerer): string {
  switch (who.kind) {
    case "class_teacher":
      return `कक्षा अध्यापक / Class teacher ${oneLine(who.name, 40)}`;
    case "accounts":
      return "अकाउंट्स / Accounts";
    case "principal":
      return "प्रधानाचार्य कार्यालय / Principal's office";
    case "office":
      return "ऑफ़िस / Office";
  }
}

/** The parent's words in a "no" hand-off, and the answer's: enough to act on, short enough to read on a phone. */
export const FOLLOW_UP_WORDS = { parent: 300, answer: 500 } as const;

/**
 * What the school office reads when a parent says an answer did not help
 * (D-584): what the parent asked, and the answer they were given, so the
 * office does not have to go looking for either. One row in Messages is read
 * by Hindi and English readers alike, so the labels carry both.
 */
export function followUpBody(input: { parentWords: string; answer: string | null; who: Answerer | null }): string {
  const lines = [`अभिभावक / Parent: “${oneLine(input.parentWords, FOLLOW_UP_WORDS.parent)}”`];
  const answer = input.answer?.trim();
  if (answer) {
    const by = input.who ? ` (${answererLabel(input.who)})` : "";
    lines.push(`जवाब / Answer${by}: “${oneLine(answer, FOLLOW_UP_WORDS.answer)}”`);
  }
  return lines.join("\n");
}

export type RelayResult = "sent" | "waiting" | "failed";

/** What the person who answered is told, in their language. */
export function staffConfirmText(result: RelayResult | "not_text" | "not_saved", language: StaffLanguage, studentLabel: string): string {
  const student = oneLine(studentLabel, 60);
  const words: Record<typeof result, Pair> = {
    sent: {
      hi: `✅ आपका जवाब ${student} के अभिभावक को भेज दिया गया। धन्यवाद!`,
      en: `✅ Your answer has gone to the parent of ${student}. Thank you!`,
    },
    waiting: {
      hi: `✅ आपका जवाब सहेज लिया गया। ${student} के अभिभावक ने एक दिन से ज़्यादा समय से नहीं लिखा, इसलिए उन्हें बताया गया है कि जवाब तैयार है। वे जैसे ही उत्तर देंगे, आपका जवाब उन्हें मिल जाएगा।`,
      en: `✅ Your answer is saved. The parent of ${student} has not written for over a day, so they were told an answer is ready, and they get yours the moment they reply.`,
    },
    failed: {
      hi: `⚠️ आपका जवाब One में सहेजा गया है, पर अभी ${student} के अभिभावक को नहीं भेजा जा सका। ऑफ़िस इसे आगे पहुँचाएगा।`,
      en: `⚠️ Your answer is saved in One, but it could not be sent to the parent of ${student} just now. The office will pass it on.`,
    },
    not_text: {
      hi: "✍️ कृपया अपना जवाब शब्दों में लिखें। आवाज़ या फ़ोटो अभी आगे नहीं भेजे जा सकते।",
      en: "✍️ Please type your answer as words. Voice notes and photos cannot be passed on yet.",
    },
    not_saved: {
      hi: "⚠️ माफ़ कीजिए, आपका जवाब अभी सहेजा नहीं जा सका। कृपया थोड़ी देर बाद फिर स्वाइप करके लिखें, या One में Messages से जवाब दें।",
      en: "⚠️ Sorry, your answer could not be saved just now. Please swipe and type it again in a little while, or answer from Messages in One.",
    },
  };
  return words[result][language];
}

/** Words that only acknowledge, in English, Hindi and Hinglish. "fees" is not one: a single word can be a question. */
const ACKNOWLEDGING = new Set(
  [
    "ok okay okk k kk fine done noted sure yes yeah yep alright great good nice received welcome",
    "thanks thank thanku thankyou thx ty tq you u very much so got it sir mam maam madam ji jee",
    "theek thik hai h he dhanyawad dhanyavad dhanyvad shukriya ha haa haan han acha achha accha achchha mil gaya gya bahut badhiya",
    "ठीक है हैं धन्यवाद शुक्रिया हाँ हां जी अच्छा ओके मिल गया गई गयी बहुत बढ़िया सर मैडम",
  ]
    .join(" ")
    .split(" "),
);

/** A parent's few words that only acknowledge ("ok", "thanks", "ठीक है", 👍) rather than ask something new. */
export function isAcknowledgement(text: string | null | undefined): boolean {
  const clean = String(text ?? "").toLowerCase().trim();
  if (/[?？]/.test(clean)) return false;
  const words = clean.replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return words.length <= 6 && words.every((word) => ACKNOWLEDGING.has(word));
}
