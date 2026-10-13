import type { DesignView } from "../../design.fixture";
import type { ActionResult, SaveOutcome } from "@/vx/screens/exams/save-types";
import type { CellCounts, CellState } from "@/vx/screens/exams/domain/board";
import type { Cell } from "@/vx/screens/exams/domain/entry";
import { subjectPair } from "@/vx/screens/exams/domain/groups";
import { ExamsBoard, type ExamsProps, type ExamsView } from "@/vx/screens/exams/exams-board";
import { MarksSheet } from "@/vx/screens/exams/marks-sheet";
import type { TeacherRowView } from "@/vx/screens/exams/remind";
import type { SheetPaper, SheetStudent } from "@/vx/screens/exams/sheet-data";

/*
 * Exams, marks & report cards: one view per design frame
 * (docs/design-handoff/screenshots/academics/*Exams*, r-academic/*Exams*,
 * r-exam/*Exams*). The records copy the design's own sample
 * (`Exams.dc.html` → `data()`): its 19 classes and their marks status, the
 * Half-yearly at 68%, Class 9 Science half done for Mr. Meena, Class 8's
 * report cards, Class 10's analysis. All names are the design's, synthetic.
 *
 * The app locks marks a whole class at a time (UI-54); the design locks a
 * subject. The tracker frames are drawn with the design's per-subject states
 * so the two pictures can be compared cell for cell.
 */

const sp = (x: string) => x.split(",");
const GR: Record<string, [string, number]> = {
  pre: ["English,Hindi,Maths,EVS,Drawing", 50],
  pri: ["English,Hindi,Maths,Sci / EVS,Social Sci.,Sanskrit,Computer", 100],
  sec: ["English,Hindi,Maths,Science,Social Sci.,Sanskrit", 80],
  sci: ["Physics,Chemistry,Maths / Bio,English,Hindi", 80],
  com: ["Accountancy,Business St.,Economics,English,Hindi", 80],
  art: ["History,Geography,Political Sci.,Hindi Lit.,English", 80],
};
const TT: Record<string, string> = {
  pre: ",,,,Ms. Regar",
  p15: ",Ms. Kumawat,,,,Mr. Gurjar,Mr. Sen",
  p68: "Ms. Singh,Ms. Sukhwal,Mr. Joshi,Ms. Bhati,Mr. Choudhary,Mr. Solanki,Ms. Agarwal",
  sec: "Ms. Dadhich,Mr. Saini,Ms. Dave,Mr. Meena,Mr. Lohar,Mr. Tak",
  sci: "Mr. Trivedi,Mr. Bhatt,Ms. Shekhawat,Mr. Sisodia,Mr. Sanadhya",
  com: "Mr. Purohit,Ms. Kothari,Mr. Rajawat,Mr. Sisodia,Mr. Sanadhya",
  art: "Ms. Chouhan,Mr. Rawal,Ms. Mewara,Mr. Sanadhya,Mr. Sisodia",
};
type K = { id: string; name: string; ct: string; n: number; g: string; codes: string[]; subs: string[]; max: number; tch: string[] };
const CL: K[] = "Nursery|Ms. Kanwar|18|pre|pre|L,L,L,L,D;LKG|Ms. Rathore|20|pre|pre|L,L,D,L,6;UKG|Ms. Mehta|22|pre|pre|L,10,D,L,14;Class 1|Ms. Jain|23|pri|p15|L,L,L,D,D,L,N;Class 2|Ms. Vyas|25|pri|p15|D,L,10,12,18,L,N;Class 3|Ms. Sharma|24|pri|p15|14,D,L,9,D,N,N;Class 4|Mr. Verma|29|pri|p15|L,8,17,D,21,N,N;Class 5|Ms. Paliwal|26|pri|p15|D,D,L,11,20,N,N;Class 6|Ms. Bhati|31|pri|p68|D,20,14,D,N,19,N;Class 7|Mr. Choudhary|27|pri|p68|9,D,11,16,N,D,N;Class 8|Mr. Solanki|28|pri|p68|L,L,L,L,L,26,27;Class 9|Mr. Meena|28|sec|sec|17,22,D,12,N,D;Class 10|Ms. Dave|30|sec|sec|L,L,L,L,L,L;11 Science|Mr. Trivedi|22|sci|sci|12,9,N,5,15;11 Commerce|Mr. Purohit|18|com|com|10,D,6,D,7;11 Arts|Ms. Chouhan|14|art|art|D,N,6,D,8;12 Science|Mr. Bhatt|20|sci|sci|15,9,N,8,D;12 Commerce|Ms. Kothari|17|com|com|D,4,11,13,D;12 Arts|Mr. Rawal|12|art|art|5,N,8,D,D"
  .split(";")
  .map((row) => {
    const a = row.split("|");
    const num = Number(a[0].replace(/\D/g, "")) || 0;
    return {
      id: `class-${a[0].toLowerCase().replace(/\s+/g, "-")}`,
      name: a[0],
      ct: a[1],
      n: Number(a[2]),
      g: a[3],
      codes: sp(a[5]),
      subs: sp(GR[a[3]][0]).map((x) => (x === "Sci / EVS" ? (num <= 5 ? "EVS" : "Science") : x)),
      max: GR[a[3]][1],
      tch: sp(TT[a[4]]).map((t) => t || a[1]),
    };
  });

