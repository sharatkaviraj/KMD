import type { DesignView } from "../design.fixture";

import type { Language } from "@/platform/i18n/language";
import type { AttentionChild, ClassToday, DayAttendance, MarksEntry, UpcomingEvent } from "@/vx/screens/academics/data";
import { tally, type AttentionReason, type PaperProgress, type WeekFacts } from "@/vx/screens/academics/domain";
import { AcadHomeView, type AcadHomeProps } from "@/vx/screens/academics/home-view";
import type { ClassDetail, ClassResult, StudentDetail } from "@/vx/screens/academics/data";
import { AcadProgressView, type AcadProgressProps, type HeatStat } from "@/vx/screens/academics/progress-view";

/*
 * The academic coordinator's screens (AcadHome, AcadProgress,
 * AcadAttendance), one view per design frame, filled with the frames' own
 * synthetic records (docs/design-handoff/design/src/Acad*.dc.html). Nothing
 * here reaches a database; the names are the design's made-up ones.
 */

// Sheets render into #vx-layer, which the real shell mounts beside the page.
if (typeof document !== "undefined" && !document.getElementById("vx-layer")) {
  const layer = document.createElement("div");
  layer.id = "vx-layer";
  layer.className = "vxt vx-layer";
  document.body.append(layer);
}

const qp = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const language: Language = qp.get("locale") === "hi" ? "hi" : qp.get("locale") === "hi-en" ? "both" : "en";

const TODAY = "2026-10-08";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/* ------------------------------------------------------------ attendance */

// class · teacher · on roll · present today (-1 = not marked) · marked at
const ATT: [string, string, number, number, string][] = [
  ["Nursery", "Ms. Kanwar", 18, 16, "08:20"],
  ["LKG", "Ms. Rathore", 20, 19, "08:18"],
  ["UKG", "Ms. Mehta", 22, 20, "08:25"],
  ["Class 1", "Ms. Jain", 23, 22, "08:15"],
  ["Class 2", "Ms. Vyas", 25, 24, "08:22"],
  ["Class 3", "Ms. Sharma", 24, 23, "08:19"],
  ["Class 4", "Mr. Verma", 29, 27, "08:31"],
  ["Class 5", "Ms. Paliwal", 26, 25, "08:16"],
  ["Class 6", "Ms. Bhati", 31, 29, "08:12"],
  ["Class 7", "Mr. Choudhary", 27, 25, "08:27"],
  ["Class 8", "Mr. Solanki", 28, 27, "08:24"],
  ["Class 9", "Mr. Meena", 28, -1, ""],
  ["Class 10", "Ms. Dave", 30, 28, "08:14"],
  ["11 Science", "Mr. Trivedi", 22, 21, "08:35"],
  ["11 Commerce", "Mr. Purohit", 18, 17, "08:29"],
  ["11 Arts", "Ms. Chouhan", 14, -1, ""],
  ["12 Science", "Mr. Bhatt", 20, 19, "08:33"],
  ["12 Commerce", "Ms. Kothari", 17, 15, "08:26"],
  ["12 Arts", "Mr. Rawal", 12, 10, "08:40"],
];

const classId = (label: string) => uuid(100 + ATT.findIndex((a) => a[0] === label));
const staffId = (name: string) => uuid(500 + [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7));

const classes: ClassToday[] = ATT.map(([label, teacher, roll, present, at]) => {
  const saved = present >= 0;
  const t = saved ? tally([...Array(present).fill("present"), ...Array(roll - present).fill("absent")]) : tally([]);
  return {
    classId: classId(label),
    label,
    roll,
    teacherId: staffId(teacher),
    teacherName: teacher,
    teacherAway: teacher === "Mr. Meena",
    registerId: saved ? uuid(900 + roll) : null,
    saved,
    savedAt: saved ? `${TODAY}T${at}:00+05:30` : null,
    savedBy: saved ? teacher : null,
    onBehalf: false,
    tally: t,
    pct: saved ? Math.round((present / roll) * 1000) / 10 : null,
  };
});

const savedClasses = classes.filter((c) => c.saved);
const total = savedClasses.reduce((s, c) => ({ ...s, present: s.present + c.tally.present, absent: s.absent + c.tally.absent, counted: s.counted + c.tally.counted, credit: s.credit + c.tally.credit }), tally([]));
const attendance: DayAttendance = {
  day: TODAY,
  classes,
  marked: savedClasses.length,
  total,
  pct: Math.round((total.credit / total.counted) * 1000) / 10,
  notMarked: classes.filter((c) => !c.saved),
  unmarkedChildren: classes.filter((c) => !c.saved).reduce((s, c) => s + c.roll, 0),
  activity: [],
  closed: null,
};

