import type { DesignView } from "../design.fixture";
import type { ChildChoice, NoteReply, NotesPeople, SupportPlan } from "@/vx/screens/notes/data";
import type { BoardNote, NoteTag } from "@/vx/screens/notes/domain/notes";
import type { AddStep, ClientViewer } from "@/vx/screens/notes/ui/parts";
import { NotesBoard, TeachNotes, type NotesFocus, type NotesProps, type NotesScope } from "@/vx/screens/notes/ui/workspace";

/*
 * Notes on children (design modules `Notes` and `TchNotes`), one view per
 * design frame, with the design's own synthetic names and sample notes. No
 * database: the notes actions are stubbed by the fixture's Vite config, and
 * "speaking" is a stand-in SpeechRecognition that hears the design's words.
 */

const TODAY = "2026-10-08"; // Thu 8 Oct, as the frames are drawn

const C = { c6: "class-6", c7: "class-7", c8: "class-8", c9: "class-9", c10: "class-10", c11: "class-11c", c12: "class-12s", lkg: "class-lkg", ukg: "class-ukg" } as const;
const LABEL: Record<string, string> = { [C.c6]: "Class 6", [C.c7]: "Class 7", [C.c8]: "Class 8", [C.c9]: "Class 9", [C.c10]: "Class 10", [C.c11]: "11 Commerce", [C.c12]: "12 Science", [C.lkg]: "LKG", [C.ukg]: "UKG" };

const people: NotesPeople = {
  classTeachers: { [C.c6]: "Ms. Bhati", [C.c7]: "Mr. Choudhary", [C.c8]: "Mr. Solanki", [C.c9]: "Mr. Meena", [C.c10]: "Ms. Dave", [C.c11]: "Mr. Purohit", [C.c12]: "Mr. Bhatt", [C.lkg]: "Ms. Rathore", [C.ukg]: "Ms. Mehta" },
  coordinator: "Ms. Asha Purohit",
  admin: "Janmejay Singh",
};

