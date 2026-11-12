import type { TemplateSubmission } from "@/platform/whatsapp/providers";

/**
 * Staff notices and teacher tasks as the school's WhatsApp hub takes them
 * (owner, 12 Nov 2026: "Yes submit them") — D-573.
 *
 * The staff templates were written for AiSensy, one name per message with
 * one English body, and most begin with the person's name (`{{1}}, …`) and
 * end with a link (`… {{6}}`). Meta refuses a body that starts or ends with a
 * blank, and a staff member who reads Hindi would get English words around
 * Hindi values. So the hub gets its own copy of each: one name per message
 * and language (`vpps_staff_<slug>_<hi|en>_v1`), a bold title and the
 * school's name first, one labelled line per value, and a closing line.
 *
 * The blanks keep the old order exactly, so every renderer
 * (`staff-notices/domain/notices.ts`, the teacher-task delivery) fills these
 * unchanged; only the name the message goes out under changes, at the last
 * step (`staffHubKey`). The app's own screens keep the old wording.
 *
 * Pure and server-side: it carries every body, like `hub-templates.ts`.
 */

export type StaffHubLanguage = "hi" | "en";

type Parts = {
  title: string;
  /** The line after "Dear {{1}}," — absent for a notice with no name. */
  intro?: string;
  lines: readonly string[];
  /** The last line before the thanks; a link blank sits here, never last. */
  action: string;
};

export type StaffHubEntry = {
  slug: string;
  feature: "staff_notice" | "teacher_task";
  /** The codes One renders this message under (`STAFF_TEMPLATES`, the teacher-task campaigns). */
  codes: readonly string[];
  /** What each blank holds, in order: the same order the renderer fills. */
  variables: readonly string[];
  /** Whether `{{1}}` is the reader's name, greeted on its own line. */
  greets: boolean;
  /** A teacher task's "Open task" button, whose link ends in the task's token. */
  taskButton: boolean;
  label: string;
  parts: Record<StaffHubLanguage, Parts>;
  samples: Record<StaffHubLanguage, readonly string[]>;
};

export const STAFF_SCHOOL_LINE: Record<StaffHubLanguage, string> = {
  en: "Shri Veer Patta Sr. Sec. School",
  hi: "श्री वीर पत्ता सी. सै. स्कूल",
};

const GREETING: Record<StaffHubLanguage, string> = { en: "Dear {{1}},", hi: "{{1}} जी," };
const THANKS: Record<StaffHubLanguage, string> = { en: "Thank you.", hi: "धन्यवाद।" };

/** Where a teacher task's button opens: the task's token is `{{1}}` (`claim_teacher_task_delivery`'s `buttonSuffix`). */
export const TASK_BUTTON_URL = "https://one.vpps.co.in/t/tasks/{{1}}";
export const TASK_BUTTON_LABEL: Record<StaffHubLanguage, string> = { en: "Open task", hi: "कार्य खोलें" };

const COVER_VARIABLES = ["name", "day", "period", "classes", "subject", "link"] as const;
const COVER_LINES: Record<StaffHubLanguage, readonly string[]> = {
  en: ["Day: {{2}}", "Period: {{3}}", "Class: {{4}}", "Subject: {{5}}"],
  hi: ["दिन: {{2}}", "कालांश: {{3}}", "कक्षा: {{4}}", "विषय: {{5}}"],
};
const COVER_SAMPLES: Record<StaffHubLanguage, readonly string[]> = {
  en: ["Anita Verma", "Mon 16 Nov", "P3 (10:20)", "7A", "Maths", "https://one.vpps.co.in/teach"],
  hi: ["अनीता वर्मा", "सोम 16 नवंबर", "P3 (10:20)", "7A", "गणित", "https://one.vpps.co.in/teach"],
};
const TASK_VARIABLES = ["teacher", "task", "due"] as const;
const TASK_LINES: Record<StaffHubLanguage, readonly string[]> = {
  en: ["Task: {{2}}", "Due: {{3}}"],
  hi: ["कार्य: {{2}}", "अंतिम तिथि: {{3}}"],
};
const TASK_SAMPLES: Record<StaffHubLanguage, readonly string[]> = {
  en: ["Anita Verma", "Enter the half-yearly marks of 7A", "20 Nov"],
  hi: ["अनीता वर्मा", "7A के अर्धवार्षिक अंक दर्ज करें", "20 नवंबर"],
};