const stateOf = (k: K, i: number): { state: CellState; entered: number } => {
  const c = k.codes[i];
  if (c === "L") return { state: "locked", entered: k.n };
  if (c === "D") return { state: "done", entered: k.n };
  if (c === "N") return { state: "not_started", entered: 0 };
  return { state: "in_progress", entered: Math.min(k.n, Number(c)) };
};
const paperId = (k: K, i: number) => `paper-${k.id}-${i}`;
const teacherId = (name: string) => `staff-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;

/* ---------------------------------------------------------------- times */
const NOW = new Date();
/** A moment `days` ago at hh:mm, in this machine's clock (the fixture runs in IST). */
const ago = (days: number, hh: number, mm: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};

/* ---------------------------------------------------------------- tracker */
const BAND_OF = (k: K): [string, { en: string; hi: string }] => {
  const num = Number(k.name.replace(/\D/g, "")) || 0;
  if (k.g === "pre") return ["pre", { en: "Pre-primary", hi: "पूर्व-प्राथमिक" }];
  if (num <= 5) return ["c1_5", { en: "Classes 1–5", hi: "कक्षा 1–5" }];
  if (num <= 8) return ["c6_8", { en: "Classes 6–8", hi: "कक्षा 6–8" }];
  if (num <= 10) return ["c9_10", { en: "Classes 9–10", hi: "कक्षा 9–10" }];
  const stream = k.g === "sci" ? ["science", "11–12 Science", "11–12 विज्ञान"] : k.g === "com" ? ["commerce", "11–12 Commerce", "11–12 वाणिज्य"] : ["arts", "11–12 Arts", "11–12 कला"];
  return [`c11_12-${stream[0]}`, { en: stream[1], hi: stream[2] }];
};

const bands: ExamsProps["bands"] = [];
for (const k of CL) {
  const [key, label] = BAND_OF(k);
  let band = bands.find((b) => b.key === key);
  if (!band) {
    band = { key, label, subjects: [], rows: [] };
    bands.push(band);
  }
  for (const s of k.subs) if (!band.subjects.some((x) => x.code === s)) band.subjects.push({ code: s, name: subjectPair(s) });
  const cells = Object.fromEntries(
    k.subs.map((s, i) => {
      const st = stateOf(k, i);
      return [s, { paperId: paperId(k, i), state: st.state, entered: st.entered, total: k.n, late: st.state === "not_started", teacher: k.tch[i] }];
    }),
  );
  const entered = k.subs.reduce((a, _s, i) => a + stateOf(k, i).entered, 0);
  band.rows.push({ classId: k.id, label: k.name, teacher: k.ct, children: k.n, percent: Math.round((entered / (k.n * k.subs.length)) * 100), cells });
}

const counts: CellCounts = { locked: 0, done: 0, in_progress: 0, not_started: 0, empty: 0, late: 0, all: 0 };
let entered = 0;
let total = 0;
for (const k of CL) {
  k.subs.forEach((_s, i) => {
    const st = stateOf(k, i);
    counts[st.state] += 1;
    counts.all += 1;
    if (st.state === "not_started") counts.late += 1;
    entered += st.entered;
    total += k.n;
  });
}

/* ---------------------------------------------------------------- teachers */
const SEEN: Record<string, string | null> = { "Mr. Meena": ago(1, 19, 40), "Ms. Dave": ago(0, 9, 32), "Ms. Kothari": ago(1, 18, 5) };
const NO_LINK = new Set(["Mr. Lohar", "Mr. Rawal"]);
const OPENED_ELSE = [ago(0, 8, 12), ago(1, 21, 30), ago(4, 16, 30)];
const hash = (x: string) => {
  let h = 2166136261;
  for (let i = 0; i < x.length; i++) {
    h ^= x.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
};
const byTeacher = new Map<string, { k: K; i: number }[]>();
for (const k of CL) k.subs.forEach((_s, i) => byTeacher.set(k.tch[i], [...(byTeacher.get(k.tch[i]) ?? []), { k, i }]));
const teachers: TeacherRowView[] = [...byTeacher.entries()].map(([name, items]) => {
  const papers = items.map(({ k, i }) => {
    const st = stateOf(k, i);
    return { paperId: paperId(k, i), classLabel: k.name, subjectCode: k.subs[i], entered: st.entered, total: k.n, status: (st.state === "locked" || st.state === "done" ? "done" : st.state) as "done" | "in_progress" | "not_started" };
  });
  const e = papers.reduce((a, x) => a + x.entered, 0);
  const all = papers.reduce((a, x) => a + x.total, 0);
  const notStarted = papers.some((x) => x.status === "not_started");
  const h = hash(`${name}x`);
  const opened = NO_LINK.has(name) ? null : (SEEN[name] ?? (e === 0 ? null : OPENED_ELSE[Math.floor(hash(name) * 3)]));
  return {
    id: teacherId(name),
    name,
    phone: "9000000000",
    phoneMasked: name === "Mr. Meena" ? "98290 ••512" : `98290 ••${100 + Math.floor(h * 899)}`,
    papers,
    entered: e,
    total: all,
    late: notStarted,
    notStarted,
    link: NO_LINK.has(name) ? null : { url: `https://vpps.one/t/marks/${Math.floor(h * 1e9).toString(36).slice(0, 5)}`, createdAt: ago(25, 10, 0), openedAt: opened },
    remindedAt: null,
  };
});

