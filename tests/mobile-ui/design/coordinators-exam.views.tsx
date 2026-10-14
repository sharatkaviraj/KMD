import type { DesignView } from "../design.fixture";

import { ExamHome, type HomeView, type NextExamView, type ResultsExamView, type TimelineItem } from "@/vx/screens/exams/office-home";
import { PlanBoard, type PlanProps } from "@/vx/screens/exams/plan-board";
import type { TeacherRowView } from "@/vx/screens/exams/remind";
import { ResultsBoard, type ResultsProps } from "@/vx/screens/exams/results-board";
import type { ActionResult } from "@/vx/screens/exams/save-types";

/*
 * The exam coordinator's three screens (ExamHome, ExamPlan, ExamResults),
 * one view per design frame, with the frames' own synthetic records.
 */

const ok = async (): Promise<ActionResult> => ({ ok: true, message: { en: "Done", hi: "हो गया" } });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/* ------------------------------------------------------------ ExamHome */

const results: ResultsExamView = {
  id: "exam-hy",
  name: { en: "Half-yearly", hi: "अर्धवार्षिक" },
  dates: "Wed 23 Sept – Sat 3 Oct",
  percent: 68,
  entered: 4120,
  total: 6060,
  teachersDone: 24,
  teachersTotal: 31,
  lateCount: 7,
  dueLabel: "Wed 14 Oct",
  daysToDue: 6,
  resultsLabel: "Sat 17 Oct",
  daysToResults: 9,
  ptmAt: "10:00",
  bands: [
    { key: "pre", label: { en: "Pre-primary", hi: "पूर्व-प्राथमिक" }, percent: 96 },
    { key: "c1_5", label: { en: "Classes 1–5", hi: "कक्षा 1–5" }, percent: 71 },
    { key: "c6_8", label: { en: "Classes 6–8", hi: "कक्षा 6–8" }, percent: 74 },
    { key: "c9_10", label: { en: "Classes 9–10", hi: "कक्षा 9–10" }, percent: 55 },
    { key: "c11_12", label: { en: "Classes 11–12", hi: "कक्षा 11–12" }, percent: 58 },
  ],
};

const step = (key: NextExamView["steps"][number]["key"], state: "done" | "doing" | "todo", dueLabel: string | null, daysLeft: number | null, extra: Partial<NextExamView["steps"][number]> = {}): NextExamView["steps"][number] => ({
  key,
  state,
  part: state === "done" ? 1 : 0,
  progress: null,
  dueOn: null,
  owner: "you",
  canTick: state !== "done" && key !== "created",
  dueLabel,
  daysLeft,
  ...extra,
});

const next: NextExamView = {
  id: "exam-ut2",
  name: { en: "Unit Test 2", hi: "यूनिट टेस्ट 2" },
  dates: "Mon 7 – Sat 12 Dec",
  daysLeft: 60,
  copiedFrom: "last year’s Unit Test 2",
  slots: 38,
  papersReceived: 4,
  steps: [
    step("created", "done", "Mon 5 Oct", 0),
    step("datesheet", "doing", "Fri 30 Oct", 22, { part: 0.5, progress: "draft" }),
    step("parents", "todo", "Mon 2 Nov", 25),
    step("seating", "todo", "Fri 20 Nov", 43),
    step("duties", "todo", "Fri 20 Nov", 43),
    step("papers", "doing", "Mon 23 Nov", 46, { owner: "teachers", part: 0.105, progress: "4/38", canTick: false }),
    step("admit", "todo", "Thu 3 Dec", 56, { owner: "office" }),
  ],
  readiness: { percent: 23, done: 1, underWay: 2 },
};

