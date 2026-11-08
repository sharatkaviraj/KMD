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

  change: p("Link brothers and sisters", "भाई-बहन जोड़ें"),
  changeSub: p("Link two or more children as one family", "दो या ज़्यादा बच्चों को एक परिवार में जोड़ें"),
  addKid: p("Add a brother or sister", "भाई या बहन जोड़ें"),
  addKidSub: p("Link another child to this family", "इस परिवार में एक और बच्चा जोड़ें"),
  takeOut: p("Take out of this family", "इस परिवार से अलग करें"),
  takeOutWho: (name: string): Pair => p(`Take ${name} out of this family`, `${name} को इस परिवार से अलग करें`),

  /* Linking and taking out (the sheets) */
  link: {
    title: p("Link brothers and sisters", "भाई-बहन जोड़ें"),
    addTitle: p("Add a brother or sister", "भाई या बहन जोड़ें"),
    step1: p("Step 1 of 2 · Find the children", "चरण 1/2 · बच्चे खोजें"),
    step2: p("Step 2 of 2 · Check and save", "चरण 2/2 · देखें और सेव करें"),
    find: p("Type a child's name, SR or father's name", "बच्चे का नाम, SR या पिता का नाम लिखें"),
    findHint: p("Type at least 2 letters. Tap a child to pick them.", "कम से कम 2 अक्षर लिखें। बच्चे को चुनने के लिए टैप करें।"),
    searching: p("Searching…", "खोज रहे हैं…"),
    none: (q: string): Pair => p(`No child found for “${q}”. Try the first name or the SR.`, `“${q}” से कोई बच्चा नहीं मिला। पहला नाम या SR लिखकर देखें।`),
    picked: p("Will be one family", "एक परिवार बनेंगे"),
    pickedNone: p("No child picked yet", "अभी कोई बच्चा नहीं चुना"),
    already: p("Already in this family", "पहले से इस परिवार में"),
    remove: (name: string): Pair => p(`Remove ${name}`, `${name} को हटाएँ`),
    pick: (name: string): Pair => p(`Pick ${name}`, `${name} को चुनें`),
    needTwo: p("Pick at least 2 children", "कम से कम 2 बच्चे चुनें"),
    needOne: p("Pick at least 1 more child", "कम से कम 1 और बच्चा चुनें"),
    next: p("Check fees", "फीस देखें"),
    checking: p("Checking with Fees what will change…", "Fees से देख रहे हैं कि क्या बदलेगा…"),
    checkingLocal: p("Working out what will change…", "देख रहे हैं कि क्या बदलेगा…"),
    afterTitle: (n: number): Pair => p(`After saving: one family of ${n} children`, `सेव करने के बाद: ${n} बच्चों का एक परिवार`),
    merge: (n: number): Pair => p(`${n} families become one.`, `${n} परिवार एक हो जाएँगे।`),
    otherYear: p("Other year", "दूसरा साल"),
    otherYearNote: p("A brother or sister from another year stays linked but counts for nothing this year.", "दूसरे साल का भाई-बहन जुड़ा रहता है, पर इस साल गिना नहीं जाता।"),
    staffChild: p("Staff Child", "स्टाफ़ चाइल्ड"),
    thirdNow: p("Has 3rd Child Policy now", "अभी 3rd Child Policy है"),
    feesLeft: (amount: string): Pair => p(`${amount} fees left`, `${amount} फीस बाकी`),
    lateApart: (amount: string): Pair => p(`${amount} late fee (apart)`, `${amount} लेट फीस (अलग)`),
    moneyNotRead: p("Fees not read", "फीस नहीं पढ़ी गई"),
    paidStays: p("Receipts and money already paid stay with each child. Each child's dues are worked out again after saving.", "रसीदें और जमा पैसा हर बच्चे के साथ रहता है। सेव करने के बाद हर बच्चे की फीस फिर से बनती है।"),
    back: p("Go back", "वापस"),
    save: p("Yes, link them", "हाँ, जोड़ें"),
    saving: p("Saving… please wait", "सेव हो रहा है… रुकें"),
    saved: (n: number): Pair => p(`Linked! This family now has ${n} children.`, `जुड़ गए! इस परिवार में अब ${n} बच्चे हैं।`),
    openFamily: p("Open the family", "परिवार खोलें"),
    done: p("Done", "हो गया"),
  },
  unlink: {
    title: (name: string): Pair => p(`Take ${name} out of this family?`, `${name} को इस परिवार से अलग करें?`),
    keeps: (n: number): Pair => p(`The family keeps ${n} children.`, `परिवार में ${n} बच्चे रहेंगे।`),
    ends: (name: string): Pair => p(`Only ${name} would be left, so this family ends. Both children stay in school as before.`, `परिवार में सिर्फ़ ${name} रह जाएँगे, इसलिए यह परिवार खत्म हो जाएगा। दोनों बच्चे पहले की तरह स्कूल में रहेंगे।`),
    leaves: (name: string): Pair => p(`${name} will be in no family.`, `${name} किसी परिवार में नहीं रहेंगे।`),
    save: p("Yes, take out", "हाँ, अलग करें"),
    cancel: p("No, keep", "नहीं, रहने दें"),
    saved: (name: string): Pair => p(`${name} is out of the family.`, `${name} परिवार से अलग हो गए।`),
    savedEnded: p("Done. This family has ended.", "हो गया। यह परिवार खत्म हुआ।"),
  },
  third: {
    title: p("3rd Child Policy", "3rd Child Policy"),
    off: p("No 3rd Child Policy is set for this year, so nobody's fees change for it.", "इस साल 3rd Child Policy सेट नहीं है, इसलिए इसके कारण किसी की फीस नहीं बदलेगी।"),
    needThree: (n: number): Pair => p(`The 3rd Child Policy needs 3 children in school this year. This family will have ${n}, so nobody gets it.`, `3rd Child Policy के लिए इस साल स्कूल में 3 बच्चे चाहिए। इस परिवार में ${n} होंगे, इसलिए किसी को नहीं मिलेगी।`),
    gets: (name: string, cls: string): Pair => p(`${name} (${cls}) will get the 3rd Child Policy.`, `${name} (${cls}) को 3rd Child Policy मिलेगी।`),
    keeps: (name: string): Pair => p(`${name} keeps the 3rd Child Policy.`, `${name} की 3rd Child Policy बनी रहेगी।`),
    tuition: (to: string, from: string): Pair => p(`Tuition ${to} instead of ${from}.`, `ट्यूशन ${from} की जगह ${to}।`),
    tuitionTo: (to: string): Pair => p(`Tuition becomes ${to}.`, `ट्यूशन ${to} होगी।`),
    staff: (name: string): Pair => p(`${name} is a Staff Child and keeps Staff Child, so nobody gets the 3rd Child Policy.`, `${name} स्टाफ़ चाइल्ड हैं और स्टाफ़ चाइल्ड ही रहेंगे, इसलिए किसी को 3rd Child Policy नहीं मिलेगी।`),
    loses: (name: string): Pair => p(`${name} loses the 3rd Child Policy, so ${name}'s fees go up.`, `${name} की 3rd Child Policy हटेगी, इसलिए ${name} की फीस बढ़ेगी।`),
    same: p("Nobody's 3rd Child Policy changes.", "किसी की 3rd Child Policy नहीं बदलेगी।"),
  },
  problem: {
    not_enabled: p("Linking families from One is not switched on yet. Nothing was changed. For now, link them on the child's page in the Fees app.", "One से परिवार जोड़ना अभी चालू नहीं है। कुछ नहीं बदला। अभी Fees ऐप में बच्चे के पेज पर जोड़ें।"),
    read_only: p("One's fee desk is read-only right now. Use the Fees app for this.", "One का फीस डेस्क अभी सिर्फ़ देखने के लिए है। यह Fees ऐप में करें।"),
    signin: p("Please sign in again, then try once more.", "कृपया फिर से साइन इन करें, फिर दोबारा कोशिश करें।"),
    family_changed: p("Someone changed this family just now. Check again to see it as it is now.", "अभी किसी ने यह परिवार बदला है। अभी की स्थिति देखने के लिए फिर से जाँचें।"),
    family_conflict: p("One of these children is in two families already. Ask the office to sort it out in Fees on the child's page.", "इनमें से एक बच्चा पहले से दो परिवारों में है। ऑफ़िस से कहें कि Fees में बच्चे के पेज पर ठीक करें।"),
    not_found: p("A child is not in this year, or is not in this family any more. Close this and search again.", "कोई बच्चा इस साल में नहीं है, या अब इस परिवार में नहीं है। इसे बंद करके फिर खोजें।"),
    unavailable: p("Fees did not answer just now. Wait a minute and try again.", "Fees ने अभी जवाब नहीं दिया। एक मिनट रुककर फिर कोशिश करें।"),
    uncertain: p("We could not hear back whether it saved. Tap Try again: it will not link twice.", "पता नहीं चला कि सेव हुआ या नहीं। ‘फिर कोशिश करें’ दबाएँ: दो बार नहीं जुड़ेगा।"),
    failed: p("This could not be saved. Nothing was changed. Try again.", "यह सेव नहीं हो सका। कुछ नहीं बदला। फिर कोशिश करें।"),
    unsettled: p("The family is saved. The 3rd Child Policy and dues are not worked out yet. Tap Finish to complete it.", "परिवार सेव हो गया। 3rd Child Policy और फीस अभी बननी बाकी है। पूरा करने के लिए ‘पूरा करें’ दबाएँ।"),
    finish: p("Finish", "पूरा करें"),
    retry: p("Try again", "फिर कोशिश करें"),
    checkAgain: p("Check again", "फिर से जाँचें"),
    close: p("Close", "बंद करें"),
  },

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
    change: p("Add a brother or sister links another child. Take out of this family is on each child. You see what changes in fees before anything is saved.", "‘भाई या बहन जोड़ें’ से एक और बच्चा जुड़ता है। ‘इस परिवार से अलग करें’ हर बच्चे पर है। कुछ भी सेव होने से पहले फीस में बदलाव दिखता है।"),
    collect: p("Collect fee opens the Payment Desk with this family's child ready.", "‘फीस जमा करें’ से पेमेंट डेस्क इस परिवार के बच्चे के साथ खुलता है।"),
    open: p("Open child shows that child's full page.", "‘बच्चा खोलें’ से उस बच्चे का पूरा पेज खुलता है।"),
    late: p("The late fee is shown apart. A family that owes only a late fee has its fees paid.", "लेट फीस अलग दिखती है। जिस परिवार पर सिर्फ़ लेट फीस बाकी है, उसकी फीस जमा मानी जाती है।"),
  },
} as const;
