import type { DesignView } from "../design.fixture";
import { longDay, schoolToday } from "@/vx/format";
import { AttendanceScreen } from "@/vx/screens/admin/attendance";
import { InboxScreen } from "@/vx/screens/admin/inbox";
import { sortInbox, type ClassBoardRow } from "@/vx/screens/admin/logic";
import { T } from "@/vx/screens/admin/text";
import type { BoardData, InboxItem, SheetData } from "@/vx/screens/admin/types";
import { VxPage } from "@/vx/ui/page";
import { p } from "@/vx/text";

/*
 * Needs you (F02, D03) and the attendance board (F11, F12, D04), drawn with
 * the design's own sample records (App.dc.html / Desktop.dc.html `CLASSES`,
 * `INBOX`, `ROSTER`). Every name is the design's synthetic data.
 *
 * The items are shaped as `loadInbox` builds them, so the words are the
 * loader's where the design's differ. The design's attendance-correction
 * item is gone (D-248: no correction waits for anyone), and the app has no
 * duplicate-record check, so the Students item is a parent's answer to check.
 */

const DAY = "2026-10-08";

/** The design's 19 classes: teacher, roll, present, half day, marked at, teacher on leave. */
const CLASSES: [string, string, number, number | null, number, string, boolean?][] = [
  ["Nursery", "Ms. Kanwar", 18, 17, 0, "08:36"], ["LKG", "Ms. Rathore", 20, 19, 0, "08:38"], ["UKG", "Ms. Mehta", 22, 21, 1, "08:40"],
  ["Class 1", "Ms. Jain", 23, 22, 0, "08:41"], ["Class 2", "Ms. Vyas", 25, 25, 0, "08:39"], ["Class 3", "Ms. Sharma", 24, null, 0, ""],
  ["Class 4", "Mr. Verma", 29, 27, 1, "08:50"], ["Class 5", "Ms. Paliwal", 26, null, 0, ""], ["Class 6", "Ms. Bhati", 31, 30, 0, "08:52"],
  ["Class 7", "Mr. Choudhary", 27, null, 0, ""], ["Class 8", "Mr. Solanki", 28, 26, 1, "08:55"], ["Class 9", "Mr. Meena", 28, null, 0, "", true],
  ["Class 10", "Ms. Dave", 30, 28, 0, "08:47"], ["11 Science", "Mr. Trivedi", 22, 21, 0, "09:02"], ["11 Commerce", "Mr. Purohit", 18, null, 0, ""],
  ["11 Arts", "Ms. Chouhan", 14, 13, 0, "09:05"], ["12 Science", "Mr. Bhatt", 20, 19, 0, "08:58"], ["12 Commerce", "Ms. Kothari", 17, 16, 0, "09:10"],
  ["12 Arts", "Mr. Rawal", 12, 12, 0, "09:12"],
];

const classId = (label: string) => `class-${label.toLowerCase().replace(/\s+/g, "-")}`;

const rows: ClassBoardRow[] = CLASSES.map(([label, teacher, roll, present, half, at, away], rank) => ({
  classId: classId(label),
  label,
  rank,
  teacherId: `t-${rank}`,
  teacherName: teacher,
  roll,
  recorded: present !== null,
  savedAt: present !== null ? `${DAY}T${at}:00+05:30` : null,
  present: present ?? 0,
  absent: present !== null ? roll - present - half : 0,
  halfDay: present !== null ? half : 0,
  other: 0,
  teacherAway: Boolean(away),
  remindedAt: null,
}));

const board: BoardData = {
  day: DAY,
  rows,
  halfDayCredit: 0.5,
  schoolOpen: true,
  bells: [
    { index: 0, starts: "08:30", ends: "09:20" },
    { index: 1, starts: "09:20", ends: "10:00" },
    { index: 2, starts: "10:40", ends: "11:20" },
  ],
};

const ROSTER = ["Aditya Sharma", "Bhavna Kumawat", "Chetan Jain", "Deepika Rathore", "Farhan Khan", "Gaurav Mehta", "Harshita Joshi", "Imran Qureshi", "Jyoti Paliwal", "Karan Singh", "Lata Verma", "Manish Agarwal", "Naina Purohit", "Om Prakash", "Priya Sharma", "Rahul Dave", "Sakshi Bhati", "Tarun Vyas", "Usha Kanwar", "Vikram Solanki", "Yash Trivedi", "Zoya Ali", "Ankit Kothari", "Bhumi Chouhan", "Dev Rawal", "Esha Bhatt", "Hemant Jain", "Kavya Mehta"];

/** Class 9 with nothing saved yet: the panel opens with everyone present (RULES C, UI-22). */
const class9: SheetData = {
  classId: classId("Class 9"),
  label: "Class 9",
  day: DAY,
  roll: ROSTER.map((fullName, i) => ({ studentId: `stu-${i + 1}`, fullName, rollNo: String(i + 1) })),
  saved: {},
  revision: 0,
  teacherName: "Mr. Meena",
  teacherAway: true,
  savedBy: null,
  savedAt: null,
};

const dayLine = `${longDay(DAY)} · ${T.periodRunning(2).en}`;

