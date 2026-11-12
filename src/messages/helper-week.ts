import { t, type Localized } from "@/platform/i18n/language";

/**
 * Settings → WhatsApp → Veer Patta AI (D-589, D-590): the helper's week and
 * the "teach it once" list. Rule 9 pairs in a module of their own: only this
 * page imports it, so none of it ships on a budgeted route.
 */

export const hw = {
  crumb: t("सेटिंग्स · स्कूल का WhatsApp", "Settings · School WhatsApp"),
  title: t("Veer Patta AI", "Veer Patta AI"),
  sub: t("अभिभावकों का WhatsApp सहायक: यह हफ़्ता, और जो जवाब स्कूल एक बार सिखाता है", "The parents' WhatsApp helper: this week, and the answers the school teaches once"),
  tabWeek: t("यह हफ़्ता", "This week"),
  tabTeach: (waiting: number) => t(waiting > 0 ? `एक बार सिखाएँ (${waiting})` : "एक बार सिखाएँ", waiting > 0 ? `Teach it once (${waiting})` : "Teach it once"),
  practiceNote: t(
    "अभ्यास: ये अभ्यास वाले परिवार (मालिक के नंबर) के संदेश हैं। असली परिवारों के लिए सत्र 2026-27 चुनें।",
    "Practice: these are the practice family's messages (the owner's number). Pick the 2026-27 year to see real families.",
  ),
  realNote: t(
    "असली परिवार: Veer Patta AI अभी सिर्फ़ अभ्यास वाले परिवार को जवाब देता है, इसलिए यहाँ तब तक कुछ नहीं आएगा जब तक यह अभिभावकों के लिए चालू न हो।",
    "Real families: Veer Patta AI answers only the practice family for now, so this stays empty until it is turned on for parents.",
  ),
  unreadable: t("अभी पढ़ा नहीं जा सका। थोड़ी देर बाद पेज फिर खोलें।", "Could not be read just now. Open the page again in a little while."),

  // The week
  thisWeek: t("यह हफ़्ता", "This week"),
  lastWeek: t("पिछला हफ़्ता", "Last week"),
  questions: t("सवाल जिनका जवाब गया", "Questions answered"),
  byItself: t("ख़ुद जवाब दिया", "Answered by itself"),
  byItselfSub: (percent: number | null) => t(percent === null ? "—" : `${percent}% सवाल`, percent === null ? "—" : `${percent}% of questions`),
  handedOff: t("स्टाफ़ को भेजे", "Passed to staff"),
  replyIn: t("जवाब में लगा समय", "Time to reply"),
  replyInSub: t("आधे जवाब इससे जल्दी", "Half the replies were faster"),
  seconds: (s: number) => t(`${s} सेकंड`, `${s} s`),
  noneYet: t("इस हफ़्ते अभी कोई संदेश नहीं।", "No messages this week yet."),
  noneYetHelp: t("जब अभिभावक स्कूल के नंबर पर लिखेंगे, यहाँ गिनती दिखेगी।", "When parents write to the school's number, the numbers appear here."),

  needsTitle: t("कहाँ आपकी ज़रूरत है", "Where it needs you"),
  needsNone: t("सब ठीक: इस हफ़्ते कुछ अटका नहीं।", "All good: nothing got stuck this week."),
  couldNot: (n: number) => t(`${n} सवाल जिनका जवाब Veer Patta AI नहीं दे सका`, `${n} question${n === 1 ? "" : "s"} Veer Patta AI could not answer`),
  couldNotHelp: t("जवाब एक बार लिख दें, फिर वह ख़ुद जवाब देगा।", "Write the answer once, and it answers by itself from then on."),
  teachButton: t("जवाब सिखाएँ", "Teach the answers"),
  waitingNow: (n: number) => t(`${n} अभिभावक स्टाफ़ के जवाब का इंतज़ार कर रहे हैं`, `${n} parent${n === 1 ? " is" : "s are"} waiting for staff to answer`),
  waitingOldest: (age: Localized) => t(`सबसे पुराना: ${age.hi}`, `Longest wait: ${age.en}`),
  openMessages: t("संदेश खोलें", "Open Messages"),
  notHelped: (n: number) => t(`${n} जवाब से अभिभावक की मदद नहीं हुई (👎)`, `${n} answer${n === 1 ? "" : "s"} did not help the parent (👎)`),
  fellBack: (n: number) => t(`${n} बार जवाब नहीं सूझा, मेन्यू भेजा`, `${n} time${n === 1 ? "" : "s"} it had no answer and sent the menu`),
  notSent: (n: number) => t(`${n} जवाब अभिभावक तक नहीं पहुँचे`, `${n} repl${n === 1 ? "y" : "ies"} did not reach the parent`),

  topicsTitle: t("अभिभावकों ने किस बारे में पूछा", "What parents asked about"),
  fromSchool: (n: number) => t(`${n} जवाब स्कूल के सिखाए जवाब से`, `${n} answer${n === 1 ? "" : "s"} came from the school's own answers`),

  peopleTitle: t("किसने जवाब दिया, कितनी जल्दी", "Who answered, and how fast"),
  peopleHelp: t("इस हफ़्ते भेजे गए संदेशों का पहला जवाब। समय: आधे जवाब इससे जल्दी।", "The first answer to each message passed on this week. Time: half the answers were faster."),
  peopleNone: t("इस हफ़्ते स्टाफ़ को कुछ नहीं भेजा गया, या अभी किसी ने जवाब नहीं दिया।", "Nothing was passed to staff this week, or nobody has answered yet."),
  answeredCount: (n: number) => t(`${n} जवाब`, `${n} answer${n === 1 ? "" : "s"}`),
  inTime: (age: Localized) => t(`${age.hi} में`, `in ${age.en}`),
  forTitle: t("किसके लिए भेजे गए", "Who they were for"),
  forRow: (count: number, answered: number) => t(`${count} भेजे, ${answered} का जवाब`, `${count} passed on, ${answered} answered`),
  otherStaff: t("दूसरे स्टाफ़", "Other staff"),
  officeAnyone: t("ऑफ़िस (कोई भी)", "Office (anyone)"),

  waitingTitle: t("अभी इंतज़ार में", "Still waiting"),
  waitingNone: t("कोई अभिभावक इंतज़ार में नहीं।", "No parent is waiting."),
  waitingRow: (n: number, age: Localized) => t(`${n} संदेश · सबसे पुराना ${age.hi}`, `${n} message${n === 1 ? "" : "s"} · longest ${age.en}`),

  ratingsTitle: t("क्या जवाब से मदद मिली?", "Did the answer help?"),
  ratingsHelp: t("स्टाफ़ का जवाब पहुँचने के बाद अभिभावक से पूछा जाता है।", "Parents are asked after a member of staff's answer reaches them."),
  ratingsNone: t("इस हफ़्ते अभी कोई जवाब नहीं।", "No answers this week yet."),
  helped: (n: number) => t(`👍 ${n} हाँ`, `👍 ${n} yes`),
  notHelpedShort: (n: number) => t(`👎 ${n} नहीं`, `👎 ${n} no`),

  costTitle: t("AI का ख़र्च", "AI cost"),
  costLine: (rupees: string) => t(`इस हफ़्ते ${rupees}`, `${rupees} this week`),

  // Teach it once
  teachIntro: t(
    "जब Veer Patta AI किसी सवाल का जवाब नहीं दे पाता, अभिभावक पहले की तरह ऑफ़िस तक पहुँचते हैं, और सवाल यहाँ आ जाता है। स्कूल का जवाब एक बार लिख दें: अगले संदेश से Veer Patta AI उसका जवाब ख़ुद देगा, अभिभावक की भाषा में।",
    "When Veer Patta AI cannot answer a question, the parent reaches the office as before, and the question comes here. Write the school's answer once: from the next message, Veer Patta AI answers it by itself, in the parent's language.",
  ),
  teachSafe: t(
    "सवाल Veer Patta AI के अपने शब्दों में हैं: किसी बच्चे या परिवार का नाम या नंबर नहीं।",
    "The questions are in Veer Patta AI's own words: no child's or family's name or number.",
  ),
  waitingTitleList: t("जवाब का इंतज़ार", "Waiting for an answer"),
  waitingListNone: t("कोई सवाल इंतज़ार में नहीं।", "No question is waiting."),
  waitingListNoneHelp: t("जिन सवालों का जवाब Veer Patta AI नहीं दे पाएगा, वे यहाँ आएँगे।", "Questions Veer Patta AI cannot answer will appear here."),
  asked: (n: number, ago: Localized) => t(`${n} बार पूछा · पिछली बार ${ago.hi}`, `Asked ${n} time${n === 1 ? "" : "s"} · last ${ago.en}`),
  questionLabel: t("सवाल (चाहें तो शब्द बदलें)", "The question (you can reword it)"),
  answerLabel: t("स्कूल का जवाब", "The school's answer"),
  answerPlaceholder: t("जवाब लिखें या बोलें… जैसे: 1 नवंबर से स्कूल सुबह 9 से दोपहर 3 बजे तक।", "Type or speak the answer… for example: From 1 November, school runs 9 am to 3 pm."),
  answerHint: t("छोटा और साफ़ जवाब, सब परिवारों के लिए। किसी बच्चे का नाम न लिखें।", "A short, clear answer for every family. Do not write a child's name."),
  /** {n} is filled in on the phone as the answer is typed. */
  chars: (max: number) => t(`{n} / ${max} अक्षर`, `{n} / ${max} letters`),
  save: t("जवाब सहेजें", "Save answer"),
  saving: t("सहेज रहे हैं…", "Saving…"),
  byPeopleButton: t("यह हमेशा कोई व्यक्ति बताएगा", "A person always answers this"),
  byPeopleInstead: t("अब से कोई व्यक्ति बताएगा", "A person answers this instead"),
  remove: t("सूची से हटाएँ", "Remove from the list"),
  removing: t("हटा रहे हैं…", "Removing…"),
  removeConfirm: t("यह सवाल सूची से हटाएँ? कोई फिर पूछे तो यह वापस आ जाएगा।", "Remove this question from the list? If a parent asks it again, it comes back."),

  answeredTitle: t("Veer Patta AI इनका जवाब ख़ुद देता है", "Veer Patta AI answers these itself"),
  answeredNone: t("अभी कोई जवाब नहीं सिखाया गया।", "No answer taught yet."),
  used: (n: number) => t(`${n} बार इस्तेमाल हुआ`, `Used ${n} time${n === 1 ? "" : "s"}`),
  taughtBy: (name: string | null, ago: Localized) => t(name ? `${name} ने सिखाया, ${ago.hi}` : `सिखाया ${ago.hi}`, name ? `Taught by ${name}, ${ago.en}` : `Taught ${ago.en}`),
  change: t("जवाब बदलें", "Change answer"),
  byPeopleTitle: t("ये हमेशा कोई व्यक्ति बताता है", "A person always answers these"),
  byPeopleHelp: t("Veer Patta AI इन्हें पहले की तरह स्टाफ़ को भेजता है और सूची में दोबारा नहीं डालता।", "Veer Patta AI passes these to staff as before and does not list them again."),
  teachInstead: t("जवाब सिखाएँ", "Teach an answer instead"),

  lookOnly: t("सिर्फ़ देखने के लिए: बदलाव सिर्फ़ एडमिन कर सकते हैं।", "Look only: only an admin can change this."),
};

