import type { DesignView } from "../design.fixture";

import type { Language } from "@/platform/i18n/language";
import type { AttentionChild, ClassToday, DayAttendance, MarksEntry, UpcomingEvent } from "@/vx/screens/academics/data";
import { tally, type AttentionReason, type PaperProgress, type WeekFacts } from "@/vx/screens/academics/domain";
import { AcadHomeView, type AcadHomeProps } from "@/vx/screens/academics/home-view";

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

export const academicViews: Record<string, DesignView> = {
  AcadHome: home({}),
  "DX-AcadHome-Week": home({ mode: "week" }),
  "DX-AcadHome-Remind": home({ sheet: "remind" }),
  "DX-AcadHome-Dark": home({}),
  "M-AcadHome": home({}),
  "M-AcadHome-Menu": home({ mode: "menu" }),
  "M-AcadHome-Remind": home({ sheet: "remind" }),
  "M-AcadHome-Week": home({ mode: "week" }),
};
