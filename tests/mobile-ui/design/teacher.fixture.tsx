import { useEffect, type ReactNode } from "react";

import type { Cell } from "@/vx/screens/exams/domain/entry";
import { MarksSheet, type SheetPhase } from "@/vx/screens/exams/marks-sheet";
import { PublicMarksSheet, PublicPaperList } from "@/vx/screens/exams/public-sheet";
import type { SaveOutcome } from "@/vx/screens/exams/save-types";
import type { SheetPaper } from "@/vx/screens/exams/sheet-data";
import { TeacherPick, TeacherRemarks, type PickCard, type RemarkChild } from "@/vx/screens/exams/teacher-marks";
import type { BoardNote } from "@/vx/screens/notes/domain/notes";
import type { AttendData, ClassData, HomeData, MoreData, StudentData, SubjectData } from "@/vx/screens/teach/data";
import type { Mark } from "@/vx/screens/teach/domain/teach";
import { TeachAttend } from "@/vx/screens/teach/ui/attend";
import { TeachClass, TeachStudent, TeachSubject } from "@/vx/screens/teach/ui/class";
import { TeachHome } from "@/vx/screens/teach/ui/home";
import { TeachMore, type MoreView } from "@/vx/screens/teach/ui/more";

import type { DesignView } from "../design.fixture";

/*
 * The teacher app's frames (design TchHome, TchAttend, TchClass, TchMarks,
 * TchMore) drawn by the production screens with the design's own synthetic
 * sample records: Ms. Kavita Bhati, class teacher of Class 6, Science for 6,
 * 7 and 8, on Thursday 8 October. No database, no sign-in.
 */

const layer = (node: ReactNode) => (
  <>
    {node}
    <div id="vx-layer" className="vxt vx-layer" />
  </>
);

const NAME = "Ms. Kavita Bhati";
const TODAY = "2026-10-08";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C6 = id(906);
const C7 = id(907);
const C8 = id(908);
const SCI = id(501);
const at = (hhmm: string, day = TODAY) => `${day}T${hhmm}:00+05:30`;

/* ------------------------------------------------------------------ Today */

const BELLS = [
  ["08:10", "08:50"], ["08:50", "09:30"], ["09:30", "10:10"], ["10:10", "10:50"],
  ["11:10", "11:50"], ["11:50", "12:30"], ["12:30", "13:10"], ["13:10", "13:50"],
].map(([starts, ends], i) => ({ period: i, number: i + 1, starts, ends }));

const lesson = (i: number, classId: string, classLabel: string) => ({ period: i, number: i + 1, starts: BELLS[i].starts, ends: BELLS[i].ends, subjectCode: "SCI", subjectName: "Science", classLabel, classId, combined: false });