type Paper = TeacherRowView["papers"][number];
const paper = (id: string, classLabel: string, subjectCode: string, entered: number, total: number): Paper => ({
  paperId: id,
  classLabel,
  subjectCode,
  entered,
  total,
  status: entered >= total ? "done" : entered ? "in_progress" : "not_started",
});
const teacher = (id: string, name: string, phoneMasked: string, papers: Paper[], openedMinutesAgo: number | null, remindedAt: string | null = null): TeacherRowView => {
  const entered = papers.reduce((a, x) => a + x.entered, 0);
  const total = papers.reduce((a, x) => a + x.total, 0);
  return {
    id,
    name,
    phone: "9000000000",
    phoneMasked,
    papers,
    entered,
    total,
    late: true,
    notStarted: entered === 0,
    link: openedMinutesAgo === null ? null : { url: `https://vpps.one/s/${id}`, createdAt: minutesAgo(40_000), openedAt: openedMinutesAgo < 0 ? null : minutesAgo(openedMinutesAgo) },
    remindedAt,
  };
};

const teachers: TeacherRowView[] = [
  teacher("t-lohar", "Mr. Lohar", "98290 ••726", [paper("p3", "Class 9", "Social Sci.", 0, 28), paper("p4", "Class 10", "Social Sci.", 0, 30)], null),
  teacher("t-sen", "Mr. Sen", "98290 ••907", [paper("p1", "Class 4", "Computer", 0, 29), paper("p2", "Class 5", "Computer", 0, 26)], -1),
  teacher("t-sanadhya", "Mr. Sanadhya", "98290 ••641", [paper("p9", "11 Commerce", "Hindi", 6, 18), paper("p10", "12 Commerce", "Hindi", 0, 17)], 720),
  teacher("t-meena", "Mr. Meena", "98290 ••512", [paper("p5", "Class 9", "Science", 12, 28), paper("p6", "Class 10", "Science", 0, 30)], 840),
  teacher("t-shek", "Ms. Shekhawat", "98290 ••455", [paper("p7", "11 Science", "Chemistry", 0, 22), paper("p8", "12 Science", "Chemistry", 9, 20)], 3000),
  teacher("t-bhati", "Ms. Bhati", "98290 ••318", [paper("p11", "Class 6", "Science", 31, 31), paper("p12", "Class 7", "Science", 12, 27), paper("p13", "Class 8", "Science", 0, 28)], 90),
  teacher("t-mewara", "Ms. Mewara", "98290 ••283", [paper("p14", "11 Arts", "Political Sci.", 6, 14), paper("p15", "12 Arts", "Political Sci.", 8, 12)], 106),
];

const timeline: TimelineItem[] = [
  { id: "exam-ut1", name: { en: "Unit Test 1", hi: "यूनिट टेस्ट 1" }, when: "14–18 Jul", state: "done", doneOn: "4 Aug" },
  { id: "exam-hy", name: { en: "Half-yearly", hi: "अर्धवार्षिक" }, when: "23 Sep – 3 Oct", state: "now", resultsOn: "17 Oct" },
  { id: "exam-ut2", name: { en: "Unit Test 2", hi: "यूनिट टेस्ट 2" }, when: "7–12 Dec", state: "next" },
  { id: "exam-annual", name: { en: "Annual exam", hi: "वार्षिक परीक्षा" }, when: "Mar 2027", state: "later" },
];

const activity = [
  { id: "a1", text: { en: "Ms. Dave locked Class 10 Maths" }, at: minutesAgo(1), kind: "locked" },
  { id: "a2", text: { en: "Ms. Mewara entered 6 marks · 11 Arts" }, at: minutesAgo(106), kind: "submitted" },
  { id: "a3", text: { en: "3 question papers came in · Classes 6–8 English" }, at: minutesAgo(1500), kind: "papers" },
  { id: "a4", text: { en: "You copied last year’s UT2 date sheet as a draft" }, at: minutesAgo(4500), kind: "datesheet" },
  { id: "a5", text: { en: "You created Unit Test 2 · 7–12 Dec" }, at: minutesAgo(4510), kind: "created" },
];

const home = (view: HomeView): DesignView => ({
  menu: "exam",
  path: "/exam-office",
  render: () => (
    <ExamHome
      view={view}
      hello="Good morning"
      staffName="Mr. Hemant Trivedi"
      staffPhone="98290 ••260"
      sessionLabel="2026–27"
      todayLabel="Thu 8 Oct"
      results={results}
      next={next}
      teachers={teachers}
      timeline={timeline}
      activity={activity}
      remind={ok}
      logCall={ok}
      markStep={ok}
    />
  ),
});

