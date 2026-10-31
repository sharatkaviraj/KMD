import { p, type Pair } from "@/vx/text";

/**
 * Words on the admin's Today as it reads around the school day: Scheduled
 * now, teaching exceptions, student support and approvals. Pure pairs like
 * `T` in `./text.ts`; a pair with a number in it is a function.
 */
export const TD = {
  /* ------------------------------------------------------ scheduled now */
  scheduledNow: p("Scheduled now", "अभी निर्धारित"),
  now: p("Now", "अभी"),
  next: p("Next", "अगला"),
  scheduledSub: p("From the published timetable with today's cover — not a record of what was taught", "प्रकाशित समय-सारणी और आज की व्यवस्था से — क्या पढ़ाया गया, इसका रिकॉर्ड नहीं"),
  periodAt: (n: number, starts: string, ends: string): Pair => p(`Period ${n} · ${starts}–${ends}`, `पीरियड ${n} · ${starts}–${ends}`),
  firstPeriodAt: (time: string): Pair => p(`First period at ${time}`, `पहला पीरियड ${time} बजे`),
  breakThenAt: (n: number, time: string): Pair => p(`Break — period ${n} starts at ${time}`, `अवकाश — पीरियड ${n} ${time} बजे`),
  dayFinished: p("School day finished", "स्कूल का दिन समाप्त"),
  lastBellAt: (time: string): Pair => p(`The last bell was at ${time}`, `आख़िरी घंटी ${time} बजे थी`),
  lastPeriod: p("This is the last period of the day", "यह दिन का आख़िरी पीरियड है"),
  noTeachingToday: p("School is open, but the timetable does not run today", "स्कूल खुला है, पर आज समय-सारणी नहीं चलती"),
  noTimetable: p("No published timetable for today", "आज के लिए कोई प्रकाशित समय-सारणी नहीं"),
  nothingThisPeriod: p("Nothing scheduled in this period", "इस पीरियड में कुछ निर्धारित नहीं"),
  fullDay: p("Full timetable", "पूरी समय-सारणी"),
  onLeave: p("Away", "अनुपस्थित"),
  combined: p("Combined", "संयुक्त"),
  shared: p("Shared", "साझा"),
  parallel: p("Parallel", "समानांतर"),
  needSubstitute: (n: number): Pair => p(`${n} need${n === 1 ? "s" : ""} a substitute`, `${n} के लिए स्थानापन्न चाहिए`),
  showAllClasses: (n: number): Pair => p(`Show all ${n} classes`, `सभी ${n} कक्षाएँ दिखाएँ`),
  showFewer: p("Show fewer", "कम दिखाएँ"),
  whichPeriod: p("Which period", "कौन-सा पीरियड"),

  /* ------------------------------------------------- teaching exceptions */
  exceptions: p("Teaching exceptions", "पढ़ाई में बदलाव"),
  noExceptions: p("No changes to today's teaching", "आज की पढ़ाई में कोई बदलाव नहीं"),
  notMarked: p("Not marked", "दर्ज नहीं"),
  coverLine: (n: number, classes: string, subject: string): Pair => p(`Period ${n} · ${classes} ${subject}`, `पीरियड ${n} · ${classes} ${subject}`),
  awayLine: (names: string): Pair => p(`${names} away`, `${names} अवकाश पर`),
  openBoard: p("Open board", "बोर्ड खोलें"),
  arrangeCover: p("Arrange cover", "व्यवस्था करें"),

  /* ---------------------------------------------------- student support */
  support: p("Student support", "विद्यार्थी सहायता"),
  needAction: (n: number): Pair => p(`${n} note${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} action`, `${n} नोट पर कार्रवाई चाहिए`),
  followUpsDue: (n: number): Pair => p(`${n} follow-up${n === 1 ? "" : "s"} due`, `${n} फ़ॉलो-अप बाकी`),
  nothingNeedsAction: p("Nothing needs action", "कुछ भी बाकी नहीं"),
  openNotes: p("Open notes", "नोट खोलें"),

  /* ------------------------------------------------------------ approvals */
  approvals: p("Approvals", "मंज़ूरी"),
  dataChanges: (n: number): Pair => p(`${n} student-data change${n === 1 ? "" : "s"} waiting`, `विद्यार्थी जानकारी के ${n} बदलाव प्रतीक्षा में`),
  noDataChanges: p("No student-data changes waiting", "विद्यार्थी जानकारी का कोई बदलाव प्रतीक्षा में नहीं"),
  reviewChanges: p("Review changes", "बदलाव देखें"),
  moreInInbox: (n: number): Pair => p(`${n} more in the inbox`, `इनबॉक्स में ${n} और`),

  /* -------------------------------------------------------------- money */
  financeToday: p("Fees today", "आज की फ़ीस"),

  /* ------------------------------------------- the design's frames (F01, Desktop) */
  searchEverything: p("Search everything", "सब कुछ खोजें"),
  searchPlaceholder: p("Search students, receipts, pages…", "विद्यार्थी, रसीदें, पेज खोजें…"),
  account: p("Your account and settings", "आपका खाता और सेटिंग्स"),
  newMenu: p("New", "नया"),
  sessionLine: (role: Pair, session: string): Pair => p(`${role.en} · Session ${session}`, `${role.hi ?? role.en} · सत्र ${session}`),
  feesCollectedToday: p("Fees collected today", "आज जमा फ़ीस"),
  otherModes: p("Other", "अन्य"),
  receiptsLine: (n: number): Pair => p(`${n} receipt${n === 1 ? "" : "s"}`, `${n} रसीद`),
  callsSub: (promised: number | null): Pair =>
    promised === null ? p("Pending fees, oldest first", "बकाया फ़ीस, सबसे पुरानी पहले") : p(`Pending fees, oldest first · ${promised} promised today`, `बकाया फ़ीस, सबसे पुरानी पहले · आज ${promised} का वादा`),
  promisedToPay: (n: number): Pair => p(`${n} promised to pay today`, `आज ${n} ने देने का वादा किया`),
  classesNotMarked: (n: number): Pair => p(`${n} class${n === 1 ? "" : "es"} not marked`, `${n} कक्षाएँ दर्ज नहीं`),
  feesCollected: p("Fees collected", "जमा फ़ीस"),
  shouldBeByToday: (n: number): Pair => p(`Should be ${n}% by today`, `आज तक ${n}% होना चाहिए`),
  catchUp: (perDay: string, days: number, month: Pair): Pair =>
    p(`Clearing ${perDay} a day for the remaining ${days} days of ${month.en} closes this gap.`, `${month.hi ?? month.en} के बाकी ${days} दिनों में रोज़ ${perDay} आने से यह अंतर पूरा होगा।`),
  attendanceThisWeek: p("Attendance this week", "इस हफ़्ते की हाज़िरी"),
  presentShare: p("present %", "उपस्थित %"),
  avgPill: (v: string): Pair => p(`avg ${v}`, `औसत ${v}`),
  nothingTaken: p("nothing taken", "कुछ जमा नहीं"),
  sunday: p("Sunday", "रविवार"),
  howTheyPaySub: p("Today · hover a slice", "आज · हिस्से पर रुकें"),
  oldBalance: p("Old", "पुराना"),
  total: p("Total", "कुल"),
  nothingPastDue: p("No installment is past its due date yet.", "अभी कोई किस्त अपनी तारीख़ से आगे नहीं गई।"),
  allClearRail: p("All clear — nothing is waiting on you.", "सब ठीक है — आपके लिए कुछ बाकी नहीं।"),
  allClearSub: p("Nothing is waiting on you right now.", "अभी आपके लिए कुछ बाकी नहीं।"),
  feesUnavailable: p("Fee figures could not be read. Refresh to try again.", "फ़ीस के आँकड़े पढ़े नहीं जा सके। दोबारा कोशिश करें।"),
  weekday: [p("Sun", "रवि"), p("Mon", "सोम"), p("Tue", "मंगल"), p("Wed", "बुध"), p("Thu", "गुरु"), p("Fri", "शुक्र"), p("Sat", "शनि")] as readonly Pair[],
  month: [
    p("January", "जनवरी"), p("February", "फ़रवरी"), p("March", "मार्च"), p("April", "अप्रैल"), p("May", "मई"), p("June", "जून"),
    p("July", "जुलाई"), p("August", "अगस्त"), p("September", "सितंबर"), p("October", "अक्टूबर"), p("November", "नवंबर"), p("December", "दिसंबर"),
  ] as readonly Pair[],
  /** The design's names for the quick actions on a phone (the "+ New" menu keeps the full names). */
  quickShort: { mark: p("Attendance", "हाज़िरी") } as Partial<Record<string, Pair>>,
  /** What each "+ New" item opens, under its name (Desktop.dc.html `newItems`). */
  quickSub: {
    collect: p("Opens the Payment Desk", "फ़ीस काउंटर खुलता है"),
    mark: p("Any class, today", "कोई भी कक्षा, आज"),
    notice: p("WhatsApp to parents or staff", "अभिभावकों या स्टाफ़ को WhatsApp"),
    admit: p("New admission", "नया प्रवेश"),
    cover: p("Cover an absent teacher", "अनुपस्थित शिक्षक की व्यवस्था"),
    note: p("A note on a child", "किसी बच्चे पर नोट"),
  } as Partial<Record<string, Pair>>,
  modeName: {
    upi: p("UPI", "UPI"),
    cash: p("Cash", "नकद"),
    cheque: p("Cheque", "चेक"),
    bank_transfer: p("Bank transfer", "बैंक ट्रांसफ़र"),
    card: p("Card", "कार्ड"),
    // A Razorpay Pay now payment: never "Cash" (fees app #86 / #103).
    online: p("Online (Razorpay)", "ऑनलाइन (Razorpay)"),
  },
};
