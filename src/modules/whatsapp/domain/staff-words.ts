import type { StaffRole } from "@/platform/auth/permissions";

/**
 * What a member of staff asks Veer Patta AI on WhatsApp, read from their
 * words or their tap (D-591, D-607). Pure: no database, no clock.
 *
 * Three kinds of asking:
 *
 *  - A command: a tap on a staff button or a menu row (`vpst:`), or the
 *    words of one ("today", "fees", "बकाया"). Some words mean different
 *    things on different desks ("attendance" is the school's on the admin's
 *    and the class's own on a teacher's), so words name candidates in order
 *    and the desk takes the first it has.
 *  - A role: the owner's number trying another role ("try as accountant",
 *    a tap on a role row, `vpsr:`), and anybody on staff choosing to write
 *    to the school as a parent ("as parent") or back as staff.
 *  - Anything else that is typed: understood by Claude when the AI helper
 *    is on, and by the keywords below when it is not.
 *
 * The D-591 words ("today", "questions", "absent", "staff") stay commands
 * however the number is set up, so a number on a staff record that never
 * linked itself is still told to link first. A greeting ("hi", "menu") is
 * a staff ask only from a linked number or the owner's.
 */

export type StaffCommand =
  | "menu"
  | "today"
  | "questions"
  | "absent"
  | "needs_you"
  | "school"
  | "staff_away"
  | "cover"
  | "leave"
  | "collection"
  | "dues"
  | "roles";

export const STAFF_COMMANDS: readonly StaffCommand[] = [
  "menu",
  "today",
  "questions",
  "absent",
  "needs_you",
  "school",
  "staff_away",
  "cover",
  "leave",
  "collection",
  "dues",
  "roles",
];

/** A role the owner's number can try, or a parent (D-607). */
export type StaffHat = StaffRole | "parent";

export const STAFF_HATS: readonly StaffHat[] = [
  "admin",
  "office",
  "accountant",
  "fee_collector",
  "teacher",
  "academic_coordinator",
  "exam_coordinator",
  "view_only",
  "parent",
];

export function isStaffHat(value: unknown): value is StaffHat {
  return typeof value === "string" && (STAFF_HATS as readonly string[]).includes(value);
}

/** The id of a staff button or menu row: `vpst:today`, or `vpst:today:teacher` on the owner's number. A parent's are `vpai:`. */
export const STAFF_TAP_PREFIX = "vpst:";
/** The id of a role row: `vpsr:accountant`, `vpsr:parent`, `vpsr:staff` (back to one's own role), `vpsr:list`. */
export const ROLE_TAP_PREFIX = "vpsr:";

/** A command word is a few words at most; anything longer is a message. */
const MAX_COMMAND_CHARS = 40;

/**
 * The same words however they are typed: lower case, no punctuation or emoji,
 * one space between words, and no nukta (ज़ and ज are one letter here, as
 * people type them either way).
 */
