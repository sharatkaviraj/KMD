import { periodNumber } from "@/modules/timetable/domain/periods";
import { p, type Pair } from "@/vx/text";

/**
 * Words on the guided cover flow (review C01). Pure pairs, English first, as
 * every vx screen's are (UI-6); a pair with a number in it is a function.
 */

const pn = (period: number) => `P${periodNumber(period)}`;
const list = (periods: readonly number[]) => periods.map(pn).join(", ");

export const G = {
  title: p("Arrange cover", "व्यवस्था करें"),
  crumb: p("Timetable · cover", "समय सारणी · व्यवस्था"),
  steps: [p("Who is away", "कौन अनुपस्थित"), p("Lessons & cover", "पीरियड और व्यवस्था"), p("Review", "जाँचें"), p("Done", "पूरा")] as const,
  stepOf: (n: number, total: number): Pair => p(`Step ${n} of ${total}`, `चरण ${n} / ${total}`),
  whichPage: p(
    "Use Arrange cover to mark a teacher away and choose substitutes step by step. Use the Cover tab or the classic Cover page to see the whole day and change one duty.",
    "शिक्षक को अनुपस्थित दर्ज करने और कदम-दर-कदम व्यवस्था चुनने के लिए \"व्यवस्था करें\" खोलें। पूरे दिन की व्यवस्था देखने या एक ड्यूटी बदलने के लिए व्यवस्था टैब या पुराना व्यवस्था पेज खोलें।",
  ),
  openCoverTab: p("Open the Cover tab", "व्यवस्था टैब खोलें"),
  openClassic: p("Classic Cover page", "पुराना व्यवस्था पेज"),

  /* --------------------------------------------------------- step 1 */
  day: p("Day", "दिन"),
  today: p("Today", "आज"),
  tomorrow: p("Tomorrow", "कल"),
  anotherDay: p("Another day", "दूसरा दिन"),
  teacher: p("Teacher who is away", "अनुपस्थित शिक्षक"),
  pickTeacher: p("Choose a teacher…", "शिक्षक चुनें…"),
  alreadyAwayTag: (periods: readonly number[]): Pair => p(`away ${list(periods)}`, `${list(periods)} अनुपस्थित`),
  onLeaveTag: p("on leave", "छुट्टी पर"),
  alreadyAway: (periods: readonly number[]): Pair =>
    p(
      `Already marked away ${list(periods)}. Those periods are picked below; confirming keeps exactly what you pick.`,
      `पहले से ${list(periods)} में अनुपस्थित दर्ज। वही पीरियड नीचे चुने हैं; पक्का करने पर जो चुना है वही रहेगा।`,
    ),
  howLong: p("Away for", "कब तक अनुपस्थित"),
  wholeDay: p("Whole day", "पूरा दिन"),
  somePeriods: p("Some periods", "कुछ पीरियड"),
  firstHalf: p("First half", "पहली पाली"),
  secondHalf: p("Second half", "दूसरी पाली"),
  whichPeriods: p("Which periods", "कौन से पीरियड"),
  free: p("Free", "खाली"),
  periodLabel: (period: number): Pair => p(`Period ${periodNumber(period)}`, `पीरियड ${periodNumber(period)}`),
  needTeacher: p("Choose the teacher who is away.", "अनुपस्थित शिक्षक चुनें।"),
  needPeriods: p("Pick at least one period.", "कम से कम एक पीरियड चुनें।"),
  showLessons: p("Show their lessons", "उनके पीरियड देखें"),
  noTimetable: p("No published timetable — import and publish the timetable first.", "कोई प्रकाशित समय सारणी नहीं — पहले समय सारणी आयात करके प्रकाशित करें।"),
  noTimetableDay: p("The timetable has no lessons on this day, so there is nothing to arrange.", "इस दिन समय सारणी में कोई पीरियड नहीं, इसलिए व्यवस्था नहीं।"),
  noSession: p("No academic session is open.", "कोई सत्र खुला नहीं है।"),
  noTeachers: p("No teaching staff found for this day.", "इस दिन के लिए कोई शिक्षक नहीं मिला।"),

  /* --------------------------------------------------------- step 2 */
  spanWhole: p("all day", "पूरे दिन"),
  spanPeriods: (periods: readonly number[]): Pair => p(`in ${list(periods)}`, `${list(periods)} में`),
  summary: (name: string, span: Pair, day: string): Pair =>
    p(`${name} · away ${span.en} · ${day}`, `${name} · ${span.hi ?? span.en} अनुपस्थित · ${day}`),
  change: p("Change", "बदलें"),
  begun: (periods: readonly number[]): Pair =>
    p(
      `${list(periods)} had already begun, so cover is not arranged for ${periods.length === 1 ? "it" : "them"} here. Check that the class had someone.`,
      `${list(periods)} पहले ही शुरू हो चुका, इसलिए यहाँ व्यवस्था नहीं होगी। देख लें कि कक्षा में कोई था।`,
    ),
  refused: (name: string, period: number | null, why: Pair): Pair =>
    p(
      `${name} cannot take ${period === null ? "that lesson" : pn(period)} now (${why.en}). The best available teacher is proposed instead.`,
      `${name} अब ${period === null ? "वह पीरियड" : pn(period)} नहीं ले सकते (${why.hi ?? why.en})। उसकी जगह सबसे उपयुक्त शिक्षक सुझाए गए हैं।`,
    ),
  noLessons: p("No lessons to cover in the chosen periods", "चुने हुए पीरियड में कोई पाठ नहीं"),
  noLessonsBody: p("The absence is still recorded when you confirm.", "पक्का करने पर अनुपस्थिति फिर भी दर्ज होगी।"),
  proposed: (name: string): Pair => p(`Proposed: ${name}`, `सुझाव: ${name}`),
  yourChoice: (name: string): Pair => p(`Your choice: ${name}`, `आपकी पसंद: ${name}`),
  nobodyChosen: p("Your choice: nobody yet — a person decides later", "आपकी पसंद: अभी कोई नहीं — बाद में तय होगा"),
  needsPerson: p("Needs a person", "किसी को तय करना है"),
  teamLesson: p("A team lesson: choose who supervises — the app never picks for a team by itself.", "टीम का पीरियड: कौन देखेगा, आप चुनें — टीम के लिए ऐप अपने-आप नहीं चुनता।"),
  whoCovers: (period: number): Pair => p(`Who covers ${pn(period)}`, `${pn(period)} कौन लेगा`),
  bestMatch: p("Best match", "सबसे उपयुक्त"),
  proposedTag: p("Proposed", "सुझाया गया"),
  load: (today: number, week: number): Pair =>
    p(
      `${today} ${today === 1 ? "cover" : "covers"} today · ${week} this week`,
      `आज ${today} व्यवस्था · इस सप्ताह ${week}`,
    ),
  nobodyYet: p("Nobody yet — a person decides later", "अभी कोई नहीं — बाद में तय होगा"),
  nobodyYetSub: p("The lesson is saved as needing a person.", "पीरियड \"किसी को तय करना है\" के रूप में सहेजा जाएगा।"),
  showAll: (n: number): Pair => p(`Show all ${n} free teachers`, `सभी ${n} खाली शिक्षक दिखाएँ`),
  showFewer: p("Show fewer", "कम दिखाएँ"),
  noneFree: (period: number): Pair => p(`Nobody is free in ${pn(period)}.`, `${pn(period)} में कोई खाली नहीं।`),
  notAvailable: (n: number): Pair => p(`Not available then · ${n}`, `उस समय उपलब्ध नहीं · ${n}`),
  conflicts: {
    away: p("Away then", "उस समय अनुपस्थित"),
    on_leave: p("On approved leave", "स्वीकृत छुट्टी पर"),
    teaching: p("Teaching their own class then", "उस समय अपनी कक्षा में"),
    covering: p("Already covering another class then", "उस समय दूसरी कक्षा की व्यवस्था में"),
    unavailable: p("Not available then", "उस समय उपलब्ध नहीं"),
  } as Record<"away" | "on_leave" | "teaching" | "covering" | "unavailable", Pair>,
  updating: p("Updating the plan…", "व्यवस्था अपडेट हो रही है…"),
  toReview: p("Review", "जाँचें"),
  back: p("Back", "वापस"),
  loadFailed: p("Could not work out the plan just now. Nothing was saved.", "अभी व्यवस्था तैयार नहीं हो सकी। कुछ सहेजा नहीं गया।"),
  tryAgain: p("Try again", "फिर आज़माएँ"),

  /* --------------------------------------------------------- step 3 */
  reviewTitle: p("Check before saving", "सहेजने से पहले जाँचें"),
  reviewLead: p("Nothing is saved until you press Confirm.", "पक्का करें दबाने तक कुछ सहेजा नहीं जाता।"),
  absenceLine: (name: string, span: Pair, day: string): Pair =>
    p(`${name} is away ${span.en} on ${day}.`, `${name} ${day} को ${span.hi ?? span.en} अनुपस्थित हैं।`),
  tally: (assigned: number, total: number, waiting: number): Pair =>
    p(
      `${assigned} of ${total} ${total === 1 ? "lesson gets" : "lessons get"} a teacher${waiting ? ` · ${waiting} ${waiting === 1 ? "waits" : "wait"} for a person` : ""}`,
      `${total} में से ${assigned} पीरियड को शिक्षक मिलेगा${waiting ? ` · ${waiting} के लिए किसी को तय करना है` : ""}`,
    ),
  byYou: p("your choice", "आपकी पसंद"),
  alsoChanges: p("Also changes on this day", "इस दिन और भी बदलेगा"),
  other: {
    moved: (from: string, to: string): Pair => p(`${from} → ${to}`, `${from} → ${to}`),
    released: (from: string | null): Pair => p(`${from ?? "—"} → nobody yet`, `${from ?? "—"} → अभी कोई नहीं`),
    assigned: (to: string): Pair => p(`now ${to}`, `अब ${to}`),
    cancelled: p("no longer needed", "अब ज़रूरत नहीं"),
  },
  whatsappTitle: p("WhatsApp messages", "WhatsApp संदेश"),
  whatsappLead: (n: number, people: number): Pair =>
    n === 0
      ? p("Nobody will be messaged: no teacher gets a new or changed cover.", "किसी को संदेश नहीं जाएगा: किसी शिक्षक की व्यवस्था नई या बदली नहीं है।")
      : p(
          `Confirming queues ${n} WhatsApp ${n === 1 ? "message" : "messages"} to ${people} ${people === 1 ? "teacher" : "teachers"} — one per lesson, about ₹0.88 each, sent from the staff outbox:`,
          `पक्का करने पर ${people} शिक्षकों को ${n} WhatsApp संदेश कतार में जाएँगे — हर पीरियड का एक, लगभग ₹0.88 प्रति संदेश, स्टाफ़ आउटबॉक्स से:`,
        ),
  noPhone: p("no WhatsApp number — assigned, but not messaged; tell them yourself", "WhatsApp नंबर नहीं — व्यवस्था होगी, संदेश नहीं जाएगा; स्वयं बताएँ"),
  updatedTag: p("correction", "सुधार"),
  withdrawnLead: p(
    "Covers taken from these teachers: they are messaged that it is cancelled only if they had already been told.",
    "इन शिक्षकों से व्यवस्था हटेगी: उन्हें रद्द होने का संदेश तभी जाएगा जब पहले बताया जा चुका हो।",
  ),
  confirm: p("Confirm and save", "पक्का करें और सहेजें"),
  saving: p("Saving…", "सहेजा जा रहा है…"),
  checking: p("No answer came back. Checking whether it saved…", "जवाब नहीं आया। जाँच रहे हैं कि सहेजा गया या नहीं…"),
  notSaved: p("Not saved. Try again sends the same request — it can never be saved twice.", "सहेजा नहीं गया। \"फिर आज़माएँ\" वही अनुरोध भेजता है — यह दो बार कभी नहीं सहेजा जाता।"),
  unknown: p("Could not confirm whether it saved. Trying again is safe — it can never be saved twice.", "पता नहीं चल सका कि सहेजा गया या नहीं। फिर आज़माना सुरक्षित है — यह दो बार कभी नहीं सहेजा जाता।"),
  checkAgain: p("Check again", "फिर जाँचें"),
  stale: p(
    "Somebody else changed cover for this day after you looked. Nothing was saved. The plan below is the latest — check it and confirm again.",
    "आपके देखने के बाद किसी और ने इस दिन की व्यवस्था बदली। कुछ सहेजा नहीं गया। नीचे नई व्यवस्था है — जाँचकर फिर पक्का करें।",
  ),
  planChanged: p(
    "The plan changed after you reviewed it (a period may have begun). Nothing was saved. The plan below is the latest — check it and confirm again.",
    "आपके जाँचने के बाद व्यवस्था बदल गई (कोई पीरियड शुरू हुआ हो सकता है)। कुछ सहेजा नहीं गया। नीचे नई व्यवस्था है — जाँचकर फिर पक्का करें।",
  ),
  reloading: p("Reading the latest plan…", "नई व्यवस्था पढ़ी जा रही है…"),
  refusedReason: {
    refused_override: p("A teacher you chose cannot take that lesson any more. The plan was read again — check it.", "आपके चुने एक शिक्षक अब वह पीरियड नहीं ले सकते। व्यवस्था फिर से पढ़ी गई — जाँचें।"),
    disabled: p("Arranging cover is switched off for now by an administrator. Nothing was saved.", "व्यवस्था अभी प्रशासक ने बंद की है। कुछ सहेजा नहीं गया।"),
    no_timetable: p("No published timetable. Nothing was saved.", "कोई प्रकाशित समय सारणी नहीं। कुछ सहेजा नहीं गया।"),
    no_timetable_day: p("The timetable has no lessons on this day. Nothing was saved.", "इस दिन समय सारणी में पीरियड नहीं। कुछ सहेजा नहीं गया।"),
    not_permitted: p("You do not have permission to change cover. Nothing was saved.", "आपको व्यवस्था बदलने की अनुमति नहीं। कुछ सहेजा नहीं गया।"),
    id_reused: p("This request was already used for a different change. Go back and review again.", "यह अनुरोध पहले किसी और बदलाव के लिए भेजा जा चुका है। वापस जाकर फिर जाँचें।"),
    bad_request: p("Something was missing. Go back and review again. Nothing was saved.", "कुछ अधूरा था। वापस जाकर फिर जाँचें। कुछ सहेजा नहीं गया।"),
    invalid: p("That plan no longer holds. The plan was read again — check it.", "वह व्यवस्था अब सही नहीं। व्यवस्था फिर से पढ़ी गई — जाँचें।"),
  } as Record<string, Pair>,
  previewing: p("You are previewing another role: nothing can be saved here.", "आप दूसरी भूमिका का पूर्वावलोकन कर रहे हैं: यहाँ कुछ सहेजा नहीं जा सकता।"),

  /* --------------------------------------------------------- step 4 */
  saved: p("Saved", "सहेजा गया"),
  alreadySaved: p("Already saved — this is the earlier result", "पहले ही सहेजा जा चुका — यह पहले का परिणाम है"),
  savedLessons: p("Saved cover", "सहेजी गई व्यवस्था"),
  noReadBack: p("Saved. The details could not be read back just now — open the Cover tab to see them.", "सहेजा गया। विवरण अभी पढ़ा नहीं जा सका — देखने के लिए व्यवस्था टैब खोलें।"),
  queued: (n: number, people: number): Pair =>
    n === 0
      ? p("No WhatsApp messages were queued.", "कोई WhatsApp संदेश कतार में नहीं गया।")
      : p(
          `${n} WhatsApp ${n === 1 ? "message" : "messages"} queued for ${people} ${people === 1 ? "teacher" : "teachers"}. Queued is not delivered yet — the Cover tab shows when each one is delivered.`,
          `${people} शिक्षकों के लिए ${n} WhatsApp संदेश कतार में। कतार का मतलब अभी पहुँचा नहीं — हर संदेश कब पहुँचा, व्यवस्था टैब में दिखेगा।`,
        ),
  noPhoneQueued: (n: number): Pair =>
    p(
      `${n} ${n === 1 ? "teacher has" : "teachers have"} no WhatsApp number: assigned, but not messaged — tell them yourself.`,
      `${n} शिक्षकों का WhatsApp नंबर नहीं: व्यवस्था हुई, संदेश नहीं जाएगा — स्वयं बताएँ।`,
    ),
  another: p("Arrange another absence", "दूसरी अनुपस्थिति दर्ज करें"),

  /* --------------------------------------------------------- drafts */
  draftMissing: p("That draft could not be opened. Arrange the cover below.", "वह मसौदा नहीं खुल सका। नीचे व्यवस्था करें।"),
  fromDraft: p("Opened from a draft. Nothing is saved until you confirm.", "मसौदे से खोला गया। पक्का करने तक कुछ सहेजा नहीं जाता।"),
};
