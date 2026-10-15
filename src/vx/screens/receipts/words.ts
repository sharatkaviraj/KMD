import { p } from "@/vx/text";

/** The words on /receipts, English with Hindi (src/vx/text.ts). */
export const W = {
  crumb: p("Money · Session", "पैसा · सत्र"),
  money: p("Money", "पैसा"),
  title: p("Receipts", "रसीदें"),
  closeDay: p("Close the day", "दिन बंद करें"),
  today: p("Today", "आज"),
  yesterday: p("Yesterday", "कल"),
  last3: p("Last 3 days", "पिछले 3 दिन"),
  collected: p("Collected", "जमा हुआ"),
  collectedToday: p("Collected today", "आज जमा"),
  cash: p("Cash", "नकद"),
  upi: p("UPI", "UPI"),
  cheque: p("Cheque", "चेक"),
  bank: p("Bank", "बैंक"),
  other: p("Other", "अन्य"),
  reversed: p("Reversed", "रद्द"),
  reversedSub: p("kept in history, not counted", "इतिहास में, गिनती में नहीं"),
  toCount: p("to count", "गिनना है"),
  howItCameIn: p("How it came in", "कैसे आया"),
  allModes: p("All modes", "सभी तरीके"),
  everyone: p("Everyone", "सभी"),
  search: p("Receipt no., name or class", "रसीद नं., नाम या कक्षा"),
  searchLabel: p("Search receipts", "रसीदें खोजें"),
  export: p("Export", "निर्यात"),
  closeDayShort: p("Close day", "दिन बंद"),
  collectedYesterday: p("Collected yesterday", "कल जमा"),
  net: p("net", "शुद्ध"),
  backToMenu: p("Back to menu", "मेनू पर वापस"),
  receipt: p("Receipt", "रसीद"),
  time: p("Time", "समय"),
  student: p("Student", "विद्यार्थी"),
  mode: p("Mode", "तरीका"),
  takenBy: p("Taken by", "लेने वाले"),
  amount: p("Amount", "राशि"),
  noMatch: p("No receipts match", "कोई रसीद नहीं मिली"),
  noMatchBody: p("Try another mode or name, or clear the filters.", "दूसरा तरीका या नाम आज़माएँ, या फ़िल्टर हटाएँ।"),
  clearFilters: p("Clear filters", "फ़िल्टर हटाएँ"),
  emptyDay: p("No receipts on this day yet", "इस दिन अभी कोई रसीद नहीं"),
  emptyDayBody: p("Receipts appear here as fees are taken at the desk.", "डेस्क पर फीस लेते ही रसीदें यहाँ दिखेंगी।"),
  lastDay: p("Show the last day with receipts", "आख़िरी रसीद वाला दिन दिखाएँ"),
  takeFee: p("Take a fee", "फीस लें"),
  truncated: p("Showing the newest 500 receipts in this window.", "इस अवधि की नई 500 रसीदें दिख रही हैं।"),
  dayClosed: p("Day closed", "दिन बंद"),
  seeClose: p("See the close", "बंदी देखें"),
  afterClose: p("posted after the day was closed", "दिन बंद होने के बाद बनीं"),
  // detail
  notSent: p("Not sent yet", "अभी नहीं भेजी"),
  sentRead: p("Sent · read", "भेजी · पढ़ी"),
  sent: p("Sent", "भेजी"),
  delivered: p("Sent · delivered", "भेजी · पहुँची"),
  failed: p("Not delivered", "नहीं पहुँची"),
  feeReceipt: "रसीद · FEE RECEIPT",
  school: p("Shri Veer Patta Senior Secondary School", "श्री वीर पत्ता सीनियर सेकेंडरी स्कूल"),
  classSr: p("Class · SR", "कक्षा · SR"),
  father: p("Father", "पिता"),
  dateTime: p("Date · time", "तारीख · समय"),
  totalReceived: p("Total received", "कुल प्राप्त"),
  ref: p("Ref", "संदर्भ"),
  send: p("Send", "भेजें"),
  sendTo: p("Send to {name} on WhatsApp", "{name} को WhatsApp पर भेजें"),
  sendWa: p("Send on WhatsApp", "WhatsApp पर भेजें"),
  sendAgain: p("Send again on WhatsApp", "WhatsApp पर फिर भेजें"),
  closeReceipt: p("Close receipt", "रसीद बंद करें"),
  student2: p("Student", "विद्यार्थी"),
  print: p("Print", "प्रिंट"),
  pdf: p("PDF", "PDF"),
  printPdf: p("Print / PDF", "प्रिंट / PDF"),
  reverse: p("Reverse", "रद्द करें"),
  history: p("History", "इतिहास"),
  hPosted: p("Receipt created by {name}", "{name} ने रसीद बनाई"),
  hPostedBare: p("Receipt created", "रसीद बनी"),
  hReversed: p("Reversed", "रद्द हुई"),
  hSent: p("Sent to {name} on WhatsApp", "{name} को WhatsApp पर भेजी"),
  hSentBare: p("Sent on WhatsApp", "WhatsApp पर भेजी"),
  hRead: p("Read by parent", "अभिभावक ने पढ़ी"),
  footnote: p(
    "Receipts are never edited. A reversal writes a separate entry and this receipt stays in history.",
    "रसीद कभी बदली नहीं जाती। रद्द करने पर अलग प्रविष्टि बनती है और यह रसीद इतिहास में रहती है।",
  ),
  pendingReversal: p("Reversal asked · waiting for an admin", "रद्द करने का अनुरोध · एडमिन की प्रतीक्षा"),
  back: p("Back to receipts", "रसीदों पर वापस"),
  // reverse sheet
  why: p("Why?", "क्यों?"),
  rWrongAmount: p("Wrong amount typed", "ग़लत राशि लिखी"),
  rWrongStudent: p("Wrong student", "ग़लत विद्यार्थी"),
  rBounced: p("Cheque bounced", "चेक बाउंस हुआ"),
  rDuplicate: p("Entered twice", "दो बार दर्ज"),
  rWrongAmountSub: p("A new receipt can be made with the right amount", "सही राशि की नई रसीद बनाई जा सकती है"),
  rWrongStudentSub: p("Then take the fee again for the right child", "फिर सही बच्चे के लिए फीस दोबारा लें"),
  rBouncedSub: p("The dues come back on the family", "बकाया परिवार पर लौट आता है"),
  rDuplicateSub: p("The second copy is cancelled", "दूसरी प्रति रद्द होती है"),
  notePlaceholder: p("Anything the accountant should know", "अकाउंटेंट को जो जानना चाहिए"),
  noteOptional: p("Note (optional)", "टिप्पणी (वैकल्पिक)"),
  keepReceipt: p("Keep receipt", "रसीद रखें"),
  askAdmin: p("Ask an admin to reverse", "एडमिन से रद्द करवाएँ"),
  impactAdmin: p(
    "A reversal entry of {amount} is written today. {no} stays in history marked REVERSED, {name}’s dues go back up by {back}, and the day total drops.",
    "आज {amount} की रद्द प्रविष्टि लिखी जाएगी। {no} इतिहास में 'रद्द' के निशान के साथ रहेगी, {name} का बकाया {back} बढ़ेगा और दिन का कुल घटेगा।",
  ),
  impactRequest: p(
    "Nothing changes yet. This goes to Needs you, and an admin reverses it.",
    "अभी कुछ नहीं बदलेगा। यह 'आपके लिए' में जाएगा और एडमिन रद्द करेंगे।",
  ),
  doneReversed: p("Receipt reversed. It stays in history.", "रसीद रद्द हुई। यह इतिहास में रहेगी।"),
  doneRequested: p("Sent to an admin under Needs you.", "एडमिन को 'आपके लिए' में भेजा।"),
  doneExists: p("An admin has already been asked about this receipt.", "इस रसीद के लिए एडमिन से पहले ही पूछा गया है।"),
  // share sheet
  shareTitle: p("Send this receipt on WhatsApp", "यह रसीद WhatsApp पर भेजें"),
  sharePreviewOnly: p(
    "This is a preview. Sending happens from the classic receipt screen, which shows its own preview before anything goes to the family.",
    "यह केवल झलक है। भेजना पुरानी रसीद स्क्रीन से होता है, जो भेजने से पहले अपनी झलक दिखाती है।",
  ),
  openClassic: p("Open the receipt to send", "भेजने के लिए रसीद खोलें"),
  close: p("Close", "बंद करें"),
  // close flow
  closeTitle: p("Close the day", "दिन बंद करें"),
  closeSub: p("Count cash · check UPI · close", "नकद गिनें · UPI जाँचें · बंद करें"),
  noneToday: p("none today", "आज कोई नहीं"),
  notePlaceholderClose: p("For example: ₹100 given back as change to a parent, to be collected tomorrow", "जैसे: ₹100 एक अभिभावक को छुट्टे लौटाए, कल लेने हैं"),
  closeHintReady: p("Everything matches — you can close the day.", "सब मेल खाता है — दिन बंद कर सकते हैं।"),
  oneLess: p("One less", "एक कम"),
  oneMore: p("One more", "एक और"),
  expects: p("What the app expects", "ऐप के हिसाब से"),
  total: p("Total", "कुल"),
  upiMatches: p("UPI matches the bank app", "UPI बैंक ऐप से मेल खाता है"),
  matched: p("matched", "मेल खाया"),
  notChecked: p("not checked yet", "अभी नहीं जाँचा"),
  expected: p("Expected", "अपेक्षित"),
  countCash: p("Count the cash", "नकद गिनें"),
  coins: p("Coins", "सिक्के"),
  counted: p("Counted", "गिना"),
  matches: p("Matches", "मेल खाता है"),
  shortBy: p("Short by", "कम"),
  overBy: p("Over by", "ज़्यादा"),
  noteRecord: p("Note for the record (needed if cash does not match)", "रिकॉर्ड के लिए टिप्पणी (नकद मेल न खाए तो ज़रूरी)"),
  closeButton: p("Close the day", "दिन बंद करें"),
  closeHintUpi: p("Tick the UPI check first.", "पहले UPI जाँच पर टिक करें।"),
  closeHintNote: p("Cash does not match. Recount, or write a note to close anyway.", "नकद मेल नहीं खाता। फिर गिनें, या टिप्पणी लिखकर बंद करें।"),
  closeNoLock: p(
    "Receipts stay as they are. Any receipt dated this day that is made after the close is flagged here.",
    "रसीदें जैसी हैं वैसी रहेंगी। बंद होने के बाद इस दिन की कोई रसीद बने तो यहाँ दिखेगी।",
  ),
  closedAt: p("Closed", "बंद किया"),
  closedBy: p("Closed by {name} at {time}.", "{name} ने {time} बजे बंद किया।"),
  closedAtOnly: p("Closed at {time}.", "{time} बजे बंद किया।"),
  short: p("short", "कम"),
  over: p("over", "ज़्यादा"),
  note: p("Note", "टिप्पणी"),
  cashCounted: p("Cash counted", "गिना हुआ नकद"),
  receipts: p("Receipts", "रसीदें"),
  dayBook: p("Day book (CSV)", "दिन की बही (CSV)"),
  reopen: p("Reopen day (admin)", "दिन फिर खोलें (एडमिन)"),
  reopenTitle: p("Reopen this day?", "यह दिन फिर खोलें?"),
  reopenWhy: p("Why is it being reopened?", "क्यों खोला जा रहा है?"),
  reopenImpact: p("The close stays on record. The day can be counted and closed again.", "बंदी रिकॉर्ड में रहेगी। दिन फिर गिनकर बंद किया जा सकता है।"),
  reopenDone: p("Day reopened.", "दिन फिर खुला।"),
  closeDone: p("Day closed.", "दिन बंद हुआ।"),
  reopenedBy: p("Reopened", "फिर खोला"),
  cannotClose: p("Only staff who take fees can close the day.", "केवल फीस लेने वाले स्टाफ़ दिन बंद कर सकते हैं।"),
};