/* ------------------------------------------------------------------ marks */

// teacher · [class, subject, entered, roll]
const LATE: [string, [string, string, number, number][]][] = [
  ["Ms. Kavita Bhati", [["Class 8", "Science", 0, 28], ["Class 7", "Science", 12, 27]]],
  ["Mr. Choudhary", [["Class 6", "SST", 0, 31], ["Class 7", "SST", 0, 27]]],
  ["Ms. Agarwal", [["Class 6", "Computer", 0, 31], ["Class 7", "Computer", 0, 27]]],
  ["Mr. Lohar", [["Class 9", "SST", 0, 28]]],
  ["Ms. Shekhawat", [["11 Science", "Maths / Bio", 0, 22]]],
  ["Mr. Rawal", [["11 Arts", "Geography", 0, 14], ["12 Arts", "Geography", 0, 12]]],
  ["Mr. Meena", [["Class 9", "Science", 12, 28]]],
];
const MK: [string, number][] = [["Nursery", 100], ["LKG", 92], ["UKG", 80], ["Class 1", 90], ["Class 2", 70], ["Class 3", 66], ["Class 4", 72], ["Class 5", 75], ["Class 6", 52], ["Class 7", 44], ["Class 8", 71], ["Class 9", 54], ["Class 10", 100], ["11 Science", 41], ["11 Commerce", 69], ["11 Arts", 58], ["12 Science", 60], ["12 Commerce", 62], ["12 Arts", 48]];

let paperN = 0;
const paper = (cls: string, subject: string, entered: number, roll: number, submitted: boolean, teacher: string | null): PaperProgress => ({ paperId: uuid(2000 + (paperN += 1)), classId: classId(cls), classLabel: cls, subject, entered, roll, submitted, teacherId: teacher ? staffId(teacher) : null });
const latePapers = LATE.flatMap(([t, items]) => items.map(([c, s, e, r]) => paper(c, s, e, r, false, t)));
// 113 class-subjects: 63 submitted, 39 under way, 11 not started (the design's split).
const papers: PaperProgress[] = [
  ...latePapers,
  ...Array.from({ length: 63 }, (_, i) => paper(ATT[i % 19][0], "English", 20, 20, true, null)),
  ...Array.from({ length: 39 - latePapers.filter((p) => p.entered > 0).length }, (_, i) => paper(ATT[i % 19][0], "Hindi", 9, 20, false, null)),
  ...Array.from({ length: 11 - latePapers.filter((p) => p.entered === 0).length }, (_, i) => paper(ATT[i % 19][0], "Sanskrit", 0, 20, false, null)),
];

const entry: MarksEntry = {
  exam: { id: uuid(3001), code: "HY", label: "Half-yearly", labelHi: "अर्धवार्षिक", startsOn: "2026-09-23", endsOn: "2026-10-03", status: "active" },
  dueOn: "2026-10-14",
  pct: 68,
  papers,
  late: LATE.map(([name, items]) => ({
    teacherId: staffId(name),
    name,
    papers: latePapers.filter((p) => p.teacherId === staffId(name)),
    entered: items.reduce((s, x) => s + x[2], 0),
    roll: items.reduce((s, x) => s + x[3], 0),
  })),
  byClass: MK.map(([label, pct]) => ({ classId: classId(label), label, pct, done: Math.round(pct / 12), total: 8 })),
};

/* ---------------------------------------------------------- needs attention */

// name · class · a = attendance %, m = below 33% in, d = dropped points / subject, n = open notes
const KIDS = "Mohit Agarwal|Class 9|m:Maths|d:18/Maths|n:2;Ananya Solanki|11 Science|m:Chemistry|d:21/Chemistry;Vivaan Jain|Class 8|m:Maths|d:15/Maths;Dev Gurjar|Class 7|a:70|m:Hindi;Muskan Meena|12 Arts|a:74|n:2;Aditya Kumawat|Class 9|a:72|m:Sanskrit;Aarav Sharma|Class 7|d:16/Science|n:2;Om Regar|Class 6|a:68;Kabir Rawal|Class 9|m:Maths+Science;Riya Singh|Class 6|m:Maths;Nikhil Meena|Class 6|a:72;Tanya Kumawat|Class 10|m:Science;Harsh Vyas|Class 8|a:73;Sneha Bhati|Class 9|d:17/English;Payal Regar|Class 5|a:71;Rudra Sen|Class 4|m:Maths;Laksh Kothari|11 Commerce|d:19/Economics;Jhanvi Sen|11 Arts|a:69;Parth Chouhan|12 Science|m:Physics;Isha Trivedi|Class 10|n:2;Krish Dave|Class 3|a:70;Yash Purohit|Class 2|a:74;Meera Paliwal|12 Commerce|m:Accountancy"
  .split(";")
  .map((row) => row.split("|"));