/** `default`: the desk's panel opens on Class 9 by itself; `explicit`: Class 9 was tapped (the phone's sheet opens). */
function Board({ focus }: { focus: "explicit" | "default" }) {
  return (
    <VxPage label="Attendance">
      <AttendanceScreen board={board} sheet={class9} focus={focus} filter={null} dayLine={dayLine} previewing={false} canMark />
    </VxPage>
  );
}

/* --------------------------------------------------------------- Needs you */

// "Today 9:20", "Yesterday": the screen says when relative to now, so the times are today's.
const today = schoolToday();
const at = (daysAgo: number, time: string) => {
  const d = new Date(`${today}T${time}:00+05:30`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
};
const amount = (n: number) => `₹${new Intl.NumberFormat("en-IN").format(n)}`;
const notMarked = rows.filter((r) => !r.recorded);

const items: InboxItem[] = sortInbox([
  {
    id: `not-marked:${DAY}`,
    type: "attendance",
    kind: "not_marked",
    at: at(0, "09:20"),
    urgent: true,
    badge: T.bAttendance,
    title: T.notMarkedTitle(notMarked.length),
    sub: p("Period 1 ends 09:20", "पीरियड 1 09:20 पर ख़त्म"),
    body: T.notMarkedBody,
    facts: [
      { label: T.classes, value: notMarked.map((r) => r.label).join(", ") },
      { label: T.teacherOnLeave, value: "Class 9 · Mr. Meena" },
    ],
    href: "/attendance?f=pending",
    classIds: notMarked.map((r) => r.classId),
    remindable: 4,
    day: DAY,
  },
  {
    id: "cover:need-p3-c9",
    type: "timetable",
    kind: "cover",
    at: at(0, "08:05"),
    urgent: true,
    badge: T.bCover,
    title: T.coverTitle(3, "Class 9", "Physics"),
    sub: T.coverSub("Mr. Meena", 2),
    body: T.coverBody("Mr. Meena", 2),
    facts: [
      { label: T.period, value: "3 · 10:40 – 11:20" },
      { label: T.onLeave, value: "Mr. Meena" },
      { label: T.freeThen, value: "Ms. Bhati, Mr. Verma" },
      { label: T.onAssign, value: T.onAssignValue.en },
    ],
    footnote: T.coverFootnote,
    href: `/substitutions?day=${DAY}`,
    needKey: "need-p3-c9",
    day: DAY,
    dayRevision: 4,
    candidates: [
      { id: "t-bhati", name: "Ms. Bhati", detail: "4 periods today", free: true },
      { id: "t-verma", name: "Mr. Verma", detail: "5 periods today · 1 covers this month", free: true },
      { id: "t-dave", name: "Ms. Dave", detail: "6 periods today", free: false },
    ],
  },
  {
    id: "refund:ref-1",
    type: "money",
    kind: "refund",
    at: at(1, "15:10"),
    urgent: false,
    badge: T.bRefund,
    title: T.refundTitle(amount(2500), "Aman K."),
    sub: p("Transport fee · left in September"),
    facts: [
      { label: p("Amount", "राशि"), value: amount(2500) },
      { label: T.reason, value: "Transport fee · left in September" },
    ],
    footnote: T.refundFootnote,
    href: "/fees/finance-controls",
  },
  {
    id: "refund:wo-1",
    type: "money",
    kind: "refund",
    at: at(1, "12:40"),
    urgent: false,
    badge: p("Write-off", "माफ़ी"),
    title: p(`Write off ${amount(1200)} · Neha Joshi`, `${amount(1200)} माफ़ · Neha Joshi`),
    sub: p("Old balance · hardship"),
    facts: [
      { label: p("Amount", "राशि"), value: amount(1200) },
      { label: T.reason, value: "Old balance · hardship" },
    ],
    footnote: p("Decided on the receipt or dues screen; nothing moves until you confirm it there.", "फ़ैसला रसीद या बकाया स्क्रीन पर होता है; वहाँ पुष्टि के बिना कुछ नहीं बदलता।"),
    href: "/dues",
  },
  {
    id: "submission:sub-1",
    type: "students",
    kind: "submission",
    at: at(3, "11:00"),
    urgent: false,
    badge: T.bSubmission,
    title: p("Father's phone · Kunal Verma", "पिता का फ़ोन · Kunal Verma"),
    sub: T.submissionSub("Class 4", "Mr. Verma"),
    facts: [
      { label: T.was, value: "98••• ••187" },
      { label: T.becomes, value: "94••• ••210" },
      { label: T.change, value: "Changed" },
    ],
    href: "/collection/review",
    submissionIds: ["sub-1"],
  },
]);

const scope = { accountId: "design-admin", sessionLabel: "2026-27", day: DAY };

function Inbox() {
  return (
    <VxPage label="Needs you">
      <InboxScreen items={items} initial="cover:need-p3-c9" previewing={false} unavailable={false} scope={scope} />
    </VxPage>
  );
}

export const views: Record<string, DesignView> = {
  "F02-NeedsYou": { render: () => <Inbox />, path: "/inbox" },
  "D03-NeedsYou": { render: () => <Inbox />, path: "/inbox" },
  "F11-Attendance": { render: () => <Board focus="default" />, path: "/attendance" },
  "F12-MarkAttendance": { render: () => <Board focus="explicit" />, path: "/attendance" },
  "D04-Attendance": { render: () => <Board focus="default" />, path: "/attendance" },
};
