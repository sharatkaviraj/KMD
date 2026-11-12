import type { TemplateSubmission } from "@/platform/whatsapp/providers";

import type { StaffLanguage } from "./helper-handoff";
import { STAFF_SCHOOL_LINE } from "./staff-hub-templates";

/**
 * Veer Patta AI's two approved messages on the school's WhatsApp hub (D-578),
 * Hindi and English, for the times a typed message cannot go because the
 * person has not written to the school in the last 24 hours:
 *
 *  - `vpps_staff_parent_question_<hi|en>_v1` tells a teacher, the accountant,
 *    an admin or the office that a parent's message is waiting for them. They
 *    answer by swiping right on it and typing; no link, because a teacher
 *    cannot open One's Messages and does not need to.
 *  - `vpps_parent_answer_ready_<hi|en>_v1` tells a parent whose chat has gone
 *    quiet that their answer is ready. Meta lets the school send the answer
 *    itself only once they reply, and the helper sends it the moment they do.
 *
 * Shaped like the staff set (`staff-hub-templates.ts`): a bold title, the
 * school's name, one labelled line per blank, never a blank first or last.
 * The hourly template check sends each to Meta once, by itself.
 *
 * Pure and server-side: it carries every body.
 */

export const STAFF_ALERT_TEMPLATE: Record<StaffLanguage, string> = {
  hi: "vpps_staff_parent_question_hi_v1",
  en: "vpps_staff_parent_question_en_v1",
};

export const ANSWER_READY_TEMPLATE: Record<StaffLanguage, string> = {
  hi: "vpps_parent_answer_ready_hi_v1",
  en: "vpps_parent_answer_ready_en_v1",
};

const STAFF_ALERT_BODY: Record<StaffLanguage, string> = {
  en: [
    "*A parent's message for you*",
    STAFF_SCHOOL_LINE.en,
    "",
    "Dear {{1}},",
    "Student: {{2}}",
    "About: {{3}}",
    "Message: {{4}}",
    "",
    "Swipe right on this message and type your answer, and it goes to the parent from the school's number.",
    "Thank you.",
  ].join("\n"),
  hi: [
    "*आपके लिए अभिभावक का संदेश*",
    STAFF_SCHOOL_LINE.hi,
    "",
    "{{1}} जी,",
    "विद्यार्थी: {{2}}",
    "विषय: {{3}}",
    "संदेश: {{4}}",
    "",
    "जवाब देने के लिए इस संदेश को दाईं ओर स्वाइप करके लिखें, जवाब स्कूल के नंबर से अभिभावक को भेज दिया जाएगा।",
    "धन्यवाद।",
  ].join("\n"),
};

const STAFF_ALERT_SAMPLES: Record<StaffLanguage, readonly string[]> = {
  en: ["Anita Verma", "Aarav · Class 5 A", "Homework", "Aarav was unwell yesterday, please share today's homework."],
  hi: ["अनीता वर्मा", "आरव · कक्षा 5 A", "गृहकार्य", "आरव कल बीमार था, कृपया आज का गृहकार्य भेज दें।"],
};

const ANSWER_READY_BODY: Record<StaffLanguage, string> = {
  en: [
    "*Your answer is ready*",
    STAFF_SCHOOL_LINE.en,
    "",
    "{{1}} has answered your message about {{2}}.",
    "",
    "Reply to this message to read the answer.",
    "Thank you.",
  ].join("\n"),
  hi: [
    "*आपका जवाब तैयार है*",
    STAFF_SCHOOL_LINE.hi,
    "",
    "{{1}} ने {{2}} के बारे में आपके संदेश का जवाब दिया है।",
    "",
    "जवाब पढ़ने के लिए इस संदेश का उत्तर दें।",
    "धन्यवाद।",
  ].join("\n"),
};

const ANSWER_READY_SAMPLES: Record<StaffLanguage, readonly string[]> = {
  en: ["Class teacher Anita Verma", "Aarav"],
  hi: ["कक्षा अध्यापक अनीता वर्मा", "आरव"],
};

const LANGUAGES: readonly StaffLanguage[] = ["hi", "en"];

/** The four, as the hub's `POST /v1/templates` takes them. */
export const HELPER_HUB_SUBMISSIONS: readonly TemplateSubmission[] = LANGUAGES.flatMap((language) => [
  {
    name: STAFF_ALERT_TEMPLATE[language],
    language,
    category: "UTILITY" as const,
    body: STAFF_ALERT_BODY[language],
    examples: [...STAFF_ALERT_SAMPLES[language]],
    buttons: [],
  },
  {
    name: ANSWER_READY_TEMPLATE[language],
    language,
    category: "UTILITY" as const,
    body: ANSWER_READY_BODY[language],
    examples: [...ANSWER_READY_SAMPLES[language]],
    buttons: [],
  },
]);

/** How many blanks each fills, for the registry rows and the send check. */
export const HELPER_TEMPLATE_PARAMS = { staffAlert: 4, answerReady: 2 } as const;
