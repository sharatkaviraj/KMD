import type { ReactNode } from "react";

import { LoginForm } from "@/app/login/login-form";
import { LoginScreen } from "@/app/login/login-screen";
import type { Language } from "@/platform/i18n/language";
import { TodayScreen, type TodayProps } from "@/vx/screens/admin/today";
import { DeniedScreen } from "@/vx/screens/system/denied";
import { NotFoundScreen } from "@/vx/screens/system/not-found";
import { OfflineStrip } from "@/vx/screens/system/offline-banner";
import { PasswordScreen } from "@/vx/screens/system/password-screen";
import { ExpiredSheet } from "@/vx/screens/system/expired-sheet";
import { SessionScreen } from "@/vx/screens/system/session-screen";
import { UpdateToast } from "@/vx/screens/system/update-banner";
import type { SettingsData } from "@/vx/screens/settings/data";
import type { SettingsState } from "@/vx/screens/settings/domain/settings";
import { SettingsScreen } from "@/vx/screens/settings/settings-screen";
import type { MessagesData } from "@/vx/screens/messages/data";
import { MessagesScreen, type MessagesState } from "@/vx/screens/messages/messages-screen";
import { Section, TopBar, VxPage } from "@/vx/ui/page";

import type { DesignView } from "../design.fixture";
import { aiSettingsData } from "./ai-settings";

/*
 * Design fidelity views for Messages, Settings and Sign-in & app states
 * (design modules `Messages`, `Settings`, `Auth`). One view per frame, keyed
 * by the frame's name; the records copy the frame's sample data, which is
 * synthetic. Nothing here reaches a database.
 */

const params = new URLSearchParams(location.search);
const language: Language = params.get("locale") === "hi" ? "hi" : params.get("locale") === "hi-en" ? "both" : "en";

/** Sheets portal into `#vx-layer`, which the real shell mounts; the fixture's shell does not. */
function Layer({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <div id="vx-layer" className="vxt vx-layer" />
    </>
  );
}

/* ---------------------------------------------------------------- Auth */

const today: TodayProps = {
  firstName: "Janmejay",
  greeting: { en: "Good afternoon", hi: "नमस्कार" },
  dayLine: "Thu 8 Oct · 434 students · Half-yearly marks in progress",
  status: null,
  today: "2026-10-08",
  money: {
    today: 38400,
    receiptsToday: 14,
    days: [{ date: "2026-10-08", amount: 38400 }, { date: "2026-10-07", amount: 29100 }],
    modes: [{ mode: "upi", amount: 24400, receipts: 9 }, { mode: "cash", amount: 14000, receipts: 5 }],
    matrix: [],
    installments: [],
    expected: 1860000,
    collected: 1220000,
    dueSoFar: 1860000,
    followUps: 6,
  },
  moneyFailed: false,
  attendance: { marked: 17, total: 19, percent: 92, schoolOpen: true },
  staffAway: 1,
  cover: { needed: 2, arranged: 1, missed: 0 },
  inbox: [],
  timeline: [],
  schedule: null,
  scheduleFailed: false,
  exceptions: { notMarked: ["Class 9", "12 Arts"], cover: [] },
  support: null,
  actions: [],
  links: { collect: true, reports: true, attendance: true, substitutions: true, review: true, timetable: true },
  unavailable: false,
};

const todayPage = () => <TodayScreen {...today} />;

const people = [
  { id: "js", initials: "JS", name: "Janmejay Singh", role: { en: "Admin", hi: "प्रशासक" }, phoneShown: "98290 ••512", callHref: "tel:+910000000000" },
  { id: "ns", initials: "NS", name: "Ms. Neelam Sharma", role: { en: "Accountant", hi: "लेखाकार" }, phoneShown: "98290 ••207", callHref: "tel:+910000000000" },
];

