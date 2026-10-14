import { p, type Pair } from "@/vx/text";

/**
 * Words for the Students list's views and badges. Pure pairs, like `T` in
 * `./text.ts`; a pair with a value in it is a function. Every badge says a
 * fact, and its detail line says the period and where the fact comes from.
 */
export const ST = {
  /* the list as the design draws it (F05/D01) */
  search: p("Name, SR no., class or parent", "नाम, SR नं., कक्षा या अभिभावक"),
  searchPhone: p("Name, SR no. or class", "नाम, SR नं. या कक्षा"),
  searchLabel: p("Search students", "विद्यार्थी खोजें"),
  showing: (n: number): Pair => p(`Showing ${n}`, `${n} दिख रहे`),
  showingOf: (n: number, total: number): Pair => p(`Showing ${n} of ${total}`, `${total} में से ${n} दिख रहे`),
  /** "Showing 12 of 12 students" on one page, "Showing 51–100 of 583 students" on more. */
  footer: (a: number, b: number, total: number): Pair => {
    const span = a <= 1 && b >= total ? `${total}` : `${a}–${b}`;
    return p(
      `Showing ${span} of ${total} students · click a name for Student 360 · click a column to sort`,
      `${total} में से ${span} विद्यार्थी · Student 360 के लिए नाम दबाएँ · क्रम के लिए कॉलम दबाएँ`,
    );
  },
  colPendingToday: p("Pending today", "आज तक बकाया"),
  colNotDueYet: p("Not due yet", "अभी देय नहीं"),
  sortBy: (col: string): Pair => p(`Sort by ${col}`, `${col} से क्रम`),
  sortOnePage: p("Money columns sort when the list fits one page: pick a chip or type a class first.", "पैसे वाले कॉलम का क्रम तब बदलता है जब सूची एक पेज में आए: पहले कोई चिप चुनें या कक्षा लिखें।"),
  pendingToday: p("pending today", "आज तक बकाया"),
  paidUp: p("Paid up", "पूरा जमा"),
  yearClear: p("year clear", "साल की फ़ीस पूरी"),
  onTrack: p("On track", "समय पर"),
  later: (amount: string): Pair => p(`${amount} later`, `${amount} बाद में`),
  swipeHint: p("Swipe a row left for Call · WhatsApp · Collect", "फ़ोन · WhatsApp · फ़ीस के लिए पंक्ति बाएँ खिसकाएँ"),
  swipeHintNoCollect: p("Swipe a row left for Call · WhatsApp", "फ़ोन · WhatsApp के लिए पंक्ति बाएँ खिसकाएँ"),
  clearClass: (label: string): Pair => p(`${label} · clear`, `${label} · हटाएँ`),
  exportList: (n: number): Pair => p(`Export these ${n}`, `ये ${n} निर्यात करें`),
  callParent: (who: string): Pair => p(`Call ${who}`, `${who} को फ़ोन`),
  whatsappParent: (who: string): Pair => p(`WhatsApp ${who}`, `${who} को WhatsApp`),
  collectFrom: (name: string): Pair => p(`Collect fee from ${name}`, `${name} की फ़ीस लें`),
  noMatchDesign: p("No student matches. Try an SR no., a class or a parent's name.", "कोई विद्यार्थी नहीं मिला। SR नं., कक्षा या अभिभावक का नाम लिखें।"),

  views: p("View", "दृश्य"),
  viewSchool: p("School", "स्कूल"),
  viewFees: p("Fees", "फ़ीस"),
  colAttendance: p("Attendance", "हाज़िरी"),
  colDetails: p("Details", "विवरण"),
  noAttendance: p("No attendance yet", "अभी हाज़िरी नहीं"),
  attendanceDays: (present: string, counted: number): Pair => p(`${present}/${counted} days`, `${counted} में से ${present} दिन`),
  attendancePct: (pct: number): Pair => p(`${pct}% this session`, `इस सत्र ${pct}%`),
  moreDetails: (n: number): Pair => p(`+${n} details`, `+${n} विवरण`),
  lessDetails: p("Hide details", "विवरण छिपाएँ"),

  /* badges: the short label */
  bAttendance: (present: string, counted: number): Pair => p(`Attendance ${present}/${counted} days`, `हाज़िरी ${counted} में से ${present} दिन`),
  bSiblings: (n: number): Pair => p(`${n} sibling${n === 1 ? "" : "s"}`, `${n} भाई-बहन`),
  bNew: p("New this year", "इस साल नए"),
  bRoute: (route: string): Pair => p(`Bus · ${route}`, `बस · ${route}`),
  bYearClear: p("Year clear", "साल की फ़ीस पूरी"),
  bEmi: p("EMI plan", "EMI योजना"),
  bEmiDue: p("EMI due", "EMI देय"),
  bEmiBehind: p("EMI missed", "EMI छूटी"),
  bEmiDone: p("EMI complete", "EMI पूरी"),
  bConcession: (label: string): Pair => p(`Concession · ${label}`, `छूट · ${label}`),

  /* badges: the detail line (period · reason · source) */
  dAttendance: (session: string, pct: number | null): Pair =>
    p(
      `Session ${session}${pct === null ? "" : `, ${pct}%`} · submitted daily registers; leave not counted`,
      `सत्र ${session}${pct === null ? "" : `, ${pct}%`} · जमा हुए दैनिक रजिस्टर से; छुट्टी नहीं गिनी`,
    ),
  dSiblings: p("Linked family in the fee records", "फ़ीस रिकॉर्ड में जुड़ा परिवार"),
  dNew: (session: string): Pair => p(`Session ${session} · new-admission fee tier in the fee records`, `सत्र ${session} · फ़ीस रिकॉर्ड में नए प्रवेश की श्रेणी`),
  dRoute: p("Transport route in the fee profile", "फ़ीस प्रोफ़ाइल में परिवहन रूट"),
  dYearClear: (session: string): Pair => p(`Session ${session} · nothing left to pay · fee records`, `सत्र ${session} · कुछ बाकी नहीं · फ़ीस रिकॉर्ड`),
  dEmi: (monthly: string, next: string | null): Pair =>
    p(
      `${monthly} a month${next ? `, next due ${next}` : ""} · active repayment plan`,
      `${monthly} प्रति माह${next ? `, अगली किस्त ${next}` : ""} · चालू भुगतान योजना`,
    ),
  dEmiBehind: p("An EMI whose date has passed is unpaid", "तारीख़ बीत चुकी एक EMI जमा नहीं हुई"),
  dConcession: p("Fee concession policy · office only", "फ़ीस छूट नीति · केवल कार्यालय"),
};