const attention: AttentionChild[] = KIDS.map(([name, cls, ...rs], i) => {
  const reasons: AttentionReason[] = [];
  let attendancePct: number | null = null;
  let below33Subjects: string[] = [];
  let dropPoints: number | null = null;
  let dropSubject: string | null = null;
  let openNotes = 0;
  for (const r of rs) {
    const [k, v] = r.split(":");
    if (k === "a") (reasons.push("attendance"), (attendancePct = Number(v)));
    if (k === "m") (reasons.push("below_33"), (below33Subjects = v.split("+")));
    if (k === "d") (reasons.push("dropped"), (dropPoints = Number(v.split("/")[0])), (dropSubject = v.split("/")[1]));
    if (k === "n") (reasons.push("notes"), (openNotes = Number(v)));
  }
  return { studentId: uuid(7000 + i), name, classId: classId(cls), classLabel: cls, reasons, attendancePct, below33Subjects, dropPoints, dropSubject, openNotes, followup: null, plan: null };
});

/* --------------------------------------------------------------- coming up */

const events: UpcomingEvent[] = [
  { id: uuid(8001), kind: "ptm", title: "Results day + PTM", titleHi: "परिणाम दिवस + अभिभावक बैठक", startsOn: "2026-10-17", endsOn: "2026-10-17", startsAt: "10:00:00", place: "Classes 9–10" },
  { id: "day:2026-10-20", kind: "holiday", title: "Dussehra holiday", titleHi: "दशहरा अवकाश", startsOn: "2026-10-20", endsOn: "2026-10-20", startsAt: null, place: null },
  { id: uuid(8003), kind: "exam", title: "Unit Test 2 begins", titleHi: "यूनिट टेस्ट 2 शुरू", startsOn: "2026-12-07", endsOn: "2026-12-12", startsAt: null, place: null },
];

/* -------------------------------------------------------------- the week */

const facts: WeekFacts = {
  coordinator: "Ms. Asha Purohit",
  weekLabel: "2026-10-05",
  attendancePct: 93.8,
  attendanceBefore: 93.1,
  classesAlwaysMarked: 17,
  classes: 19,
  marksPct: 68,
  lateTeachers: 7,
  attention: 23,
  attentionNew: 4,
  notesOpen: 4,
  correctionsMade: 2,
};
const TREND = [91.8, 92.6, 90.9, 92.1, 93.0, 92.2, 93.1, 93.8];
const MONDAYS = ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"];

const base: AcadHomeProps = {
  language,
  mode: "home",
  sheet: null,
  what: "marks",
  who: null,
  marksTab: "late",
  me: { name: "Ms. Asha Purohit" },
  session: "2026–27",
  hello: { en: "Good morning", hi: "सुप्रभात" },
  today: TODAY,
  attendance,
  entry,
  away: [staffId("Mr. Meena")],
  attention,
  attentionNew: 4,
  notes: { open: 4, due: 2, dueOn: "2026-10-12" },
  events,
  marksTemplate: {
    hi: "नमस्ते {{1}},\nअर्धवार्षिक परीक्षा के अंक अभी बाकी हैं: {{2}}।\nकृपया बुधवार 14 अक्टूबर तक VPPS One में भरें।\n— आशा पुरोहित",
    en: "Half-yearly marks are pending for {{2}}. Please enter them by Wed 14 Oct in VPPS One. — Asha Purohit",
  },
  week: {
    monday: "2026-10-05",
    daily: [
      { day: "2026-10-05", pct: 92.9 },
      { day: "2026-10-06", pct: 94.1 },
      { day: "2026-10-07", pct: 94.4 },
      { day: "2026-10-08", pct: 93.6 },
    ],
    trend: MONDAYS.map((monday, i) => ({ monday, pct: TREND[i] })),
    facts,
    improved: [
      { studentId: uuid(7101), name: "Kunal Verma", classLabel: "Class 4", by: "Mr. Verma" },
      { studentId: uuid(7102), name: "Pooja Mehta", classLabel: "11 Commerce", by: "Mr. Purohit" },
      { studentId: uuid(7103), name: "Neha Joshi", classLabel: "Class 8", by: "Mr. Solanki" },
    ],
    help: attention.slice(0, 4),
    papers: { locked: 34, done: 29, inProgress: 39, notStarted: 11 },
    principals: ["Janmejay Singh"],
    lastSent: "2026-10-02T17:10:00+05:30",
  },
  summaryTemplate: {
    hi: "नमस्ते {{1}},\nइस सप्ताह का शैक्षणिक सारांश: {{2}}\n— {{3}}",
    en: "Hello {{1}}, this week's academic summary: {{2}} — {{3}}",
  },
  mayRemind: true,
  notesHref: "/notes",
};