function home(state: "home" | "later"): HomeData {
  const later = state === "later";
  return {
    sessionLabel: "2026-27",
    today: TODAY,
    nowMinutes: later ? 14 * 60 + 5 : 9 * 60 + 48,
    schoolOpen: true,
    published: true,
    myClass: {
      classId: C6,
      classLabel: "Class 6",
      total: 31,
      register: later ? { revision: 1, submittedAt: at("08:52"), present: 29, absent: 2, halfDay: 0, total: 31, alerts: 2 } : null,
    },
    heldCount: 1,
    otherHeld: [],
    periods: [lesson(0, C6, "Class 6"), lesson(1, C8, "Class 8"), lesson(2, C7, "Class 7"), lesson(5, C6, "Class 6")],
    bells: BELLS,
    covers: [
      { id: id(701), period: 4, number: 5, starts: "11:10", ends: "11:50", classLabels: "Class 9", subjectCode: "PHY", subjectName: "Physics", forName: "Mr. Meena", acknowledged: later, askedAt: at("08:20"), reason: "Motion — numericals 4 to 8 on page 112. Please collect the homework copies." },
    ],
    tomorrow: { day: "2026-10-09", first: { number: 1, starts: "08:10", classLabel: "Class 6", subjectName: "Science" } },
    notices: [
      { id: id(801), kind: "notice", title: "PTM for Classes 9–10 on Sat 17 Oct, 10 am", bodyEn: "Half-yearly results will be shown to parents. Class teachers of 9 and 10 meet parents in their rooms; other teachers please help at the gate and in the hall.", bodyHi: "अर्धवार्षिक परिणाम अभिभावकों को दिखाए जाएँगे। कक्षा 9 और 10 के कक्षा अध्यापक अपने कमरों में मिलेंगे; बाकी शिक्षक गेट और हॉल में मदद करें।", createdAt: at("08:10"), fromName: "Janmejay Singh", seen: later },
      { id: id(802), kind: "notice", title: "Enter Half-yearly marks by Wed 14 Oct", bodyEn: "Use your Sampark links. After 14 Oct the links close and report cards are made for the PTM.", bodyHi: "अपने संपर्क लिंक से अंक भरें। 14 अक्टूबर के बाद लिंक बंद हो जाएँगे।", createdAt: at("16:30", "2026-10-07"), fromName: "Janmejay Singh", seen: true },
      { id: id(803), kind: "notice", title: "Dussehra holiday on Tue 20 Oct", bodyEn: "School stays closed. Classes run as usual from Wed 21 Oct.", bodyHi: "स्कूल बंद रहेगा। बुधवार 21 अक्टूबर से कक्षाएँ सामान्य रूप से चलेंगी।", createdAt: at("09:00", "2026-10-05"), fromName: "Janmejay Singh", seen: true },
      { id: id(804), kind: "notice", title: "Staff meeting Fri 9 Oct, 3:30 pm, library", bodyEn: "We will plan PTM duties, Half-yearly results and the Diwali programme.", bodyHi: "PTM की ड्यूटी, अर्धवार्षिक परिणाम और दिवाली कार्यक्रम की योजना बनेगी।", createdAt: at("09:10", "2026-10-05"), fromName: "Janmejay Singh", seen: false },
    ],
    kids: [{ id: id(114), name: "Om Regar", reasons: ["attendance"], attendancePct: 68, detail: "Absent Mon, Tue and Wed · 68% attendance this session" }],
    birthdays: [{ id: id(111), name: "Jiya Kothari", inDays: 0, turning: 11, rollNo: "11", wished: later }],
    followUpsDue: 1,
    reviews: [{ id: id(601), studentId: id(119), studentName: "Riya Singh", body: "finds fractions hard · practice sheets started", followUpOn: "2026-10-12" }],
    subjects: [
      { classId: C6, classLabel: "Class 6", subjectId: SCI, name: "Science", children: 31, mine: true },
      { classId: C7, classLabel: "Class 7", subjectId: SCI, name: "Science", children: 27, mine: false },
      { classId: C8, classLabel: "Class 8", subjectId: SCI, name: "Science", children: 28, mine: false },
    ],
    links: [
      { paperId: id(306), classLabel: "Class 6", subjectCode: "Science", exam: "Half-yearly", entered: 31, total: 31, submitted: false, examId: id(300), maxMarks: 80, url: "https://one.vpps.example/t/marks/synthetic-token" },
      { paperId: id(307), classLabel: "Class 7", subjectCode: "Science", exam: "Half-yearly", entered: 12, total: 27, submitted: false, examId: id(300), maxMarks: 80, url: "https://one.vpps.example/t/marks/synthetic-token" },
      { paperId: id(308), classLabel: "Class 8", subjectCode: "Science", exam: "Half-yearly", entered: 0, total: 28, submitted: false, examId: id(300), maxMarks: 80, url: "https://one.vpps.example/t/marks/synthetic-token" },
    ],
    canMark: true,
  };
}

const homeView = (state: "home" | "later", sheet: string | null, linkFirst?: string): DesignView => ({
  menu: "teacher",
  path: "/teach",
  render: () => {
    const data = home(state);
    if (linkFirst) data.links = [...data.links.filter((l) => l.classLabel === linkFirst), ...data.links.filter((l) => l.classLabel !== linkFirst)];
    return layer(<TeachHome data={data} name={NAME} initialSheet={sheet} school="Shri Veer Patta School" officePhone="0000000000" />);
  },
});