const sessions = [
  { label: "2026-27", current: true, status: "active" },
  { label: "2025-26", current: false, status: "closed" },
];
const roles = [
  { menu: "teacher", label: { en: "Teacher", hi: "अध्यापक" }, home: "/teach" },
  { menu: "accountant", label: { en: "Accounts", hi: "लेखा" }, home: "/accounts" },
  { menu: "academic", label: { en: "Academics", hi: "शैक्षणिक" }, home: "/academics" },
  { menu: "exam", label: { en: "Exams", hi: "परीक्षा" }, home: "/exam-office" },
];

const notFoundLinks = [
  { label: { en: "Receipts & day close", hi: "रसीदें" }, icon: "receipt" as const, href: "/receipts" },
  { label: { en: "Dues & calls", hi: "बकाया" }, icon: "phone" as const, href: "/dues" },
  { label: { en: "Reports", hi: "रिपोर्ट" }, icon: "chart" as const, href: "/reports" },
  { label: { en: "Exams & marks", hi: "परीक्षा" }, icon: "clipboard" as const, href: "/exams" },
  { label: { en: "Messages", hi: "संदेश" }, icon: "megaphone" as const, href: "/messages" },
  { label: { en: "Settings", hi: "सेटिंग्स" }, icon: "settings" as const, href: "/settings" },
];

const signIn = (initial?: Parameters<typeof LoginForm>[0]["initial"]) => (
  <LoginScreen language={language}>
    <LoginForm language={language} initial={initial} />
  </LoginScreen>
);

const wrongPassword = { status: "error" as const, message: { en: "That email and password do not match an account.", hi: "ईमेल या पासवर्ड गलत है।" } };

const authViews: Record<string, DesignView> = {
  Auth: { render: () => signIn(), bare: true },
  "M-Auth": { render: () => signIn(), bare: true },
  "M-Auth-Error": { render: () => signIn(wrongPassword), bare: true },
  "M-Auth-Password": {
    render: () => <PasswordScreen language={language} temporary phone="9829000512" initial={{ current: "Temp4821", next: "amet2026" }} />,
    path: "/preferences/password",
  },
  "M-Auth-Session": {
    render: () => <SessionScreen language={language} name="Janmejay" sessions={sessions} viewing="2026-27" roles={roles} previewing={null} home="/" />,
    path: "/preferences/session",
  },
  "M-Auth-Update": {
    render: () => (
      <>
        {todayPage()}
        <UpdateToast onUpdate={() => undefined} onLater={() => undefined} />
      </>
    ),
    path: "/",
  },
  "DX-Auth-Offline": {
    render: () => (
      <>
        <OfflineStrip offline onRetry={() => undefined} />
        {todayPage()}
      </>
    ),
    path: "/",
  },
  "DX-Auth-Denied": {
    render: () => (
      <VxPage>
        <TopBar crumb="No access" title="You can't open this page" mSub="Not open for this account" mBack="/" />
        <main>
          <Section>
            <DeniedScreen
              language={language}
              me={{ name: "Office desk", role: { en: "Fee Collector", hi: "वसूली कर्मी" } }}
              roles={[{ en: "Admin", hi: "प्रशासक" }, { en: "Accountant", hi: "लेखाकार" }]}
              people={people}
              permission="fees:setup"
              home="/accounts"
              requestHref="https://wa.me/910000000000"
            />
          </Section>
        </main>
      </VxPage>
    ),
    path: "/fee-setup",
  },
  "DX-Auth-Expired": {
    render: () => (
      <Layer>
        {todayPage()}
        <ExpiredSheet open who={{ name: "Janmejay Singh", at: "2026-10-08T07:52:00+05:30" }} href="/login?reason=expired&next=%2F" />
      </Layer>
    ),
    path: "/",
  },
  "auth-notfound": {
    render: () => (
      <VxPage>
        <TopBar title="Page not found" mSub="An old or broken link" mBack="/" />
        <main>
          <Section>
            <NotFoundScreen language={language} links={notFoundLinks} home="/" />
          </Section>
        </main>
      </VxPage>
    ),
    path: "/",
  },
};

