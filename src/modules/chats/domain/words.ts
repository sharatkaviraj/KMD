import { p, type Pair } from "@/vx/text";

import type { ChatDesk, ChatDirection, ChatKind, ChatLanguage, ChatMedia } from "./types";

/**
 * The words of parent chats (D-616): what the parent reads above a message
 * from school, the one line a chat list shows, and the desks' names. Pure.
 *
 * Every message from school goes out from the school's one number, so the
 * parent is told who is writing: the class teacher by name, the accounts
 * office, or the principal's office. The name heads a message when the
 * speaker changes, or when the same person writes again after a pause; a
 * quick run of messages from one person carries it once, as a WhatsApp chat
 * with a person would.
 */

export type Speaker =
  | { kind: "class_teacher"; name: string }
  | { kind: "accounts" }
  | { kind: "principal" }
  | { kind: "office" };

/** Who a member of staff is to the parent in this chat. */
export function speakerFor(input: { desk: ChatDesk; role: string; isClassTeacher: boolean; name: string }): Speaker {
  const name = input.name.trim();
  if (input.desk === "class" && input.isClassTeacher && name) return { kind: "class_teacher", name: name.slice(0, 60) };
  if (input.role === "admin") return { kind: "principal" };
  if (input.desk === "accounts" || input.role === "accountant" || input.role === "fee_collector") return { kind: "accounts" };
  return { kind: "office" };
}

/** A speaker as a stable key, to tell whether the last message came from the same one. */
export function speakerKey(speaker: Speaker): string {
  return speaker.kind === "class_teacher" ? `class_teacher:${speaker.name}` : speaker.kind;
}

/** A speaker as a message keeps it, so a message that waited goes out under the same name. */
export function speakerToMeta(speaker: Speaker): Record<string, string> {
  return speaker.kind === "class_teacher" ? { kind: speaker.kind, name: speaker.name } : { kind: speaker.kind };
}

/** A speaker read back from a message, or null when it carries none. */
export function speakerFromMeta(value: unknown): Speaker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "class_teacher") {
    const name = typeof record.name === "string" ? record.name.trim() : "";
    return name ? { kind: "class_teacher", name: name.slice(0, 60) } : null;
  }
  if (record.kind === "accounts" || record.kind === "principal" || record.kind === "office") return { kind: record.kind };
  return null;
}

/** The bold first line of a message from school, in the parent's language. */
export function speakerHead(speaker: Speaker, language: ChatLanguage): string {
  const words: Record<ChatLanguage, string> =
    speaker.kind === "class_teacher"
      ? { hi: `कक्षा अध्यापक ${speaker.name}`, hx: `Class teacher ${speaker.name}`, en: `${speaker.name}, class teacher` }
      : speaker.kind === "accounts"
        ? { hi: "स्कूल अकाउंट्स विभाग", hx: "School accounts office", en: "School accounts office" }
        : speaker.kind === "principal"
          ? { hi: "प्रधानाचार्य कार्यालय", hx: "Principal office", en: "Principal's office" }
          : { hi: "स्कूल ऑफ़िस", hx: "School office", en: "School office" };
  return `💬 *${words[language]}*`;
}

/** The same person writing again within this long carries no new head. */
export const HEAD_AGAIN_AFTER_MINUTES = 30;

/** Whether a message needs the speaker's head: a new speaker, or the same one after a pause. */
export function needsHead(previous: { speaker: string | null; at: string | null } | null, speaker: Speaker, now: Date): boolean {
  if (!previous?.speaker || !previous.at) return true;
  if (previous.speaker !== speakerKey(speaker)) return true;
  const at = Date.parse(previous.at);
  return !Number.isFinite(at) || now.getTime() - at > HEAD_AGAIN_AFTER_MINUTES * 60_000;
}

/** The longest message a person can type in one go: WhatsApp's own limit, less room for the head. */
export const MAX_CHAT_TEXT = 3500;
/** A photo's or a file's words underneath it: WhatsApp's caption limit, less room for the head. */
export const MAX_CHAT_CAPTION = 900;

/** The words the parent receives: the head when it is due, then what was typed (a photo's may be none). */
export function outgoingText(input: { speaker: Speaker; language: ChatLanguage; text: string; head: boolean }): string {
  const text = input.text.trim();
  if (!input.head) return text;
  const head = speakerHead(input.speaker, input.language);
  return text ? `${head}\n${text}` : head;
}

/* ------------------------------------------------------------ children */