/* ------------------------------------------------------------- Attendance */

const KIDS = ("Aadhya Jain,Aarav Kumawat,Ananya Vyas,Arjun Gurjar,Bhavya Paliwal,Chirag Mehta,Divya Rathore,Gaurav Choudhary,Harshita Dave,Ishaan Purohit," +
  "Jiya Kothari,Kabir Solanki,Khushi Sharma,Om Regar,Manav Joshi,Naina Chouhan,Nikhil Meena,Palak Agarwal,Pari Sen,Pranav Rawal,Riya Singh,Rohan Sharma," +
  "Saanvi Kumawat,Sahil Gurjar,Sneha Vyas,Tanish Jain,Tanya Paliwal,Utkarsh Mehta,Vani Rathore,Yash Dave,Zoya Khan").split(",");
const kidId = (roll: number) => id(100 + roll);
const ROLL = KIDS.map((name, i) => ({ id: kidId(i + 1), name, rollNo: String(i + 1), gender: null, birthday: i + 1 === 11 }));
// October's school days so far: absent and half-day rolls (the design's sample month).
const OCT: Record<number, { a: number[]; h?: number[] }> = { 1: { a: [17, 24] }, 3: { a: [17, 31, 26], h: [7] }, 5: { a: [14] }, 6: { a: [14, 17, 18] }, 7: { a: [14, 19] } };

function attend(saved: boolean): AttendData {
  const days: Record<number, { a: number[]; h?: number[] }> = saved ? { ...OCT, 8: { a: [14, 19] } } : { ...OCT };
  const monthMarks = Object.entries(days).flatMap(([d, v]) =>
    ROLL.map((r, i) => ({ studentId: r.id, day: `2026-10-${String(d).padStart(2, "0")}`, status: (v.a.includes(i + 1) ? "absent" : v.h?.includes(i + 1) ? "half_day" : "present") as Mark })),
  );
  return {
    kind: "class",
    sessionLabel: "2026-27",
    classId: C6,
    classLabel: "Class 6",
    choices: [{ classId: C6, classLabel: "Class 6" }],
    day: TODAY,
    prevDay: "2026-10-07",
    closed: false,
    canSave: true,
    canCorrect: true,
    isOwner: true,
    correctsAny: false,
    onBehalf: false,
    reason: null,
    roll: ROLL,
    registerId: saved ? id(990) : null,
    revision: saved ? 1 : 0,
    saved: saved ? { [kidId(14)]: "absent", [kidId(19)]: "absent" } : {},
    yesterday: { [kidId(14)]: "absent", [kidId(19)]: "absent" },
    receipt: saved ? { savedAt: at("08:52"), actorName: NAME, revision: 1 } : null,
    queuedAlerts: saved ? [kidId(14), kidId(19)] : [],
    month: "2026-10",
    monthMarks,
    closedDays: ["2026-10-02", "2026-10-20"],
  };
}

/** Taps the screen's own controls after it draws, as a teacher would (marking two children absent, pressing Change). */
function Taps({ labels, buttons }: { labels?: string[]; buttons?: string[] }) {
  useEffect(() => {
    const t = window.setTimeout(() => {
      for (const label of labels ?? []) document.querySelector<HTMLButtonElement>(`button[aria-label^="${label},"]`)?.click();
      for (const text of buttons ?? []) [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)?.click();
    }, 60);
    return () => window.clearTimeout(t);
  }, [labels, buttons]);
  return null;
}

const TWO = ["Om Regar", "Pari Sen"];
const attendView = (saved: boolean, opts: { sheet?: string; view?: string; taps?: string[]; buttons?: string[] } = {}): DesignView => ({
  menu: "teacher",
  path: "/teach/attendance",
  render: () =>
    layer(
      <>
        <TeachAttend data={attend(saved)} ownerId="fixture-teacher" initialSheet={opts.sheet ?? null} initialView={opts.view ?? null} school="Shri Veer Patta School" officePhone="0000000000" />
        <Taps labels={opts.taps} buttons={opts.buttons} />
      </>,
    ),
});

