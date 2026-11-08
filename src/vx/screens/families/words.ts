import { p, type Pair } from "@/vx/text";

/*
 * Every word on the Families screens (owner, 8 Nov 2026), in English and
 * Hindi. Plain words for office staff: "family", "brothers and sisters",
 * "fees left", never a table name. The late fee is always named apart from
 * fees, because it is never part of them.
 */

const kids = (n: number): Pair => (n === 1 ? p("1 child", "1 बच्चा") : p(`${n} children`, `${n} बच्चे`));
const families = (n: number): Pair => (n === 1 ? p("1 family", "1 परिवार") : p(`${n} families`, `${n} परिवार`));

export const W = {
  title: p("Families", "परिवार"),
  crumb: p("Children & staff · Families", "बच्चे व स्टाफ़ · परिवार"),
  lead: p(
    "Brothers and sisters in the school, with their fees together. Tap a family to see each child.",
    "स्कूल में पढ़ने वाले भाई-बहन, उनकी फीस एक साथ। हर बच्चे को देखने के लिए परिवार पर टैप करें।",
  ),
  kids,
  families,
  summary: (f: number, c: number): Pair => p(`${families(f).en} · ${kids(c).en}`, `${families(f).hi} · ${kids(c).hi}`),

  notYet: p(
    "Linking or separating brothers and sisters for this year is still done in Fees.",
    "इस साल भाई-बहन जोड़ना या अलग करना अभी Fees में ही होता है।",
  ),
  testYear: (session: string): Pair =>
    p(`Practice year ${session}: these families are test data, not real children.`, `अभ्यास वर्ष ${session}: ये परिवार टेस्ट डेटा हैं, असली बच्चे नहीं।`),

  kpi: {
    families: p("Families", "परिवार"),
    familiesSub: p("With two or more children here", "जिनके दो या ज़्यादा बच्चे यहाँ पढ़ते हैं"),
    children: p("Children in them", "उनके बच्चे"),
    childrenSub: (three: number): Pair => p(`${three} families with 3 or more`, `${three} परिवारों में 3 या ज़्यादा`),
    feesLeft: p("Fees left", "बाकी फीस"),
    feesLeftSub: (owing: number): Pair => p(`${owing} families still owe`, `${owing} परिवारों की फीस बाकी`),
    unreadSub: (n: number): Pair => p(`${n} not read from Fees; not counted`, `${n} Fees से नहीं पढ़े गए; जोड़े नहीं`),
    late: p("Late fee (apart)", "लेट फीस (अलग)"),
    lateSub: p("Never part of fees left", "बाकी फीस में कभी नहीं जुड़ती"),
  },

  search: p("Child, father, phone or SR", "बच्चा, पिता, फ़ोन या SR"),
  speak: p("Say a name", "नाम बोलें"),
  listening: p("Listening… say the name", "सुन रहे हैं… नाम बोलें"),
  heard: (text: string): Pair => p(`Searching for “${text}”`, `“${text}” खोज रहे हैं`),
  filtersLabel: p("Which families", "कौन-से परिवार"),
  filters: {
    all: p("All", "सभी"),
    owing: p("Fees left", "फीस बाकी"),
    late: p("Late fee", "लेट फीस"),
    three: p("3 or more children", "3 या ज़्यादा बच्चे"),
    paid: p("Fees paid", "फीस जमा"),
  },
  sortLabel: p("Order", "क्रम"),
  sort: {
    name: p("A to Z", "नाम से"),
    owing: p("Most fees left", "सबसे ज़्यादा बाकी"),
  },
  showing: (shown: number, total: number): Pair =>
    shown === total ? families(total) : p(`Showing ${shown} of ${total} families`, `${total} में से ${shown} परिवार`),
  more: (n: number): Pair => p(`Show ${n} more`, `${n} और दिखाएँ`),

  card: {
    father: (name: string): Pair => p(`Father: ${name}`, `पिता: ${name}`),
    guardian: (name: string): Pair => p(`Parent: ${name}`, `अभिभावक: ${name}`),
    feesLeft: (amount: string): Pair => p(`${amount} fees left`, `${amount} फीस बाकी`),
    feesPaid: p("Fees paid", "फीस जमा"),
    notRead: p("Fees not read", "फीस नहीं पढ़ी गई"),
    late: (amount: string): Pair => p(`${amount} late fee (apart)`, `${amount} लेट फीस (अलग)`),
    overdue: p("Overdue", "समय निकल गया"),
    allLeft: p("All have left", "सब छोड़ चुके"),
    open: (name: string): Pair => p(`Open the ${name} family`, `${name} परिवार खोलें`),
  },

  empty: {
    none: p("No families yet", "अभी कोई परिवार नहीं"),
    noneBody: p(
      "When brothers and sisters are linked as one family, they appear here together.",
      "जब भाई-बहन एक परिवार में जोड़े जाते हैं, वे यहाँ साथ दिखते हैं।",
    ),
    noMatch: p("No family matches", "कोई परिवार नहीं मिला"),
    noMatchBody: p("Try the child's first name, the father's name, a phone number or the SR.", "बच्चे का पहला नाम, पिता का नाम, फ़ोन नंबर या SR लिखकर देखें।"),
    clear: p("Show all families", "सभी परिवार दिखाएँ"),
  },

  change: p("Change brothers and sisters", "भाई-बहन बदलें"),
  changeSub: p("Link two children as one family, or take one out", "दो बच्चों को एक परिवार में जोड़ें, या किसी को अलग करें"),

  /* The family page */
  back: p("All families", "सभी परिवार"),
  notFound: p("This family was not found", "यह परिवार नहीं मिला"),
  notFoundBody: p(
    "It may have been changed in Fees, or it belongs to another year. Go back to all families and search again.",
    "हो सकता है Fees में बदला गया हो, या यह किसी और साल का हो। सभी परिवारों पर लौटकर फिर खोजें।",
  ),
  call: p("Call", "कॉल करें"),
  callWho: (name: string): Pair => p(`Call ${name}`, `${name} को कॉल करें`),
  whatsapp: p("WhatsApp", "व्हाट्सऐप"),
  whatsappWho: (name: string): Pair => p(`WhatsApp ${name}`, `${name} को व्हाट्सऐप करें`),
  collect: p("Collect fee", "फीस जमा करें"),
  collectFor: (name: string): Pair => p(`Collect fee for ${name}`, `${name} की फीस जमा करें`),
  noPhone: p("No phone number saved", "कोई फ़ोन नंबर नहीं"),
  opening: {
    call: (name: string): Pair => p(`Opening the phone to call ${name}…`, `${name} को कॉल करने के लिए फ़ोन खुल रहा है…`),
    whatsapp: p("Opening WhatsApp…", "व्हाट्सऐप खुल रहा है…"),
  },
  father: p("Father", "पिता"),
  mother: p("Mother", "माता"),
  parent: p("Parent", "अभिभावक"),
  village: p("Village / city", "गाँव / शहर"),

  money: {
    title: p("This year, all children together", "इस साल, सभी बच्चे मिलाकर"),
    yearFees: p("Year's fees", "साल की फीस"),
    paid: p("Paid", "जमा"),
    left: p("Fees left", "बाकी फीस"),
    paidPart: (pct: number): Pair => p(`${pct}% of the year's fees paid`, `साल की ${pct}% फीस जमा`),
    allPaid: p("All fees for this year are paid", "इस साल की पूरी फीस जमा है"),
    late: (amount: string): Pair => p(`Late fee ${amount}: kept apart, never added to fees`, `लेट फीस ${amount}: अलग रखी गई, फीस में नहीं जुड़ती`),
    notRead: p(
      "One child's fees could not be read from Fees, so no family total is shown. Each child's own figures are below.",
      "एक बच्चे की फीस Fees से नहीं पढ़ी जा सकी, इसलिए परिवार का कुल नहीं दिखाया। हर बच्चे के अपने आँकड़े नीचे हैं।",
    ),
  },

  children: (n: number): Pair => p(`Children (${n})`, `बच्चे (${n})`),
  child: {
    sr: (sr: string): Pair => p(`SR ${sr}`, `SR ${sr}`),
    left: p("Left school", "स्कूल छोड़ा"),
    inactive: p("Not on the roll", "रोल पर नहीं"),
    thirdChild: p("3rd child", "तीसरा बच्चा"),
    feesLeft: p("Fees left", "बाकी फीस"),
    paid: p("Paid", "जमा"),
    late: p("Late fee (apart)", "लेट फीस (अलग)"),
    nextDue: p("Next due", "अगली किस्त"),
    nextDueOn: (amount: string, on: string): Pair => p(`${amount} on ${on}`, `${on} को ${amount}`),
    allPaid: p("All paid for this year", "इस साल की पूरी फीस जमा"),
    notRead: p("Fees could not be read for this child", "इस बच्चे की फीस नहीं पढ़ी जा सकी"),
    discount: p("Discount", "छूट"),
    open: p("Open child", "बच्चा खोलें"),
    openWho: (name: string): Pair => p(`Open ${name}'s page`, `${name} का पेज खोलें`),
  },

  help: {
    title: p("How to use this page", "यह पेज कैसे इस्तेमाल करें"),
    collect: p("Collect fee opens the Payment Desk with this family's child ready.", "‘फीस जमा करें’ से पेमेंट डेस्क इस परिवार के बच्चे के साथ खुलता है।"),
    open: p("Open child shows that child's full page.", "‘बच्चा खोलें’ से उस बच्चे का पूरा पेज खुलता है।"),
    late: p("The late fee is shown apart. A family that owes only a late fee has its fees paid.", "लेट फीस अलग दिखती है। जिस परिवार पर सिर्फ़ लेट फीस बाकी है, उसकी फीस जमा मानी जाती है।"),
  },
} as const;