/* ------------------------------------------------------------ ExamPlan */

const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DEC = ["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12"];
const DEC_LABEL = ["Mon 7", "Tue 8", "Wed 9", "Thu 10", "Fri 11", "Sat 12"];
type GK = "pre" | "c1_5" | "c6_8" | "c9_10" | "c11_12";
const SHEET: [GK, string, number, (string | null)[]][] = [
  ["pre", "09:00", 45, ["English", "Hindi", "Maths", "EVS", "Drawing", null]],
  ["c1_5", "08:30", 60, ["English", "Hindi", "Maths", "EVS", "Sanskrit", "Computer"]],
  ["c6_8", "08:30", 90, ["Science", "English", "Maths", "Hindi", "Social Sci.", "Sanskrit"]],
  ["c9_10", "08:30", 90, ["English", "Hindi", "Social Sci.", "Maths", "Sanskrit", null]],
  ["c11_12", "08:30", 90, ["English", "Physics · Accounts · History", "Hindi · Hindi Lit.", "Chemistry · Business · Geography", "Maths/Bio · Economics · Pol. Sci.", null]],
];
let slotN = 0;
const planSlots = SHEET.flatMap(([groupKey, start, minutes, subjects]) =>
  subjects.flatMap((subject, i) => (subject ? [{ id: pid(6000 + (slotN += 1)), groupKey, subject, day: DEC[i], start, minutes }] : [])),
);
const scienceSlot = { id: pid(6100), groupKey: "c9_10" as GK, subject: "Science", day: DEC[3], start: "11:00", minutes: 90 };
planSlots.push(scienceSlot);
const mathsSlot = planSlots.find((s) => s.groupKey === "c9_10" && s.subject === "Maths")!;
const ROOM_NAMES = ["Room 1", "Room 2", "Room 3", "Room 4", "Room 5", "Room 6", "Room 7", "Room 8", "Room 9", "Room 10", "Room 12", "Room 13", "Room 14", "Hall"];
const roomsEmpty = ROOM_NAMES.map((name, i) => ({ id: pid(6200 + i), name, seats: name === "Hall" ? 120 : 35, cols: name === "Hall" ? 10 : 5, used: 0, classes: [] as { classId: string; label: string; count: number; from: number; to: number }[] }));
const roomsSeated = roomsEmpty.map((r, i) => (i === 3 ? { ...r, used: 35, classes: [{ classId: pid(6301), label: "Class 9", count: 21, from: 1, to: 21 }, { classId: pid(6302), label: "Class 7", count: 14, from: 1, to: 14 }] } : { ...r, used: r.seats, classes: [{ classId: pid(6310 + i), label: `Class ${(i % 8) + 1}`, count: Math.ceil(r.seats / 2), from: 1, to: Math.ceil(r.seats / 2) }, { classId: pid(6330 + i), label: `Class ${((i + 4) % 8) + 2}`, count: Math.floor(r.seats / 2), from: 1, to: Math.floor(r.seats / 2) }] }));
const room4Chart = Array.from({ length: 35 }, (_, k) => {
  const row = Math.floor(k / 5);
  const col = k % 5;
  const nine = col % 2 === 0;
  const roll = nine ? row + 1 + (col / 2) * 7 : row + 1 + ((col - 1) / 2) * 7;
  return { seatNo: k + 1, classId: nine ? pid(6301) : pid(6302), classLabel: nine ? "Class 9" : "Class 7", roll: String(roll) };
});
const TEACHERS: [string, string | null][] = [["Ms. Jain", "Class 1"], ["Ms. Vyas", "Class 2"], ["Ms. Sharma", "Class 3"], ["Mr. Verma", "Class 4"], ["Ms. Paliwal", "Class 5"], ["Mr. Sen", null], ["Ms. Kumawat", null], ["Ms. Singh", null], ["Mr. Joshi", null], ["Ms. Bhati", null], ["Mr. Choudhary", "Class 7"]];
const planTeachers = TEACHERS.map(([name, sub], i) => ({ id: pid(6400 + i), name, phone: "9000000000", sub }));
const DUTY_GRID: (string | null)[][] = [
  ["R1", "R4", null, "R5", null, "R8"], ["Hall", "R3", "Hall", "R2", null, null], [null, "R8", "Hall", "Hall", null, null], [null, "R2", "R5", "R10", null, null], [null, "R9", null, null, "R7", null],
  [null, null, "R6", null, "R3", null], [null, null, null, null, null, "R6"], ["R7", null, null, "Hall", "R6", null], ["R2", "R10", "R8", null, "R8", "R2"], ["R8", "R6", "R1", "R9", "Hall", "R3"], ["R3", null, "R2", "R4", null, "R9"],
];
const roomIdOf = (short: string) => roomsSeated.find((r) => (short === "Hall" ? r.name === "Hall" : r.name === `Room ${short.slice(1)}`))?.id ?? roomsSeated[0].id;
const planDuties = DUTY_GRID.flatMap((row, t) => row.flatMap((cell, d) => (cell ? [{ day: DEC[d], roomId: roomIdOf(cell), staffId: planTeachers[t].id }] : [])));
const planProps: PlanProps = {
  view: "datesheet",
  slotId: null,
  exam: { id: pid(6001), name: { en: "Unit Test 2", hi: "यूनिट टेस्ट 2" }, dates: "Mon 7 – Sat 12 Dec", daysLeft: 60, checked: false, publishedAt: null, copiedFrom: "Unit Test 1", reportingTime: "8:15 am" },
  exams: [{ id: pid(6001), name: { en: "Unit Test 2", hi: "यूनिट टेस्ट 2" } }],
  days: DEC.map((day, i) => ({ day, label: DEC_LABEL[i], outside: false })),
  holidays: [],
  bands: [
    { key: "pre", label: { en: "Pre-primary", hi: "पूर्व-प्राथमिक" }, children: 60, start: "9:00", minutes: 45 },
    { key: "c1_5", label: { en: "Classes 1–5", hi: "कक्षा 1–5" }, children: 127, start: "8:30", minutes: 60 },
    { key: "c6_8", label: { en: "Classes 6–8", hi: "कक्षा 6–8" }, children: 86, start: "8:30", minutes: 90 },
    { key: "c9_10", label: { en: "Classes 9–10", hi: "कक्षा 9–10" }, children: 58, start: "8:30", minutes: 90 },
    { key: "c11_12", label: { en: "Classes 11–12", hi: "कक्षा 11–12" }, children: 103, start: "8:30", minutes: 90 },
  ],
  slots: planSlots,
  clashes: [{ kind: "same_day", groupKey: "c9_10", day: DEC[3], slotIds: [mathsSlot.id, scienceSlot.id], overlap: false }],
  subjects: { pre: ["English", "Hindi", "Maths", "EVS", "Drawing"], c1_5: ["English", "Hindi", "Maths", "EVS", "Sanskrit", "Computer"], c6_8: ["English", "Hindi", "Maths", "Science", "Social Sci.", "Sanskrit"], c9_10: ["English", "Hindi", "Maths", "Science", "Social Sci.", "Sanskrit"], c11_12: ["English", "Hindi"] },
  sources: [{ id: pid(6002), name: { en: "Unit Test 1", hi: "यूनिट टेस्ट 1" }, slots: 30 }],
  rooms: roomsEmpty,
  roomId: null,
  chart: [],
  totalChildren: 434,
  seated: 0,
  teachers: planTeachers,
  dutyDays: DEC.map((day, i) => ({ day, label: DEC_LABEL[i] })),
  duties: planDuties,
  spread: { min: 1, max: 6, fair: false },
  papers: planSlots.map((s, i) => ({ slotId: s.id, status: i < 2 ? "received" : i === 2 ? "checked" : i === 3 ? "printed" : "waiting", setterId: planTeachers[i % planTeachers.length].id, setterName: planTeachers[i % planTeachers.length].name, setterPhone: "9000000000" })),
  fromName: "Mr. Hemant Trivedi",
  actions: { saveSlot: ok, swapSlots: ok, deleteSlot: ok, copy: ok, check: ok, publish: ok, fillSeating: ok, shareDuties: ok, setPaperStatus: ok, setPaperSetter: ok },
};
const plan = (patch: Partial<PlanProps>): DesignView => ({ menu: "exam", path: "/exam-office/plan", render: () => <PlanBoard {...planProps} {...patch} /> });
const seatedRoom = { rooms: roomsSeated, roomId: roomsSeated[3].id, chart: room4Chart, seated: 434 };