/** The longest label a chat keeps for its children (the column's own limit). */
export const MAX_CHILDREN_LABEL = 200;

/**
 * "Riya · Class 6, Aarav · Class 2": the children a chat is about, as its
 * heading shows them, the one the parent named first. Null when none is known.
 */
export function childrenLabel(children: ReadonlyArray<{ firstName: string; className: string }>): string | null {
  const parts = children
    .map((child) => [child.firstName.trim(), child.className.trim()].filter(Boolean).join(" · "))
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  let label = "";
  for (const part of parts) {
    const next = label ? `${label}, ${part}` : part;
    if (next.length > MAX_CHILDREN_LABEL) break;
    label = next;
  }
  return label || parts[0].slice(0, MAX_CHILDREN_LABEL);
}

/** The first child's first name in a chat's label ("Riya · Class 6, …" is "Riya"), for "about Riya". */
export function firstChildName(label: string | null): string | null {
  const first = (label ?? "").split(",")[0]?.split("·")[0]?.trim() ?? "";
  return first ? first.slice(0, 40) : null;
}

/* ------------------------------------------------------------ previews */

const PREVIEW_MAX = 140;

function firstLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * The one line kept on the chat for its list: the words, or a sign for what
 * was sent. Language-neutral, so one row reads in Hindi or English; the
 * screen turns a bare sign into words (`previewWords`).
 */
export function previewFor(kind: ChatKind, body: string | null, media: ChatMedia | null): string {
  const text = body?.trim() ? firstLine(body, PREVIEW_MAX) : "";
  switch (kind) {
    case "image":
      return text ? `📷 ${text}` : "📷";
    case "video":
      return text ? `🎬 ${text}` : "🎬";
    case "document":
      return `📄 ${firstLine(media?.filename ?? "", 80) || text || "PDF"}`;
    case "audio":
      return "🎤";
    case "sticker":
      return "🙂";
    case "location":
      return "📍";
    case "contacts":
      return "👤";
    case "tap":
      return text ? `👆 ${text}` : "👆";
    case "text":
    case "suggestion":
    case "event":
      return text || "💬";
    default:
      return text || "💬";
  }
}

const SIGN_WORDS: Record<string, Pair> = {
  "📷": p("Photo", "फ़ोटो"),
  "🎬": p("Video", "वीडियो"),
  "🎤": p("Voice note", "वॉइस नोट"),
  "🙂": p("Sticker", "स्टिकर"),
  "📍": p("Location", "लोकेशन"),
  "👤": p("Contact", "संपर्क"),
  "👆": p("Button", "बटन"),
  "💬": p("Message", "संदेश"),
};

/** A stored preview as the reader sees it: a bare sign gets its word. */
export function previewWords(preview: string | null): Pair {
  const value = (preview ?? "").trim();
  if (!value) return p("No messages yet", "अभी कोई संदेश नहीं");
  const word = SIGN_WORDS[value];
  return word ? { en: `${value} ${word.en}`, hi: `${value} ${word.hi ?? word.en}` } : { en: value };
}

/** Who wrote the list's last line, shown before it. Null for the parent, whose name heads the row already. */
export function previewBy(direction: ChatDirection | null): Pair | null {
  if (direction === "out") return p("School", "स्कूल");
  if (direction === "ai") return p("AI", "AI");
  if (direction === "note") return p("Note", "नोट");
  return null;
}

/* --------------------------------------------------------------- desks */

export const DESK_WORDS: Record<ChatDesk, Pair> = {
  class: p("Class teacher", "कक्षा अध्यापक"),
  accounts: p("Accounts", "अकाउंट्स"),
  admin: p("Office", "ऑफ़िस"),
};

/** What a chat is about, from Veer Patta AI's topic, for the chip on its row. */
const TOPIC_WORDS: Record<string, Pair> = {
  fees: p("Fees", "फ़ीस"),
  receipts: p("Receipt", "रसीद"),
  attendance: p("Attendance", "हाज़िरी"),
  results: p("Results", "परिणाम"),
  calendar: p("Dates", "तारीख़ें"),
  leave: p("Leave", "छुट्टी"),
  complaint: p("Complaint", "शिकायत"),
  admission: p("Admission", "प्रवेश"),
  visit: p("Visit", "विज़िट"),
  homework: p("Homework", "गृहकार्य"),
  transport: p("Transport", "वाहन"),
  not_helped: p("Answer did not help", "जवाब से मदद नहीं मिली"),
};

