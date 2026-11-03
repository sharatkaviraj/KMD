/**
 * Every word on the one-tap pay page, in Hindi and English together — the
 * owner's decision (2026-10-29): parents read Hindi first, and an English line
 * under it serves the families who read that. Since 2026-10-30 the page shows
 * the Hindi large and the English as one small line, and only under the words
 * a parent acts on: the whole page fits one phone screen.
 *
 * Amounts are passed in already formatted by `formatInr`, never written here:
 * the money-format audit refuses a hand-written rupee glyph, and one formatter
 * is what keeps every screen saying the same thing.
 */

export type Bilingual = { hi: string; en: string };

const pair = (hi: string, en: string): Bilingual => ({ hi, en });

export const PAY_COPY = {
  title: pair("स्कूल फीस भुगतान", "School fee payment"),
  session: (label: string) => pair(`सत्र ${label}`, `Session ${label}`),
  installment: (no: number) => pair(`किश्त ${no}`, `Installment ${no}`),
  lastYear: pair("पिछले वर्ष का बकाया", "Last year's balance"),
  dueOn: (date: string) => pair(`अंतिम तिथि ${date}`, `Due ${date}`),
  charged: pair("फीस", "Fee"),
  paid: pair("जमा", "Paid"),
  toPay: pair("बाकी", "To pay"),
  lateFee: pair("विलंब शुल्क", "Late fee"),
  state: {
    paid: pair("जमा हो गया", "Paid"),
    overdue: pair("तिथि निकल गई", "Overdue"),
    part_paid: pair("आंशिक जमा", "Part paid"),
    upcoming: pair("आगामी", "Upcoming"),
  },
  clearDuesToDate: pair("अब तक का बकाया", "Clear dues to date"),
  wholeSession: pair("पूरे सत्र का बकाया", "Whole session"),
  nothingOwed: pair("इस सत्र का कुछ भी बकाया नहीं", "Nothing is owed this session"),
  amountFor: (name: string) => pair(`${name} के लिए राशि`, `Amount for ${name}`),
  bounds: (min: string, max: string) => pair(`कम से कम ${min} · अधिकतम ${max}`, `At least ${min} · at most ${max}`),
  clearToSkip: pair("अभी इस बच्चे का भुगतान नहीं करना? बॉक्स खाली कर दें।", "Not paying for this child now? Clear the box."),
  error: {
    not_whole: pair("केवल पूरे रुपये", "Whole rupees only"),
    below_min: (min: string) => pair(`कम से कम ${min}`, `At least ${min}`),
    above_max: (max: string) => pair(`अधिकतम ${max} — इस सत्र का पूरा बकाया`, `At most ${max} — everything owed this session`),
  },
  total: pair("कुल राशि", "Total"),
  pay: (amount: string) => pair(`${amount} का भुगतान करें`, `Pay ${amount}`),
  enterAmount: pair("राशि भरें", "Enter an amount"),
  opening: pair("भुगतान खुल रहा है…", "Opening payment…"),
  methods: pair(
    "Razorpay से UPI (PhonePe, Google Pay, Paytm), कार्ड या नेटबैंकिंग से भुगतान करें। रसीद व्हाट्सऐप पर आएगी।",
    "Pay by UPI (PhonePe, Google Pay, Paytm), card or netbanking through Razorpay. Your receipt comes on WhatsApp.",
  ),
  methodsUpi: pair(
    "Razorpay के ज़रिए UPI (PhonePe, Google Pay, Paytm, BHIM) से भुगतान करें। रसीद व्हाट्सऐप पर आएगी।",
    "Pay by UPI (PhonePe, Google Pay, Paytm, BHIM) through Razorpay. Your receipt comes on WhatsApp.",
  ),
  chooseApp: pair("अपना UPI ऐप चुनें", "Choose your UPI app"),
  payWithApp: (amount: string) => pair(`${amount} का भुगतान UPI ऐप से करें`, `Pay ${amount} with a UPI app`),
  continueToPay: (amount: string) => pair(`${amount} का भुगतान करने के लिए आगे बढ़ें`, `Continue to pay ${amount}`),
  waitingForApp: pair(
    "ऐप में भुगतान करके इस पेज पर लौटें। पुष्टि अपने आप हो जाएगी — दोबारा भुगतान न करें।",
    "Pay in the app, then come back to this page. It confirms on its own — please do not pay twice.",
  ),
  appMissing: pair("वह ऐप इस फ़ोन पर नहीं है। कृपया कोई दूसरा ऐप चुनें।", "That app is not on this phone. Please choose another."),
  openInChrome: pair("कुछ नहीं खुला? यह पेज Chrome में खोलें", "Nothing opened? Open this page in Chrome"),
  changeAmount: pair("राशि बदलें", "Change the amount"),
  counter: pair("आप स्कूल के फीस काउंटर पर भी भुगतान कर सकते हैं।", "You can also pay at the school fee counter."),
  confirming: pair(
    "आपके भुगतान की पुष्टि हो रही है… कृपया दोबारा भुगतान न करें।",
    "Confirming your payment… Please do not pay again.",
  ),
  received: pair("भुगतान प्राप्त हुआ, धन्यवाद", "Payment received, thank you"),
  receiptSent: (number: string, amount: string) =>
    pair(`रसीद ${number} (${amount}) व्हाट्सऐप पर भेजी गई`, `Receipt ${number} (${amount}) sent on WhatsApp`),
  dismissed: pair("भुगतान पूरा नहीं हुआ। आप फिर से प्रयास कर सकते हैं।", "Payment not completed. You can try again."),
  failed: pair("भुगतान नहीं हो सका। कृपया फिर से प्रयास करें।", "The payment did not go through. Please try again."),
  busy: pair("भुगतान सेवा ने जवाब नहीं दिया। कृपया एक मिनट बाद फिर प्रयास करें।", "The payment service did not answer. Please try again in a minute."),
  inProgress: pair(
    "आपका पिछला भुगतान अभी प्रक्रिया में है। कृपया एक मिनट रुकें।",
    "Your earlier payment is still being processed. Please wait a minute.",
  ),
  amountChanged: pair(
    "बकाया राशि बदल गई है। पेज दोबारा खोलकर नई राशि देखें।",
    "The amount owed has changed. Reopen this page to see the new figures.",
  ),
  unavailable: pair(
    "अभी ऑनलाइन भुगतान उपलब्ध नहीं है। कृपया स्कूल के फीस काउंटर पर भुगतान करें।",
    "Online payment is not available right now. Please pay at the school fee counter.",
  ),
  footer: pair(
    "यह पेज केवल आपके बच्चे की फीस का विवरण दिखाता है।",
    "This page shows only your child's fee details.",
  ),

  // The one-screen page (2026-10-30).
  secure: pair("Razorpay से सुरक्षित भुगतान", "Secured by Razorpay"),
  progress: (paid: string, owed: string) => pair(`जमा ${paid} · बाकी ${owed}`, `Paid ${paid} · Due ${owed}`),
  choice: {
    due_so_far: pair("अब तक का बकाया", "Due so far"),
    whole_year: pair("पूरे साल का बकाया", "Whole year"),
    other: pair("अपनी राशि लिखें", "Other amount"),
  },
  lateFeeIncluded: (amount: string) => pair(`विलंब शुल्क ${amount} सहित`, `incl. ${amount} late fee`),
  otherHint: (min: string, max: string) => pair(`${min} से ${max} तक`, `${min} to ${max}`),
  details: pair("पूरा विवरण देखें", "See details"),
  paidRows: (which: string) => pair(`${which} — जमा ✓`, `${which} — paid`),
  remaining: pair("बाकी", "Due"),
  include: (name: string) => pair(`${name} का भुगतान करें`, `Pay for ${name}`),
  change: pair("बदलें", "Change"),
  done: pair("ठीक है", "Done"),
  notPayingNow: pair("अभी नहीं", "Not now"),
  methodsLine: "UPI · PhonePe · Google Pay · Paytm · BHIM",
  otherApp: pair("कोई और UPI ऐप", "Other UPI app"),
  lastUsed: pair("पिछली बार", "Last time"),
  backToAmount: pair("← राशि बदलें", "← Change amount"),
  waitingTitle: pair("ऐप में भुगतान पूरा करें", "Complete the payment in the app"),
  steps: [
    pair("ऐप में अपना UPI PIN डालें", "Enter your UPI PIN in the app"),
    pair("इसी पेज पर वापस आएँ", "Come back to this page"),
    pair("रसीद अपने-आप WhatsApp पर आएगी", "Your receipt comes on WhatsApp by itself"),
  ],
  checking: pair("भुगतान की पुष्टि हो रही है…", "Confirming your payment…"),
  slowConfirm: pair(
    "पैसा कट गया हो तो चिंता न करें — पुष्टि में कुछ मिनट लग सकते हैं। दोबारा भुगतान न करें।",
    "If money was taken, don't worry — confirming can take a few minutes. Please don't pay again.",
  ),
  otherAppInstead: pair("ऐप नहीं खुला? दूसरा ऐप चुनें", "App didn't open? Choose another"),
  receivedTitle: (amount: string) => pair(`${amount} मिल गए!`, "Payment received"),
  receiptLine: (number: string, amount: string) => pair(`रसीद ${number} · ${amount}`, `Receipt ${number} · ${amount}`),
  receiptOnWhatsApp: pair("रसीद WhatsApp पर भेज दी गई ✓", "Receipt sent on WhatsApp"),
  nowDue: (amount: string) => pair(`अब बाकी ${amount}`, `Now due ${amount}`),
  allPaid: pair("इस साल का पूरा भुगतान हो गया", "Everything for this year is paid"),
  backToWhatsApp: pair("ऊपर ✕ दबाकर WhatsApp पर लौटें", "Tap ✕ at the top to go back to WhatsApp"),
  payMore: pair("और भुगतान करें", "Make another payment"),
  failedTitle: pair("भुगतान नहीं हुआ", "Payment not completed"),
  failedNote: pair("कोई पैसा नहीं कटा।", "No money was taken."),
  tryAgain: pair("फिर से कोशिश करें", "Try again"),
  lastPaidBanner: (amount: string, date: string) => pair(`${amount} मिल गए · ${date}`, `${amount} received · ${date}`),
} as const;