/* --------------------------------------------------------- ExamResults */

const lateTeachers: TeacherRowView[] = [
  teacher("r-meena", "Mr. Meena", "98290 ••512", [paper("r1", "Class 9", "Science", 12, 28)], 840),
  teacher("r-lohar", "Mr. Lohar", "98290 ••726", [paper("r2", "Class 9", "Social Sci.", 0, 28)], null),
  teacher("r-sukhwal", "Ms. Sukhwal", "98290 ••118", [paper("r3", "Class 6", "Hindi", 20, 31), paper("r4", "Class 7", "Hindi", 0, 27)], 300),
  teacher("r-sisodia", "Mr. Sisodia", "98290 ••901", [paper("r5", "11 Science", "English", 22, 22), paper("r6", "12 Science", "English", 9, 20), paper("r7", "12 Arts", "English", 0, 12)], 200),
  teacher("r-shek", "Ms. Shekhawat", "98290 ••455", [paper("r8", "11 Science", "Maths", 0, 22), paper("r9", "12 Science", "Biology", 0, 20)], -1),
  teacher("r-gurjar", "Mr. Gurjar", "98290 ••377", [paper("r10", "Class 3", "Sanskrit", 9, 24), paper("r11", "Class 4", "Sanskrit", 0, 29), paper("r12", "Class 5", "Sanskrit", 0, 26)], 1000),
  teacher("r-rawal", "Mr. Rawal", "98290 ••644", [paper("r13", "12 Arts", "Geography", 0, 12)], null),
];