/** By `WeekTopic` (modules/whatsapp/domain/helper-week.ts). */
export const topicLabels: Record<string, Localized> = {
  fees: t("फ़ीस", "Fees"),
  receipts: t("रसीदें", "Receipts"),
  attendance: t("हाज़िरी", "Attendance"),
  results: t("परिणाम", "Results"),
  teacher: t("क्लास टीचर", "Class teacher"),
  leave: t("बच्चा नहीं आएगा", "Child away"),
  calendar: t("छुट्टियाँ और समय", "Holidays and timings"),
  complaint: t("शिकायत", "Complaint"),
  request: t("अनुरोध", "Request"),
  admission: t("प्रवेश", "Admission"),
  office: t("ऑफ़िस के लिए", "For the office"),
  other: t("दूसरे सवाल", "Other questions"),
  hello: t("नमस्ते, मेन्यू, धन्यवाद", "Hello, menu, thanks"),
};

/** By hand-off target. */
export const targetLabels: Record<string, Localized> = {
  class_teacher: t("क्लास टीचर", "Class teacher"),
  accounts: t("अकाउंट्स", "Accounts"),
  office: t("ऑफ़िस", "Office"),
  principal: t("प्रिंसिपल", "Principal"),
};

/** "12 min", "3 h 5 min", "2 days 4 h" in both languages. */
export function durationText(parts: { days: number; hours: number; minutes: number }): Localized {
  if (parts.days > 0) {
    return t(`${parts.days} दिन${parts.hours > 0 ? ` ${parts.hours} घंटे` : ""}`, `${parts.days} day${parts.days === 1 ? "" : "s"}${parts.hours > 0 ? ` ${parts.hours} h` : ""}`);
  }
  if (parts.hours > 0) return t(`${parts.hours} घंटे${parts.minutes > 0 ? ` ${parts.minutes} मिनट` : ""}`, `${parts.hours} h${parts.minutes > 0 ? ` ${parts.minutes} min` : ""}`);
  return t(`${parts.minutes} मिनट`, `${parts.minutes} min`);
}