export const STAFF_HUB_ENTRIES: readonly StaffHubEntry[] = [
  {
    slug: "cover_assigned",
    feature: "staff_notice",
    codes: ["vppsone_cover_assigned"],
    variables: COVER_VARIABLES,
    greets: true,
    taskButton: false,
    label: "Cover assigned",
    parts: {
      en: { title: "Cover duty for you", intro: "you have a period to cover.", lines: COVER_LINES.en, action: "Please open it and acknowledge: {{6}}" },
      hi: { title: "आपके लिए व्यवस्था", intro: "आपको एक कालांश की व्यवस्था मिली है।", lines: COVER_LINES.hi, action: "कृपया देखें और पुष्टि करें: {{6}}" },
    },
    samples: COVER_SAMPLES,
  },
  {
    slug: "cover_changed",
    feature: "staff_notice",
    codes: ["vppsone_cover_changed"],
    variables: COVER_VARIABLES,
    greets: true,
    taskButton: false,
    label: "Cover changed",
    parts: {
      en: { title: "Cover duty changed", intro: "your cover period has changed. It is now:", lines: COVER_LINES.en, action: "See the new details: {{6}}" },
      hi: { title: "व्यवस्था में बदलाव", intro: "आपकी कालांश व्यवस्था बदल गई है। अब यह है:", lines: COVER_LINES.hi, action: "नया विवरण देखें: {{6}}" },
    },
    samples: COVER_SAMPLES,
  },
  {
    slug: "cover_cancelled",
    feature: "staff_notice",
    codes: ["vppsone_cover_cancelled"],
    variables: COVER_VARIABLES,
    greets: true,
    taskButton: false,
    label: "Cover cancelled",
    parts: {
      en: { title: "Cover duty cancelled", intro: "you no longer need to cover this period.", lines: COVER_LINES.en, action: "Details: {{6}}" },
      hi: { title: "व्यवस्था रद्द", intro: "यह कालांश अब आपको नहीं लेना है।", lines: COVER_LINES.hi, action: "विवरण: {{6}}" },
    },
    samples: COVER_SAMPLES,
  },
  {
    slug: "cover_needed",
    feature: "staff_notice",
    codes: ["vppsone_cover_escalation"],
    variables: COVER_VARIABLES,
    greets: true,
    taskButton: false,
    label: "Cover refused",
    parts: {
      en: { title: "Cover needed", intro: "the teacher given this period cannot take it, so it needs someone.", lines: COVER_LINES.en, action: "Please review: {{6}}" },
      hi: { title: "व्यवस्था चाहिए", intro: "जिन्हें यह कालांश दिया गया था, वे इसे नहीं ले सकते। किसी और की ज़रूरत है।", lines: COVER_LINES.hi, action: "कृपया देखें: {{6}}" },
    },
    samples: COVER_SAMPLES,
  },
  {
    slug: "register_not_saved",
    feature: "staff_notice",
    codes: ["vppsone_staff_attendance_reminder"],
    variables: ["name", "day", "class", "link"],
    greets: true,
    taskButton: false,
    label: "Register not saved",
    parts: {
      en: { title: "Attendance not saved", intro: "the attendance register has not been saved yet.", lines: ["Day: {{2}}", "Class: {{3}}"], action: "Please take it here: {{4}}" },
      hi: { title: "हाज़िरी दर्ज नहीं हुई", intro: "हाज़िरी अभी दर्ज नहीं हुई है।", lines: ["दिन: {{2}}", "कक्षा: {{3}}"], action: "कृपया यहाँ लें: {{4}}" },
    },
    samples: {
      en: ["Anita Verma", "today", "7A", "https://one.vpps.co.in/teach"],
      hi: ["अनीता वर्मा", "आज", "7A", "https://one.vpps.co.in/teach"],
    },
  },
  {
    slug: "marks_pending",
    feature: "staff_notice",
    codes: ["vppsone_marks_reminder"],
    variables: ["Teacher name", "Which papers"],
    greets: true,
    taskButton: false,
    label: "Marks reminder",
    parts: {
      en: { title: "Marks pending", intro: "marks are still to be entered for these papers.", lines: ["Papers: {{2}}"], action: "Please enter them in VPPS One." },
      hi: { title: "अंक बाकी", intro: "इन पेपरों के अंक अभी दर्ज होने बाकी हैं।", lines: ["पेपर: {{2}}"], action: "कृपया VPPS One में अंक दर्ज करें।" },
    },
    samples: {
      en: ["Anita Verma", "7A Maths, 8B Science"],
      hi: ["अनीता वर्मा", "7A गणित, 8B विज्ञान"],
    },
  },
  {
    slug: "weekly_summary",
    feature: "staff_notice",
    codes: ["vppsone_weekly_summary"],
    variables: ["name", "summary", "from"],
    greets: true,
    taskButton: false,
    label: "Weekly academic summary",
    parts: {
      en: { title: "Weekly academic summary", intro: "here is this week's academic summary.", lines: ["Summary: {{2}}", "From: {{3}}"], action: "Please open VPPS One for details." },
      hi: { title: "साप्ताहिक शैक्षणिक सारांश", intro: "इस सप्ताह का शैक्षणिक सारांश यह है।", lines: ["सारांश: {{2}}", "भेजने वाले: {{3}}"], action: "पूरी जानकारी के लिए VPPS One खोलें।" },
    },
    samples: {
      en: ["Anita Verma", "Attendance 94%, 3 tests marked, 2 papers pending", "Academic office"],
      hi: ["अनीता वर्मा", "हाज़िरी 94%, 3 टेस्ट जाँचे, 2 पेपर बाकी", "शैक्षणिक कार्यालय"],
    },
  },
  {
    slug: "notice",
    feature: "staff_notice",
    codes: ["vx_staff_notice"],
    variables: ["text"],
    greets: false,
    taskButton: false,
    label: "Staff notice",
    parts: {
      en: { title: "Staff notice", lines: ["{{1}}"], action: "Please open VPPS One for details." },
      hi: { title: "स्टाफ़ सूचना", lines: ["{{1}}"], action: "पूरी जानकारी के लिए VPPS One खोलें।" },
    },
    samples: {
      en: ["Staff meeting in the library at 2:30 PM today."],
      hi: ["आज दोपहर 2:30 बजे पुस्तकालय में स्टाफ़ बैठक है।"],
    },
  },
  {
    slug: "online_payment_check",
    feature: "staff_notice",
    codes: ["vx_staff_online_review_v1"],
    variables: ["name", "amount", "student or class", "link"],
    greets: true,
    taskButton: false,
    label: "Online payment needs review",
    parts: {
      en: { title: "Online payment to check", intro: "an online fee payment could not be posted automatically.", lines: ["Amount: {{2}}", "For: {{3}}"], action: "Please check it and post it here: {{4}}" },
      hi: { title: "ऑनलाइन भुगतान जाँचें", intro: "एक ऑनलाइन फ़ीस भुगतान अपने-आप दर्ज नहीं हो सका।", lines: ["राशि: {{2}}", "किसका: {{3}}"], action: "कृपया जाँच कर यहाँ दर्ज करें: {{4}}" },
    },
    samples: {
      en: ["Anita Verma", "₹5,000", "a student of 7A", "https://one.vpps.co.in/fees/payments/online"],
      hi: ["अनीता वर्मा", "₹5,000", "7A का एक विद्यार्थी", "https://one.vpps.co.in/fees/payments/online"],
    },
  },
  {
    slug: "online_payment",
    feature: "staff_notice",
    codes: ["vx_staff_online_payment_v1"],
    variables: ["name", "amount", "student or class", "receipt", "link"],
    greets: true,
    taskButton: false,
    label: "Online payment received",
    parts: {
      en: { title: "Online payment received", intro: "a fee payment was received online and its receipt has been posted.", lines: ["Amount: {{2}}", "For: {{3}}", "Receipt: {{4}}"], action: "Details: {{5}}" },
      hi: { title: "ऑनलाइन भुगतान मिला", intro: "एक फ़ीस भुगतान ऑनलाइन मिला है और उसकी रसीद बन गई है।", lines: ["राशि: {{2}}", "किसका: {{3}}", "रसीद: {{4}}"], action: "विवरण: {{5}}" },
    },
    samples: {
      en: ["Anita Verma", "₹5,000", "a student of 7A", "SVP20261116-0001", "https://one.vpps.co.in/fees/payments/online"],
      hi: ["अनीता वर्मा", "₹5,000", "7A का एक विद्यार्थी", "SVP20261116-0001", "https://one.vpps.co.in/fees/payments/online"],
    },
  },
  {
    slug: "day_collection",
    feature: "staff_notice",
    codes: ["vx_staff_day_collection_v1"],
    variables: ["name", "day", "total", "receipts", "by mode", "link"],
    greets: true,
    taskButton: false,
    label: "Day's collection",
    parts: {
      en: { title: "Day's fee collection", intro: "here is the fee collection for the day.", lines: ["Day: {{2}}", "Total: {{3}}", "Receipts: {{4}}", "By mode: {{5}}"], action: "Details: {{6}}" },
      hi: { title: "दिन का फ़ीस संग्रह", intro: "दिन का फ़ीस संग्रह यह है।", lines: ["दिन: {{2}}", "कुल: {{3}}", "रसीदें: {{4}}", "तरीका: {{5}}"], action: "विवरण: {{6}}" },
    },
    samples: {
      en: ["Anita Verma", "Mon 16 Nov", "₹48,500", "12", "Cash ₹30,000, UPI ₹18,500", "https://one.vpps.co.in/receipts"],
      hi: ["अनीता वर्मा", "सोम 16 नवंबर", "₹48,500", "12", "नकद ₹30,000, UPI ₹18,500", "https://one.vpps.co.in/receipts"],
    },
  },
  {
    slug: "day_not_closed",
    feature: "staff_notice",
    codes: ["vx_staff_day_not_closed_v1"],
    variables: ["name", "day", "receipts", "total", "link"],
    greets: true,
    taskButton: false,
    label: "Day not closed",
    parts: {
      en: { title: "Day not closed", intro: "the day has not been closed yet.", lines: ["Day: {{2}}", "Receipts: {{3}}", "Total: {{4}}"], action: "Please count the cash and close the day here: {{5}}" },
      hi: { title: "दिन बंद नहीं हुआ", intro: "दिन अभी बंद नहीं हुआ है।", lines: ["दिन: {{2}}", "रसीदें: {{3}}", "कुल: {{4}}"], action: "कृपया नकद गिनकर यहाँ दिन बंद करें: {{5}}" },
    },
    samples: {
      en: ["Anita Verma", "Mon 16 Nov", "12", "₹48,500", "https://one.vpps.co.in/receipts"],
      hi: ["अनीता वर्मा", "सोम 16 नवंबर", "12", "₹48,500", "https://one.vpps.co.in/receipts"],
    },
  },
  {
    slug: "money_request",
    feature: "staff_notice",
    codes: ["vx_staff_money_request_v1"],
    variables: ["name", "what", "amount", "student or class", "asked by", "link"],
    greets: true,
    taskButton: false,
    label: "Reversal or write-off requested",
    parts: {
      en: { title: "Decision needed", intro: "a request is waiting for your decision.", lines: ["Request: {{2}}", "Amount: {{3}}", "For: {{4}}", "Asked by: {{5}}"], action: "Please decide here: {{6}}" },
      hi: { title: "निर्णय चाहिए", intro: "एक अनुरोध आपके निर्णय की प्रतीक्षा में है।", lines: ["अनुरोध: {{2}}", "राशि: {{3}}", "किसका: {{4}}", "किसने माँगा: {{5}}"], action: "कृपया यहाँ निर्णय करें: {{6}}" },
    },
    samples: {
      en: ["Anita Verma", "receipt reversal", "₹2,000", "a student of 7A", "Office desk", "https://one.vpps.co.in/inbox"],
      hi: ["अनीता वर्मा", "रसीद रद्द", "₹2,000", "7A का एक विद्यार्थी", "कार्यालय", "https://one.vpps.co.in/inbox"],
    },
  },
  {
    slug: "money_decision",
    feature: "staff_notice",
    codes: ["vx_staff_money_decision_v1"],
    variables: ["name", "what", "decision", "amount", "student or class", "link"],
    greets: true,
    taskButton: false,
    label: "Reversal or write-off decided",
    parts: {
      en: { title: "Request decided", intro: "your request has been decided.", lines: ["Request: {{2}}", "Decision: {{3}}", "Amount: {{4}}", "For: {{5}}"], action: "Details: {{6}}" },
      hi: { title: "अनुरोध पर निर्णय", intro: "आपके अनुरोध पर निर्णय हो गया है।", lines: ["अनुरोध: {{2}}", "निर्णय: {{3}}", "राशि: {{4}}", "किसका: {{5}}"], action: "विवरण: {{6}}" },
    },
    samples: {
      en: ["Anita Verma", "receipt reversal", "approved", "₹2,000", "a student of 7A", "https://one.vpps.co.in/inbox"],
      hi: ["अनीता वर्मा", "रसीद रद्द", "मंज़ूर", "₹2,000", "7A का एक विद्यार्थी", "https://one.vpps.co.in/inbox"],
    },
  },
  {
    slug: "leave_request",
    feature: "staff_notice",
    codes: ["vx_staff_leave_requested_v1"],
    variables: ["name", "teacher", "dates", "link"],
    greets: true,
    taskButton: false,
    label: "Leave requested",
    parts: {
      en: { title: "Leave request", intro: "a teacher has asked for leave.", lines: ["Teacher: {{2}}", "Dates: {{3}}"], action: "Please review: {{4}}" },
      hi: { title: "छुट्टी का अनुरोध", intro: "एक अध्यापक ने छुट्टी माँगी है।", lines: ["अध्यापक: {{2}}", "तिथि: {{3}}"], action: "कृपया देखें: {{4}}" },
    },
    samples: {
      en: ["Anita Verma", "Ravi Kumar", "Mon 16 Nov to Tue 17 Nov", "https://one.vpps.co.in/timetable"],
      hi: ["अनीता वर्मा", "रवि कुमार", "सोम 16 नवंबर से मंगल 17 नवंबर", "https://one.vpps.co.in/timetable"],
    },
  },
  {
    slug: "leave_decided",
    feature: "staff_notice",
    codes: ["vx_staff_leave_decided_v1"],
    variables: ["name", "dates", "decision", "link"],
    greets: true,
    taskButton: false,
    label: "Leave decided",
    parts: {
      en: { title: "Leave decided", intro: "your leave request has been decided.", lines: ["Dates: {{2}}", "Decision: {{3}}"], action: "Details: {{4}}" },
      hi: { title: "छुट्टी पर निर्णय", intro: "आपकी छुट्टी के अनुरोध पर निर्णय हो गया है।", lines: ["तिथि: {{2}}", "निर्णय: {{3}}"], action: "विवरण: {{4}}" },
    },
    samples: {
      en: ["Anita Verma", "Mon 16 Nov", "approved", "https://one.vpps.co.in/teach"],
      hi: ["अनीता वर्मा", "सोम 16 नवंबर", "मंज़ूर", "https://one.vpps.co.in/teach"],
    },
  },
  {
    slug: "system_check",
    feature: "staff_notice",
    codes: ["vx_staff_ops_alert_v1"],
    variables: ["name", "day", "count", "what", "link"],
    greets: true,
    taskButton: false,
    label: "System check",
    parts: {
      en: { title: "System check", intro: "the daily system check found things to look at.", lines: ["Day: {{2}}", "How many: {{3}}", "What: {{4}}"], action: "Details: {{5}}" },
      hi: { title: "सिस्टम जाँच", intro: "रोज़ की सिस्टम जाँच में कुछ बातें देखनी हैं।", lines: ["दिन: {{2}}", "कितनी: {{3}}", "क्या: {{4}}"], action: "विवरण: {{5}}" },
    },
    samples: {
      en: ["Anita Verma", "Mon 16 Nov", "2", "a backup did not finish", "https://one.vpps.co.in/jobs"],
      hi: ["अनीता वर्मा", "सोम 16 नवंबर", "2", "एक बैकअप पूरा नहीं हुआ", "https://one.vpps.co.in/jobs"],
    },
  },
  {
    slug: "digest",
    feature: "staff_notice",
    codes: ["vx_staff_digest_v1"],
    variables: ["name", "count", "what", "link"],
    greets: true,
    taskButton: false,
    label: "Several messages at once",
    parts: {
      en: { title: "New messages for you", intro: "you have new messages in VPPS One.", lines: ["How many: {{2}}", "About: {{3}}"], action: "See them all here: {{4}}" },
      hi: { title: "आपके लिए नए संदेश", intro: "VPPS One में आपके लिए नए संदेश हैं।", lines: ["कितने: {{2}}", "विषय: {{3}}"], action: "सब यहाँ देखें: {{4}}" },
    },
    samples: {
      en: ["Anita Verma", "3", "Cover assigned", "https://one.vpps.co.in/inbox"],
      hi: ["अनीता वर्मा", "3", "व्यवस्था मिली", "https://one.vpps.co.in/inbox"],
    },
  },
  {
    slug: "task",
    feature: "teacher_task",
    codes: ["vppsone_teacher_task_en_v1", "vppsone_teacher_task_hi_v1", "vppsone_teacher_task_both_v1"],
    variables: TASK_VARIABLES,
    greets: true,
    taskButton: true,
    label: "Teacher task",
    parts: {
      en: { title: "New task", intro: "you have a new task.", lines: TASK_LINES.en, action: "Please tap Open task to see your work." },
      hi: { title: "नया कार्य", intro: "आपके लिए एक नया कार्य है।", lines: TASK_LINES.hi, action: "अपना काम देखने के लिए \"कार्य खोलें\" दबाएँ।" },
    },
    samples: TASK_SAMPLES,
  },
  {
    slug: "task_reminder",
    feature: "teacher_task",
    codes: ["vppsone_teacher_task_reminder_en_v1", "vppsone_teacher_task_reminder_hi_v1", "vppsone_teacher_task_reminder_both_v1"],
    variables: TASK_VARIABLES,
    greets: true,
    taskButton: true,
    label: "Task reminder",
    parts: {
      en: { title: "Task reminder", intro: "this work is still pending.", lines: TASK_LINES.en, action: "Please tap Open task to finish it." },
      hi: { title: "कार्य की याद", intro: "यह कार्य अभी बाकी है।", lines: TASK_LINES.hi, action: "काम पूरा करने के लिए \"कार्य खोलें\" दबाएँ।" },
    },
    samples: TASK_SAMPLES,
  },
];