/* ------------------------------------------------------- My class & subjects */

const GIRLS = new Set("Aadhya Ananya Bhavya Divya Harshita Jiya Khushi Naina Palak Pari Riya Saanvi Sneha Tanya Vani Zoya".split(" "));
const rnd = (a: number, b: number) => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const ATT: Record<number, number> = { 14: 68, 17: 72 };
const LOWEST: Record<number, { code: string; pct: number }> = { 21: { code: "Maths", pct: 30 }, 20: { code: "Maths", pct: 31 } };
const NOTES_OPEN: Record<number, number> = { 21: 1, 14: 2, 12: 1, 19: 2 };

function classData(): ClassData {
  const children = KIDS.map((name, i) => {
    const roll = i + 1;
    const pct = ATT[roll] ?? Math.round(84 + rnd(roll, 1) * 15);
    const reasons: ("attendance" | "marks" | "notes")[] = [];
    if (pct < 75) reasons.push("attendance");
    if (LOWEST[roll]) reasons.push("marks");
    if ((NOTES_OPEN[roll] ?? 0) >= 2) reasons.push("notes");
    return {
      id: kidId(roll),
      name,
      rollNo: String(roll),
      dateOfBirth: roll === 11 ? "2015-10-08" : roll === 12 ? "2015-10-10" : "2015-03-14",
      gender: GIRLS.has(name.split(" ")[0]) ? "female" : "male",
      attendancePct: pct,
      daysCounted: 30,
      lowestSubject: LOWEST[roll] ?? null,
      openNotes: NOTES_OPEN[roll] ?? 0,
      reasons,
      presentDays: Math.round((pct / 100) * 30),
      papersMissing: roll > 18 ? 1 : 0,
      nextReview: roll === 21 ? "2026-10-12" : null,
    };
  });
  const subj = (code: string, average: number, marked: number, n: number) => ({ subjectId: id(500 + n), code, average, paperId: id(400 + n), paperLabel: "Half-yearly", below33: 1, marked });
  return {
    kind: "class",
    sessionLabel: "2026-27",
    today: TODAY,
    classId: C6,
    classLabel: "Class 6",
    isHeld: true,
    heldClasses: [{ classId: C6, classLabel: "Class 6" }],
    children,
    subjects: [subj("English", 71, 31, 1), subj("Hindi", 74, 31, 2), subj("Maths", 62, 31, 3), subj("Science", 68, 31, 4), subj("Social Science", 70, 31, 5), subj("Sanskrit", 52, 18, 6)],
    classAttendance: 93,
    todayRegister: null,
    birthdays: [
      { id: kidId(11), name: "Jiya Kothari", inDays: 0, turning: 11, rollNo: "11" },
      { id: kidId(12), name: "Kabir Solanki", inDays: 2, turning: 11, rollNo: "12" },
      { id: kidId(29), name: "Vani Rathore", inDays: 6, turning: 11, rollNo: "29" },
    ],
    mySubjects: [
      { classId: C6, classLabel: "Class 6", subjectId: SCI, code: "Science", name: "Science", periods: 10, children: 31, held: true },
      { classId: C7, classLabel: "Class 7", subjectId: SCI, code: "Science", name: "Science", periods: 10, children: 27, held: false },
      { classId: C8, classLabel: "Class 8", subjectId: SCI, code: "Science", name: "Science", periods: 10, children: 28, held: false },
    ],
    links: home("home").links.map((l, i) => (i === 0 ? { ...l, submitted: true } : l)),
    timetable: [
      ["Science", "You", true], ["Maths", "Mr. Verma", false], ["English", "Ms. Dave", false], ["Hindi", "Ms. Paliwal", false],
      ["Social Science", "Mr. Solanki", false], ["Science lab", "You", true], ["Sanskrit", "Mr. Purohit", false], ["Games", "Mr. Gurjar", false],
    ].map(([subjectName, teacher, mine], i) => ({ period: i, number: i + 1, starts: BELLS[i].starts, ends: BELLS[i].ends, subjectName: String(subjectName), teacher: String(teacher), mine: Boolean(mine) })),
    nowMinutes: 9 * 60 + 48,
    published: true,
  };
}