type ResultsClass = ResultsProps["classes"][number];
const rclass = (id: string, label: string, teacherName: string, children: number, percent: number, extra: Partial<ResultsClass> = {}): ResultsClass => ({
  id,
  label,
  sort: 0,
  teacher: teacherName,
  children,
  percent,
  allSubmitted: percent === 100,
  late: 0,
  unusual: 0,
  unusualOpen: 0,
  graceNeeded: 0,
  locked: false,
  issued: 0,
  ...extra,
});

const resultsClasses: ResultsClass[] = [
  rclass("k-nur", "Nursery", "Ms. Kanwar", 18, 100),
  rclass("k-lkg", "LKG", "Ms. Rathore", 20, 86),
  rclass("k-ukg", "UKG", "Ms. Mehta", 22, 74),
  rclass("k-1", "Class 1", "Ms. Jain", 23, 100),
  rclass("k-2", "Class 2", "Ms. Vyas", 25, 70),
  rclass("k-3", "Class 3", "Ms. Sharma", 24, 58, { late: 1, graceNeeded: 1 }),
  rclass("k-4", "Class 4", "Mr. Verma", 29, 52, { late: 1, graceNeeded: 2 }),
  rclass("k-5", "Class 5", "Ms. Paliwal", 26, 57, { late: 1 }),
  rclass("k-6", "Class 6", "Ms. Bhati", 31, 66, { late: 1, graceNeeded: 1 }),
  rclass("k-7", "Class 7", "Mr. Sen", 27, 52, { late: 1 }),
  rclass("k-8", "Class 8", "Ms. Kumawat", 28, 100, { unusual: 1, unusualOpen: 1, graceNeeded: 3 }),
  rclass("k-9", "Class 9", "Ms. Singh", 28, 61, { late: 2, graceNeeded: 2 }),
  rclass("k-10", "Class 10", "Mr. Joshi", 30, 100, { unusual: 1, unusualOpen: 1, graceNeeded: 1 }),
  rclass("k-11s", "11 Science", "Ms. Bhati", 22, 64, { late: 2, graceNeeded: 1 }),
  rclass("k-11c", "11 Commerce", "Mr. Purohit", 18, 58),
  rclass("k-11a", "11 Arts", "Ms. Mewara", 14, 48),
  rclass("k-12s", "12 Science", "Mr. Dadhich", 20, 45, { late: 2 }),
  rclass("k-12c", "12 Commerce", "Mr. Sanadhya", 17, 41),
  rclass("k-12a", "12 Arts", "Mr. Rawal", 12, 38, { late: 2 }),
];