/* ------------------------------------------------------------ Settings */

/** An instant `days` ago at `hh:mm` school time. */
function at(days: number, hhmm: string): string {
  const d = new Date(Date.now() - days * 86_400_000);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  return new Date(`${ymd}T${hhmm}:00+05:30`).toISOString();
}
const dayOf = (days: number) => at(days, "12:00").slice(0, 10);
const MB = 1024 * 1024;

const CLASS_ROWS: [string, string, number][] = [
  ["Nursery", "Ms. Kanwar", 18], ["LKG", "Ms. Rathore", 20], ["UKG", "Ms. Mehta", 22], ["Class 1", "Ms. Jain", 23], ["Class 2", "Ms. Vyas", 25],
  ["Class 3", "Ms. Sharma", 24], ["Class 4", "Mr. Verma", 29], ["Class 5", "Ms. Paliwal", 26], ["Class 6", "Ms. Bhati", 31], ["Class 7", "Mr. Choudhary", 27],
  ["Class 8", "Mr. Solanki", 28], ["Class 9", "Mr. Meena", 28], ["Class 10", "Ms. Dave", 30], ["11 Science", "Mr. Trivedi", 22], ["11 Commerce", "Mr. Purohit", 18],
  ["11 Arts", "Ms. Chouhan", 14], ["12 Science", "Mr. Bhatt", 20], ["12 Commerce", "Ms. Kothari", 17], ["12 Arts", "Mr. Rawal", 12],
];