const note = (n: number, body: string, tags: string[], status: "open" | "working" | "done", by: string, createdAt: string, followUpOn: string | null): BoardNote =>
  ({ id: id(700 + n), studentId: kidId(21), studentName: "Riya Singh", classId: C6, classLabel: "Class 6", body, tags, source: "typed", status, visibility: "staff", needsFollowUp: Boolean(followUpOn), followUpOn, followUpOwner: null, followUpStaffId: null, followUpName: null, tellParents: false, writtenBy: id(1), writtenByName: by, authorRelation: null, subjectCode: null, createdAt, replies: 0, planId: null }) as unknown as BoardNote;

function studentData(): StudentData {
  const days = Object.entries(OCT).map(([d]) => ({ day: `2026-10-${String(d).padStart(2, "0")}`, status: "present" as Mark }));
  const sep = Array.from({ length: 30 }, (_, i) => i + 1).filter((d) => new Date(Date.UTC(2026, 8, d)).getUTCDay() !== 0).map((d) => ({ day: `2026-09-${String(d).padStart(2, "0")}`, status: (d === 15 ? "absent" : d === 22 ? "half_day" : "present") as Mark }));
  return {
    id: kidId(21),
    name: "Riya Singh",
    admissionNo: "TEST-0621",
    rollNo: "21",
    classId: C6,
    classLabel: "Class 6",
    fatherName: "Vikram Singh",
    motherName: "Meena Kanwar",
    phone: "9000000327",
    dateOfBirth: "2015-03-14",
    attendance: { percent: 91, counted: 33, present: 30, days: [...sep, ...days] },
    marks: [
      { code: "English", label: "Half-yearly", value: 58, max: 80, absent: false, pct: 73 },
      { code: "Hindi", label: "Half-yearly", value: 61, max: 80, absent: false, pct: 76 },
      { code: "Maths", label: "Half-yearly", value: 24, max: 80, absent: false, pct: 30 },
      { code: "Science", label: "Half-yearly", value: 52, max: 80, absent: false, pct: 65 },
      { code: "Social Science", label: "Half-yearly", value: 49, max: 80, absent: false, pct: 61 },
      { code: "Sanskrit", label: "Half-yearly", value: null, max: 80, absent: false, pct: null },
    ],
    notes: [note(1, "Finds fractions hard; started practice sheets", ["studies"], "working", "Ms. Kavita Bhati", at("10:00", "2026-10-05"), "2026-10-12")],
  };
}

const C7KIDS = "Aarav Sharma,Aditya Mehta,Bhumika Jain,Chetan Kumawat,Deepika Rathore,Dhruv Paliwal,Gunjan Vyas,Hardik Choudhary,Isha Purohit,Jatin Solanki,Kavya Jain,Kritika Dave,Lokesh Gurjar,Muskan Trivedi,Nidhi Chouhan,Nikita Regar,Parth Kothari,Rahul Rawal,Ritika Meena,Sakshi Agarwal,Tushar Joshi,Urvashi Singh,Vansh Kanwar,Vikas Sen,Yamini Bhati,Yuvraj Sharma,Zara Khan".split(",");
function subjectData(): SubjectData {
  const rows = C7KIDS.map((name, i) => {
    const has = i < 12;
    const value = has ? Math.round(30 + rnd(i + 1, 63) * 46) : null;
    return { id: id(300 + i), name, rollNo: String(i + 1), value, absent: false, exempt: false, pct: value === null ? null : Math.round((value / 80) * 100) };
  });
  return { classId: C7, classLabel: "Class 7", subjectCode: "Science", paper: { id: id(307), maxMarks: 80, label: "Half-yearly", entryStatus: "open" }, rows, average: 66 };
}

const classView = (view: "class" | "roster" | "subjects"): DesignView => ({ menu: "teacher", path: "/teach/class", render: () => layer(<TeachClass data={classData()} initialView={view} />) });

