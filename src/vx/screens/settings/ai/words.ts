import type { AiProvider, JobResult } from "@/modules/assist/domain/overview";
import type { LaneId } from "@/modules/assist/domain/ai-map";
import type { IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";

/*
 * Words for Settings → AI helper (D-501). One page for every AI job in One:
 * written drafts, photos read and voice requests. Pairs per rule 9; this
 * file ships only with the Settings route.
 */

export type AiView = "used" | "how" | "cost" | "switches";
export const AI_VIEWS: readonly AiView[] = ["used", "how", "cost", "switches"];
export const isAiView = (value: unknown): value is AiView => typeof value === "string" && (AI_VIEWS as readonly string[]).includes(value);

export const VIEW_WORDS: Record<AiView, { label: Pair; icon: IconName }> = {
  used: { label: p("What AI did", "AI ने क्या किया"), icon: "chart" },
  how: { label: p("How it works", "कैसे चलता है"), icon: "layers" },
  cost: { label: p("Cost", "खर्च"), icon: "rupee" },
  switches: { label: p("Switches", "स्विच"), icon: "sliders" },
};

/** Who answers, as staff read it. */
export const PROVIDER_WORDS: Record<AiProvider, { name: string; short: string; about: Pair }> = {
  "nvidia-free": {
    name: "NVIDIA Free",
    short: "NVIDIA",
    about: p("A free AI from NVIDIA. Writes drafts that name nobody.", "NVIDIA का मुफ़्त AI। ऐसे मसौदे लिखता है जिनमें किसी का नाम नहीं।"),
  },
  "apinex-free": {
    name: "APInex Free",
    short: "APInex",
    about: p(
      "Free models through APInex, each picked for its kind of job. Writes notices and summaries first; the best ones are found by “Check free models”.",
      "APInex के ज़रिए मुफ़्त मॉडल, हर काम के लिए अलग चुना गया। सूचनाएँ और सारांश पहले यही लिखता है; सबसे अच्छे मॉडल “मुफ़्त मॉडल जाँचें” से तय होते हैं।",
    ),
  },
  "openrouter-free": {
    name: "OpenRouter Free",
    short: "OpenRouter",
    about: p("Free AI models through OpenRouter. Tried when NVIDIA and APInex are busy.", "OpenRouter के ज़रिए मुफ़्त AI। NVIDIA और APInex व्यस्त हों तो इसे आज़माया जाता है।"),
  },
  "gemini-free": {
    name: "Gemini Free",
    short: "Gemini Free",
    about: p("Google's free Gemini key. The last free try.", "Google की मुफ़्त Gemini कुंजी। आख़िरी मुफ़्त कोशिश।"),
  },
  anthropic: {
    name: "Claude",
    short: "Claude",
    about: p("Anthropic's Claude, paid per use. The main paid AI: it writes about children and reads photos.", "Anthropic का Claude, हर उपयोग का भुगतान। मुख्य पेड AI: बच्चों के बारे में लिखता है और फ़ोटो पढ़ता है।"),
  },
  openai: {
    name: "OpenAI",
    short: "OpenAI",
    about: p("OpenAI, paid per use. Listens to voice requests, and stands in when Claude is busy.", "OpenAI, हर उपयोग का भुगतान। आवाज़ सुनता है, और Claude व्यस्त हो तो उसकी जगह लिखता है।"),
  },
  "gemini-paid": {
    name: "Gemini Paid",
    short: "Gemini",
    about: p("Google's paid Gemini. The last safety net when the others cannot answer.", "Google का पेड Gemini। बाक़ी जवाब न दे पाएँ तो आख़िरी सहारा।"),
  },
};

export const UNKNOWN_PROVIDER = { name: "Older record", short: "—" };

export function providerName(provider: AiProvider | null): string {
  return provider ? PROVIDER_WORDS[provider].name : UNKNOWN_PROVIDER.name;
}

/** Each kind of job, by its task id. */
export const TASK_WORDS: Record<string, { label: Pair; icon: IconName }> = {
  "note.polish": { label: p("Tidy a note", "नोट साफ़ करना"), icon: "notePen" },
  "note.sort": { label: p("Sort a note", "नोट छाँटना"), icon: "notePen" },
  "text.translate": { label: p("Translate", "अनुवाद"), icon: "globe" },
  "message.write": { label: p("Write a notice", "सूचना लिखना"), icon: "megaphone" },
  "message.polish": { label: p("Polish a notice", "सूचना सुधारना"), icon: "megaphone" },
  "message.reply": { label: p("Reply to a parent", "अभिभावक को जवाब"), icon: "message" },
  "cover.plan": { label: p("Cover-period plan", "सब्स्टिट्यूट पीरियड योजना"), icon: "swap" },
  "columns.match": { label: p("Match sheet columns", "शीट के कॉलम मिलाना"), icon: "table" },
  "form.read": { label: p("Read an admission form", "दाख़िला फ़ॉर्म पढ़ना"), icon: "camera" },
  "remarks.class": { label: p("Report-card remarks", "रिपोर्ट कार्ड टिप्पणी"), icon: "award" },
  "results.summary": { label: p("Class results summary", "कक्षा परिणाम सारांश"), icon: "chart" },
  "ask.answer": { label: p("Ask & how-to", "पूछें व कैसे करें"), icon: "help" },
  "child.summary": { label: p("A child's notes in short", "बच्चे के नोट्स संक्षेप में"), icon: "user" },
  "class.digest": { label: p("A class's week of notes", "कक्षा के हफ़्ते के नोट्स"), icon: "users" },
  "call.script": { label: p("Call script", "कॉल में क्या कहें"), icon: "phone" },
  "template.draft": { label: p("Message template", "संदेश टेम्पलेट"), icon: "fileText" },
  "brief.today": { label: p("Weekly brief", "हफ़्ते का सार"), icon: "sun" },
  "marks-photo": { label: p("Marks from a photo", "फ़ोटो से अंक"), icon: "camera" },
  "substitution-photo": { label: p("Substitution from a photo", "फ़ोटो से सब्स्टिट्यूशन"), icon: "camera" },
  voice: { label: p("Voice request", "आवाज़ से अनुरोध"), icon: "mic" },
};

export function taskWords(task: string): { label: Pair; icon: IconName } {
  return TASK_WORDS[task] ?? { label: p(task), icon: "sparkle" };
}

export const RESULT_WORDS: Record<JobResult, { label: Pair; tone: "ok" | "info" | "mut" | "soft" | "bad" }> = {
  kept: { label: p("Kept as written", "जैसा लिखा, रखा"), tone: "ok" },
  edited: { label: p("Kept after changes", "बदलकर रखा"), tone: "info" },
  unused: { label: p("Not used", "उपयोग नहीं हुआ"), tone: "mut" },
  open: { label: p("Not decided", "तय नहीं"), tone: "soft" },
  failed: { label: p("No answer", "जवाब नहीं मिला"), tone: "bad" },
};

/** The four roads a job can take. */
export const LANE_WORDS: Record<LaneId, { title: Pair; rule: Pair; why: Pair; icon: IconName; tone: "ok" | "acc" | "info" | "warn" }> = {
  open: {
    title: p("Names nobody", "किसी का नाम नहीं"),
    rule: p("Free AI first, paid AI only if the free ones are busy", "पहले मुफ़्त AI, वे व्यस्त हों तभी पेड AI"),
    why: p(
      "Notices to everyone, how-to answers, column matching, cover activities, templates and class results carry no child's details, so the free AI may write them.",
      "सबको सूचना, कैसे करें के जवाब, कॉलम मिलान, सब्स्टिट्यूट गतिविधि, टेम्पलेट और कक्षा परिणाम में किसी बच्चे की जानकारी नहीं होती, इसलिए मुफ़्त AI इन्हें लिख सकता है।",
    ),
    icon: "globe",
    tone: "ok",
  },
  people: {
    title: p("About a child or a family", "बच्चे या परिवार के बारे में"),
    rule: p("Paid AI only. The free AI is locked out", "सिर्फ़ पेड AI। मुफ़्त AI बंद"),
    why: p(
      "Notes, replies to parents, call scripts, remarks and summaries are about real children. Free services may keep what they are sent, so these never go to them. Test accounts' made-up children are the only exception.",
      "नोट, अभिभावकों को जवाब, कॉल स्क्रिप्ट, टिप्पणी और सारांश असली बच्चों के बारे में होते हैं। मुफ़्त सेवाएँ भेजी गई बातें रख सकती हैं, इसलिए ये उन्हें कभी नहीं भेजे जाते। सिर्फ़ टेस्ट खातों के काल्पनिक बच्चे अपवाद हैं।",
    ),
    icon: "user",
    tone: "acc",
  },
  photo: {
    title: p("A photograph", "फ़ोटो"),
    rule: p("Paid AI only, never a free one", "सिर्फ़ पेड AI, मुफ़्त कभी नहीं"),
    why: p(
      "Admission forms, marks sheets and substitution registers are read from a photo. A photo can show anything, so it only ever goes to a paid AI.",
      "दाख़िला फ़ॉर्म, अंक तालिका और सब्स्टिट्यूशन रजिस्टर फ़ोटो से पढ़े जाते हैं। फ़ोटो में कुछ भी दिख सकता है, इसलिए वह सिर्फ़ पेड AI को जाती है।",
    ),
    icon: "camera",
    tone: "info",
  },
  voice: {
    title: p("A spoken request", "बोलकर किया अनुरोध"),
    rule: p("OpenAI listens, Claude understands", "OpenAI सुनता है, Claude समझता है"),
    why: p(
      "When someone speaks to One, OpenAI turns the voice into words and Claude works out what to do. If they are busy, Gemini Paid does both.",
      "कोई One से बोलता है तो OpenAI आवाज़ को शब्दों में बदलता है और Claude समझता है कि क्या करना है। वे व्यस्त हों तो Gemini Paid दोनों काम करता है।",
    ),
    icon: "mic",
    tone: "warn",
  },
};

export const LOCK_WORDS = {
  test: p("Test accounts only", "सिर्फ़ टेस्ट खाते"),
  never: p("Never used here", "यहाँ कभी नहीं"),
};

/** Why a key or a try failed, in plain words. */
export const PROBLEM_WORDS: Record<string, Pair> = {
  quota_daily: p("free daily limit used up", "मुफ़्त रोज़ की सीमा पूरी"),
  quota: p("too many requests, resting a minute", "बहुत अनुरोध, एक मिनट आराम"),
  rate_limit: p("too many requests, resting a minute", "बहुत अनुरोध, एक मिनट आराम"),
  billing: p("out of credit", "क्रेडिट ख़त्म"),
  credential: p("key refused", "कुंजी अस्वीकार"),
  permission: p("access refused", "अनुमति नहीं"),
  model: p("model not available", "मॉडल उपलब्ध नहीं"),
  timeout: p("too slow, moved on", "बहुत धीमा, आगे बढ़े"),
  schema: p("answer not usable", "जवाब काम का नहीं"),
  server: p("service error", "सेवा में गड़बड़ी"),
  network: p("network error", "नेटवर्क गड़बड़ी"),
  unavailable: p("not available", "उपलब्ध नहीं"),
  no_answer: p("gave no answer", "कोई जवाब नहीं"),
  not_hindi: p("Hindi not right", "हिंदी ठीक नहीं"),
  firewall: p("blocked by its firewall", "फ़ायरवॉल ने रोका"),
  not_free: p("not free on this account", "इस खाते पर मुफ़्त नहीं"),
  decision: p("not a writing model", "लिखने वाला मॉडल नहीं"),
  check_in: p("waiting for today's check-in", "आज का चेक-इन बाक़ी"),
  failed: p("failed", "विफल"),
  other: p("failed", "विफल"),
};

export function problemWords(problem: string | null | undefined): Pair {
  return (problem && PROBLEM_WORDS[problem]) || PROBLEM_WORDS.other;
}

export const W = {
  heroTitle: p("Every AI job in One, in one place", "One का हर AI काम, एक जगह"),
  heroSub: p(
    "AI writes first drafts, reads photos and listens to spoken requests. Staff always decide: nothing is saved or sent by AI.",
    "AI पहला मसौदा लिखता है, फ़ोटो पढ़ता है और बोले गए अनुरोध सुनता है। फ़ैसला हमेशा स्टाफ़ करता है: AI न कुछ सहेजता है, न भेजता है।",
  ),
  monthFrom: (from: Pair) => p(`Since ${from.en}`, `${from.hi ?? from.en} से`),
  jobs: p("AI jobs", "AI काम"),
  free: p("Done free", "मुफ़्त में"),
  cost: p("Cost", "खर्च"),
  kept: p("Kept by staff", "स्टाफ़ ने रखे"),
  writtenOn: p("Written drafts on", "लिखित मसौदे चालू"),
  writtenOff: p("Written drafts off", "लिखित मसौदे बंद"),
  pvLive: p("Photo & voice on", "फ़ोटो व आवाज़ चालू"),
  pvTest: p("Photo & voice: TEST only", "फ़ोटो व आवाज़: सिर्फ़ टेस्ट"),
  pvOff: p("Photo & voice off", "फ़ोटो व आवाज़ बंद"),
  noKey: p("No paid AI key", "कोई पेड AI कुंजी नहीं"),
  connectorTitle: p("Looking for Claude / ChatGPT connector?", "Claude / ChatGPT कनेक्टर ढूँढ रहे हैं?"),
  connectorSub: p(
    "That is something else: it lets your own Claude or ChatGPT read One. It has its own page.",
    "वह अलग चीज़ है: उससे आपका अपना Claude या ChatGPT One पढ़ता है। उसका अपना पेज है।",
  ),
  open: p("Open", "खोलें"),
  unread: p("This month's numbers could not be read. The switches below still work.", "इस महीने के आँकड़े नहीं पढ़े जा सके। नीचे के स्विच फिर भी चलते हैं।"),
  unreadSettings: p("The AI helper's settings could not be read. Is the database update applied?", "AI सहायक की सेटिंग्स नहीं पढ़ी जा सकीं। क्या डेटाबेस अपडेट लगा है?"),

  // What AI did
  whoWorked: p("Who did the work", "काम किसने किया"),
  whoWorkedSub: p("Every job an AI answered this month. Green ones are free.", "इस महीने AI के हर जवाब वाले काम। हरे वाले मुफ़्त हैं।"),
  freeTag: p("Free", "मुफ़्त"),
  paidTag: p("Paid", "पेड"),
  jobsN: (n: number) => p(`${n} ${n === 1 ? "job" : "jobs"}`, `${n} काम`),
  dayByDay: p("Day by day", "दिन-ब-दिन"),
  dayTip: p("Tap a day to see its jobs", "किसी दिन को दबाकर उसके काम देखें"),
  dayLine: (day: Pair, free: number, paid: number) => p(`${day.en}: ${free} free, ${paid} paid`, `${day.hi ?? day.en}: ${free} मुफ़्त, ${paid} पेड`),
  byJob: p("By kind of job", "काम के हिसाब से"),
  byJobSub: p("Tap a job to see which AI answered and what staff did with it.", "किसी काम को दबाकर देखें कि किस AI ने जवाब दिया और स्टाफ़ ने क्या किया।"),
  latest: p("Latest jobs", "हाल के काम"),
  latestSub: p("The newest first. The dots show each try, in order.", "सबसे नया पहले। बिंदु हर कोशिश दिखाते हैं, क्रम से।"),
  test: p("TEST", "टेस्ट"),
  people: p("Who uses it most", "सबसे ज़्यादा कौन उपयोग करता है"),
  peopleSub: p("Written drafts this month", "इस महीने के लिखित मसौदे"),
  nothing: p("No AI jobs yet this month.", "इस महीने अभी कोई AI काम नहीं।"),
  failedN: (n: number) => p(`${n} got no answer`, `${n} को जवाब नहीं मिला`),
  photoVoice: p("Photo & voice", "फ़ोटो व आवाज़"),
  written: p("Written draft", "लिखित मसौदा"),
  answeredBy: p("Answered by", "जवाब दिया"),
  whatHappened: p("What staff did with it", "स्टाफ़ ने क्या किया"),
  roadTitle: p("Its road", "इसका रास्ता"),
  perJob: p("per job", "प्रति काम"),
  thisMonth: p("This month", "इस महीने"),
  someone: p("Someone", "कोई"),

  // How it works
  howIntro: p(
    "Every AI job goes along one of four roads. The first AI on the road answers. If it is busy, out of credit or too slow, the next one takes over. Nobody has to choose.",
    "हर AI काम चार में से एक रास्ते पर जाता है। रास्ते का पहला AI जवाब देता है। वह व्यस्त हो, क्रेडिट ख़त्म हो या बहुत धीमा हो, तो अगला संभाल लेता है। किसी को चुनना नहीं पड़ता।",
  ),
  showMe: p("Show me", "दिखाएँ"),
  tries: (name: string) => p(`${name} tries first`, `पहले ${name} कोशिश करता है`),
  thenNext: (name: string) => p(`If busy, ${name} takes over`, `व्यस्त हो तो ${name} संभालता है`),
  skipped: (name: string) => p(`${name} is skipped for real records`, `असली रिकॉर्ड के लिए ${name} छोड़ा जाता है`),
  busiest: p("Did most this month", "इस महीने सबसे ज़्यादा"),
  walkDone: p("Whoever answers, staff check the draft before anything is saved.", "जवाब कोई भी दे, कुछ सहेजने से पहले स्टाफ़ मसौदा जाँचता है।"),
  voicePair: (listen: string, think: string) => p(`${listen} listens, ${think} understands`, `${listen} सुनता है, ${think} समझता है`),
  tasksOnRoad: p("Jobs that take this road", "इस रास्ते से जाने वाले काम"),
  aboutThis: p("About this AI", "इस AI के बारे में"),
  listens: p("listens", "सुनता है"),
  understands: p("understands", "समझता है"),
  laneOff: p("Photo and voice AI is switched off on this deployment.", "इस डिप्लॉयमेंट पर फ़ोटो व आवाज़ AI बंद है।"),
  noStation: p("No AI is set up for this road.", "इस रास्ते के लिए कोई AI नहीं जुड़ा।"),
  freeRule: p(
    "The free AI never sees a child's, a family's or a parent's details, or any photo: free services may keep what they are sent.",
    "मुफ़्त AI को किसी बच्चे, परिवार या अभिभावक की जानकारी या कोई फ़ोटो कभी नहीं भेजी जाती: मुफ़्त सेवाएँ भेजी गई बातें रख सकती हैं।",
  ),
  jobsOnRoad: p("Jobs on this road", "इस रास्ते के काम"),
  answeredHere: (n: number) => p(`Answered ${n} this month`, `इस महीने ${n} जवाब`),
  stepNo: (n: number) => p(`Tries ${n === 1 ? "first" : `number ${n}`}`, `${n === 1 ? "सबसे पहले" : `${n}वें नंबर पर`} कोशिश`),
  models: p("Models", "मॉडल"),
  onThisRoad: (n: number) => p(`On this road: ${n} answered this month`, `इस रास्ते पर: इस महीने ${n} जवाब`),
  everyRoad: p("all roads together, this month", "सभी रास्ते मिलाकर, इस महीने"),
  usedFor: p("Used for", "किसके लिए"),

  // Cost
  budgetTitle: p("Written drafts budget", "लिखित मसौदों का बजट"),
  budgetLine: (spent: string, budget: string) => p(`${spent} of ${budget} used`, `${budget} में से ${spent} खर्च`),
  budgetLeft: (pct: number) => p(`${pct}% used. When it is all used, paid AI stops for the month; free AI keeps going.`, `${pct}% खर्च। पूरा होने पर इस महीने पेड AI रुकेगा; मुफ़्त AI चलता रहेगा।`),
  pvSpend: p("Photo & voice", "फ़ोटो व आवाज़"),
  pvSpendSub: (limit: number | null) =>
    limit === null ? p("No daily limit set", "रोज़ की सीमा तय नहीं") : p(`Up to ${limit} per person a day`, `हर व्यक्ति रोज़ ${limit} तक`),
  saved: p("Saved by free AI", "मुफ़्त AI से बचत"),
  savedSub: p("What the free drafts would have cost on Claude (estimate)", "मुफ़्त मसौदे Claude पर कितने के पड़ते (अनुमान)"),
  totalSpend: p("Spent this month", "इस महीने खर्च"),
  byModel: p("Cost by model", "मॉडल के हिसाब से खर्च"),
  byModelSub: p("Every try costs, even when the next AI ends up answering.", "हर कोशिश का खर्च होता है, भले जवाब अगला AI दे।"),
  answered: (n: number) => p(`${n} answered`, `${n} जवाब`),
  heard: (n: number) => p(`Heard ${n} voice ${n === 1 ? "note" : "notes"}`, `${n} आवाज़ें सुनीं`),
  triesN: (n: number) => p(`${n} ${n === 1 ? "try" : "tries"}`, `${n} कोशिश`),
  freeCost: p("Free", "मुफ़्त"),
  keys: p("Photo & voice keys", "फ़ोटो व आवाज़ की कुंजियाँ"),
  keysSub: p("What each key last did. Keys are never shown.", "हर कुंजी ने आख़िरी बार क्या किया। कुंजियाँ कभी नहीं दिखतीं।"),
  keyOk: p("Working", "चल रही"),
  keyQuota: p("Limit reached", "सीमा पूरी"),
  keyFailing: p("Failing", "विफल"),
  keyNone: p("Not used yet", "अभी उपयोग नहीं"),
  keyNotSet: p("Not set up", "जुड़ी नहीं"),
  skippedUntil: (when: Pair) => p(`skipped until ${when.en}`, `${when.hi ?? when.en} तक छोड़ी गई`),
  checkKeys: p("Check keys now", "कुंजियाँ अभी जाँचें"),
  checking: p("Checking every key…", "हर कुंजी जाँच रहे हैं…"),
  checkKeysSub: p("Sends one tiny request per key from the server. Costs a fraction of a rupee.", "सर्वर से हर कुंजी पर एक छोटा अनुरोध। एक रुपये से भी कम खर्च।"),
  lastCheck: (when: Pair) => p(`Last checked ${when.en}`, `आख़िरी जाँच ${when.hi ?? when.en}`),
  estimate: p(
    "These are estimates from the usage each AI service reports. Their own billing pages have the exact charges.",
    "ये अनुमान हर AI सेवा के बताए उपयोग पर हैं। सटीक शुल्क उनकी बिलिंग में देखें।",
  ),
  rate: (rate: number) => p(`Dollars are turned into rupees at ₹${rate} to the dollar.`, `डॉलर को ₹${rate} प्रति डॉलर पर रुपये में बदला गया है।`),

  // Free models (APInex, D-567)
  freeTitle: p("Free models (APInex)", "मुफ़्त मॉडल (APInex)"),
  freeSub: p(
    "Each free model writes a made-up notice and a made-up cover plan. The ones that write well and quickly are used first, each for the kind of job it is best at.",
    "हर मुफ़्त मॉडल एक काल्पनिक सूचना और एक काल्पनिक सब्स्टिट्यूट योजना लिखता है। जो अच्छा और जल्दी लिखें, वही पहले लगते हैं, हर एक उस काम पर जिसमें वह सबसे अच्छा है।",
  ),
  freeCheck: p("Check free models", "मुफ़्त मॉडल जाँचें"),
  freeChecking: p("Checking…", "जाँच रहे हैं…"),
  freeCheckingLong: p(
    "Each free model in turn is writing a made-up notice and plan. APInex allows only a few a minute, so this takes up to two minutes; you can wait here.",
    "हर मुफ़्त मॉडल बारी-बारी से एक काल्पनिक सूचना और योजना लिख रहा है। APInex एक मिनट में कुछ ही अनुरोध लेता है, इसलिए इसमें दो मिनट तक लगते हैं; यहीं रुकें।",
  ),
  freeCheckLost: p(
    "The answer did not come back in time. The check carries on, and its results appear here within two minutes.",
    "जवाब समय पर नहीं लौटा। जाँच चलती रहती है; उसके नतीजे दो मिनट में यहीं दिखेंगे।",
  ),
  freeCheckIn: p(
    "APInex lends its free models only after the account holder checks in on apinex.bond that day. Until then One writes with the other free AIs, and nobody waits.",
    "APInex अपने मुफ़्त मॉडल तभी देता है जब खाते वाला उस दिन apinex.bond पर चेक-इन करे। तब तक One बाक़ी मुफ़्त AI से लिखता है, किसी को रुकना नहीं पड़ता।",
  ),
  freeCheckSub: p("Costs nothing and sends no school record: the notice and the plan are made up.", "कोई खर्च नहीं, स्कूल का कोई रिकॉर्ड नहीं जाता: सूचना और योजना काल्पनिक हैं।"),
  freeNoKey: p(
    "The APInex key is not set up on this server yet. Until it is, NVIDIA, OpenRouter and Gemini Free write the free drafts.",
    "इस सर्वर पर APInex कुंजी अभी नहीं जुड़ी। तब तक मुफ़्त मसौदे NVIDIA, OpenRouter और Gemini Free लिखते हैं।",
  ),
  freeNever: p("Not checked yet. Until they are, One uses the models it expects to be best.", "अभी जाँचे नहीं गए। तब तक One वे मॉडल लगाता है जो सबसे अच्छे होने चाहिए।"),
  freeBlocked: p(
    "At the last check APInex's firewall turned this server away. Its free models are skipped for now; the other free AIs write instead.",
    "पिछली जाँच में APInex की फ़ायरवॉल ने इस सर्वर को रोका। अभी इसके मुफ़्त मॉडल छोड़े जा रहे हैं; बाक़ी मुफ़्त AI लिखते हैं।",
  ),
  freeSummary: (good: number, n: number, listed: number) =>
    p(`${good} of ${n} checked models answered · ${listed} free models listed`, `जाँचे गए ${n} में से ${good} मॉडलों ने जवाब दिया · ${listed} मुफ़्त मॉडल`),
  probeNotice: p("Notice", "सूचना"),
  probePlan: p("Plan", "योजना"),
  notChecked: p("not checked", "जाँचा नहीं"),
  inUseFor: p("Used for", "इसमें लगा"),
  notUsed: p("Spare", "अतिरिक्त"),
  showAll: (n: number) => p(`Show all ${n}`, `सभी ${n} दिखाएँ`),
  showFewer: p("Show fewer", "कम दिखाएँ"),
  seconds: (s: number) => p(`${s}s`, `${s} सेकंड`),

  // Switches
  writtenTitle: p("Written drafts", "लिखित मसौदे"),
  master: p("AI helper", "AI सहायक"),
  masterSub: p("Switch off to hide every AI writing button for everyone", "बंद करने पर सबके लिए AI के लिखने वाले हर बटन छिप जाएँगे"),
  budget: p("Monthly budget (US $)", "मासिक बजट (US $)"),
  budgetHint: p("When the estimate reaches this, paid AI stops for the month. Free AI keeps writing what it may.", "अनुमान यहाँ तक पहुँचते ही इस महीने पेड AI रुक जाता है। मुफ़्त AI जो लिख सकता है, लिखता रहता है।"),
  cap: p("Drafts per person per day", "हर व्यक्ति के रोज़ के मसौदे"),
  features: p("Features", "सुविधाएँ"),
  save: p("Save", "सहेजें"),
  saving: p("Saving…", "सहेज रहे हैं…"),
  saved2: p("Saved", "सहेजा गया"),
  pvTitle: p("Photo & voice", "फ़ोटो व आवाज़"),
  pvMode: p("Who can use it", "कौन उपयोग कर सकता है"),
  pvModeLive: p("On for staff", "स्टाफ़ के लिए चालू"),
  pvModeTest: p("TEST session only", "सिर्फ़ टेस्ट सत्र"),
  pvModeOff: p("Off", "बंद"),
  pvModeSub: p("Set where the app is deployed, not here.", "यह डिप्लॉयमेंट में तय होता है, यहाँ नहीं।"),
  pvLimit: p("Photo and voice jobs per person per day", "हर व्यक्ति के रोज़ के फ़ोटो व आवाज़ काम"),
  pvLimitHint: p("0 pauses new requests. Up to 200.", "0 से नए अनुरोध रुकते हैं। 200 तक।"),
  pvLimitLocked: p("Only an admin can change this while photo and voice AI is on.", "फ़ोटो व आवाज़ AI चालू हो तो इसे सिर्फ़ प्रशासक बदल सकते हैं।"),
  saveLimit: p("Save limit", "सीमा सहेजें"),
  privacy: p(
    "Only who, which job, which AI, tokens and cost are kept. What staff write or say is never stored by the helper.",
    "सिर्फ़ यह रखा जाता है: किसने, कौन-सा काम, कौन-सा AI, टोकन और खर्च। स्टाफ़ जो लिखते या बोलते हैं, सहायक उसे कभी नहीं रखता।",
  ),
  unsaved: p("Changes not saved yet", "बदलाव अभी सहेजे नहीं"),
  usesN: (n: number) => p(`${n} this month`, `इस महीने ${n}`),
  keptPct: (n: number) => p(`${n}% kept`, `${n}% रखे`),
};

export const TIER_WORDS = {
  quick: p("Quick help", "तेज़ मदद"),
  writing: p("For parents", "अभिभावकों के लिए"),
  careful: p("Careful", "सावधानी से"),
};
