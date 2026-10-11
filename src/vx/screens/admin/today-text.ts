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
  onLeave: p("On leave", "अवकाश पर"),
  combined: p("Combined", "संयुक्त"),
  shared: p("Shared", "साझा"),
  parallel: p("Parallel", "समानांतर"),
  needSubstitute: (n: number): Pair => p(`${n} need${n === 1 ? "s" : ""} a substitute`, `${n} के लिए स्थानापन्न चाहिए`),

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
};