/* ------------------------------------------------- Notices, links & more */

const WEEK: Record<string, string> = { Monday: "6-78-687", Tuesday: "76-8-6-7", Wednesday: "8-67-6-6", Thursday: "687--6--", Friday: "67-86-78", Saturday: "8-76-6--" };
function moreData(): MoreData {
  const h = home("home");
  const week = Object.entries(WEEK).flatMap(([day, row]) =>
    row.split("").flatMap((ch, i) => (ch === "-" ? [] : [{ day, period: i, number: i + 1, classLabel: `Class ${ch}`, subjectCode: "Science", starts: BELLS[i].starts, ends: BELLS[i].ends }])),
  );
  return {
    sessionLabel: "2026-27",
    today: TODAY,
    notices: h.notices.map((n, i) => ({ ...n, seen: i === 1 || i === 2 })),
    links: [
      { ...h.links[1] },
      { ...h.links[2] },
      { ...h.links[0], submitted: true },
    ],
    week,
    periodTimes: BELLS.map((b) => ({ number: b.number, starts: b.starts, ends: b.ends })),
    profile: {
      name: NAME,
      email: "kavita.bhati@example.test",
      role: "teacher",
      classes: [{ classId: C6, classLabel: "Class 6", held: true }, { classId: C7, classLabel: "Class 7", held: false }, { classId: C8, classLabel: "Class 8", held: false }],
      subjects: ["Science"],
      largeText: false,
      alerts: { notices: true },
    },
    leave: [
      { id: id(801), from_day: "2026-10-26", to_day: "2026-10-26", span: "first_half", note: "Personal work", status: "asked", created_at: at("10:00", "2026-10-06") },
      { id: id(802), from_day: "2026-09-25", to_day: "2026-09-25", span: "full", note: "Unwell", status: "approved", created_at: at("09:00", "2026-09-24") },
      { id: id(803), from_day: "2026-08-31", to_day: "2026-09-01", span: "full", note: "Family function", status: "approved", created_at: at("09:00", "2026-08-28") },
    ],
    nowMinutes: 9 * 60 + 48,
    classSizes: { [C6]: 31, [C7]: 27, [C8]: 28 },
  };
}
const moreView = (view: MoreView, sheet: string | null = null): DesignView => ({
  menu: "teacher",
  path: "/teach/more",
  render: () => layer(<TeachMore data={moreData()} initialView={view} initialSheet={sheet} makeLink={async () => ({ ok: true })} officePhone="0000000000" />),
});

/* ------------------------------------------------------------------ Marks */

const HY = { en: "Half-yearly", hi: "अर्धवार्षिक" };
const pickCards: PickCard[] = [
  { paperId: id(307), examLabel: HY, classLabel: "Class 7", subjectCode: "Science", maxMarks: 80, entered: 12, total: 27, status: "in_progress", submittedToName: "Mr. Hemant Trivedi" },
  { paperId: id(308), examLabel: HY, classLabel: "Class 8", subjectCode: "Science", maxMarks: 80, entered: 0, total: 28, status: "not_started", submittedToName: "Mr. Hemant Trivedi" },
  { paperId: id(306), examLabel: HY, classLabel: "Class 6", subjectCode: "Science", maxMarks: 80, entered: 31, total: 31, status: "done", submittedToName: "Mr. Hemant Trivedi" },
];
const remarkKids = (): RemarkChild[] =>
  KIDS.map((name, i) => ({
    id: kidId(i + 1),
    name,
    roll: String(i + 1),
    remark: i < 9 ? "Works steadily and is improving in every subject." : null,
    percent: Math.round(55 + rnd(i + 1, 3) * 35),
    attendance: ATT[i + 1] ?? Math.round(84 + rnd(i + 1, 1) * 15),
    suggestions: [
      { text: { en: "Good progress this term. Keep reading every day.", hi: "इस सत्र अच्छी प्रगति। रोज़ पढ़ते रहें।" }, source: "marks", basis: "62%" },
      { text: { en: "Sincere and regular. Needs more practice in Maths.", hi: "नियमित और ईमानदार। गणित में और अभ्यास चाहिए।" }, source: "subjects", basis: "Maths 48%" },
      { text: { en: "Must come to school every day to keep up.", hi: "पढ़ाई में साथ रहने के लिए रोज़ स्कूल आना ज़रूरी है।" }, source: "attendance", basis: "91%" },
    ] as RemarkChild["suggestions"],
  }));

