import type { TemplateSubmission } from "@/platform/whatsapp/providers";

import type { ChatLanguage } from "./types";
import type { Speaker } from "./words";

/**
 * The chats' own two approved messages (D-616), Hindi and English, for the
 * times a typed WhatsApp cannot go because the person has not written to the
 * school's number in the last 24 hours:
 *
 *  - `vpps_staff_open_one_<hi|en>_v1` tells a member of staff that parents
 *    are waiting for them, with an "Open chats" button that opens their whole
 *    Chats section in One through a one-tap link (`/go/<code>`). Until Meta
 *    approves it, the approved "Your staff alerts" message carries the link
 *    in its words instead (`digestParams`).
 *  - `vpps_parent_school_message_<hi|en>_v1` tells a parent that the school
 *    has written to them, when the school writes first. An answer to the
 *    parent's own question uses Veer Patta AI's approved "your answer is
 *    ready" note instead. Either way the message itself goes the moment the
 *    parent replies.
 *
 * Shaped like the staff set (`staff-hub-templates.ts`): a bold title, the
 * school's name, one labelled line per blank, never a blank first or last.
 * Pure: it carries every body, for the submission and for the check that
 * holds an approval to these exact words.
 */

type TemplateLanguage = "hi" | "en";

const SCHOOL_LINE: Record<TemplateLanguage, string> = {
  en: "Shri Veer Patta Sr. Sec. School",
  hi: "श्री वीर पत्ता सी. सै. स्कूल",
};

export const OPEN_ONE_TEMPLATE: Record<TemplateLanguage, string> = {
  hi: "vpps_staff_open_one_hi_v1",
  en: "vpps_staff_open_one_en_v1",
};

export const SCHOOL_MESSAGE_TEMPLATE: Record<TemplateLanguage, string> = {
  hi: "vpps_parent_school_message_hi_v1",
  en: "vpps_parent_school_message_en_v1",
};

/** How many blanks each fills, matching the registry rows `20261115034215_parent_chats.sql` added. */
export const CHAT_TEMPLATE_PARAMS = { openOne: 2, schoolMessage: 2 } as const;

/** Where the "Open chats" button goes: the one-tap link's code is `{{1}}` (`goLinkUrl`). */
export const OPEN_ONE_BUTTON_URL = "https://one.vpps.co.in/go/{{1}}";
export const OPEN_ONE_BUTTON_LABEL: Record<TemplateLanguage, string> = { en: "Open chats", hi: "चैट खोलें" };

const OPEN_ONE_BODY: Record<TemplateLanguage, string> = {
  en: [
    "*Parents are waiting for your reply*",
    SCHOOL_LINE.en,
    "",
    "Dear {{1}},",
    "Waiting: {{2}}",
    "",
    "Tap Open chats below to read their messages and reply in One.",
    "Thank you.",
  ].join("\n"),
  hi: [
    "*अभिभावक आपके जवाब की प्रतीक्षा में*",
    SCHOOL_LINE.hi,
    "",
    "{{1}} जी,",
    "प्रतीक्षा में: {{2}}",
    "",
    "उनके संदेश पढ़ने और One में जवाब देने के लिए नीचे चैट खोलें दबाएँ।",
    "धन्यवाद।",
  ].join("\n"),
};

const OPEN_ONE_SAMPLES: Record<TemplateLanguage, readonly string[]> = {
  en: ["Anita Verma", "2 parents"],
  hi: ["अनीता वर्मा", "2 अभिभावक"],
};

const SCHOOL_MESSAGE_BODY: Record<TemplateLanguage, string> = {
  en: [
    "*A message from the school*",
    SCHOOL_LINE.en,
    "",
    "{{1}} has sent you a message about {{2}}.",
    "",
    "Reply to this message to read it.",
    "Thank you.",
  ].join("\n"),
  hi: [
    "*विद्यालय से आपके लिए संदेश*",
    SCHOOL_LINE.hi,
    "",
    "{{1}} ने {{2}} के बारे में आपको एक संदेश भेजा है।",
    "",
    "इसे पढ़ने के लिए इस संदेश का उत्तर दें।",
    "धन्यवाद।",
  ].join("\n"),
};

const SCHOOL_MESSAGE_SAMPLES: Record<TemplateLanguage, readonly string[]> = {
  en: ["Class teacher Anita Verma", "Aarav"],
  hi: ["कक्षा अध्यापक अनीता वर्मा", "आरव"],
};

const LANGUAGES: readonly TemplateLanguage[] = ["hi", "en"];

/**
 * The four, as the hub's `POST /v1/templates` takes them. On the list the hub
 * carries (`HUB_TEMPLATE_SUBMISSIONS`) since the owner said to send them for
 * approval (15 Nov 2026, "Yes, yes, go ahead"), as every new template has
 * gone to Meta only on the owner's word (D-573).
 */
export const CHAT_HUB_SUBMISSIONS: readonly TemplateSubmission[] = LANGUAGES.flatMap((language) => [
  {
    name: OPEN_ONE_TEMPLATE[language],
    language,
    category: "UTILITY" as const,
    body: OPEN_ONE_BODY[language],
    examples: [...OPEN_ONE_SAMPLES[language]],
    buttons: [{ type: "URL" as const, text: OPEN_ONE_BUTTON_LABEL[language], url: OPEN_ONE_BUTTON_URL }],
  },
  {
    name: SCHOOL_MESSAGE_TEMPLATE[language],
    language,
    category: "UTILITY" as const,
    body: SCHOOL_MESSAGE_BODY[language],
    examples: [...SCHOOL_MESSAGE_SAMPLES[language]],
    buttons: [],
  },
]);

/** A parent's language as an approved template's: Hinglish readers get Hindi. */
export function templateLanguageOf(language: ChatLanguage): TemplateLanguage {
  return language === "en" ? "en" : "hi";
}

/** Who wrote, as the subject of "… has sent you a message", in the template's language. */
export function speakerSubject(speaker: Speaker, language: TemplateLanguage): string {
  switch (speaker.kind) {
    case "class_teacher":
      return language === "hi" ? `कक्षा अध्यापक ${speaker.name}` : `Class teacher ${speaker.name}`;
    case "accounts":
      return language === "hi" ? "स्कूल के अकाउंट्स विभाग" : "The school's accounts office";
    case "principal":
      return language === "hi" ? "प्रधानाचार्य कार्यालय" : "The principal's office";
    case "office":
      return language === "hi" ? "स्कूल ऑफ़िस" : "The school office";
  }
}

const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** The school message's two blanks: who wrote, and which child it is about. */
export function schoolMessageParams(speaker: Speaker, childName: string | null, language: ChatLanguage): string[] {
  const lang = templateLanguageOf(language);
  const about = childName?.trim() || (lang === "hi" ? "आपके बच्चे" : "your child");
  return [oneLine(speakerSubject(speaker, lang), 60), oneLine(about, 40)];
}