/**
 * The receipt message as the family would read it: Hindi first, English under.
 * It is the parent's message, so it does not follow the staff reader's language.
 */
export function shareLines(name: string, amount: string, receiptNumber: string, date: string): string[] {
  return [
    `नमस्ते, ${name} की फीस ${amount} प्राप्त हुई। रसीद नं. ${receiptNumber}, दिनांक ${date}।`,
    "",
    `Fee of ${amount} received for ${name}. Receipt ${receiptNumber}, ${date}.`,
  ];
}

export const SHARE_FOOTER = "Shri Veer Patta School · PDF attached";

export const MODE_WORD: Record<string, { en: string; hi?: string }> = {
  cash: W.cash,
  upi: W.upi,
  cheque: W.cheque,
  bank: W.bank,
  other: W.other,
};

export const REASON_WORD: Record<string, { en: string; hi?: string }> = {
  wrong_amount: W.rWrongAmount,
  wrong_student: W.rWrongStudent,
  cheque_bounced: W.rBounced,
  duplicate: W.rDuplicate,
};

export const REASON_SUB: Record<string, { en: string; hi?: string }> = {
  wrong_amount: W.rWrongAmountSub,
  wrong_student: W.rWrongStudentSub,
  cheque_bounced: W.rBouncedSub,
  duplicate: W.rDuplicateSub,
};

/** "1 receipt" / "14 receipts". */
export function receiptCount(n: number): { en: string; hi: string } {
  return { en: `${n} ${n === 1 ? "receipt" : "receipts"}`, hi: `${n} रसीद${n === 1 ? "" : "ें"}` };
}

/** Fill `{name}`-style holes in both halves of a pair. */
export function fill(pair: { en: string; hi?: string }, values: Record<string, string>): { en: string; hi?: string } {
  const put = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
  return pair.hi ? { en: put(pair.en), hi: put(pair.hi) } : { en: put(pair.en) };
}