export const STAFF_HUB_LANGUAGES: readonly StaffHubLanguage[] = ["hi", "en"];

export function staffHubName(slug: string, language: StaffHubLanguage): string {
  return `vpps_staff_${slug}_${language}_v1`;
}

/** The exact body submitted to Meta, and the one the hourly check holds an approval to. */
export function staffHubBody(entry: StaffHubEntry, language: StaffHubLanguage): string {
  const parts = entry.parts[language];
  const opening = entry.greets ? [GREETING[language], ...(parts.intro ? [parts.intro] : []), ""] : [];
  return [`*${parts.title}*`, STAFF_SCHOOL_LINE[language], "", ...opening, ...parts.lines, "", parts.action, THANKS[language]].join("\n");
}

export function staffHubSubmission(entry: StaffHubEntry, language: StaffHubLanguage): TemplateSubmission {
  return {
    name: staffHubName(entry.slug, language),
    language,
    category: "UTILITY",
    body: staffHubBody(entry, language),
    examples: [...entry.samples[language]],
    buttons: entry.taskButton ? [{ type: "URL" as const, text: TASK_BUTTON_LABEL[language], url: TASK_BUTTON_URL }] : [],
  };
}

/** Every staff and teacher-task template the hub gets: 20 messages, Hindi and English. */
export const STAFF_HUB_SUBMISSIONS: readonly TemplateSubmission[] = STAFF_HUB_ENTRIES.flatMap((entry) =>
  STAFF_HUB_LANGUAGES.map((language) => staffHubSubmission(entry, language)),
);