export function commandText(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/़/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Phrase = {
  /** What the words ask for, in order: the desk answers with the first it has. */
  to: readonly StaffCommand[];
  /** One of D-591's four staff words, a staff ask whoever writes it; the rest are only from a linked number or the owner's. */
  strict: boolean;
  /** "staff": also back to staff from writing as a parent. */
  back?: true;
  words: readonly string[];
};

const PHRASES: readonly Phrase[] = [
  {
    to: ["today", "school"],
    strict: true,
    words: [
      "today", "my day", "today's periods", "my periods", "periods", "timetable", "time table", "my timetable", "schedule", "my schedule",
      "aaj", "aaj ka din", "mera din", "aaj ke period", "aaj ke periods", "aaj ka timetable",
      "आज", "आज का दिन", "मेरा दिन", "आज के पीरियड", "मेरे पीरियड", "पीरियड", "टाइम टेबल", "टाइमटेबल", "समय सारणी",
    ],
  },
  {
    to: ["questions"],
    strict: true,
    words: [
      "questions", "question", "my questions", "parent questions", "parents questions", "parents' questions", "pending questions",
      "sawal", "sawaal", "savaal", "mere sawal", "mere sawaal",
      "सवाल", "मेरे सवाल", "प्रश्न", "अभिभावकों के सवाल",
    ],
  },
  {
    to: ["absent", "school"],
    strict: true,
    words: [
      "absent", "absents", "absentees", "who is absent", "who's absent", "absent today", "today absent", "absent list",
      "kaun absent", "absent kaun", "kaun absent hai", "absent kaun hai", "aaj kaun absent", "aaj kaun absent hai", "gairhazir", "gairhajir",
      "अनुपस्थित", "ग़ैरहाज़िर", "गैरहाजिर", "कौन अनुपस्थित", "आज कौन अनुपस्थित", "कौन नहीं आया", "आज कौन नहीं आया", "एबसेंट",
    ],
  },
  { to: ["menu"], strict: true, back: true, words: ["staff", "staff menu", "staff help", "teacher menu", "स्टाफ़", "स्टाफ", "स्टाफ़ मेनू", "स्टाफ मेनू"] },
  {
    to: ["menu"],
    strict: false,
    words: [
      "menu", "main menu", "help", "options", "start", "hi", "hii", "hiii", "hello", "helo", "hey", "namaste", "namaskar", "good morning", "gm",
      "मेनू", "मदद", "नमस्ते", "नमस्कार", "हेलो", "हाय", "शुरू",
    ],
  },
  {
    to: ["needs_you"],
    strict: false,
    words: [
      "needs you", "need you", "approvals", "approval", "pending approvals", "to decide", "suggestions", "parent suggestions", "parents suggestions",
      "approve", "manjuri", "manzuri", "मंज़ूरी", "मंजूरी", "स्वीकृति", "सुझाव", "फैसले", "आपके फैसले",
    ],
  },
  {
    to: ["school", "absent"],
    strict: false,
    words: [
      "attendance", "attendance today", "today attendance", "today's attendance", "hazri", "haziri", "hajri", "aaj ki hazri", "aaj ki haziri",
      "हाज़िरी", "हाजिरी", "आज की हाज़िरी", "आज की हाजिरी", "उपस्थिति",
    ],
  },
  {
    to: ["school"],
    strict: false,
    words: ["school", "school today", "today school", "school day", "summary", "today summary", "school summary", "overview", "स्कूल", "आज का स्कूल", "सारांश"],
  },
  {
    to: ["staff_away"],
    strict: false,
    words: [
      "staff away", "teachers away", "who is away", "who's away", "staff absent", "teachers absent", "absent teachers", "absent staff",
      "staff on leave", "teachers on leave", "away today", "kaun chutti par", "kaun chhutti par", "chutti par kaun", "kaun teacher chutti par",
      "स्टाफ़ छुट्टी", "कौन छुट्टी पर", "छुट्टी पर कौन", "आज कौन छुट्टी पर", "शिक्षक छुट्टी पर",
    ],
  },
  {
    to: ["cover", "today"],
    strict: false,
    words: [
      "cover", "cover today", "today cover", "cover plan", "substitution", "substitutions", "arrangement", "arrangements", "substitute", "subs",
      "सबस्टिट्यूशन", "अरेंजमेंट", "व्यवस्था", "आज की व्यवस्था",
    ],
  },
  {
    to: ["leave", "today"],
    strict: false,
    words: [
      "leave", "leaves", "leave requests", "leave request", "pending leave", "leave asked", "chutti", "chhutti",
      "छुट्टी", "छुट्टियाँ", "छुट्टियां", "अवकाश", "छुट्टी की अर्ज़ी",
    ],
  },
  {
    to: ["collection", "dues"],
    strict: false,
    words: [
      "collection", "collections", "fees", "fee", "fees today", "today fees", "today's fees", "today collection", "today's collection",
      "fee collection", "fees collection", "collected", "jama", "aaj ki fees", "aaj ka collection", "aaj kitna jama",
      "फीस", "आज की फीस", "कलेक्शन", "वसूली", "जमा",
    ],
  },
  {
    to: ["dues", "collection"],
    strict: false,
    words: [
      "dues", "due", "pending fees", "fees pending", "fee pending", "pending", "balance", "baki", "baaki", "bakaya", "baki fees", "baaki fees",
      "defaulters", "defaulter", "outstanding", "बकाया", "बाकी", "बाकी फीस", "बकाया फीस", "शेष",
    ],
  },
  {
    to: ["roles"],
    strict: false,
    words: ["roles", "role", "switch role", "change role", "try roles", "try a role", "try another role", "other roles", "भूमिका", "भूमिकाएँ", "रोल"],
  },
];

const BY_WORDS: ReadonlyMap<string, Phrase> = new Map(PHRASES.flatMap((phrase) => phrase.words.map((word) => [commandText(word), phrase] as const)));

/* ------------------------------------------------------------- the roles */

const HAT_WORDS: Record<StaffHat, readonly string[]> = {
  admin: ["admin", "administrator", "एडमिन"],
  office: ["office", "office staff", "clerk", "ऑफिस", "कार्यालय"],
  accountant: ["accountant", "accounts", "account", "accounts desk", "अकाउंटेंट", "लेखाकार"],
  fee_collector: ["fee collector", "fees collector", "collector", "फीस कलेक्टर", "कलेक्टर"],
  teacher: ["teacher", "class teacher", "टीचर", "क्लास टीचर", "शिक्षक", "अध्यापक"],
  academic_coordinator: ["academic coordinator", "coordinator", "academic", "कोऑर्डिनेटर", "समन्वयक"],
  exam_coordinator: ["exam coordinator", "exams coordinator", "exam", "exams", "exam office", "परीक्षा", "परीक्षा समन्वयक"],
  view_only: ["viewer", "view only", "व्यूअर"],
  parent: ["parent", "parents", "guardian", "अभिभावक", "पेरेंट", "माता पिता"],
};

/** "staff" in a role ask: back to the number's own role. */
const OWN_ROLE_WORDS = ["staff", "my role", "own role", "myself", "me", "स्टाफ", "स्टाफ़"];

const HAT_BY_WORDS: ReadonlyMap<string, StaffHat | "staff"> = new Map([
  ...STAFF_HATS.flatMap((hat) => HAT_WORDS[hat].map((word) => [commandText(word), hat] as const)),
  ...OWN_ROLE_WORDS.map((word) => [commandText(word), "staff"] as const),
]);

/** "try as accountant", "write as a parent", "accountant mode", "अकाउंटेंट बनकर": the role named, or null. */
function roleAsked(text: string): StaffHat | "staff" | null {
  const forms = [
    /^(?:(?:please|pls|plz|now|ab)\s+)?(?:(?:try|test|switch|change|go|be|act|login|log in|use|open|set|write|talk|chat|answer|reply|continue|work|back)\s+)?(?:me\s+)?(?:as|to|into)\s+(?:a\s+|an\s+|the\s+|my\s+)?(.+?)(?:\s+(?:mode|role|view|desk|please|pls))?$/u,
    /^(.+?)\s+(?:mode|role|view|desk|bano|banao|ban jao|ban ke|banke|bankar)$/u,
    /^(?:main|mai|me|mein)\s+(.+?)\s+(?:hoon|hun|hu|hoo|hu na)$/u,
    /^(?:मैं\s+)?(.+?)\s+(?:बनकर|बनके|बनो|बन जाओ|की तरह|के रूप में|मोड|हूँ|हूं)$/u,
    /^(?:back to|go back to|return to)\s+(.+)$/u,
  ];
  for (const form of forms) {
    const match = form.exec(text);
    if (!match) continue;
    const named = HAT_BY_WORDS.get(match[1].trim());
    if (named) return named;
  }
  return null;
}

/* --------------------------------------------------------- what is asked */

export type StaffAsk =
  /** A tap on a staff button or menu row, or the words of one. */
  | {
      kind: "command";
      to: readonly StaffCommand[];
      /** On the owner's number: the role the button was sent under. */
      hat: StaffHat | null;
      /** A student's name or admission number, for *dues*. */
      query: string | null;
      via: "tap" | "words";
      /** One of D-591's four staff words (see the top). */
      strict: boolean;
      /** The word "staff": back to staff from writing as a parent. */
      back: boolean;
    }
  /** A role: one to try (the owner), a parent, "staff" (back to one's own role), or null (show the roles). */
  | { kind: "hat"; hat: StaffHat | "staff" | null; via: "tap" | "words" }
  /** Anything else typed: for Claude or the keywords. */
  | { kind: "text"; text: string }
  /** A tap on somebody else's button (the parents' helper's `vpai:`), for whoever sent it. */
  | { kind: "foreign" }
  /** Nothing to read: a voice note, a photo, an empty message. */
  | { kind: "none" };

function tapId(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw || raw.type !== "interactive") return null;
  const interactive = raw.interactive && typeof raw.interactive === "object" ? (raw.interactive as Record<string, unknown>) : {};
  const reply = (interactive.button_reply ?? interactive.list_reply) as Record<string, unknown> | undefined;
  return typeof reply?.id === "string" ? reply.id.trim() : "";
}