const sheetPaper = (status: "open" | "submitted"): SheetPaper => ({ id: id(307), examId: id(300), examLabel: HY, classId: C7, classLabel: "Class 7", subjectCode: "Science", subjectId: SCI, maxMarks: 80, passMarks: 27, markStep: 0.5, allowExempt: true, entryStatus: status, entryRevision: status === "submitted" ? 3 : 1, submittedAt: status === "submitted" ? at("10:14") : null, submittedBy: status === "submitted" ? NAME : null, examOpen: true, locked: false, dueLabel: "Wed 14 Oct" });
const sheetKids = C7KIDS.map((name, i) => ({ id: id(300 + i), name, roll: String(i + 1), prev: `${Math.round(8 + rnd(i + 1, 21) * 11)}/20`, prevPct: Math.round(40 + rnd(i + 1, 21) * 55) }));
const sheetSaved = (all: boolean): Record<string, Cell> =>
  Object.fromEntries(sheetKids.slice(0, all ? sheetKids.length : 12).map((k, i) => [k.id, i === 5 && !all ? { state: "absent", value: null } : { state: "value", value: Math.round(30 + rnd(i + 1, 63) * 46) }]));
const savedOk = async (): Promise<SaveOutcome> => ({ ok: true, revision: 2, entryStatus: "open", savedAt: at("10:12"), actorName: NAME, changed: 1, counts: null });
const sheetView = (phase: SheetPhase, mode: "list" | "pad", all: boolean): DesignView => ({
  menu: "teacher",
  path: "/teach/marks",
  render: () =>
    layer(
      <MarksSheet
        ownerId="fixture-teacher"
        sessionLabel="2026-27"
        paper={sheetPaper(phase === "sent" ? "submitted" : "open")}
        students={sheetKids}
        saved={sheetSaved(all)}
        coordinatorName="Mr. Hemant Trivedi"
        onSave={savedOk}
        onWithdraw={savedOk}
        initialPhase={phase}
        initialMode={mode}
        crumb="Marks · Half-yearly 2026–27"
        backHref="/teach/marks"
        nextHref={`/teach/marks?paper=${id(308)}`}
        nextLabel="Class 8 Science"
        doneHref="/teach/marks"
        noteHref="/teach/notes?student="
      />,
    ),
});
const pickView: DesignView = { menu: "teacher", path: "/teach/marks", render: () => layer(<TeacherPick cards={pickCards} remarks={[{ classId: C6, classLabel: "Class 6", done: 9, total: 31, examLabel: HY }]} due={{ label: "Wed 14 Oct", daysLeft: 6, results: "Sat 17 Oct (PTM)" }} crumb="Marks · Half-yearly 2026–27" />) };
const remarksView: DesignView = { menu: "teacher", path: "/teach/marks", render: () => layer(<TeacherRemarks classLabel="Class 6" term="T1" examLabel={HY} kids={remarkKids()} save={async () => ({ ok: true })} crumb="Class 6 · report cards · Half-yearly" />) };
const linkView = (view: "entry" | "keypad"): DesignView => ({
  bare: true,
  path: "/t/marks/synthetic-token",
  render: () =>
    layer(
      <div className="vxt" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
        <PublicMarksSheet ownerId="marks-link/fixture" sessionLabel="2026-27" token="synthetic-token" paper={sheetPaper("open")} students={sheetKids} saved={sheetSaved(false)} coordinatorName="Mr. Hemant Trivedi" crumb={`${NAME} · Half-yearly`} view={view} />
      </div>,
    ),
});