const settingsData: SettingsData = {
  profile: {
    nameEn: "Shri Veer Patta Sr. Sec. School",
    nameHi: "श्री वीर पत्ता सीनियर सेकेंडरी स्कूल",
    address: "Near Bus Stand, Amet\nDistrict Rajsamand, Rajasthan 313332",
    affiliation: "RBSE-0457",
    phone: "98290 00512",
    footer: "जमा की गई फीस वापस नहीं होगी। रसीद संभाल कर रखें।\nFees once paid are not refunded. Please keep this receipt safe.",
    logo: null,
    signature: null,
  },
  profileChangedAt: at(6, "10:00"),
  profileChangedBy: "Janmejay",
  prefs: { largeText: false, alerts: { day_not_closed: true, big_payment: true, absent_teacher: true, parent_reply: false } },
  sessionLabel: "2026-27",
  sessions: ["2026-27", "2025-26", "2024-25", "2023-24"],
  staffCount: 14,
  roleCount: 7,
  activity: [
    { id: "a1", at: at(0, "15:12"), who: "Janmejay Singh", area: "settings", text: "turned on the “Day not closed by 6 pm” alert", changes: [{ field: "Alert", before: "Off", after: "On" }] },
    { id: "a2", at: at(0, "13:05"), who: "Ms. Neelam Sharma", area: "money", text: "reversed receipt R-0399 · wrong student", changes: [{ field: "R-0399 · Rudra Singh", before: "₹3,000 paid", after: "Reversed" }, { field: "Money moved to", before: "—", after: "R-0400 · Manvi Joshi" }] },
    { id: "a3", at: at(0, "12:20"), who: "Mr. Meena", area: "marks", text: "entered Half-yearly marks · Class 9 Science", changes: [{ field: "Marks entered", before: "0 of 28", after: "28 of 28" }] },
    { id: "a4", at: at(0, "11:02"), who: "Janmejay Singh", area: "students", text: "changed Aarav Sharma’s bus route", changes: [{ field: "Route", before: "Route 2 · Kelwa", after: "Route 3 · Railmagra" }] },
    { id: "a5", at: at(0, "10:38"), who: "Office desk", area: "money", text: "made receipt R-0417 · Pooja Mehta", changes: [{ field: "Amount", before: "—", after: "₹4,350" }] },
    { id: "a6", at: at(0, "08:01"), who: "Office desk", area: "signin", text: "signed in", changes: [] },
    { id: "a7", at: at(1, "17:06"), who: "Janmejay Singh", area: "money", text: "closed the day", changes: [{ field: "Cash counted", before: "—", after: "₹7,600 · matched" }] },
    { id: "a8", at: at(1, "16:15"), who: "Ms. Dave", area: "students", text: "updated Aarti Kumawat’s mother’s phone", changes: [] },
  ],
  backups: [212, 211, 210, 210, 208, 208, 207, 206, 205, 204, 204, 203, 201, 200].map((size, i) => ({ day: dayOf(i), files: 9, bytes: size * MB })),
  archives: [
    { id: "00000000-0000-4000-8000-0000000000a1", label: "Backup today", sessionLabel: "2026-27", status: "ready", tableCount: 42, rowCount: 18230, objectCount: 210, totalBytes: 212 * MB, schemaVersion: null, appCommit: null, error: null, createdAt: at(0, "02:00"), createdByName: "Janmejay Singh", lastDrill: null },
    { id: "00000000-0000-4000-8000-0000000000a2", label: "Backup yesterday", sessionLabel: "2026-27", status: "ready", tableCount: 42, rowCount: 18110, objectCount: 208, totalBytes: 211 * MB, schemaVersion: null, appCommit: null, error: null, createdAt: at(1, "02:00"), createdByName: "Janmejay Singh", lastDrill: null },
    { id: "00000000-0000-4000-8000-0000000000a3", label: "2024-25 year end", sessionLabel: "2024-25", status: "ready", tableCount: 40, rowCount: 16000, objectCount: 190, totalBytes: 1100 * MB, schemaVersion: null, appCommit: null, error: null, createdAt: at(190, "02:00"), createdByName: "Janmejay Singh", lastDrill: null },
  ],
  jobs: [],
  master: {
    classes: CLASS_ROWS.map(([label, teacher, students], i) => ({ id: `c${i}`, label, students, classTeacher: teacher })),
    subjects: ["English", "Hindi", "Maths", "Science", "Social Science", "Sanskrit", "Physics", "Chemistry", "Biology", "Accountancy", "Economics", "Geography"].map((name, i) => ({ id: `s${i}`, code: name.slice(0, 3).toUpperCase(), name, active: true })),
    houses: [{ name: "Bhamashah", students: 109 }, { name: "Meera", students: 109 }, { name: "Panna", students: 108 }, { name: "Pratap", students: 108 }],
    paymentModes: [{ mode: "cash", receipts: 812 }, { mode: "upi", receipts: 640 }, { mode: "cheque", receipts: 41 }, { mode: "bank_transfer", receipts: 22 }],
    holidays: [{ day: "2026-10-20", label: "Dussehra" }, { day: "2026-11-07", label: "Diwali break" }],
  },
  integrations: [
    { key: "aisensy", name: "AiSensy WhatsApp", sub: "Messages and receipts to parents", status: "on", facts: [["API key", "Set"], ["Parent sending", "By hand from To send"], ["Templates", "14 ready · 2 waiting"], ["Cost", "about ₹0.88 a message"]], href: "/messages?view=templates" },
    { key: "sampark", name: "Sampark links", sub: "Collection and marks without a login", status: "on", facts: [["Links made", "23"]], href: "/collection" },
    { key: "backups", name: "Nightly backup", sub: "Fee records copied every night", status: "on", facts: [["Schedule", "Every night"], ["Last copy", dayOf(0)]], href: "/settings?s=backups" },
    { key: "jobs", name: "Scheduled jobs", sub: "Registers, reminders and summaries", status: "on", facts: [["open registers", "ok · today"], ["daily summary", "ok · yesterday"]], href: "/jobs" },
  ],
  me: { name: "Janmejay Singh", role: { en: "Admin", hi: "प्रशासक" } },
};