const kidId = (name: string) => `kid-${name.toLowerCase().replace(/\s+/g, "-")}`;
const staffId = (name: string) => `staff-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;

function note(o: {
  id: string;
  kid: string;
  cls: string;
  by: string;
  rel?: "class_teacher" | "subject_teacher" | "admin";
  at: string;
  body: string;
  tags: NoteTag[];
  status?: "open" | "working" | "done";
  follow?: [string, "me" | "class_teacher" | "coordinator" | "admin"] | null;
  replies?: number;
  plan?: string;
  vis?: "team" | "private";
  told?: boolean;
  source?: "typed" | "voice";
}): BoardNote {
  return {
    id: o.id,
    studentId: kidId(o.kid),
    studentName: o.kid,
    classId: o.cls,
    classLabel: LABEL[o.cls]!,
    body: o.body,
    tags: o.tags,
    source: o.source ?? "typed",
    status: o.status ?? "open",
    visibility: o.vis ?? "team",
    needsFollowUp: Boolean(o.follow),
    followUpOn: o.follow?.[0] ?? null,
    followUpOwner: o.follow?.[1] ?? null,
    followUpStaffId: o.follow ? staffId(o.follow[1] === "me" ? o.by : o.follow[1] === "class_teacher" ? people.classTeachers[o.cls]! : o.follow[1] === "coordinator" ? people.coordinator! : people.admin!) : null,
    followUpName: o.follow ? (o.follow[1] === "me" ? o.by : o.follow[1] === "class_teacher" ? people.classTeachers[o.cls]! : o.follow[1] === "coordinator" ? people.coordinator : people.admin) : null,
    tellParents: o.told ?? false,
    writtenBy: staffId(o.by),
    writtenByName: o.by,
    authorRelation: o.rel ?? "class_teacher",
    subjectCode: null,
    createdAt: o.at,
    replies: o.replies ?? 0,
    planId: o.plan ?? null,
  };
}

function plan(o: { id: string; noteId: string; kid: string; cls: string; goal: string; by: string; at: string; steps: [string, string, string, boolean][]; told?: boolean }): SupportPlan {
  return {
    id: o.id,
    studentId: kidId(o.kid),
    studentName: o.kid,
    classId: o.cls,
    classLabel: LABEL[o.cls]!,
    noteId: o.noteId,
    goal: o.goal,
    status: "active",
    tellParents: o.told ?? false,
    createdBy: staffId(o.by),
    createdByName: o.by,
    createdAt: o.at,
    updatedAt: o.at,
    steps: o.steps.map(([body, owner, when, done], i) => ({ id: `${o.id}-s${i}`, body, ownerRole: owner === "Me" ? "me" : "class_teacher", ownerName: owner === "Me" || owner === "Class teacher" || owner === "Coordinator" ? null : owner, whenLabel: when, done, sortOrder: i })),
  };
}

/* ------------------------------------------------------------- the board */

const MB = "Ms. Bhati";
const BOARD_NOTES: BoardNote[] = [
  // Needs action: due today, so the board's rule (due, or unclaimed health/family) picks the frame's four.
  note({ id: "n1", kid: "Aarav Sharma", cls: C.c7, by: MB, rel: "subject_teacher", at: "2026-10-08T04:22:00Z", body: "Not submitting his Science lab notebook for 3 weeks. Says he leaves it at home.", tags: ["studies"], follow: ["2026-10-08", "class_teacher"] }),
  note({ id: "n2", kid: "Om Regar", cls: C.c6, by: MB, at: "2026-10-07T10:40:00Z", body: "Absent 3 days, father says grandmother is unwell — call again Friday.", tags: ["attendance", "family"], status: "working", follow: ["2026-10-09", "me"], replies: 1, plan: "p-n2" }),
  note({ id: "n6", kid: "Nikhil Meena", cls: C.c6, by: MB, at: "2026-10-07T07:50:00Z", body: "Attendance is 72%. Often late or absent on days the Route 2 bus is late.", tags: ["attendance"], follow: ["2026-10-08", "coordinator"] }),
  note({ id: "n3", kid: "Kabir Solanki", cls: C.c6, by: MB, at: "2026-10-06T06:00:00Z", body: "Excellent at drawing — suggest for district art competition.", tags: ["talent"], follow: ["2026-10-08", "admin"] }),
  note({ id: "n13", kid: "Aarti Kumawat", cls: C.c10, by: "Ms. Dave", at: "2026-10-06T05:00:00Z", body: "Scores well but is very worried about the board exams. A talk with the coordinator may help.", tags: ["health", "studies"], follow: ["2026-10-08", "coordinator"] }),
  note({ id: "n7", kid: "Aarav Sharma", cls: C.c7, by: "Mr. Verma", rel: "subject_teacher", at: "2026-10-06T04:00:00Z", body: "Half-yearly Maths 38 of 80 (was 61% in Unit Test 1). Finds word problems hard.", tags: ["studies"], status: "working", follow: ["2026-10-19", "class_teacher"], plan: "p-n7" }),
  note({ id: "n4", kid: "Riya Singh", cls: C.c6, by: MB, at: "2026-10-05T06:00:00Z", body: "Finds fractions hard; started practice sheets.", tags: ["studies"], status: "working", follow: ["2026-10-12", "me"], replies: 1, plan: "p-n4" }),
  note({ id: "n11", kid: "Neha Joshi", cls: C.c8, by: "Mr. Solanki", at: "2026-10-05T05:00:00Z", body: "Mother is unwell, so Neha is missing homework. Giving her extra time for the project.", tags: ["family", "studies"], status: "working", follow: ["2026-10-16", "me"], plan: "p-n11" }),
  note({ id: "n12", kid: "Mohit Agarwal", cls: C.c9, by: "Mr. Meena", at: "2026-10-05T04:00:00Z", body: "Used his phone in class twice this week. Spoke to him; parents to be called.", tags: ["behaviour"], status: "working", follow: ["2026-10-10", "admin"] }),
  note({ id: "n16", kid: "Pooja Mehta", cls: C.c11, by: "Mr. Purohit", at: "2026-10-03T06:00:00Z", body: "Won the inter-school debate in Rajsamand.", tags: ["talent"] }),
  note({ id: "n5", kid: "Khushi Sharma", cls: C.c6, by: MB, at: "2026-10-02T06:00:00Z", body: "Headache after morning assembly twice; parents informed.", tags: ["health"], status: "done", told: true }),
  note({ id: "n14", kid: "Ishita Rathore", cls: C.c12, by: "Mr. Bhatt", at: "2026-10-01T06:00:00Z", body: "Wants to prepare for NEET; asks for extra Biology practice.", tags: ["talent", "studies"], status: "working", follow: ["2026-10-15", "coordinator"], plan: "p-n14" }),
  note({ id: "n8", kid: "Aarav Sharma", cls: C.c7, by: "Ms. Sharma", rel: "subject_teacher", at: "2026-09-28T06:00:00Z", body: "Squints at the board; moved him to the front row. Suggest an eye check.", tags: ["health"], status: "done", told: true }),
  note({ id: "n9", kid: "Aarav Sharma", cls: C.c7, by: "Mr. Gurjar", rel: "subject_teacher", at: "2026-09-17T06:00:00Z", body: "Fast runner — picked for the inter-house 400 m.", tags: ["talent"] }),
  note({ id: "n10", kid: "Aarav Sharma", cls: C.c7, by: "Mr. Choudhary", at: "2026-09-04T06:00:00Z", body: "Father works in Ahmedabad; mother helps with homework. Prefers WhatsApp in Hindi.", tags: ["family"] }),
];

const AP = "Ms. Asha Purohit";
const BOARD_PLANS: SupportPlan[] = [
  plan({ id: "p-n4", noteId: "n4", kid: "Riya Singh", cls: C.c6, goal: "Fractions practice", by: MB, at: "2026-10-05T06:30:00Z", steps: [["Practice sheets twice a week (Tue and Fri)", MB, "from Tue 6 Oct", true], ["Sits with a study buddy (Aadhya Jain) in Maths", MB, "from Wed 7 Oct", true], ["20 extra minutes with the Maths teacher on Saturday", "Ms. Paliwal", "Sat 10 Oct", false], ["Short fractions check, result shared with parents", MB, "Mon 19 Oct", false], ["Coordinator looks at progress", AP, "Fri 30 Oct", false]] }),
  plan({ id: "p-n7", noteId: "n7", kid: "Aarav Sharma", cls: C.c7, goal: "Maths catch-up", by: "Mr. Verma", at: "2026-10-06T04:30:00Z", steps: [["Word-problem sheet every Monday", "Mr. Verma", "from Mon 5 Oct", true], ["Sits with Mr. Verma after lunch, twice a week", "Mr. Verma", "from Tue 6 Oct", true], ["Parents check the homework diary daily", "Mr. Choudhary", "Fri 9 Oct", false], ["Short test on word problems", "Mr. Verma", "Mon 26 Oct", false]] }),
  plan({ id: "p-n2", noteId: "n2", kid: "Om Regar", cls: C.c6, goal: "Attendance check-in", by: MB, at: "2026-10-07T11:00:00Z", steps: [["Call home on each day he is absent", MB, "daily", true], ["Send work home with his cousin", MB, "Fri 9 Oct", false], ["Meet the father if still absent on Monday", AP, "Mon 12 Oct", false]] }),
  plan({ id: "p-n11", noteId: "n11", kid: "Neha Joshi", cls: C.c8, goal: "Homework support", by: "Mr. Solanki", at: "2026-10-05T05:30:00Z", steps: [["Extra week for the project", "Mr. Solanki", "Mon 5 Oct", true], ["Library homework time", "Mr. Solanki", "Tue and Thu", false], ["Check-in every Friday", AP, "Fri 16 Oct", false]] }),
  plan({ id: "p-n14", noteId: "n14", kid: "Ishita Rathore", cls: C.c12, goal: "NEET practice", by: "Mr. Bhatt", at: "2026-10-01T06:30:00Z", steps: [["Weekly Biology set", "Mr. Bhatt", "every Sat", true], ["Monthly mock test", "Mr. Trivedi", "Sat 31 Oct", false], ["Talk with parents", AP, "Thu 15 Oct", false]] }),
];

const BOARD_KIDS: ChildChoice[] = [
  ["Aarav Sharma", C.c7, "12"], ["Riya Singh", C.c6, "21"], ["Om Regar", C.c6, "14"], ["Kabir Solanki", C.c6, "12"], ["Khushi Sharma", C.c6, "13"], ["Nikhil Meena", C.c6, "17"],
  ["Neha Joshi", C.c8, "15"], ["Mohit Agarwal", C.c9, "9"], ["Aarti Kumawat", C.c10, "3"], ["Ishita Rathore", C.c12, "8"], ["Tanvi Paliwal", C.lkg, "11"], ["Pooja Mehta", C.c11, "10"], ["Aarush Jain", C.ukg, "2"],
].map(([name, cls, roll]) => ({ id: kidId(name!), name: name!, classId: cls!, classLabel: LABEL[cls!]!, rollNo: roll! }));

const ADMIN: ClientViewer = { id: staffId("Janmejay Singh"), name: "Janmejay Singh", readsEveryClass: true, correctsAttendance: true, heldClassIds: [], canWrite: true, isAdmin: true };
const COORD: ClientViewer = { id: staffId(AP), name: AP, readsEveryClass: true, correctsAttendance: false, heldClassIds: [], canWrite: true, isCoordinator: true };

const CLASSES = Object.entries(LABEL).map(([id, label]) => ({ id, label }));
const TEACHERS = [...new Map(BOARD_NOTES.map((n) => [n.writtenBy, n.writtenByName])).entries()].map(([id, name]) => ({ id, name }));

/** A stand-in SpeechRecognition that "hears" the design's words as live (interim) text. */
function hears(words: string) {
  class Fake {
    lang = "hi-IN";
    continuous = true;
    interimResults = true;
    onresult: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    start() {
      window.setTimeout(() => this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: words } }] }), 30);
    }
    stop() {}
    abort() {}
  }
  const w = window as unknown as { SpeechRecognition: unknown; webkitSpeechRecognition: unknown };
  w.SpeechRecognition = Fake;
  w.webkitSpeechRecognition = Fake;
}

function board(o: { viewer?: ClientViewer; focus?: NotesFocus; scope?: NotesScope; sheet?: "add" | null; step?: AddStep; student?: string | null } = {}) {
  const props: NotesProps & { tab: "action"; classes: typeof CLASSES; teachers: typeof TEACHERS } = {
    notes: BOARD_NOTES,
    plans: BOARD_PLANS,
    kids: BOARD_KIDS,
    viewer: o.viewer ?? ADMIN,
    today: TODAY,
    school: "VPPS",
    focus: o.focus ?? null,
    scope: o.scope ?? null,
    people,
    initialSheet: o.sheet ?? null,
    initialStep: o.step ?? "add",
    initialStudent: o.student ?? null,
    savedId: null,
    tab: "action",
    classes: CLASSES,
    teachers: TEACHERS,
  };
  return <NotesBoard {...props} />;
}

const n1 = BOARD_NOTES.find((n) => n.id === "n1")!;
const aarav: NotesScope = { studentId: kidId("Aarav Sharma"), name: "Aarav Sharma", classLabel: "Class 7", classId: C.c7, sr: "1234", father: "Rakesh Sharma", profile: true };
const AARAV_HI = "आरव आज फिर विज्ञान की लैब कॉपी नहीं लाया। प्यार से";

/* ------------------------------------------------------------ the teacher */

const KB = "Ms. Kavita Bhati";
const TEACHER: ClientViewer = { id: staffId(KB), name: KB, readsEveryClass: false, correctsAttendance: false, heldClassIds: [C.c6], canWrite: true };
const tnote = (o: Parameters<typeof note>[0]) => ({ ...note({ ...o, by: o.by }), writtenBy: o.by === KB ? TEACHER.id : staffId(o.by), followUpStaffId: o.follow?.[1] === "me" && o.by === KB ? TEACHER.id : note(o).followUpStaffId });
const RIYA_HI = "रिया को भिन्न वाले सवालों में दिक्कत आ रही है, हफ्ते में दो बार अभ्यास शीट देंगे";
const TEACH_NOTES: BoardNote[] = [
  tnote({ id: "t1", kid: "Riya Singh", cls: C.c6, by: KB, at: "2026-10-05T06:00:00Z", body: "Finds fractions hard; started practice sheets", tags: ["studies"], status: "working", follow: ["2026-10-12", "me"], replies: 2, plan: "p-t1" }),
  tnote({ id: "t2", kid: "Om Regar", cls: C.c6, by: KB, at: "2026-10-06T06:00:00Z", body: "Absent 3 days, father says grandmother is unwell — call again Friday", tags: ["attendance", "family"], status: "working", follow: ["2026-10-09", "me"] }),
  tnote({ id: "t3", kid: "Aarav Sharma", cls: C.c7, by: KB, rel: "subject_teacher", at: "2026-10-06T05:00:00Z", body: "Not submitting lab notebook", tags: ["studies"], follow: ["2026-10-12", "class_teacher"], replies: 1 }),
  tnote({ id: "t4", kid: "Kabir Solanki", cls: C.c6, by: KB, at: "2026-09-30T06:00:00Z", body: "Excellent at drawing — suggest for district art competition", tags: ["talent"], follow: ["2026-10-16", "coordinator"] }),
  tnote({ id: "t5", kid: "Pari Sen", cls: C.c6, by: KB, at: "2026-10-07T06:00:00Z", body: "Quiet lately, sits alone at lunch — will talk to her", tags: ["behaviour"], vis: "private" }),
  tnote({ id: "t8", kid: "Pari Sen", cls: C.c6, by: "Mr. Verma", rel: "subject_teacher", at: "2026-10-05T05:00:00Z", body: "Homework not done three days this week", tags: ["studies"], follow: ["2026-10-12", "class_teacher"] }),
  tnote({ id: "t6", kid: "Khushi Sharma", cls: C.c6, by: KB, at: "2026-09-25T06:00:00Z", body: "Headache after morning assembly twice; parents informed", tags: ["health"], status: "done" }),
  tnote({ id: "t7", kid: "Neha Joshi", cls: C.c8, by: KB, rel: "subject_teacher", at: "2026-10-01T06:00:00Z", body: "Asks very good questions in Science — give her the science quiz", tags: ["talent"] }),
];
// Mr. Verma's note reaches the class teacher (her) because it is about her class.
TEACH_NOTES.find((n) => n.id === "t8")!.followUpStaffId = TEACHER.id;
const SAVED: BoardNote = { ...TEACH_NOTES[0]!, id: "x1", body: RIYA_HI, status: "open", replies: 0, planId: null, source: "voice", createdAt: "2026-10-08T04:12:00Z" };

const TEACH_PLANS: SupportPlan[] = [
  { ...plan({ id: "p-t1", noteId: "t1", kid: "Riya Singh", cls: C.c6, goal: "Finds fractions hard; started practice sheets", by: KB, at: "2026-10-05T07:00:00Z", steps: [["Extra practice sheets twice a week", "Me", "Tue & Fri", true], ["Saturday remedial class", "Coordinator", "From Sat 10 Oct", false], ["Sit in the front row", "Me", "From Fri 9 Oct", false], ["Call parents every Friday", "Me", "Every Friday", false]] }), createdBy: TEACHER.id },
];
TEACH_PLANS[0]!.steps[1]!.ownerRole = "coordinator";

const ROSTER: Record<string, string[]> = {
  [C.c6]: "Aadhya Jain,Aarav Kumawat,Ananya Vyas,Arjun Gurjar,Bhavya Paliwal,Chirag Mehta,Divya Rathore,Gaurav Choudhary,Harshita Dave,Ishaan Purohit,Jiya Kothari,Kabir Solanki,Khushi Sharma,Om Regar,Manav Joshi,Naina Chouhan,Nikhil Meena,Palak Agarwal,Pari Sen,Pranav Rawal,Riya Singh".split(","),
  [C.c7]: "Aarav Sharma,Aditya Mehta,Bhumika Jain,Chetan Kumawat,Deepika Rathore".split(","),
  [C.c8]: "Aditi Rawal,Anjali Meena,Arnav Jain,Neha Joshi".split(","),
};
const TEACH_KIDS: ChildChoice[] = Object.entries(ROSTER).flatMap(([cls, names]) => names.map((name, i) => ({ id: kidId(name), name, classId: cls, classLabel: LABEL[cls]!, rollNo: String(i + 1) })));

const T_REPLIES: NoteReply[] = [
  { id: "r1", body: "Let’s add Riya to the Saturday remedial class.", source: "typed", writtenByName: AP, writtenBy: staffId(AP), createdAt: "2026-10-06T10:40:00Z" },
  { id: "r2", body: "Good idea. I will tell her parents on Friday.", source: "typed", writtenByName: KB, writtenBy: TEACHER.id, createdAt: "2026-10-07T02:35:00Z" },
];

function teacher(o: { focus?: NotesFocus; sheet?: "add" | null; step?: AddStep; student?: string | null; saved?: string | null; notes?: BoardNote[] } = {}) {
  const props: NotesProps = {
    notes: o.notes ?? TEACH_NOTES,
    plans: TEACH_PLANS,
    kids: TEACH_KIDS,
    viewer: TEACHER,
    today: TODAY,
    school: "VPPS",
    focus: o.focus ?? null,
    scope: null,
    people: { ...people, classTeachers: { ...people.classTeachers, [C.c6]: KB } },
    initialSheet: o.sheet ?? null,
    initialStep: o.step ?? "add",
    initialStudent: o.student ?? null,
    savedId: o.saved ?? null,
  };
  return <TeachNotes {...props} />;
}

const riya = kidId("Riya Singh");
const t1 = TEACH_NOTES[0]!;

/** The review frame: words that came from the voice, as the composer's own draft keeps them. */
function draftFromVoice() {
  try {
    window.localStorage.setItem(`vx.notes.draft.${TEACHER.id}`, JSON.stringify({ studentId: riya, body: RIYA_HI, tags: ["studies"], voice: true, at: Date.now() - 2000 }));
  } catch {
    // no storage: the review frame draws as "New note"
  }
}

const B = { path: "/notes" } as const;
const T = { menu: "teacher", path: "/teach/notes" } as const;

export const views: Record<string, DesignView> = {
  Notes: { ...B, render: () => board() },
  "M-Notes": { ...B, render: () => board() },
  "AD-Notes": { menu: "academic", path: "/notes", render: () => board({ viewer: COORD }) },
  "MAD-Notes": { menu: "academic", path: "/notes", render: () => board({ viewer: COORD }) },
  "DX-Notes-Detail": { ...B, render: () => board({ focus: { kind: "note", note: n1, replies: [] } }) },
  "M-Notes-Detail": { ...B, render: () => board({ focus: { kind: "note", note: n1, replies: [] } }) },
  "DX-Notes-Student": { ...B, render: () => board({ scope: aarav }) },
  "M-Notes-Student": { ...B, render: () => board({ scope: aarav }) },
  "DX-Notes-Plan": { ...B, render: () => board({ focus: { kind: "plan", plan: BOARD_PLANS[0]! } }) },
  "M-Notes-Plan": { ...B, render: () => board({ focus: { kind: "plan", plan: BOARD_PLANS[0]! } }) },
  "M-Notes-Add": { ...B, render: () => board({ sheet: "add", student: aarav!.studentId }) },
  "DX-Notes-Listening": {
    ...B,
    render: () => {
      hears(AARAV_HI);
      return board({ sheet: "add", step: "listening", student: aarav!.studentId });
    },
  },
  "M-Notes-Listening": {
    ...B,
    render: () => {
      hears(AARAV_HI);
      return board({ sheet: "add", step: "listening", student: aarav!.studentId });
    },
  },

  TchNotes: { ...T, render: () => teacher() },
  "M-TchNotes": { ...T, render: () => teacher() },
  "DX-TchNotes-Add": { ...T, render: () => teacher({ sheet: "add", student: riya }) },
  "M-TchNotes-Add": { ...T, render: () => teacher({ sheet: "add", student: riya }) },
  "DX-TchNotes-Listening": {
    ...T,
    render: () => {
      hears("रिया को भिन्न वाले सवालों में दिक्कत आ रही");
      return teacher({ sheet: "add", step: "listening", student: riya });
    },
  },
  "M-TchNotes-Listening": {
    ...T,
    render: () => {
      hears("रिया को भिन्न वाले सवालों में दिक्कत आ रही");
      return teacher({ sheet: "add", step: "listening", student: riya });
    },
  },
  "M-TchNotes-Review": {
    ...T,
    render: () => {
      draftFromVoice();
      return teacher({ sheet: "add", step: "review", student: riya });
    },
  },
  "M-TchNotes-Saved": { ...T, render: () => teacher({ sheet: "add", step: "saved", student: riya, saved: "x1", notes: [SAVED, ...TEACH_NOTES] }) },
  "DX-TchNotes-Detail": { ...T, render: () => teacher({ focus: { kind: "note", note: t1, replies: T_REPLIES } }) },
  "M-TchNotes-Detail": { ...T, render: () => teacher({ focus: { kind: "note", note: t1, replies: T_REPLIES } }) },
  "DX-TchNotes-Plan": { ...T, render: () => teacher({ focus: { kind: "plan", plan: TEACH_PLANS[0]! } }) },
};