function readTapId(id: string): StaffAsk {
  if (id.startsWith(STAFF_TAP_PREFIX)) {
    const [command, hat] = id.slice(STAFF_TAP_PREFIX.length).split(":");
    if (!(STAFF_COMMANDS as readonly string[]).includes(command)) return { kind: "foreign" };
    return { kind: "command", to: [command as StaffCommand], hat: isStaffHat(hat) ? hat : null, query: null, via: "tap", strict: true, back: false };
  }
  if (id.startsWith(ROLE_TAP_PREFIX)) {
    const value = id.slice(ROLE_TAP_PREFIX.length);
    if (value === "list") return { kind: "hat", hat: null, via: "tap" };
    if (value === "staff") return { kind: "hat", hat: "staff", via: "tap" };
    return isStaffHat(value) ? { kind: "hat", hat: value, via: "tap" } : { kind: "foreign" };
  }
  return { kind: "foreign" };
}

/** Everything a staff message can be (D-607). */
export function readStaffAsk(message: { type: string; text: string | null; raw: Record<string, unknown> | null | undefined }): StaffAsk {
  const id = tapId(message.raw);
  if (id !== null) {
    if (id) return readTapId(id);
    // An interactive message with no id of ours: read its words, if any, as typed.
  }
  if (message.type !== "text" && message.type !== "button" && message.type !== "interactive") return { kind: "none" };
  const text = String(message.text ?? "").trim();
  if (!text) return { kind: "none" };
  const words = commandText(text);
  if (!words) return { kind: "none" };

  if (text.length <= MAX_COMMAND_CHARS) {
    const phrase = BY_WORDS.get(words);
    if (phrase) return { kind: "command", to: phrase.to, hat: null, query: null, via: "words", strict: phrase.strict, back: phrase.back === true };
    // A role named on its own ("teacher") is a message, not a switch: it takes "try as", "mode" or a tap.
    const role = roleAsked(words);
    if (role) return { kind: "hat", hat: role, via: "words" };
  }
  const student = duesQueryIn(words);
  if (student) return { kind: "command", to: ["dues", "collection"], hat: null, query: student, via: "words", strict: false, back: false };
  return { kind: "text", text: text.slice(0, 500) };
}