const home = (patch: Partial<AcadHomeProps>, path = "/academics"): DesignView => ({
  menu: "academic",
  path,
  render: () => <AcadHomeView {...base} {...patch} />,
});

/* ---------------------------------------------------------- AcadProgress */

// class · average · change since UT 1 · pass % · attendance (the design's cards)
const CARDS: [string, number, number, number, number][] = [
  ["Nursery", 83, 2, 100, 90], ["LKG", 78, 1, 100, 90], ["UKG", 82, 0, 100, 90], ["Class 1", 81, 2, 100, 93], ["Class 2", 78, 0, 100, 92], ["Class 3", 68, -2, 100, 90],
  ["Class 4", 71, 0, 97, 89], ["Class 5", 70, -2, 100, 91], ["Class 6", 63, 0, 97, 88], ["Class 7", 71, 1, 96, 89], ["Class 8", 66, -3, 96, 89], ["Class 9", 56, -6, 89, 87],
  ["Class 10", 66, 2, 97, 93], ["11 Science", 59, -2, 95, 88], ["11 Commerce", 65, 3, 100, 91], ["11 Arts", 59, 0, 100, 86], ["12 Science", 67, 2, 95, 95], ["12 Commerce", 71, 0, 94, 92], ["12 Arts", 64, -2, 100, 87],
];
const results: ClassResult[] = CARDS.map(([label, avg, d, pass, att]) => ({ classId: classId(label), label, avg, before: avg - d, pass, attendance: att }));
const SUBJECTS: Record<string, string[]> = {
  pre: ["English", "Hindi", "MATHS", "EVS", "Drawing"],
  p15: ["English", "Hindi", "MATHS", "EVS", "SST", "Sanskrit"],
  p68: ["English", "Hindi", "MATHS", "Science", "SST", "Sanskrit"],
  sci: ["Physics", "Chemistry", "Maths / Bio", "English", "Hindi"],
  com: ["Accountancy", "Business St.", "Economics", "English", "Hindi"],
  art: ["History", "Geography", "Political Sci.", "English", "Hindi"],
};
const groupOf = (label: string) => (/^(Nursery|LKG|UKG)$/.test(label) ? "pre" : /^Class [1-5]$/.test(label) ? "p15" : /^Class/.test(label) ? "p68" : label.endsWith("Science") ? "sci" : label.endsWith("Commerce") ? "com" : "art");
const OFFS = [-4, 3, -9, 1, 5, -2];
const heat: HeatStat[] = CARDS.flatMap(([label, avg]) =>
  SUBJECTS[groupOf(label)].map((subject, i) => {
    const waiting = label === "Class 9" && subject === "SST";
    return { classId: classId(label), subject, sortOrder: i, avg: waiting ? null : Math.max(20, Math.min(96, avg + OFFS[i % 6])), entered: waiting ? 0 : 20 };
  }),
);
const UT1 = { id: uuid(3000), code: "UT1", label: "Unit Test 1", labelHi: "यूनिट टेस्ट 1", startsOn: "2026-07-14", endsOn: "2026-07-18", status: "locked" };
const HY = entry.exam!;
const exams = [{ code: "UT1", label: "Unit Test 1" }, { code: "HY", label: "Half-yearly" }];
const progressCommon = { language, today: TODAY, session: "2026–27", exams, exam: exams[1], previous: exams[0], entered: 68, attentionCount: 23, mayManage: true, mayFollow: true, notesHref: "/notes" };

