/**
 * Veer Patta AI reading a parent's message (D-574): which language it is in,
 * and, for a short message or a tap on one of its own buttons, what it is
 * asking for. Pure: no database, no request.
 *
 * Rules answer only the plain asks ("fees", "हाज़िरी", "receipt bhejo"), and
 * only when the message is short, because they are instant and free and
 * cannot misread a number. Anything longer, or anything the rules do not
 * know, goes to Claude (`helper-ai.ts`): "teacher ne mere bete ko daanta"
 * mentions a teacher and is a complaint, not a request for her name.
 */

/** hi = Hindi in Devanagari, hx = Hindi in Roman letters ("fees kitni baki hai"), en = English. */
export type HelperLanguage = "hi" | "hx" | "en";

export const HELPER_LANGUAGES: readonly HelperLanguage[] = ["hi", "hx", "en"];

export function isHelperLanguage(value: unknown): value is HelperLanguage {
  return value === "hi" || value === "hx" || value === "en";
}

const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[a-z]/i;

/**
 * Words that mark Roman-letter Hindi. Each one is chosen because English
 * almost never uses it on its own: "me" and "to" are left out on purpose.
 */
const ROMAN_HINDI = new Set([
  "hai", "hain", "hu", "hoon", "tha", "thi", "kya", "kyu", "kyun", "kyon", "kab", "kaise", "kaisa", "kaun", "kitna", "kitni", "kitne",
  "baki", "baaki", "bakaya", "mera", "meri", "mere", "hamara", "hamari", "hamare", "apna", "apni", "bachcha", "bachche", "bacche",
  "baccha", "beta", "beti", "aaj", "kal", "nahi", "nahin", "haan", "ji", "ka", "ki", "ke", "ko", "mein", "aur", "bhi", "hazri",
  "hajri", "haziri", "rasid", "raseed", "paisa", "paise", "jama", "karna", "karo", "kijiye", "dijiye", "batao", "bataiye", "bataye",
  "chahiye", "wala", "wali", "accha", "achha", "theek", "thik", "namaste", "namaskar", "pranam", "dhanyavad", "dhanyawad", "shukriya",
  "chutti", "chhutti", "kaksha", "fees", "ab", "abhi", "kuch", "sab", "bhejo", "bhejiye", "dekho", "dekhna", "padhai", "school",
  // Greetings: "Ram Ram", "Jai Jinendra", "Radhe Radhe" are Hindi however they are typed.
  "jai", "ram", "radhe", "jinendra", "shree", "shri", "krishna",
  // Verbs and small words a short Hinglish ask is often made of alone: "Pdf mil jaegi?" (D-606).
  "mil", "milega", "milegi", "milenge", "mila", "mili", "jaega", "jaegi", "jayega", "jayegi", "jaayega", "jaayegi", "jaenge", "jayenge",
  "hoga", "hogi", "honge", "hua", "hui", "hue", "gaya", "gayi", "gai", "gaye", "raha", "rahi", "rahe", "sakta", "sakti", "sakte",
  "dikhao", "dikhaiye", "dikhana", "bhej", "bhejna", "bhejdo", "bhejiyega", "bataiyega", "dijiyega", "kijiyega", "chahte", "chahta",
  "chahti", "chahie", "chaiye", "chaahiye", "mujhe", "muje", "mujhko", "humko", "hamko", "aap", "aapka", "aapki", "aapke", "uska",
  "uski", "iska", "iski", "unka", "unki", "kahan", "kaha", "kidhar", "yahan", "yaha", "wahan", "agar", "lekin", "kyunki", "jaldi",
  "kripya", "krupya", "nhi", "nai", "waali", "waala", "pichhli", "pichli", "pichhla", "pichla", "pehle", "pahle", "baad", "tak", "se",
  "kar", "karke", "kiya", "kiye", "diya", "diye", "dena", "lena", "dono", "wali",
]);

/**
 * Words that mark English. A message in Roman letters with none of these and
 * no Hindi marker ("Rudra absent", "Pdf mil jaegi?" before its words were
 * known) says nothing about its language, so the chat's own stands (D-606).
 */
