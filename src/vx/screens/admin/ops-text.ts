import { p, type Pair } from "@/vx/text";

/**
 * Words on Needs you and the attendance board as the design draws them
 * (F02/D03, F11/F12/D04). Pure pairs like `T` in `./text.ts`; a pair with a
 * number in it is a function.
 */

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

export const TO = {
  /* ---------------------------------------------------------- needs you */
  filterByType: p("Filter by type", "प्रकार से छाँटें"),
  waiting: (n: number, oldest: string | null): Pair =>
    n === 0
      ? p("All clear", "सब निपट गया")
      : oldest
        ? p(`${n} waiting · oldest ${oldest}`, `${n} बाकी · सबसे पुराना ${oldest}`)
        : p(`${n} waiting`, `${n} बाकी`),
  allClear: p("All clear", "सब निपट गया"),
  notAllRead: p("Not everything could be read", "सब कुछ पढ़ा नहीं जा सका"),
  allClearSub: p("Nothing in this list is waiting on you.", "इस सूची में आपके लिए कुछ बाकी नहीं।"),
  nothingInFilter: p("Nothing in this filter.", "इस छँटाई में कुछ नहीं।"),
  notMarkedCard: (classes: string): Pair =>
    p(`${classes}. “Not marked” is never counted as present.`, `${classes}। “दर्ज नहीं” को कभी उपस्थित नहीं गिना जाता।`),
  remindOnWhatsApp: p("Remind on WhatsApp", "WhatsApp पर याद दिलाएँ"),
  remindNOnWhatsApp: (n: number): Pair => p(`Remind ${n} class${n === 1 ? "" : "es"} on WhatsApp`, `${n} कक्षाओं को WhatsApp पर याद दिलाएँ`),
  openBoard: p("Open board", "बोर्ड खोलें"),
  openAttendance: p("Open attendance", "हाज़िरी खोलें"),
  otherTeacher: p("Other teacher", "दूसरा शिक्षक"),

  /* --------------------------------------------------------- attendance */
  monthlyRegister: p("Monthly register", "मासिक रजिस्टर"),
  monthRegister: (day: string): Pair => {
    const m = Number(day.slice(5, 7)) - 1;
    return p(`${MONTHS_EN[m] ?? ""} register`.trim(), `${MONTHS_HI[m] ?? ""} रजिस्टर`.trim());
  },
  todayIs: (d: string): Pair => p(`Today · ${d}`, `आज · ${d}`),
  classesStillToMark: (n: number): Pair =>
    n === 0 ? p("Every class is marked", "सभी कक्षाएँ दर्ज") : p(`${n} class${n === 1 ? "" : "es"} still to mark`, `${n} कक्षाएँ अभी बाकी`),
  present: p("Present", "उपस्थित"),
  absent: p("Absent", "अनुपस्थित"),
  halfDay: p("Half day", "आधा दिन"),
  classSize: p("Class size", "कक्षा में"),
  remindClassTeachers: (n: number): Pair =>
    p(`Remind ${n} class teacher${n === 1 ? "" : "s"} on WhatsApp`, `${n} कक्षा-अध्यापकों को WhatsApp पर याद दिलाएँ`),
  classTeacherSub: (name: string): Pair => p(`${name} · class teacher`, `${name} · कक्षा-अध्यापक`),
  onLeaveSub: (name: string): Pair => p(`${name} · away today`, `${name} · आज अनुपस्थित`),
  remindedSub: (name: string, t: string): Pair => p(`${name} · reminded at ${t}`, `${name} · ${t} पर याद दिलाया`),
  allPresentAt: (n: number, t: string): Pair => p(`All ${n} present · ${t}`, `सभी ${n} उपस्थित · ${t}`),
  somePresentAt: (present: number, of: number, half: number, t: string): Pair =>
    p(
      `${present} of ${of} present${half ? ` · ${half} half day` : ""} · ${t}`,
      `${of} में से ${present} उपस्थित${half ? ` · ${half} आधा दिन` : ""} · ${t}`,
    ),
  markIt: p("Mark it", "दर्ज करें"),
  done: p("Done", "हो गया"),
  everyClassMarked: p("Every class has marked attendance today.", "आज हर कक्षा की हाज़िरी दर्ज है।"),
  notMarkedYet: p("Not marked yet", "अभी दर्ज नहीं"),
  hasntMarked: (who: string): Pair => p(`${who} hasn’t marked attendance yet.`, `${who} ने अभी हाज़िरी दर्ज नहीं की।`),
  classTeacher: p("Class teacher", "कक्षा-अध्यापक"),
  studentsN: p("Students", "विद्यार्थी"),
  reminder: p("Reminder", "याद दिलाना"),
  sentAt: (t: string): Pair => p(`Sent ${t}`, `${t} पर भेजा`),
  notSent: p("Not sent", "नहीं भेजा"),
  markYourself: p("Mark it yourself", "खुद दर्ज करें"),
  markedAtFull: (t: string): Pair => p(`Marked at ${t}`, `${t} पर दर्ज`),
  markedBy: (who: string | null): Pair =>
    p(
      `Marked by ${who ?? "the class teacher"}. A change needs a reason and stays in the register's history.`,
      `${who ?? "कक्षा-अध्यापक"} ने दर्ज किया। बदलाव के लिए कारण चाहिए और वह रजिस्टर के इतिहास में रहता है।`,
    ),
  openRegister: p("Open register", "रजिस्टर खोलें"),
  correctIt: p("Correct it", "सुधारें"),
  countsDesk: (present: number, absent: number, half: number): Pair => p(`P ${present} · A ${absent} · Half ${half}`, `P ${present} · A ${absent} · ½ ${half}`),
  submitCounts: (present: number, absent: number): Pair => p(`Submit · ${present} present, ${absent} absent`, `सहेजें · ${present} उपस्थित, ${absent} अनुपस्थित`),
} as const;