export function topicWords(topic: string | null): Pair | null {
  if (!topic) return null;
  return TOPIC_WORDS[topic] ?? null;
}

/** How long ago, in a few letters: "now", "5m", "3h", "2d". The same in both languages. */
export function agoShort(at: string | null, now: Date): string {
  const time = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - time) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** How long a parent has been waiting, as words: "Waiting 25 min", "Waiting 3 h". */
export function waitingWords(since: string | null, now: Date): Pair | null {
  const time = since ? Date.parse(since) : Number.NaN;
  if (!Number.isFinite(time)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - time) / 60_000));
  if (minutes < 1) return p("Waiting · just now", "प्रतीक्षा · अभी");
  if (minutes < 60) return p(`Waiting ${minutes} min`, `${minutes} मिनट से प्रतीक्षा`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return p(`Waiting ${hours} h`, `${hours} घंटे से प्रतीक्षा`);
  const days = Math.floor(hours / 24);
  return p(`Waiting ${days} ${days === 1 ? "day" : "days"}`, `${days} दिन से प्रतीक्षा`);
}

/** A failed message's reason, said plainly. */
export function failureWords(code: string | null): Pair {
  const value = code ?? "";
  if (value.startsWith("needs_template")) {
    return p(
      "Not sent: the parent has not written for over a day, and the message that starts a new chat is still waiting for Meta's approval.",
      "नहीं भेजा गया: अभिभावक ने एक दिन से ज़्यादा समय से नहीं लिखा, और नई बातचीत शुरू करने वाला संदेश अभी Meta की मंज़ूरी का इंतज़ार कर रहा है।",
    );
  }
  if (value.includes("not_owner_test_number")) {
    return p(
      "Not sent: while testing, WhatsApp goes only to the owner's number.",
      "नहीं भेजा गया: जाँच के दौरान WhatsApp सिर्फ़ मालिक के नंबर पर जाता है।",
    );
  }
  if (value.includes("feature_off") || value.includes("practice_mode") || value.includes("dry_run")) {
    return p("Not sent: WhatsApp answers are switched off in Settings.", "नहीं भेजा गया: Settings में WhatsApp जवाब बंद हैं।");
  }
  if (value.includes("file")) return p("Not sent: the file could not be sent.", "नहीं भेजा गया: फ़ाइल नहीं भेजी जा सकी।");
  // WhatsApp took it, then said it could not deliver it (the webhook's tick).
  if (value === "meta:131047") {
    return p(
      "Not delivered: the parent had not written for over a day, so WhatsApp would not pass it on. Send it again: it will wait for their reply.",
      "नहीं पहुँचा: अभिभावक ने एक दिन से ज़्यादा समय से नहीं लिखा था, इसलिए WhatsApp ने इसे आगे नहीं भेजा। दोबारा भेजें: यह उनके जवाब का इंतज़ार करेगा।",
    );
  }
  if (value.startsWith("meta:")) {
    return p(
      "Not delivered: WhatsApp could not pass this on to the parent's phone.",
      "नहीं पहुँचा: WhatsApp इसे अभिभावक के फ़ोन तक नहीं पहुँचा सका।",
    );
  }
  if (value.startsWith("send_unknown")) {
    return p(
      "WhatsApp did not answer, so this may not have reached the parent. Send it again only if they did not get it.",
      "WhatsApp से जवाब नहीं आया, हो सकता है यह अभिभावक तक न पहुँचा हो। उन्हें न मिला हो तभी दोबारा भेजें।",
    );
  }
  return p("Not sent. Try again in a moment.", "नहीं भेजा गया। थोड़ी देर में फिर कोशिश करें।");
}

/**
 * A message that waits for the parent: it goes the moment they next write.
 * `error` says whether they could be told that an answer is waiting.
 */
export function heldWords(error: string | null): Pair {
  if (!error) {
    return p(
      "Waiting: the parent had not written for a day, so WhatsApp told them a message is ready. It goes as soon as they reply.",
      "प्रतीक्षा में: अभिभावक ने एक दिन से नहीं लिखा था, इसलिए WhatsApp पर उन्हें बताया गया कि संदेश तैयार है। उनके जवाब देते ही यह चला जाएगा।",
    );
  }
  return p(
    "Waiting: it goes as soon as the parent writes to the school again. They could not be told about it yet.",
    "प्रतीक्षा में: अभिभावक के फिर से लिखते ही यह चला जाएगा। अभी उन्हें इसकी सूचना नहीं दी जा सकी।",
  );
}