const C9 = ["English", "Hindi", "MATHS", "Science", "SST", "Sanskrit"];
const c9Avg = [56, 62, 49, 55, null, 60];
const c9Kids = ["Tanish Meena", "Kavya Chouhan", "Harsh Trivedi", "Saanvi Sharma", "Yash Mehta", "Mohit Agarwal", "Kabir Rawal", "Aditya Kumawat", "Sneha Bhati", "Riya Kothari", "Arjun Sen", "Diya Purohit"];
const c9Avgs = [76.8, 72.8, 71.2, 71.2, 69.4, 49, 31, 47, 58, 61, 55, 63];
const detail: ClassDetail = {
  classId: classId("Class 9"),
  label: "Class 9",
  roll: 28,
  average: 56,
  pass: 89,
  attendance: 87,
  students: c9Kids.map((name, i) => ({ studentId: uuid(9100 + i), name, rollNo: String(i + 1), avg: Math.round(c9Avgs[i]), before: Math.round(c9Avgs[i]) + 4, failed: i === 6 ? 2 : i === 5 ? 1 : 0, attendance: 87, attention: attention.find((a) => a.name === name) ?? null })),
  subjects: C9.map((subject, i) => ({ subjectId: uuid(9300 + i), subject, avg: c9Avg[i], before: c9Avg[i] === null ? 62 : (c9Avg[i] as number) + 5, pass: 90, entered: subject === "SST" ? 0 : subject === "Science" ? 12 : 28, submitted: subject !== "SST" && subject !== "Science" })),
};
// 140 papers spread 4 / 43 / 81 / 12 / 0, with the design's below-33 names.
const spreadMarks = [
  { studentId: uuid(9106), subject: "MATHS", pct: 23 },
  { studentId: uuid(9105), subject: "MATHS", pct: 28 },
  { studentId: uuid(9106), subject: "Science", pct: 29 },
  { studentId: uuid(9107), subject: "Sanskrit", pct: 31 },
  ...Array.from({ length: 43 }, (_, i) => ({ studentId: uuid(9100 + (i % 12)), subject: "English", pct: 34 + (i % 15) })),
  ...Array.from({ length: 81 }, (_, i) => ({ studentId: uuid(9100 + (i % 12)), subject: "Hindi", pct: 51 + (i % 23) })),
  ...Array.from({ length: 12 }, (_, i) => ({ studentId: uuid(9100 + (i % 12)), subject: "Hindi", pct: 76 + (i % 13) })),
];
const people = { classTeacher: "Mr. Meena", bySubject: Object.fromEntries(C9.map((s, i) => [uuid(9300 + i), ["Ms. Dadhich", "Mr. Saini", "Ms. Dave", "Mr. Meena", "Mr. Lohar", "Mr. Tak"][i]])), locked: false, notes: { total: 9, followUp: 4 } };