/**
 * The D-591 reading, kept for the gate before a number is known: a tap on a
 * staff button, or one of the staff words and nothing else. Never a
 * greeting, never a sentence.
 */
export function staffCommandIn(message: { type: string; text: string | null; raw: Record<string, unknown> | null | undefined }): StaffCommand | null {
  const ask = readStaffAsk(message);
  if (ask.kind !== "command" || !ask.strict || ask.query) return null;
  if (ask.via === "words" && message.type !== "text" && message.type !== "button") return null;
  return ask.to[0] ?? null;
}

/** The staff button's id, as `readStaffAsk` reads it back; the owner's carries the role it was sent under. */
export function staffButtonId(command: StaffCommand, hat: StaffHat | null = null): string {
  return hat ? `${STAFF_TAP_PREFIX}${command}:${hat}` : `${STAFF_TAP_PREFIX}${command}`;
}

export function roleButtonId(hat: StaffHat | "staff" | "list"): string {
  return `${ROLE_TAP_PREFIX}${hat}`;
}

/* -------------------------------------------- a student's dues by name */

const DUES_WORDS = "dues|due|fees|fee|balance|baki|baaki|bakaya|pending|outstanding|बकाया|बाकी|फीस|शेष";
const FILLER = new Set(["ki", "ka", "ke", "of", "for", "kitni", "kitna", "kitne", "kya", "hai", "h", "batao", "bata", "bataiye", "dikhao", "please", "pls", "plz", "the", "show", "tell", "me", "what", "is", "how", "much", "की", "का", "के", "कितनी", "कितना", "है", "बताओ", "बताइए", "दिखाओ", "क्या"]);