/* ---------------------------------------------------------------- actions */
const ok = async (): Promise<ActionResult> => ({ ok: true });
const actions: ExamsProps["actions"] = { remind: ok, marksLink: ok, lock: ok, issueClass: ok, create: ok };

const HY = { en: "Half-yearly", hi: "अर्धवार्षिक" };
const base: ExamsProps = {
  view: "list",
  manage: true,
  canFinalise: true,
  reports: true,
  scoped: false,
  fromName: "Janmejay Singh",
  sessionLabel: "2026-27",
  timeline: [
    { id: "exam-ut1", name: { en: "Unit Test 1", hi: "इकाई परीक्षा 1" }, dates: "14–18 Jul", state: "done", papers: 113, sub: { en: "results sent 4 Aug", hi: "परिणाम भेजे 4 Aug" } },
    { id: "exam-hy", name: HY, dates: "23 Sep – 3 Oct", state: "now", papers: 113, sub: { en: "113 papers", hi: "113 पेपर" } },
    { id: "exam-ut2", name: { en: "Unit Test 2", hi: "इकाई परीक्षा 2" }, dates: "", state: "later", papers: 0, sub: { en: "not set up yet", hi: "अभी तैयार नहीं" } },
    { id: "exam-annual", name: { en: "Annual exam", hi: "वार्षिक परीक्षा" }, dates: "", state: "later", papers: 0, sub: { en: "not set up yet", hi: "अभी तैयार नहीं" } },
  ],
  exam: {
    id: "exam-hy",
    term: "Term 1",
    name: HY,
    dates: "23 Sep – 3 Oct",
    open: true,
    dueLabel: "Sat 10 Oct",
    entered,
    total,
    percent: Math.round((entered / total) * 100),
    notStarted: teachers.filter((t) => t.notStarted).length,
    counts,
    graceGiven: 0,
  },
  activity: [
    { id: "a1", kind: "locked", text: { en: "Ms. Dave locked Class 10 Maths" }, at: ago(0, 9, 40) },
    { id: "a2", kind: "submitted", text: { en: "Mr. Meena entered 12 marks · Class 9 Science" }, at: ago(1, 19, 58) },
    { id: "a3", kind: "link", text: { en: "Ms. Kothari opened her Sampark link" }, at: ago(1, 18, 5) },
    { id: "a4", kind: "reminded", text: { en: "Janmejay reminded 9 teachers on WhatsApp" }, at: ago(3, 11, 0) },
  ],
  bands,
  gridClassId: CL[11].id,
  teachers,
  cell: null,
  cards: null,
  preview: null,
  analysis: null,
  terms: ["Term 1", "Term 2"],
  actions,
};