const modPaper = (id: string, subjectCode: string, teacherName: string, now: number, last: number, extra: Partial<ResultsProps["moderation"]["papers"][number]> = {}): ResultsProps["moderation"]["papers"][number] => ({
  paperId: id,
  subjectCode,
  teacherId: `t-${id}`,
  teacherName,
  teacherPhone: "9000000000",
  maxMarks: 80,
  passMarks: 26,
  avgPct: now,
  prevPct: last,
  baseline: last,
  basis: "previous",
  delta: now - last,
  unusual: false,
  decision: null,
  sat: 28,
  below: 0,
  highest: 76,
  spread: [0, 0, 0, 2, 5, 7, 8, 4, 2, 0],
  ...extra,
});

const graceRow = (id: string, name: string, classLabel: string, max: number, needs: [string, number][], canPass: boolean): ResultsProps["grace"]["rows"][number] => {
  const pass = Math.ceil(max * 0.33);
  const list = needs.map(([subjectCode, value], i) => ({ paperId: `${id}-${i}`, subjectCode, value, passMarks: pass, grace: pass - value, maxMarks: max }));
  return { studentId: id, name, classId: classLabel, classLabel, canPass, total: list.reduce((a, n) => a + n.grace, 0), given: false, locked: false, needs: list };
};

const recheck = (id: string, name: string, classLabel: string, subjectCode: string, teacherName: string, mark: number, note: string, askedBy: string, day: string, status: ResultsProps["rechecks"][number]["status"], newValue: number | null = null): ResultsProps["rechecks"][number] => ({
  id,
  studentId: `s-${id}`,
  name,
  paperId: `p-${id}`,
  classLabel,
  subjectCode,
  maxMarks: 80,
  mark: newValue ?? mark,
  askedBy,
  note,
  status,
  oldValue: status === "changed" || status === "no_change" ? mark : null,
  newValue: status === "changed" ? newValue : status === "no_change" ? mark : null,
  createdAt: `${day}T09:00:00+05:30`,
  teacherName,
  teacherPhone: "9000000000",
  locked: false,
});

