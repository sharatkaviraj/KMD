/**
 * The approved wording of every staff WhatsApp template, in Hindi and English
 * (go-live Phase F). Pure, and the single source for three things that must
 * agree word for word:
 *
 *  - what the renderers in `notices.ts` produce (they fill these bodies);
 *  - the rows of `vppsone.message_templates` (migration
 *    `staff_whatsapp_consent_and_gates`, checked by tests/staff-notice-templates.test.ts);
 *  - docs/cutover/STAFF-WHATSAPP.md, which the owner submits to AiSensy.
 *
 * Meta approves a body with its placeholders fixed; the app only fills
 * {{1}}, {{2}} …. A body here changes only with a new template name.
 */

export type TemplateBody = {
  label: { hi: string; en: string };
  hi: string;
  en: string;
  /** What each placeholder holds, in order. */
  variables: string[];
};

export const STAFF_TEMPLATES: Record<string, TemplateBody> = {
  vppsone_cover_assigned: {
    label: { hi: "व्यवस्था मिली", en: "Cover assigned" },
    hi: "{{1}} जी, {{2}} को {{3}} में {{4}} ({{5}}) की व्यवस्था आपकी है। देखें और पुष्टि करें: {{6}}",
    en: "{{1}}, you are covering {{4}} ({{5}}) in {{3}} on {{2}}. Open and acknowledge: {{6}}",
    variables: ["name", "day", "period", "classes", "subject", "link"],
  },
  vppsone_cover_changed: {
    label: { hi: "व्यवस्था बदली", en: "Cover changed" },
    hi: "{{1}} जी, {{2}} {{3}} की आपकी व्यवस्था बदली है: अब {{4}} ({{5}})। नया विवरण: {{6}}",
    en: "{{1}}, your cover in {{3}} on {{2}} has changed: now {{4}} ({{5}}). Current details: {{6}}",
    variables: ["name", "day", "period", "classes", "subject", "link"],
  },
  vppsone_cover_cancelled: {
    label: { hi: "व्यवस्था रद्द", en: "Cover cancelled" },
    hi: "{{1}} जी, {{2}} {{3}} में {{4}} ({{5}}) की व्यवस्था अब आपकी नहीं है। विवरण: {{6}}",
    en: "{{1}}, you no longer need to cover {{4}} ({{5}}) in {{3}} on {{2}}. Details: {{6}}",
    variables: ["name", "day", "period", "classes", "subject", "link"],
  },
  vppsone_cover_escalation: {
    label: { hi: "व्यवस्था नहीं हो सकी", en: "Cover refused" },
    hi: "{{1}} जी, {{2}} {{3}} में {{4}} ({{5}}) के लिए कोई नहीं है — किसी अध्यापक ने कहा वे नहीं ले सकते। देखें: {{6}}",
    en: "{{1}}, {{4}} ({{5}}) in {{3}} on {{2}} needs someone — the assigned teacher cannot cover it. Review: {{6}}",
    variables: ["name", "day", "period", "classes", "subject", "link"],
  },
  vppsone_staff_attendance_reminder: {
    label: { hi: "हाज़िरी की याद", en: "Register not saved" },
    hi: "{{1}} जी, {{2}} की {{3}} की हाज़िरी अभी दर्ज नहीं हुई है। यहाँ लें: {{4}}",
    en: "{{1}}, {{3}}'s register for {{2}} has not been saved yet. Take it here: {{4}}",
    variables: ["name", "day", "class", "link"],
  },
  vppsone_marks_reminder: {
    label: { hi: "अंक रिमाइंडर", en: "Marks reminder" },
    hi: "नमस्ते {{1}}, इन पेपरों के अंक अभी बाकी हैं: {{2}}",
    en: "Hello {{1}}, these papers still have marks outstanding: {{2}}",
    variables: ["Teacher name", "Which papers"],
  },
  vppsone_weekly_summary: {
    label: { hi: "साप्ताहिक शैक्षणिक सारांश", en: "Weekly academic summary" },
    hi: "नमस्ते {{1}}, इस सप्ताह का शैक्षणिक सारांश: {{2}} — {{3}}",
    en: "Hello {{1}}, this week's academic summary: {{2}} — {{3}}",
    variables: ["name", "summary", "from"],
  },
  vx_staff_notice: {
    label: { hi: "स्टाफ़ सूचना", en: "Staff notice" },
    hi: "{{1}}",
    en: "{{1}}",
    variables: ["text"],
  },
  vx_staff_online_review_v1: {
    label: { hi: "ऑनलाइन भुगतान जाँचें", en: "Online payment needs review" },
    hi: "{{1}} जी, {{3}} का {{2}} का ऑनलाइन भुगतान अपने-आप दर्ज नहीं हो सका। जाँच कर दर्ज करें: {{4}}",
    en: "{{1}}, an online payment of {{2}} for {{3}} could not be posted automatically. Review it here: {{4}}",
    variables: ["name", "amount", "student or class", "link"],
  },
  vx_staff_online_payment_v1: {
    label: { hi: "ऑनलाइन भुगतान आया", en: "Online payment received" },
    hi: "{{1}} जी, {{3}} की फ़ीस {{2}} ऑनलाइन मिली, रसीद {{4}} बन गई है। {{5}}",
    en: "{{1}}, {{2}} was received online for {{3}}; receipt {{4}} has been posted. {{5}}",
    variables: ["name", "amount", "student or class", "receipt", "link"],
  },
  vx_staff_day_collection_v1: {
    label: { hi: "दिन का संग्रह", en: "Day's collection" },
    hi: "{{1}} जी, {{2}} का संग्रह: {{3}}, {{4}} रसीदें ({{5}})। {{6}}",
    en: "{{1}}, collection for {{2}}: {{3}} in {{4}} receipts ({{5}}). {{6}}",
    variables: ["name", "day", "total", "receipts", "by mode", "link"],
  },
  vx_staff_day_not_closed_v1: {
    label: { hi: "दिन बंद नहीं हुआ", en: "Day not closed" },
    hi: "{{1}} जी, {{2}} का दिन अभी बंद नहीं हुआ है ({{3}} रसीदें, {{4}})। नकद गिनकर दिन बंद करें: {{5}}",
    en: "{{1}}, {{2}} has not been closed yet ({{3}} receipts, {{4}}). Count the cash and close the day: {{5}}",
    variables: ["name", "day", "receipts", "total", "link"],
  },
  vx_staff_money_request_v1: {
    label: { hi: "रसीद रद्द / माफ़ी का अनुरोध", en: "Reversal or write-off requested" },
    hi: "{{1}} जी, {{5}} ने {{4}} के लिए {{3}} का {{2}} माँगा है। निर्णय करें: {{6}}",
    en: "{{1}}, {{5}} asked for a {{2}} of {{3}} for {{4}}. Decide here: {{6}}",
    variables: ["name", "what", "amount", "student or class", "asked by", "link"],
  },
  vx_staff_money_decision_v1: {
    label: { hi: "रसीद रद्द / माफ़ी का निर्णय", en: "Reversal or write-off decided" },
    hi: "{{1}} जी, {{5}} के {{4}} के {{2}} का आपका अनुरोध {{3}} हुआ। {{6}}",
    en: "{{1}}, your {{2}} request of {{4}} for {{5}} was {{3}}. {{6}}",
    variables: ["name", "what", "decision", "amount", "student or class", "link"],
  },
  vx_staff_leave_requested_v1: {
    label: { hi: "छुट्टी का अनुरोध", en: "Leave requested" },
    hi: "{{1}} जी, {{2}} ने {{3}} की छुट्टी माँगी है। देखें: {{4}}",
    en: "{{1}}, {{2}} has asked for leave on {{3}}. Review: {{4}}",
    variables: ["name", "teacher", "dates", "link"],
  },
  vx_staff_leave_decided_v1: {
    label: { hi: "छुट्टी का निर्णय", en: "Leave decided" },
    hi: "{{1}} जी, {{2}} की आपकी छुट्टी {{3}} हुई। {{4}}",
    en: "{{1}}, your leave for {{2}} was {{3}}. {{4}}",
    variables: ["name", "dates", "decision", "link"],
  },
  vx_staff_ops_alert_v1: {
    label: { hi: "सिस्टम जाँच", en: "System check" },
    hi: "{{1}} जी, {{2}} की सिस्टम जाँच में {{3}} बातें देखनी हैं: {{4}}। देखें: {{5}}",
    en: "{{1}}, the system check for {{2}} found {{3}} things to look at: {{4}}. Details: {{5}}",
    variables: ["name", "day", "count", "what", "link"],
  },
  vx_staff_digest_v1: {
    label: { hi: "कई संदेश एक साथ", en: "Several messages at once" },
    hi: "{{1}} जी, आपके लिए {{2}} नए संदेश: {{3}}। सब यहाँ देखें: {{4}}",
    en: "{{1}}, you have {{2}} new messages: {{3}}. See them all here: {{4}}",
    variables: ["name", "count", "what", "link"],
  },
};