/* ---------------------------------------------------------------- cell: Class 9 Science */
const k9 = CL[11];
const cell: ExamsProps["cell"] = {
  paperId: paperId(k9, 3),
  classId: k9.id,
  classLabel: k9.name,
  subject: subjectPair("Science"),
  teacherId: teacherId("Mr. Meena"),
  teacherName: "Mr. Meena",
  phoneMasked: "98290 ••512",
  maxMarks: 80,
  entered: 12,
  total: 28,
  state: "in_progress",
  late: false,
  link: { url: "https://vpps.one/t/marks/ay5br", createdAt: ago(25, 10, 0), openedAt: ago(1, 19, 40) },
  remindedAt: null,
  canEnter: true,
  classLocked: false,
  classReady: false,
  history: [
    { text: { en: "Link opened by Mr. Meena", hi: "Mr. Meena ने लिंक खोला" }, at: ago(1, 19, 40), tone: "var(--info)" },
    { text: { en: "Marks link made", hi: "अंक लिंक बना" }, at: ago(25, 10, 0), tone: "var(--mut)" },
  ],
};

/* ---------------------------------------------------------------- report cards: Class 8 */
const FIRST = "Aditi Ananya Arjun Dev Harsh Isha Kabir Kavya Khushi Krish Laksh Manav Meera Muskan Nidhi Om Parth Payal Priya Ritika Rudra Saanvi Sneha Tanya Vivaan Yash Jhanvi Bhavna".split(" ");
const SUR = "Dave Rathore Agarwal Rathore Sanadhya Jain Mehta Paliwal Kumawat Choudhary Vyas Purohit Solanki Bhati Trivedi Chouhan Kothari Rawal Meena Joshi Singh Sen Regar Gurjar Sharma Bhati Kothari Rawal".split(" ");
const k8 = CL[10];
const cls8 = Array.from({ length: 28 }, (_, i) => (i === 17 ? "Neha Joshi" : `${FIRST[i]} ${SUR[i]}`));
const pct8 = [83.1, 50.4, 55.7, 67.9, 72.4, 61.2, 88.0, 47.5, 69.3, 79.8, 58.6, 64.1, 91.2, 53.9, 76.4, 62.7, 70.5, 89.7, 57.2, 66.8, 74.9, 81.3, 49.6, 68.2, 73.5, 60.4, 78.1, 65.0];
const cards: ExamsProps["cards"] = {
  term: "Term 1",
  classes: CL.map((k) => ({ id: k.id, label: k.name, children: k.n, issued: 0, locked: k.codes.every((c) => c === "L") })),
  classId: k8.id,
  classTeacher: "Mr. Solanki",
  subjects: 7,
  students: cls8.map((name, i) => ({ id: `stu-8-${i + 1}`, name, roll: String(i + 1), issued: false, percent: pct8[i], missing: i === 26 ? ["Sanskrit", "Computer"] : i === 27 ? ["Sanskrit"] : [], absent: 0 })),
};
cards.students = cards.students.map((s) => (s.missing?.length ? { ...s, percent: null } : s));