const resultsProps: ResultsProps = {
  view: "pipeline",
  isAdmin: false,
  canFinalise: true,
  canReopen: false,
  fromName: "Mr. Hemant Trivedi",
  exam: {
    id: "exam-hy",
    term: "half_yearly",
    name: { en: "Half-yearly", hi: "अर्धवार्षिक" },
    dates: "23 Sep – 3 Oct",
    sessionLabel: "2026–27",
    prevName: { en: "Unit Test 1", hi: "यूनिट टेस्ट 1" },
    marksDue: "Wed 14 Oct",
    daysToDue: 6,
    resultsOn: "2026-10-17",
    resultsLabel: "Sat 17 Oct",
    daysToResults: 9,
    ptmAt: "10:00",
    publishAt: null,
    publishedAt: null,
    ptm: true,
  },
  overall: { entered: 1802, total: 2654, percent: 68, done: 41, papers: 96 },
  teachers: lateTeachers,
  states: { entered: "active", checked: "can_start", grace: "can_start", locked: "can_start", cards: "waiting", published: "waiting" },
  classes: resultsClasses,
  childrenTotal: 434,
  unusualCount: 2,
  unusualOpen: 2,
  moderation: {
    classId: "k-8",
    completeClasses: [
      { id: "k-8", label: "Class 8", unusual: 1 },
      { id: "k-10", label: "Class 10", unusual: 1 },
      { id: "k-1", label: "Class 1", unusual: 0 },
      { id: "k-nur", label: "Nursery", unusual: 0 },
    ],
    still: 15,
    flagged: [
      { paperId: "m-maths", classId: "k-8", classLabel: "Class 8", subjectCode: "Maths", avgPct: 53, baseline: 71, delta: -18, basis: "previous", teacherName: "Mr. Joshi" },
      { paperId: "m-sci10", classId: "k-10", classLabel: "Class 10", subjectCode: "Science", avgPct: 69, baseline: 48, delta: 21, basis: "previous", teacherName: "Mr. Meena" },
    ],
    papers: [
      modPaper("m-maths", "Maths", "Mr. Joshi", 53, 71, { unusual: true, below: 1, highest: 78, spread: [0, 0, 0, 4, 6, 5, 7, 2, 2, 2] }),
      modPaper("m-eng", "English", "Ms. Singh", 64, 66),
      modPaper("m-hin", "Hindi", "Ms. Sukhwal", 70, 68),
      modPaper("m-sci", "Science", "Ms. Bhati", 61, 63),
      modPaper("m-sst", "Social Sci.", "Mr. Choudhary", 58, 60),
      modPaper("m-san", "Sanskrit", "Mr. Solanki", 72, 70),
      modPaper("m-cmp", "Computer", "Ms. Agarwal", 81, 78),
    ],
  },
  grace: {
    max: 3,
    subjects: 1,
    open: 11,
    rows: [
      graceRow("g1", "Harsh Vyas", "Class 8", 80, [["Maths", 26]], true),
      graceRow("g2", "Manvi Joshi", "Class 4", 100, [["English", 32]], true),
      graceRow("g3", "Yash Mehta", "Class 9", 80, [["Science", 26]], true),
      graceRow("g4", "Kunal Verma", "Class 4", 100, [["Maths", 31]], true),
      graceRow("g5", "Neha Joshi", "Class 8", 80, [["Maths", 25]], true),
      graceRow("g6", "Sneha Bhati", "Class 9", 80, [["Maths", 25]], true),
      graceRow("g7", "Dev Rathore", "11 Science", 80, [["Chemistry", 25]], true),
      graceRow("g8", "Om Regar", "Class 6", 80, [["Science", 24]], true),
      graceRow("g9", "Prisha Agarwal", "Class 8", 80, [["Sanskrit", 24]], true),
      graceRow("g10", "Rudra Singh", "Class 3", 100, [["EVS", 30]], true),
      graceRow("g11", "Aditi Jain", "Class 10", 80, [["Social Sci.", 24]], true),
      graceRow("g12", "Ritika Purohit", "Class 5", 100, [["Maths", 31], ["Hindi", 32]], false),
      graceRow("g13", "Nidhi Chouhan", "Class 7", 80, [["Hindi", 23]], false),
      graceRow("g14", "Arjun Rawal", "Class 3", 100, [["Maths", 28]], false),
      graceRow("g15", "Vivaan Trivedi", "12 Science", 80, [["Physics", 22]], false),
    ],
  },
  cards: {
    issuedTotal: 0,
    sample: {
      studentId: "s-aarti",
      name: "Aarti Kumawat",
      classLabel: "Class 10",
      issued: true,
      rows: [
        { subject: "English", scored: 62, outOf: 80, grade: "B1", grace: 0 },
        { subject: "Hindi", scored: 68, outOf: 80, grade: "A2", grace: 0 },
        { subject: "Maths", scored: 59, outOf: 80, grade: "B1", grace: 0 },
        { subject: "Science", scored: 71, outOf: 80, grade: "A2", grace: 0 },
        { subject: "Social Sci.", scored: 58, outOf: 80, grade: "B1", grace: 0 },
        { subject: "Sanskrit", scored: 74, outOf: 80, grade: "A2", grace: 0 },
      ],
      total: 392,
      outOf: 480,
      percent: 81.7,
      grade: "A2",
      passed: true,
    },
  },
  rechecks: [
    recheck("rq1", "Mohit Agarwal", "Class 9", "Science", "Mr. Meena", 31, "Q4 answer matches the book but got 0", "Father, Mahesh Agarwal · WhatsApp", "2026-10-06", "new"),
    recheck("rq2", "Neha Joshi", "Class 8", "Maths", "Mr. Joshi", 25, "Total looks short by 2 marks", "Father, Prakash Joshi · at the office", "2026-10-07", "with_teacher"),
    recheck("rq3", "Aarti Kumawat", "Class 10", "English", "Ms. Dadhich", 58, "Page 3 was not checked", "Mother, Sunita Kumawat · WhatsApp", "2026-10-05", "changed", 60),
    recheck("rq4", "Riya Singh", "Class 6", "Social Sci.", "Mr. Choudhary", 40, "Map question marked 0", "Through class teacher Ms. Bhati", "2026-10-08", "new"),
    recheck("rq5", "Pooja Mehta", "11 Commerce", "Accountancy", "Mr. Purohit", 61, "Wants to see the answer sheet", "Father, Dinesh Mehta · WhatsApp", "2026-10-03", "no_change"),
  ],
  paperChoices: [{ id: "p-rq1", classId: "k-9", label: "Class 9 · Science" }],
  rollChoices: { "k-9": [{ id: "s-rq1", name: "Mohit Agarwal", roll: "14" }] },
  recheckId: null,
  actions: {
    moderate: ok,
    saveGraceRule: ok,
    giveGrace: ok,
    removeGrace: ok,
    lock: ok,
    unlock: ok,
    issueClass: ok,
    publish: ok,
    addRecheck: ok,
    recheckWithTeacher: ok,
    resolveRecheck: ok,
    remind: ok,
  },
};