const MOHIT: [string, number, number | null][] = [["English", 64, 60], ["Hindi", 72, 70], ["MATHS", 46, 28], ["Science", 58, 49], ["SST", 61, null], ["Sanskrit", 66, 68]];
const mohit: StudentDetail = {
  studentId: uuid(7000),
  name: "Mohit Agarwal",
  father: "Sunil Agarwal",
  phone: "9000000019",
  classId: classId("Class 9"),
  classLabel: "Class 9",
  rollNo: "19",
  attendance: { pct: 83, absent: 13, counted: 78 },
  months: [{ month: "2026-07", pct: 94 }, { month: "2026-08", pct: 88 }, { month: "2026-09", pct: 77 }, { month: "2026-10", pct: 71 }],
  subjects: MOHIT.map(([subject, u, h]) => ({ subject, byExam: new Map<string, number | null>(h === null ? [[UT1.id, u]] : [[UT1.id, u], [HY.id, h]]) })),
  exams: [UT1, HY],
  notes: [
    { id: uuid(9501), body: "Got 22 of 80 in Half-yearly Maths. No homework since September; says algebra is confusing. Follow-up Mon 12 Oct.", kind: "Studies", tone: "info", at: "2026-10-01T10:00:00+05:30", by: "Ms. Dave · Maths teacher", status: "open" },
    { id: uuid(9502), body: "Absent on 4 Mondays in a row. Father says Mohit helps at the shop on market day — called him on Tue 6 Oct.", kind: "Attendance", tone: "concern", at: "2026-09-28T10:00:00+05:30", by: "Mr. Meena · class teacher", status: "working" },
    { id: uuid(9503), body: "Very good in Science practicals — keen in the lab.", kind: "Studies", tone: "good", at: "2026-09-18T10:00:00+05:30", by: "Mr. Meena · Science teacher", status: "done" },
  ],
  plan: {
    id: uuid(9600),
    goal: "Maths above 40% in Unit Test 2 (Mon 7 Dec)",
    status: "draft",
    startedAt: null,
    steps: [
      { id: uuid(9601), text: "Call father about Monday absences", owner: "Mr. Meena", ownerId: staffId("Mr. Meena"), due: "Tue 6 Oct", done: true },
      { id: uuid(9602), text: "Saturday remedial class · Maths", owner: "Ms. Dave", ownerId: staffId("Ms. Dave"), due: "from Sat 10 Oct", done: false },
      { id: uuid(9603), text: "Extra practice sheets twice a week", owner: "Ms. Dave", ownerId: staffId("Ms. Dave"), due: "Mon & Thu", done: false },
      { id: uuid(9604), text: "Parent meeting at PTM", owner: "Mr. Meena", ownerId: staffId("Mr. Meena"), due: "Sat 17 Oct", done: false },
    ],
  },
  followups: [{ kind: "call", outcome: "reached", note: "Mondays", at: "2026-10-06T11:00:00+05:30", by: "Mr. Meena" }],
  facts: { reasons: ["below_33", "dropped", "notes"], attendancePct: 83, below33Subjects: ["MATHS"], dropPoints: 18, dropSubject: "MATHS", openNotes: 2 },
};
const staffChoices = ["Mr. Meena", "Ms. Dave", "Ms. Asha Purohit", "Janmejay Singh"].map((name) => ({ id: staffId(name), name }));
const classRefs = ATT.map(([label, , roll]) => ({ id: classId(label), label, roll }));

const progress = (patch: Partial<AcadProgressProps> & Pick<AcadProgressProps, "view">, path = "/academics/progress"): DesignView => ({
  menu: "academic",
  path,
  render: () => <AcadProgressView {...({ ...progressCommon, ...patch } as AcadProgressProps)} />,
});
const overview = { view: "overview" as const, classes: results, school: { avg: 69, before: 69.5, pass: 97, lowest: { label: "Class 9", pass: 89 }, att: 90 }, stats: heat, group: "junior" as const, attention };
const classView = { view: "class" as const, detail, result: results[11], nav: { prev: classRefs[10], next: classRefs[12], pos: 12, total: 19 }, marks: spreadMarks, people };
const studentView = { view: "student" as const, child: mohit, classTeacher: { name: "Mr. Meena", phone: "9000000512" }, hl: null };
const attentionView = { view: "attention" as const, list: attention, filter: null, staff: staffChoices };
const planView = { view: "plan" as const, child: mohit, staff: staffChoices, suggestions: ["Saturday remedial class · Maths", "Extra practice sheets twice a week", "Parent meeting at PTM", "Peer buddy for daily homework", "Check homework diary every day"], father: "Sunil Agarwal", parentPhone: "9000000019" };
const compareView = { view: "compare" as const, classes: classRefs, a: classRefs[11], b: classRefs[12], results, stats: heat.filter((s) => s.classId === classRefs[11].id || s.classId === classRefs[12].id), attentionBy: { [classRefs[11].id]: 4, [classRefs[12].id]: 2 } };

export const academicViews: Record<string, DesignView> = {
  AcadProgress: progress(overview),
  "DX-AcadProgress-Student": progress(studentView),
  "DX-AcadProgress-Class": progress(classView),
  "DX-AcadProgress-Attention": progress(attentionView),
  "DX-AcadProgress-Plan": progress(planView),
  "M-AcadProgress": progress(overview),
  "M-AcadProgress-Student": progress(studentView),
  "M-AcadProgress-Class": progress(classView),
  "M-AcadProgress-Attention": progress(attentionView),
  "M-AcadProgress-Plan": progress(planView),
  "M-AcadProgress-Compare": progress(compareView),

  AcadHome: home({}),
  "DX-AcadHome-Week": home({ mode: "week" }),
  "DX-AcadHome-Remind": home({ sheet: "remind" }),
  "DX-AcadHome-Dark": home({}),
  "M-AcadHome": home({}),
  "M-AcadHome-Menu": home({ mode: "menu" }),
  "M-AcadHome-Remind": home({ sheet: "remind" }),
  "M-AcadHome-Week": home({ mode: "week" }),
};