/**
 * The teacher-task link's six templates (`vppsone_teacher_task_*_v1`, migration
 * `20261016090000_teacher_task_delivery`): not sent by the outbox — they go
 * through the task's own reviewed delivery — but staff templates all the same,
 * so the owner submits them with the rest (plan §8.3, critique1 B13). Each
 * code is one language; its body is the same in both `message_templates`
 * columns. Each has a URL button whose link ends in the task's token: the
 * button's dynamic suffix is `{{1}}` after `<site>/t/tasks/`
 * (`claim_teacher_task_delivery` returns it as `buttonSuffix`).
 * `AISENSY_CAMPAIGN_PREFIX`, when set, replaces the leading `vppsone` of the
 * campaign name (`message-provider.ts`).
 */
export type TeacherTaskTemplate = {
  label: string;
  language: "hi" | "en" | "both";
  body: string;
  variables: readonly ["teacher", "task", "due"];
  /** The URL button's link; `{{1}}` is the task token the send fills in. */
  buttonUrl: string;
};

const TASK_VARIABLES = ["teacher", "task", "due"] as const;
const TASK_BUTTON = "https://one.vpps.co.in/t/tasks/{{1}}";

export const TEACHER_TASK_TEMPLATES: Record<string, TeacherTaskTemplate> = {
  vppsone_teacher_task_en_v1: {
    label: "Teacher task · English",
    language: "en",
    body: "{{1}}, task: {{2}}. Due: {{3}}. Use the button to open your work.",
    variables: TASK_VARIABLES,
    buttonUrl: TASK_BUTTON,
  },
  vppsone_teacher_task_hi_v1: {
    label: "Teacher task · Hindi",
    language: "hi",
    body: "{{1}}, कार्य: {{2}}। अंतिम तिथि: {{3}}। काम खोलने के लिए बटन दबाएँ।",
    variables: TASK_VARIABLES,
    buttonUrl: TASK_BUTTON,
  },
  vppsone_teacher_task_both_v1: {
    label: "Teacher task · Both",
    language: "both",
    body: "{{1}}, कार्य / Task: {{2}}। अंतिम तिथि / Due: {{3}}। काम खोलने के लिए बटन दबाएँ / Use the button to open your work.",
    variables: TASK_VARIABLES,
    buttonUrl: TASK_BUTTON,
  },
  vppsone_teacher_task_reminder_en_v1: {
    label: "Task reminder · English",
    language: "en",
    body: "{{1}}, work is still pending: {{2}}. Due: {{3}}. Use the button to open your work.",
    variables: TASK_VARIABLES,
    buttonUrl: TASK_BUTTON,
  },
  vppsone_teacher_task_reminder_hi_v1: {
    label: "Task reminder · Hindi",
    language: "hi",
    body: "{{1}}, कार्य अभी बाकी है: {{2}}। अंतिम तिथि: {{3}}। काम खोलने के लिए बटन दबाएँ।",
    variables: TASK_VARIABLES,
    buttonUrl: TASK_BUTTON,
  },
  vppsone_teacher_task_reminder_both_v1: {
    label: "Task reminder · Both",
    language: "both",
    body: "{{1}}, कार्य अभी बाकी है / Work is still pending: {{2}}। अंतिम तिथि / Due: {{3}}। काम खोलने के लिए बटन दबाएँ / Use the button to open your work.",
    variables: TASK_VARIABLES,
    buttonUrl: TASK_BUTTON,
  },
};

/** Put the values in their places. A placeholder with no value is left as it is, so a gap shows. */
export function fillTemplate(body: string, values: readonly string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (whole, index: string) => values[Number(index) - 1] ?? whole);
}

/** The highest placeholder a body uses: the number of values a send must carry. */
export function placeholderCount(body: string): number {
  return Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])));
}