const preview: ExamsProps["preview"] = {
  school: "Shri Veer Patta Senior Secondary School",
  studentId: "stu-8-18",
  name: "Neha Joshi",
  fatherName: "Prakash Joshi",
  classLabel: "Class 8",
  roll: "18",
  admissionNo: "1337",
  issued: true,
  revision: 1,
  remark: "Good work. A little more practice in English will help.\nअच्छा प्रदर्शन। अंग्रेज़ी में थोड़ा और अभ्यास करें।",
  title: { en: "Half-yearly examination · Report card", hi: "अर्धवार्षिक परीक्षा · प्रगति पत्र" },
  rows: [
    ["English", 76, "B1"],
    ["Hindi", 99, "A1"],
    ["Maths", 99, "A1"],
    ["Science", 76, "B1"],
    ["Social Sci.", 80, "B1"],
    ["Sanskrit", 99, "A1"],
    ["Computer", 99, "A1"],
  ].map(([s, m, g]) => ({ subject: subjectPair(String(s)), outOf: 100, scored: Number(m), grade: String(g), grace: 0, state: "value" as const })),
  total: 628,
  outOf: 700,
  percent: 89.7,
  grade: "A2",
  passed: true,
  attendance: 82,
  present: 54,
  counted: 66,
  classTeacher: "Mr. Solanki",
  coordinator: "Ms. Neelam Sharma",
  prevId: "stu-8-17",
  nextId: "stu-8-19",
  position: 18,
  of: 28,
};

/* ---------------------------------------------------------------- analysis: Class 10 */
const analysis: ExamsProps["analysis"] = {
  classes: CL.map((k) => ({ id: k.id, label: k.name.replace("Science", "Sci").replace("Commerce", "Com") })),
  classId: CL[12].id,
  classLabel: "Class 10",
  children: 30,
  submitted: 6,
  papers: 6,
  subjects: [
    ["English", 66],
    ["Hindi", 60],
    ["Maths", 65],
    ["Science", 68],
    ["Social Sci.", 68],
    ["Sanskrit", 63],
  ].map(([s, v]) => ({ subjectCode: String(s), name: subjectPair(String(s)), avgPct: Number(v), sat: 30 })),
  counted: 30,
  passedAll: 22,
  top: [
    ["Meera Rawal", 91.0],
    ["Aditya Dave", 90.6],
    ["Bhavna Dave", 90.0],
    ["Om Rathore", 86.7],
    ["Krish Bhati", 82.7],
  ].map(([n, v], i) => ({ studentId: `stu-10-${i}`, name: String(n), percent: Number(v) })),
  below: [
    ["Aarti Kumawat", [["English", 19], ["Hindi", 19]]],
    ["Kabir Chouhan", [["Social Sci.", 22]]],
    ["Kavya Bhati", [["Maths", 18]]],
    ["Muskan Kothari", [["Hindi", 23]]],
    ["Priya Sen", [["Sanskrit", 26]]],
  ].map(([n, f], i) => ({ studentId: `stu-10-b${i}`, name: String(n), fails: (f as [string, number][]).map(([s, v]) => ({ subjectCode: s, value: v, maxMarks: 80 })) })),
  belowCount: 5,
  prevName: { en: "Unit Test 1" },
  passPct: 33,
  locked: true,
};