/** "just now", "5 min ago", "yesterday"… */
export function agoText(parts: { days: number; hours: number; minutes: number }): Localized {
  if (parts.days === 0 && parts.hours === 0 && parts.minutes < 2) return t("अभी", "just now");
  if (parts.days === 1) return t("कल", "yesterday");
  const span = durationText(parts.days > 1 ? { ...parts, hours: 0 } : parts);
  return t(`${span.hi} पहले`, `${span.en} ago`);
}

type Note = { tone: "ok" | "warn" | "bad" | "info"; text: Localized };

/** The line shown after a button on the teach list, from the `?note=` it came back with. */
export function teachNote(note: string, params: Record<string, string | undefined>): Note | null {
  switch (note) {
    case "teach_saved":
      return { tone: "ok", text: t("सहेज लिया। अगले संदेश से Veer Patta AI इसका जवाब ख़ुद देगा।", "Saved. From the next message, Veer Patta AI answers this by itself.") };
    case "teach_people":
      return { tone: "ok", text: t("ठीक है। Veer Patta AI इसे स्टाफ़ को भेजेगा और सूची में दोबारा नहीं डालेगा।", "Done. Veer Patta AI passes this to staff and will not list it again.") };
    case "teach_removed":
      return { tone: "ok", text: t("सूची से हटा दिया। कोई फिर पूछे तो यह वापस आएगा।", "Removed from the list. If a parent asks it again, it comes back.") };
    case "teach_invalid_question":
      return { tone: "warn", text: t("सवाल 6 से 160 अक्षरों का हो। कुछ नहीं बदला।", "The question should be 6 to 160 letters. Nothing was changed.") };
    case "teach_invalid_answer":
      return { tone: "warn", text: t("जवाब 2 से 600 अक्षरों का हो। कुछ नहीं बदला।", "The answer should be 2 to 600 letters. Nothing was changed.") };
    case "teach_gone":
      return { tone: "warn", text: t("यह सवाल बदल गया या हट गया। नीचे की सूची ताज़ा है।", "That question has changed or gone. The list below is up to date.") };
    case "teach_same_open":
      return { tone: "warn", text: t("यही सवाल सूची में पहले से इंतज़ार में है। उसका जवाब वहीं दें।", "The same question is already waiting on the list. Answer it there.") };
    case "teach_failed":
      return { tone: "bad", text: t("सहेजा नहीं जा सका। फिर से कोशिश करें।", "Could not save. Please try again.") };
    case "teach_locked":
      return params.why === "preview"
        ? { tone: "info", text: t("आप One को किसी और की तरह देख रहे हैं। बदलने के लिए अपने खाते पर लौटें। कुछ नहीं बदला।", "You are seeing One as someone else. Go back to your own view to change this. Nothing was changed.") }
        : { tone: "info", text: hw.lookOnly };
    default:
      return null;
  }
}