const ENTRY_BY_CODE: ReadonlyMap<string, StaffHubEntry> = new Map(STAFF_HUB_ENTRIES.flatMap((entry) => entry.codes.map((code) => [code, entry] as const)));

const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * The hub name a staff message goes out under, or null for a code that has
 * none (it then goes under its own name, which the hub never approved, and
 * is refused as "not approved").
 *
 * A teacher-task code carries its language (`_both_` is Hindi first, as the
 * renderers read it). A staff notice follows the reader: `en` reads English,
 * `hi` and `both` read Hindi (the renderers fill `both` with the Hindi
 * values). With no reader's language — a free-text notice from the Messages
 * screen — the words decide: any Devanagari is Hindi.
 */
export function staffHubKey(code: string, language: string | null | undefined, values: readonly string[] = []): string | null {
  const entry = ENTRY_BY_CODE.get(code);
  if (!entry) return null;
  let chosen: StaffHubLanguage;
  if (entry.feature === "teacher_task") chosen = /_en_v\d+$/.test(code) ? "en" : "hi";
  else if (language === "en") chosen = "en";
  else if (language === "hi" || language === "both") chosen = "hi";
  else chosen = values.some((value) => DEVANAGARI.test(value)) ? "hi" : "en";
  return staffHubName(entry.slug, chosen);
}