const settings = (state: SettingsState): DesignView => ({ render: () => <Layer><SettingsScreen data={settingsData} state={state} /></Layer>, path: "/settings" });

const settingsViews: Record<string, DesignView> = {
  Settings: settings("home"),
  "M-Settings": settings("home"),
  "DX-Settings-Activity": settings("activity"),
  "DX-Settings-Backups": settings("backups"),
  "DX-Settings-Master": settings("master"),
  "M-Settings-Prefs": settings("prefs"),
  "M-Settings-Restore": settings("restore"),
  "M-Settings-Integrations": settings("integrations"),
  "M-Settings-Glossary": settings("glossary"),
  "settings-session": settings("session"),
  // Settings → AI helper (D-501): `&v=` is ignored here, so each view has its own entry.
  "DX-Settings-AI": { render: () => <Layer><SettingsScreen data={settingsData} state="ai" ai={aiSettingsData} aiView="used" /></Layer>, path: "/settings" },
  "DX-Settings-AI-How": { render: () => <Layer><SettingsScreen data={settingsData} state="ai" ai={aiSettingsData} aiView="how" /></Layer>, path: "/settings" },
  "DX-Settings-AI-Cost": { render: () => <Layer><SettingsScreen data={settingsData} state="ai" ai={aiSettingsData} aiView="cost" /></Layer>, path: "/settings" },
  "DX-Settings-AI-Switches": { render: () => <Layer><SettingsScreen data={settingsData} state="ai" ai={aiSettingsData} aiView="switches" /></Layer>, path: "/settings" },
};

/* ------------------------------------------------------------ Messages */

type Kind = "notice" | "holiday" | "ptm" | "fee" | "result" | "staff";
const campaign = (id: string, kind: Kind, title: string, audienceLabel: string, n: number, daysAgo: number, hhmm: string, sent: number, failed: number, hi = "", en = "", status = "queued"): MessagesData["campaigns"][number] => ({
  id, kind, title, bodyHi: hi, bodyEn: en, language: hi ? "both" : "en", audience: kind === "staff" ? "staff" : "school", audienceLabel, recipientCount: n,
  costPaise: n * 88, status, createdAt: at(daysAgo, hhmm), createdBy: "Janmejay Singh",
  counts: { total: n, sent, failed, queued: n - sent - failed, cancelled: 0 },
});
const M1 = "00000000-0000-4000-8000-0000000000b1";
const campaigns = [
  campaign(M1, "ptm", "Half-yearly results and PTM on Sat 17 Oct", "All parents", 434, 2, "10:00", 421, 13, "प्रिय अभिभावक, अर्धवार्षिक परिणाम शनिवार, 17 अक्टूबर की PTM में मिलेगा। नर्सरी–कक्षा 9: सुबह 9 बजे, कक्षा 10–12: दोपहर 12 बजे। कृपया अवश्य पधारें।", "Dear parent, half-yearly results will be given at the PTM on Sat 17 Oct: 9 am for Nursery to Class 9, 12 pm for Classes 10 to 12. Please do come."),
  campaign("c2", "staff", "Staff meeting · Sat 10 Oct, 2 pm", "All staff", 38, 1, "17:10", 38, 0),
  campaign("c3", "ptm", "PTM · Class 10 · Sat 17 Oct, 12 pm", "Class 10 parents", 30, 2, "10:05", 29, 1),
  campaign("c4", "fee", "Installment 2 pending · gentle reminder", "Parents with Installment 2 pending", 138, 3, "18:30", 136, 2),
  campaign("c5", "staff", "Marks entry · your Sampark link", "Subject teachers", 31, 9, "18:00", 31, 0),
  campaign("c6", "notice", "Sports day volunteers needed", "Classes 9–12 parents", 161, 11, "11:20", 158, 3),
  campaign("c7", "holiday", "Gandhi Jayanti holiday · Fri 2 Oct", "All parents", 434, 13, "16:00", 425, 9),
  campaign("c8", "result", "Class 12 practical marks published", "Class 12 parents", 49, 15, "15:00", 49, 0),
  campaign("c9", "notice", "Half-yearly datesheet", "Classes 6–12 parents", 247, 25, "17:00", 244, 3),
];
const PEOPLE: [string, string, string, string][] = [["Rakesh Sharma", "Aarav", "Class 7", "512"], ["Prakash Joshi", "Neha", "Class 8", "208"], ["Sunita Kumawat", "Aarti", "Class 10", "771"], ["Hemraj Regar", "Lakshya", "Class 5", "093"], ["Dinesh Mehta", "Pooja", "11 Commerce", "445"], ["Gopal Paliwal", "Tanvi", "LKG", "630"], ["Sanjay Verma", "Kunal", "Class 4", "317"], ["Bhawani Gurjar", "Ritu", "Class 2", "859"], ["Ajay Rathore", "Ishita", "12 Science", "902"], ["Kamal Mehta", "Yash", "Class 9", "266"]];