/* ---------------------------------------------------------------- entry: Class 9 Science */
const NAMES9 = ["Aditi Sanadhya", "Aditi Sharma", "Aditya Dave", "Aditya Meena", "Aditya Sharma", "Ananya Chouhan", "Arjun Purohit", "Bhavna Rawal", "Bhavna Vyas", "Harsh Meena", "Isha Jain", "Kabir Rathore", "Kavya Joshi", "Khushi Bhati", "Krish Paliwal", "Laksh Sen", "Manav Kumawat", "Meera Trivedi", "Mohit Agarwal", "Nidhi Choudhary", "Om Solanki", "Parth Mehta", "Payal Regar", "Priya Gurjar", "Ritika Vyas", "Rudra Kothari", "Saanvi Dave", "Yash Chouhan"];
const MARKS9: (number | "AB" | null)[] = [78, 44, 67, 34, 22, "AB", 41, 45, 29, 25, 47, 52];
const students9: SheetStudent[] = NAMES9.map((name, i) => ({ id: `stu-9-${i + 1}`, name, roll: String(i + 1), prev: null, prevPct: null }));
const saved9: Record<string, Cell> = Object.fromEntries(
  students9.map((s, i) => {
    const m = MARKS9[i];
    return [s.id, m === "AB" ? { state: "absent", value: null } : m === null || m === undefined ? { state: "blank", value: null } : { state: "value", value: m }];
  }),
) as Record<string, Cell>;
const paper9: SheetPaper = {
  id: paperId(k9, 3),
  examId: "exam-hy",
  examLabel: HY,
  classId: k9.id,
  classLabel: "Class 9",
  subjectCode: "Science",
  subjectId: "subject-science",
  maxMarks: 80,
  passMarks: 27,
  markStep: 1,
  allowExempt: false,
  entryStatus: "open",
  entryRevision: 4,
  submittedAt: null,
  submittedBy: null,
  examOpen: true,
  locked: false,
  dueLabel: "Sat 10 Oct",
};
const saveStub = async (): Promise<SaveOutcome> => ({ ok: true, revision: 5, entryStatus: "open", savedAt: new Date().toISOString(), actorName: "Janmejay Singh", changed: 1, counts: null });

function Entry() {
  return (
    <MarksSheet
      variant="office"
      forTeacher="Mr. Meena"
      ownerId="fixture-admin"
      sessionLabel="2026-27"
      paper={paper9}
      students={students9}
      saved={saved9}
      coordinatorName="Ms. Neelam Sharma"
      onSave={saveStub}
      canCorrect
      canReopen
      crumb="Exams · Half-yearly"
      backHref={`/exams?view=cell&paper=${paper9.id}`}
      doneHref="/exams?view=grid"
    />
  );
}

/* ---------------------------------------------------------------- views */
const board = (view: ExamsView, patch: Partial<ExamsProps> = {}) =>
  function Board() {
    return <ExamsBoard {...base} view={view} {...patch} />;
  };
const academic: Partial<ExamsProps> = { manage: false, canFinalise: false, teachers: [] };

export const views: Record<string, DesignView> = {
  Exams: { render: board("list"), path: "/exams" },
  "M-Exams": { render: board("list"), path: "/exams" },
  "M-Exams-Grid": { render: board("grid"), path: "/exams" },
  "DX-Exams-Cell": { render: board("cell", { cell }), path: "/exams" },
  "M-Exams-Remind": { render: board("remind"), path: "/exams" },
  "M-Exams-Sampark": { render: board("sampark"), path: "/exams" },
  "DX-Exams-Entry": { render: () => <Entry />, path: "/exams" },
  "M-Exams-Entry": { render: () => <Entry />, path: "/exams" },
  "M-Exams-ReportCards": { render: board("reportcards", { cards }), path: "/exams" },
  "DX-Exams-Preview": { render: board("preview", { cards, preview }), path: "/exams" },
  "AD-Exams": { render: board("analysis", { ...academic, analysis }), menu: "academic", path: "/exams" },
  "MAD-Exams": { render: board("analysis", { ...academic, analysis }), menu: "academic", path: "/exams" },
  "EX-Exams": { render: board("grid"), menu: "exam", path: "/exams" },
  "MEX-Exams": { render: board("grid"), menu: "exam", path: "/exams" },
};