/** "dues Rahul", "Rahul ki fees kitni baki hai", "SR 1234 dues": the name or number, or null. */
export function duesQueryIn(words: string): string | null {
  const lead = new RegExp(`^(?:${DUES_WORDS})(?:\\s+(?:${DUES_WORDS}))*\\s+(.+)$`, "u").exec(words);
  const tail = new RegExp(`^(.+?)\\s+(?:${DUES_WORDS})(?:\\s+\\S+){0,4}$`, "u").exec(words);
  const raw = lead?.[1] ?? tail?.[1] ?? null;
  if (!raw) return null;
  const kept = raw
    .split(" ")
    .filter((word) => !FILLER.has(word) && !new RegExp(`^(?:${DUES_WORDS})$`, "u").test(word))
    .join(" ")
    .replace(/^(?:sr|admission|adm|admission no|sr no)\s+/u, "")
    .trim();
  if (kept.length < 2 || kept.length > 40) return null;
  // A word the desk already knows is not a child's name ("today's fees", "pending approvals").
  if (BY_WORDS.has(kept) || ["today", "aaj", "आज", "school", "class", "all", "total", "sab", "सब"].includes(kept)) return null;
  return kept;
}

/* ------------------------------------------------- when Claude is not there */

type Keyword = { to: readonly StaffCommand[]; weight: number; stems: readonly string[] };

const KEYWORDS: readonly Keyword[] = [
  { to: ["collection", "dues"], weight: 1, stems: ["fee", "fees", "फीस", "शुल्क"] },
  { to: ["collection"], weight: 2, stems: ["collection", "collected", "collect", "jama", "received", "receipt", "receipts", "payment", "payments", "paid", "जमा", "वसूली", "कलेक्शन", "रसीद"] },
  { to: ["dues"], weight: 2, stems: ["due", "dues", "baki", "baaki", "bakaya", "pending", "balance", "defaulter", "defaulters", "outstanding", "बकाया", "बाकी", "शेष"] },
  { to: ["absent", "school"], weight: 2, stems: ["absent", "absentees", "attendance", "hazri", "haziri", "present", "register", "अनुपस्थित", "हाजिरी", "उपस्थिति", "रजिस्टर"] },
  { to: ["staff_away"], weight: 2, stems: ["away", "teachers", "staff", "शिक्षक", "स्टाफ"] },
  { to: ["leave", "staff_away"], weight: 2, stems: ["leave", "leaves", "chutti", "chhutti", "छुट्टी", "अवकाश"] },
  { to: ["cover"], weight: 2, stems: ["cover", "substitution", "substitute", "arrangement", "सबस्टिट्यूशन", "व्यवस्था"] },
  { to: ["questions"], weight: 2, stems: ["question", "questions", "sawal", "sawaal", "message", "messages", "parent", "parents", "सवाल", "प्रश्न", "संदेश", "अभिभावक"] },
  { to: ["needs_you"], weight: 2, stems: ["approve", "approval", "approvals", "suggestion", "suggestions", "decide", "manjuri", "मंजूरी", "स्वीकृति", "सुझाव"] },
  { to: ["today"], weight: 2, stems: ["period", "periods", "timetable", "schedule", "class", "classes", "पीरियड", "टाइमटेबल"] },
  { to: ["school"], weight: 1, stems: ["school", "summary", "overview", "report", "स्कूल", "सारांश"] },
];

/** The commands a typed message seems to be about, most likely first; empty when nothing matches. */
export function keywordCommands(text: string): StaffCommand[] {
  const words = new Set(commandText(text).split(" ").filter(Boolean));
  const score = new Map<StaffCommand, number>();
  KEYWORDS.forEach((keyword) => {
    if (!keyword.stems.some((stem) => words.has(commandText(stem)))) return;
    keyword.to.forEach((command, index) => score.set(command, (score.get(command) ?? 0) + keyword.weight - index * 0.5));
  });
  return [...score.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).map(([command]) => command);
}

/** A typed message in Hindi letters is answered in Hindi, whatever the profile says. */
export function writesHindi(text: string | null | undefined): boolean {
  return /[ऀ-ॿ]/.test(String(text ?? ""));
}