const messagesData: MessagesData = {
  sessionLabel: "2026-27",
  campaigns,
  classes: CLASS_ROWS.map(([label, , students], i) => ({ id: `c${i}`, label, families: students })),
  classSets: Array.from({ length: 434 }, (_, i) => [`c${i % 19}`]),
  staffCount: 38,
  noPhone: 0,
  sample: { parent: "Rakesh Sharma", student: "Aarav", className: "Class 7" },
  templates: [
    { id: "t1", code: "ptm_invite", label: "PTM invitation", bodyHi: "प्रिय {parent}, {student} ({class}) की अभिभावक-शिक्षक बैठक {date} को है।", bodyEn: "Dear {parent}, the PTM for {student} ({class}) is on {date}.", audience: "parent", isActive: true, waCategory: "utility" },
    { id: "t2", code: "fee_gentle", label: "Fee reminder · gentle", bodyHi: "प्रिय {parent}, {student} की किस्त ({amount}) देय है।", bodyEn: "Dear {parent}, an installment for {student} ({amount}) is due.", audience: "parent", isActive: true, waCategory: "utility" },
    { id: "t3", code: "holiday_notice", label: "Holiday notice", bodyHi: "प्रिय अभिभावक, {date} को विद्यालय बंद रहेगा।", bodyEn: "Dear parent, school is closed on {date}.", audience: "parent", isActive: false, waCategory: "utility" },
    { id: "t4", code: "diwali_greeting", label: "Diwali greeting", bodyHi: "दीपावली की शुभकामनाएँ।", bodyEn: "Happy Diwali from the school.", audience: "parent", isActive: false, waCategory: "marketing" },
  ],
  replies: [
    { id: "r1", fromName: "Rakesh Sharma", phone: "98290 ••512", studentLabel: "Aarav Sharma · Class 7", studentId: "s1", regarding: campaigns[0].title, campaignTitle: campaigns[0].title, campaignBody: campaigns[0].bodyHi, body: "सर, PTM में 11 बजे के बाद आ सकते हैं क्या? सुबह खेत पर काम है।", receivedAt: at(0, "10:42"), assignedStaffId: null, status: "open", answers: [] },
    { id: "r2", fromName: "Prakash Joshi", phone: "98290 ••208", studentLabel: "Neha · Class 8 and Rohit · Class 5", studentId: "s2", regarding: campaigns[0].title, campaignTitle: null, campaignBody: null, body: "दोनों बच्चों का रिज़ल्ट कार्ड एक साथ ले सकते हैं क्या?", receivedAt: at(0, "09:58"), assignedStaffId: "st1", status: "open", answers: [] },
    { id: "r3", fromName: "Sunita Kumawat", phone: "98290 ••771", studentLabel: "Aarti Kumawat · Class 10", studentId: "s3", regarding: "PTM · Class 10 · Sat 17 Oct, 12 pm", campaignTitle: null, campaignBody: null, body: "क्या PTM में बोर्ड परीक्षा की तैयारी पर बात होगी? मैं ज़रूर आऊँगी।", receivedAt: at(0, "09:30"), assignedStaffId: "st2", status: "open", answers: [] },
    { id: "r4", fromName: "Ajay Rathore", phone: "98290 ••902", studentLabel: "Ishita Rathore · 12 Science", studentId: "s4", regarding: campaigns[0].title, campaignTitle: null, campaignBody: null, body: "Ishita will be away on the 17th for a family wedding. Can I meet the teacher on Friday instead?", receivedAt: at(1, "18:00"), assignedStaffId: null, status: "open", answers: [] },
    { id: "r5", fromName: "Mahesh Meena", phone: "98290 ••118", studentLabel: "Kavita Meena · Class 6", studentId: "s5", regarding: "Installment 2 pending · gentle reminder", campaignTitle: null, campaignBody: null, body: "Fees UPI se bhar di hai, receipt bhej dijiye.", receivedAt: at(1, "16:00"), assignedStaffId: "st3", status: "open", answers: [] },
    { id: "r6", fromName: "Dinesh Mehta", phone: "98290 ••445", studentLabel: "Pooja Mehta · 11 Commerce", studentId: "s6", regarding: "Half-yearly datesheet", campaignTitle: null, campaignBody: null, body: "The datesheet PDF does not open on my phone. Please send it again.", receivedAt: at(3, "12:00"), assignedStaffId: null, status: "open", answers: [] },
  ],
  staffChoices: [{ id: "st1", name: "Mr. Solanki" }, { id: "st2", name: "Ms. Dave" }, { id: "st3", name: "Office desk" }],
  parentDispatchOn: false,
  month: { count: 1284, costPaise: 113000, queued: 13, sent: 1250 },
  detail: {
    campaign: campaigns[0],
    recipients: PEOPLE.map(([name, child, cls, last], i) => ({ id: `rc${i}`, name, about: `${child} · ${cls}`, phone: `98290 ••${last}`, status: i === 0 ? "failed" : "sent", error: i === 0 ? "Not on WhatsApp" : null, at: at(2, `10:${String(12 + i * 4).padStart(2, "0")}`) })),
  },
};