const ENGLISH = new Set([
  "the", "is", "are", "was", "were", "am", "be", "been", "i", "my", "me", "we", "our", "us", "you", "your", "he", "she", "his", "her",
  "it", "its", "they", "their", "this", "that", "these", "those", "what", "when", "where", "why", "how", "which", "who", "whom",
  "please", "pls", "plz", "kindly", "can", "could", "will", "would", "should", "shall", "may", "might", "must", "does", "did", "have",
  "has", "had", "not", "and", "but", "if", "of", "for", "in", "on", "at", "to", "from", "with", "about", "much", "many", "want", "need",
  "send", "give", "get", "show", "tell", "know", "sorry", "thank", "thanks", "dear", "today", "tomorrow", "yesterday", "son", "daughter",
  "child", "children", "kid", "kids", "paid", "pay", "pending", "due", "copy", "any", "some", "all", "both", "last", "latest", "next",
]);

/**
 * "fees" and "school" are in the list only to break a tie towards Hindi when
 * another Roman-Hindi word is present; on their own they are English. So a
 * message needs at least one word that is NOT in this set to read as Hindi.
 */
const SHARED_WITH_ENGLISH = new Set(["fees", "school", "ab"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The parent's language, or null when the message does not say (a bare "Hi",
 * "ok", a number, an emoji): then the chat's last language stands.
 * `previous` is that language: a message of two or more words in Roman
 * letters with no marker of either language keeps it, and is English only in
 * a chat with no language yet (D-606: "Pdf mil jaegi?" in a Hinglish chat was
 * answered in English).
 */
export function detectLanguage(text: string | null | undefined, previous: HelperLanguage | null = null): HelperLanguage | null {
  const value = String(text ?? "").trim();
  if (!value) return null;
  if (DEVANAGARI.test(value)) return "hi";
  if (!LATIN.test(value)) return null;
  const list = words(value);
  const hindi = list.filter((word) => ROMAN_HINDI.has(word));
  if (hindi.some((word) => !SHARED_WITH_ENGLISH.has(word))) return "hx";
  // One word ("hello", "fees") says nothing about the language.
  if (list.length < 2) return null;
  if (list.some((word) => ENGLISH.has(word))) return "en";
  return previous ?? "en";
}

/* ---------------------------------------------------------------- intents */

export type HelperIntent =
  | "greeting"
  | "menu"
  | "fees"
  | "receipts"
  /** The receipt itself, as a PDF in the chat (D-597): "receipt bhejo", or the card's "📄 Send receipt". */
  | "receipt_send"
  | "attendance"
  | "results"
  | "teacher"
  | "office"
  | "visit"
  | "thanks"
  | "stop";

export const HELPER_INTENTS: readonly HelperIntent[] = [
  "greeting", "menu", "fees", "receipts", "receipt_send", "attendance", "results", "teacher", "office", "visit", "thanks", "stop",
];

/** Longer than this, a message goes to Claude even when a rule would match. */
export const RULE_MAX_WORDS = 5;

type Rule = {
  intent: HelperIntent;
  patterns: RegExp[];
  /** Matched, but a question all the same: Claude reads it, and no later rule is tried. */
  askClaudeIf?: (text: string) => boolean;
};

/**
 * A question rather than a plain ask or an answer: a question mark, a
 * question word, or something only a person can say (fees for a new child,
 * documents, seats, the bus). "admission" starts a booking; "admission fees
 * kitni hai" is a question for Claude.
 */
export const QUESTION_WORDS = [
  "kya", "kab", "kitni", "kitna", "kitne", "kaise", "kaun", "kyu", "kyun", "kyon", "kahan", "what", "when", "how", "where", "which",
  "why", "who", "fee", "fees", "fess", "document", "documents", "seat", "seats", "bus", "van", "transport", "timing", "timings", "uniform",
  "क्या", "कब", "कितनी", "कितना", "कितने", "कैसे", "कौन", "क्यों", "कहाँ", "कहां", "फ़ीस", "फीस", "दस्तावेज़", "दस्तावेज", "दस्तावेज़ों",
  "दस्तावेजों", "सीट", "सीटें",
] as const;

/** A whole word in either script: "कब" asks when, "कबीर" is a name. */
const QUESTION = [
  /[?？]/,
  new RegExp(`(?:^|[^a-z\u0900-\u097f])(?:${QUESTION_WORDS.join("|")})(?=$|[^a-z\u0900-\u097f])`, "i"),
];

export function looksLikeQuestion(text: string | null | undefined): boolean {
  const value = String(text ?? "");
  return QUESTION.some((pattern) => pattern.test(value));
}

/** A receipt, however it is typed. */
const RECEIPT_WORD = "receipts?|reciepts?|raseed|rasid|rashid";

/**
 * A message that names one receipt in particular: a date, a month, an amount
 * or a number ("26 Jul wali receipt", "July ki raseed bhejo"). Claude matches
 * it against the family's receipts (D-606); the rules would send the latest.
 */
const NAMES_A_RECEIPT =
  /\d|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|जनवरी|फ़?फरवरी|फ़रवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|सितम्बर|अक्टूबर|अक्तूबर|नवंबर|नवम्बर|दिसंबर|दिसम्बर|[०-९]/i;

/**
 * Asking for the paper itself: send it, a copy, the PDF. "do" and "dena" are
 * "give" ("receipt de do"); "dono" (both) is not, as a whole word.
 */
const SEND_WORD = "send|bhej\\w*|copy|pdf|download|chahiye|chaiye|chahie|de ?do|dedo|dijiye|dijie|do|dena";

/**
 * In order: the first rule that matches wins. `stop` first, so "stop fees
 * messages" is never read as a fees question.
 */
const RULES: Rule[] = [
  { intent: "stop", patterns: [/^(stop|unsubscribe|band karo|बंद करो|बंद करें)$/i] },
  // A receipt and a word asking for it to be sent: the PDF itself (D-597).
  // "receipt" alone, or "receipt dikhao", is the list of receipts below.
  // Asked as a question or a why ("receipt kyu nahi bheji?"), it is likely a
  // complaint, and Claude reads it.
  {
    intent: "receipt_send",
    patterns: [
      new RegExp(`\\b(?:${RECEIPT_WORD})\\b.*\\b(?:${SEND_WORD})\\b`, "i"),
      new RegExp(`\\b(?:${SEND_WORD})\\b.*\\b(?:${RECEIPT_WORD})\\b`, "i"),
      /रसीद.*(भेज|चाहिए|चाहिये|कॉपी|कोपी|दीजिए|दीजिये|दें|दो|पीडीएफ)|(भेज|कॉपी|पीडीएफ).*रसीद/,
      // "pdf", "pdf bhejo", "PDF please": the only PDF the helper sends is a receipt (D-606).
      /^(?:the\s+|ek\s+)?(?:pdf|पीडीएफ)(?:\s+(?:send|bhej\w*|chahiye|chaiye|chahie|de\s?do|dedo|dijiye|dijie|do|dena|please|pls|plz|ji|kar\s?do|kijiye|भेजें|भेजो|भेज\s?दो|चाहिए|दीजिए|दो))*[\s!.।]*$/i,
    ],
    askClaudeIf: (text) =>
      NAMES_A_RECEIPT.test(text) || /[?？]/.test(text) || /(?:^|[^a-z\u0900-\u097f])(?:why|kyu|kyun|kyon|kyo)(?=$|[^a-z\u0900-\u097f])|क्यों|क्यूं/i.test(text),
  },
  {
    intent: "receipts",
    patterns: [/\b(receipts?|reciepts?|reciept|raseed|rasid|rashid)\b/i, /रसीद/],
    // "26 Jul wali receipt" is one receipt in particular: Claude sends it (D-606).
    askClaudeIf: (text) => NAMES_A_RECEIPT.test(text),
  },
  // Before fees: "admission" is a visit to book (D-592), and a fee question about admission goes to Claude.
  // "pravesh patra" / "प्रवेश पत्र" is an exam's admit card, not an admission.
  {
    intent: "visit",
    patterns: [
      /\b(admissions?|admision|admisson|addmission|dakhila|daakhila|dakhla)\b/i,
      /\bpravesh\b(?!\s*patra)/i,
      /\bschool\s+(visit|tour|dekhna|dekhne|dekhni|dikhana)\b/i,
      /\b(visit|see)\s+(the\s+)?school\b/i,
      /दाखिला|दाख़िला|दाखिले|दाख़िले|एडमिशन|प्रवेश(?!\s*पत्र)|स्कूल\s*देख/,
    ],
    askClaudeIf: looksLikeQuestion,
  },
  {
    intent: "fees",
    patterns: [
      /\b(fee|fees|fess|phees|dues?|baki|baaki|bakaya|installments?|kist|kisht)\b/i,
      /फ़?फीस|फ़ीस|शुल्क|बाकी|बकाया|किस्त|क़िस्त/,
    ],
  },
  {
    intent: "attendance",
    patterns: [/\b(attendance|attendence|hazri|hajri|haziri|present|absent)\b/i, /हाज़िरी|हाजिरी|उपस्थिति|अनुपस्थित/],
  },
  {
    intent: "results",
    patterns: [/\b(results?|marks?|report ?card|scores?|grades?)\b/i, /परिणाम|रिजल्ट|रिज़ल्ट|अंक|नंबर|मार्क्स|रिपोर्ट\s?कार्ड/],
  },
  {
    intent: "teacher",
    patterns: [/\b(class ?teacher|teacher|madam|ma'am|maam)\b/i, /कक्षा अध्यापक|अध्यापक|अध्यापिका|शिक्षक|शिक्षिका|टीचर|मैडम/],
  },
  {
    intent: "office",
    patterns: [
      /\b(office|principal|staff|human|person|call me|talk to|baat karni|baat karna)\b/i,
      /कार्यालय|ऑफिस|ऑफ़िस|प्रिंसिपल|प्रधानाचार्य|बात करनी|बात करना/,
    ],
  },
  {
    intent: "menu",
    patterns: [/^(menu|help|madad|options?|start|\?)$/i, /^(मेनू|मदद|सहायता)$/],
  },
  {
    intent: "thanks",
    patterns: [
      /^(ok(ay)?\s*)?(thanks?|thank you|thx|ty|dhanyavad|dhanyawad|shukriya)(\s*(ji|sir|madam))?[\s!.]*$/i,
      /^(ok|okay|okk|done|theek hai|thik hai|accha|achha)[\s!.]*$/i,
      /^(धन्यवाद|शुक्रिया|ठीक है|अच्छा)[\s!।.]*$/,
      /^[\u{1F44D}\u{1F64F}\u{2764}\u{FE0F}\u{1F60A}\u{1F642}\s]+$/u,
    ],
  },
  {
    intent: "greeting",
    patterns: [
      /^(hi+|hello+|helo|hey|hlo|namaste|namaskar|pranam|good (morning|afternoon|evening)|gm|jai (shree|shri) krishna|ram ram|jai jinendra|radhe radhe)(\s+(sir|madam|ji|ma'am))?[\s!.]*$/i,
      /^(नमस्ते|नमस्कार|प्रणाम|राम राम|जय जिनेन्द्र|जय श्री कृष्ण|राधे राधे|सुप्रभात)(\s+जी)?[\s!।.]*$/,
    ],
  },
];

/** What a short, plain message asks for, or null: then Claude reads it. */
export function ruleIntent(text: string | null | undefined, options: { claude?: boolean } = {}): HelperIntent | null {
  const value = String(text ?? "").trim();
  if (!value) return null;
  if (words(value).length > RULE_MAX_WORDS) return null;
  // `claude: false` is the intent when Claude cannot be asked: what a rule
  // would leave to Claude ("26 Jul wali receipt") is the rule's (D-606).
  const claude = options.claude ?? true;
  for (const rule of RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(value))) continue;
    return claude && rule.askClaudeIf?.(value) ? null : rule.intent;
  }
  return null;
}

/* --------------------------------------------------------- button replies */

/**
 * Every button and list row Veer Patta AI sends carries an id of this shape,
 * so a tap is read without asking Claude: `vpai:<intent>` or
 * `vpai:<intent>:<key>`.
 */
export const HELPER_ID_PREFIX = "vpai";

/** A parent's answer to "Did this answer help?", asked after a staff answer (D-584). */
export type RatingValue = "helped" | "not_helped";

export function isRatingValue(value: unknown): value is RatingValue {
  return value === "helped" || value === "not_helped";
}

/** A tap in the school-visit booking (D-592): a day from the list, then morning or afternoon. */
export type VisitTap = "visit_day" | "visit_part";

/** A tap on one receipt in the list, to have it sent (D-597). */
export type ReceiptTap = "receipt_pdf";

/** "Try again" under a report card that could not be sent (D-613): the child's card, once more. */
export type ReportCardTap = "report_card";

export type HelperTap = {
  intent: HelperIntent | "message_teacher" | VisitTap | ReceiptTap | ReportCardTap | RatingValue;
  /**
   * The child a button is about (`childKey` in `helper-facts.ts`), on a
   * "Did this answer help?" button the hand-off it rates (`ratingKey`),
   * on a visit's day or part, the day ("20261116") or the slot ("20261116am"),
   * on a receipt, the child and the receipt (`receiptKey`), and on a
   * report card's "Try again" the child (D-613).
   */
  key: string | null;
};

const TAP = /^vpai:([a-z_]{2,20})(?::([a-z0-9]{4,16}))?$/;

export function helperId(intent: HelperTap["intent"], key?: string | null): string {
  return key ? `${HELPER_ID_PREFIX}:${intent}:${key}` : `${HELPER_ID_PREFIX}:${intent}`;
}

/**
 * The id a tap says back: a button or list row on a typed message, or the
 * payload of a quick reply on an approved one (`button.payload`; the results
 * notice's Get report card, D-614). Empty when there is none.
 */
export function tapPayload(raw: Record<string, unknown> | null | undefined): string {
  if (!raw) return "";
  if (raw.type === "button") {
    const button = raw.button && typeof raw.button === "object" ? (raw.button as Record<string, unknown>) : {};
    return typeof button.payload === "string" ? button.payload.trim() : "";
  }
  if (raw.type !== "interactive") return "";
  const interactive = raw.interactive && typeof raw.interactive === "object" ? (raw.interactive as Record<string, unknown>) : {};
  const reply = (interactive.button_reply ?? interactive.list_reply) as Record<string, unknown> | undefined;
  return typeof reply?.id === "string" ? reply.id.trim() : "";
}

/** The parent's tap, from the raw WhatsApp message, or null when it was not one of ours. */
export function readTap(raw: Record<string, unknown> | null | undefined): HelperTap | null {
  if (!raw || (raw.type !== "interactive" && raw.type !== "button")) return null;
  const id = tapPayload(raw);
  const match = TAP.exec(id);
  if (!match) return null;
  const intent = match[1];
  const key = match[2] ?? null;
  // A rating always names the hand-off it rates, a visit's day or part its day, and a receipt its receipt; without one they say nothing.
  if (isRatingValue(intent)) return key ? { intent, key } : null;
  if (intent === "visit_day" || intent === "visit_part") return key ? { intent, key } : null;
  if (intent === "receipt_pdf" || intent === "report_card") return key ? { intent, key } : null;
  if (intent !== "message_teacher" && !(HELPER_INTENTS as readonly string[]).includes(intent)) return null;
  return { intent: intent as HelperTap["intent"], key };
}

/* ------------------------------------------------------------- what kind */

/**
 * What kind of message this is, for the helper. A voice note gets a kind
 * answer ("please type"), a reaction or a sticker gets none, and nothing the
 * helper cannot read is claimed from the hub.
 */
export type MessageKind = "text" | "tap" | "voice" | "media" | "ignore";

export function messageKind(type: string, raw: Record<string, unknown> | null | undefined): MessageKind {
  if (type === "text") return "text";
  if (type === "interactive") return readTap(raw) ? "tap" : "text";
  // A quick-reply button on a template: one of ours (Get report card, D-614)
  // is a tap; any other's words are the message.
  if (type === "button") return readTap(raw) ? "tap" : "text";
  if (type === "audio") return "voice";
  if (type === "image" || type === "video" || type === "document") return "media";
  return "ignore";
}