export const views: Record<string, DesignView> = {
  TchMarks: pickView,
  "DX-TchMarks-Entry": sheetView("entry", "list", false),
  "DX-TchMarks-Check": sheetView("check", "list", true),
  "DX-TchMarks-Remarks": remarksView,
  "M-TchMarks": pickView,
  "M-TchMarks-Keypad": sheetView("entry", "pad", false),
  "M-TchMarks-Entry": sheetView("entry", "list", false),
  "M-TchMarks-Check": sheetView("check", "list", true),
  "M-TchMarks-Submitted": sheetView("sent", "list", true),
  "M-TchMarks-Remarks": remarksView,
  "MarksLink-Papers": {
    bare: true,
    path: "/t/marks/synthetic-token",
    render: () =>
      layer(
        <div className="vxt" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
          <PublicPaperList token="synthetic-token" school="Shri Veer Patta Senior Secondary School" staffName={NAME} examLabel={HY} papers={pickCards.map((c) => ({ paperId: c.paperId, classLabel: c.classLabel, subjectCode: c.subjectCode, maxMarks: c.maxMarks, entered: c.entered, total: c.total, status: c.status }))} />
        </div>,
      ),
  },
  "MarksLink-Entry": linkView("entry"),
  "MarksLink-Keypad": linkView("keypad"),
  TchMore: moreView("menu"),
  "DX-TchMore-News": moreView("news"),
  "DX-TchMore-Links": moreView("links"),
  "DX-TchMore-Timetable": moreView("timetable"),
  "DX-TchMore-Profile": moreView("profile"),
  "M-TchMore": moreView("menu"),
  "M-TchMore-News": moreView("news"),
  "M-TchMore-Links": moreView("links"),
  "M-TchMore-Timetable": moreView("timetable"),
  "M-TchMore-Leave": moreView("leave", "leave"),
  "M-TchMore-Help": moreView("help"),
  TchClass: classView("class"),
  "DX-TchClass-Roster": classView("roster"),
  "DX-TchClass-Student": { menu: "teacher", path: "/teach/class", render: () => layer(<TeachStudent data={studentData()} initialTab="about" back="/teach/class?view=roster" />) },
  "DX-TchClass-Subject": { menu: "teacher", path: "/teach/class", render: () => layer(<TeachSubject data={subjectData()} />) },
  "M-TchClass": classView("class"),
  "M-TchClass-Roster": classView("roster"),
  "M-TchClass-Student": { menu: "teacher", path: "/teach/class", render: () => layer(<TeachStudent data={studentData()} initialTab="about" back="/teach/class?view=roster" />) },
  "M-TchClass-Subjects": classView("subjects"),
  "M-TchClass-Subject": { menu: "teacher", path: "/teach/class", render: () => layer(<TeachSubject data={subjectData()} />) },
  TchAttend: attendView(false),
  "DX-TchAttend-Save": attendView(false, { sheet: "save", taps: TWO }),
  "DX-TchAttend-Saved": attendView(true),
  "DX-TchAttend-History": attendView(true, { view: "history" }),
  "M-TchAttend": attendView(false),
  "M-TchAttend-Marked2": attendView(false, { taps: TWO }),
  "M-TchAttend-Save": attendView(false, { sheet: "save", taps: TWO }),
  "M-TchAttend-Saved": attendView(true),
  "M-TchAttend-Change": attendView(true, { sheet: "save", buttons: ["Change attendance"] }),
  "M-TchAttend-History": attendView(true, { view: "history" }),
  TchHome: homeView("home", null),
  "DX-TchHome-Later": homeView("later", null),
  "DX-TchHome-Subs": homeView("home", "subs"),
  "DX-TchHome-News": homeView("home", "news"),
  "M-TchHome": homeView("home", null),
  "M-TchHome-Later": homeView("later", null),
  "M-TchHome-Subs": homeView("home", "subs"),
  "M-TchHome-Leave": homeView("home", "leave"),
  "M-TchHome-Link": homeView("home", "link", "Class 7"),
  "M-TchHome-Help": homeView("home", "help"),
};