/** Report cards: three classes locked and issued, the rest drafts. */
const cardsPatch: Partial<ResultsProps> = {
  classes: resultsClasses.map((c) => (["k-nur", "k-1", "k-8"].includes(c.id) ? { ...c, locked: true, issued: c.children, unusualOpen: 0 } : c)),
  cards: { ...resultsProps.cards, issuedTotal: 69 },
  states: { ...resultsProps.states, locked: "active" },
};

const resultsView = (patch: Partial<ResultsProps>): DesignView => ({ menu: "exam", path: "/exam-office/results", render: () => <ResultsBoard {...resultsProps} {...patch} /> });

export const examViews: Record<string, DesignView> = {
  ExamResults: resultsView({}),
  "DX-ExamResults-Moderation": resultsView({ view: "moderation" }),
  "DX-ExamResults-Grace": resultsView({ view: "grace" }),
  "DX-ExamResults-Cards": resultsView({ view: "cards", ...cardsPatch }),
  "DX-ExamResults-Recheck": resultsView({ view: "recheck", recheckId: "rq1" }),
  "M-ExamResults": resultsView({}),
  "M-ExamResults-Moderation": resultsView({ view: "moderation" }),
  "M-ExamResults-Lock": resultsView({ view: "lock" }),
  "M-ExamResults-Publish": resultsView({ view: "publish" }),
  "M-ExamResults-Recheck": resultsView({ view: "recheck", recheckId: "rq1" }),

  ExamPlan: plan({}),
  "DX-ExamPlan-Clash": plan({ view: "clash" }),
  "DX-ExamPlan-Room": plan({ view: "room", ...seatedRoom }),
  "DX-ExamPlan-Duties": plan({ view: "duties", ...seatedRoom }),
  "DX-ExamPlan-Publish": plan({ view: "publish" }),
  "M-ExamPlan": plan({}),
  "M-ExamPlan-Slot": plan({ view: "slot", slotId: scienceSlot.id }),
  "M-ExamPlan-Seating": plan({ view: "seating" }),
  "M-ExamPlan-Room": plan({ view: "room", ...seatedRoom }),
  "M-ExamPlan-Duties": plan({ view: "duties", ...seatedRoom }),
  "M-ExamPlan-Papers": plan({ view: "papers" }),

  ExamHome: home("home"),
  "DX-ExamHome-Checklist": home("checklist"),
  "DX-ExamHome-Late": home("late"),
  "DX-ExamHome-Dark": home("home"),
  "M-ExamHome": home("home"),
  "M-ExamHome-Menu": home("menu"),
  "M-ExamHome-Checklist": home("checklist"),
  "M-ExamHome-Late": home("late"),
  "M-ExamHome-Remind": home("remind"),
};
