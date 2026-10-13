import type { DesignView } from "../design.fixture";

import { ExamHome, type HomeView, type NextExamView, type ResultsExamView, type TimelineItem } from "@/vx/screens/exams/office-home";
import type { TeacherRowView } from "@/vx/screens/exams/remind";
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

export const examViews: Record<string, DesignView> = {
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
