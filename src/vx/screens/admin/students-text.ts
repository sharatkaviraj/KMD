import { p, type Pair } from "@/vx/text";

/**
 * Words for the Students list's views and badges. Pure pairs, like `T` in
 * `./text.ts`; a pair with a value in it is a function. Every badge says a
 * fact, and its detail line says the period and where the fact comes from.
 */
export const ST = {
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