const draft = {
  title: "Unit Test 2 datesheet",
  hi: "प्रिय {parent}, {student} ({class}) की इकाई परीक्षा-2 सोमवार, 7 दिसंबर से शुरू होगी। समय-सारणी साथ में भेजी गई है।",
  en: "Dear {parent}, Unit Test 2 for {student} ({class}) starts on Mon 7 Dec. The datesheet is attached.",
};
const base: MessagesState = { view: "sent", compose: false, step: "write", id: null, progress: false, done: false, sheet: null, replyId: null };
const messages = (state: Partial<MessagesState>, menu?: DesignView["menu"]): DesignView => ({
  render: () => (
    <Layer>
      <MessagesScreen data={messagesData} state={{ ...base, ...state }} outbox={null} outboxCount={4} draft={draft} />
    </Layer>
  ),
  path: "/messages",
  menu,
});

const messageViews: Record<string, DesignView> = {
  Messages: messages({}),
  "M-Messages": messages({}),
  "EX-Messages": messages({}, "exam"),
  "MEX-Messages": messages({}, "exam"),
  "DX-Messages-Detail": messages({ id: M1 }),
  "DX-Messages-Compose": messages({ compose: true }),
  "M-Messages-Compose": messages({ compose: true }),
  "M-Messages-Preview": messages({ compose: true, step: "preview" }),
  "M-Messages-Sending": messages({ id: M1, progress: true }),
  "M-Messages-Templates": messages({ view: "templates", sheet: "template-new" }),
  "DX-Messages-Replies": messages({ view: "replies" }),
};

export const views: Record<string, DesignView> = {
  ...authViews,
  ...settingsViews,
  ...messageViews,
};
