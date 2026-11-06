import { cleanFromPath } from "@/platform/fees-bridge/not-in-one";
import { p, type Pair } from "@/vx/text";

/** What a screen One does not have yet is called, from the path the person asked for. */
const TOPICS: readonly { match: (path: string) => boolean; name: Pair }[] = [
  { match: (x) => x === "/reports" || x.startsWith("/reports/") || x.startsWith("/fees/reports") || x.startsWith("/fees/exports"), name: p("Fee reports and exports", "फीस रिपोर्ट और एक्सपोर्ट") },
  { match: (x) => x === "/reminders" || x.startsWith("/reminders/") || x.startsWith("/fees/reminders"), name: p("Fee reminders", "फीस रिमाइंडर") },
  { match: (x) => x.startsWith("/accounts/") || x.startsWith("/fees/finance-controls"), name: p("Books, refunds and finance controls", "बही, रिफ़ंड और वित्त नियंत्रण") },
  { match: (x) => x === "/student-tools" || x.startsWith("/student-tools/"), name: p("Student tools", "विद्यार्थी टूल") },
  { match: (x) => x === "/admissions/new" || x.startsWith("/fees/students/new"), name: p("Adding a new student", "नया विद्यार्थी जोड़ना") },
  { match: (x) => /^\/admissions\/[0-9a-f-]{36}$/.test(x) || /^\/fees\/students\/[^/]+\/edit/.test(x), name: p("Editing a student's record or photo", "विद्यार्थी का रिकॉर्ड या फ़ोटो बदलना") },
  { match: (x) => /^\/receipts\/[^/]+\/.+/.test(x) || x.startsWith("/fees/receipts"), name: p("Reversing or sending a receipt", "रसीद रद्द करना या भेजना") },
  { match: (x) => x === "/receipts", name: p("Receipts and day book", "रसीदें और दिन का हिसाब") },
  { match: (x) => x.startsWith("/dues/"), name: p("The dues call sheet", "बकाया कॉल शीट") },
  { match: (x) => x.startsWith("/fee-setup/"), name: p("This fee setup screen", "यह फीस सेटअप स्क्रीन") },
  { match: (x) => x.startsWith("/fees/master-data") || x.startsWith("/fees/settings"), name: p("Fee settings and master data", "फीस सेटिंग और मूल डेटा") },
];
const ANY = p("This Fees screen", "यह Fees स्क्रीन");

export function notInOneTopic(from: string | null | undefined): Pair {
  const path = cleanFromPath(from);
  return TOPICS.find((t) => t.match(path))?.name ?? ANY;
}

