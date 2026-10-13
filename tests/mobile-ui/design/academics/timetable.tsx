import type { DesignView } from "../../design.fixture";
import type { CoverDutyView, LeaveView, TimetableData } from "@/vx/screens/timetable/data";
import { WEEK, type PendingChange, type Slot } from "@/vx/screens/timetable/domain/timetable";
import { TimetableScreen, type TimetableState } from "@/vx/screens/timetable/timetable-screen";

/*
 * Timetable & substitutions, one view per design frame
 * (docs/design-handoff/screenshots/academics/*Timetable*, r-academic/*Timetable*).
 *
 * The records are the design's own sample (`Timetable.dc.html` → `data()`):
 * its 19 classes and their rotating weekly pattern, Mr. Meena away on
 * Thursday 8 October, P3 and P5 still needing cover, two unpublished changes
 * for Class 7. The names are the design's, synthetic. The candidate order and
 * the "subs this week" counts are worked out the way the design works them.
 */

const sp = (x: string) => x.split(",");
const SNR = [1, 4, 6, 3, 0, 5];
const W3 = [0, 1, 3, 2, 4, 0, 1, 2];
const G: Record<string, [string, string, number[], number[]]> = {
  pre: ["English,Maths,Hindi,EVS,Drawing,Rhymes & play", ",,,,Ms. Regar,", [0, 1, 2, 3, 4, 0, 1, 5], [0, 2, 4, 6, 1, 3]],
  p15: ["English,Maths,Hindi,EVS,Social Sci.,Sanskrit,Computer", ",,Ms. Kumawat,,,Mr. Gurjar,Mr. Sen", [0, 1, 2, 3, 4, 5, 6, 1], [2, 5, 7, 0, 4, 1]],
  p68: ["Maths,Science,English,Hindi,Social Sci.,Sanskrit,Computer", "Mr. Joshi,Ms. Bhati,Ms. Singh,Ms. Sukhwal,Mr. Choudhary,Mr. Solanki,Ms. Agarwal", [0, 1, 2, 3, 0, 4, 5, 6], [4, 6, 2, 1, 3, 0]],
  sec: ["Science,Maths,English,Social Sci.,Hindi,Sanskrit", "Mr. Meena,Ms. Dave,Ms. Dadhich,Mr. Lohar,Mr. Saini,Mr. Tak", [0, 1, 2, 0, 3, 1, 4, 5], [0, 3, 5, 6, 2, 7]],
  sci: ["Physics,Chemistry,Maths / Bio,English,Hindi", "Mr. Trivedi,Mr. Bhatt,Ms. Shekhawat,Mr. Sisodia,Mr. Sanadhya", W3, SNR],
  com: ["Accountancy,Business St.,Economics,English,Hindi", "Mr. Purohit,Ms. Kothari,Mr. Rajawat,Mr. Sisodia,Mr. Sanadhya", W3, SNR],
  art: ["History,Geography,Political Sci.,English,Hindi Lit.", "Ms. Chouhan,Mr. Rawal,Ms. Mewara,Mr. Sisodia,Mr. Sanadhya", W3, SNR],
};
type K = { name: string; ct: string; c: number; subs: string[]; tch: string[]; w: number[]; o: number[] };
const CL: K[] = "Nursery|Ms. Kanwar|pre|0;LKG|Ms. Rathore|pre|1;UKG|Ms. Mehta|pre|2;Class 1|Ms. Jain|p15|0;Class 2|Ms. Vyas|p15|1;Class 3|Ms. Sharma|p15|2;Class 4|Mr. Verma|p15|3;Class 5|Ms. Paliwal|p15|4;Class 6|Ms. Bhati|p68|0;Class 7|Mr. Choudhary|p68|1;Class 8|Mr. Solanki|p68|2;Class 9|Mr. Meena|sec|0;Class 10|Ms. Dave|sec|1;11 Science|Mr. Trivedi|sci|0;11 Commerce|Mr. Purohit|com|2;11 Arts|Ms. Chouhan|art|4;12 Science|Mr. Bhatt|sci|1;12 Commerce|Ms. Kothari|com|3;12 Arts|Mr. Rawal|art|5"
  .split(";")
  .map((r) => {
    const a = r.split("|");
    const g = G[a[2]];
    return { name: a[0], ct: a[1], c: Number(a[3]), subs: sp(g[0]), tch: sp(g[1]).map((t) => t || a[1]), w: g[2], o: g[3] };
  });
const base = (k: K, d: number, p: number) => {
  if (d === 5 && p > 5) return { sub: "Activity", t: "" };
  const i = k.w[(p + k.c + k.o[d]) % 8];
  return { sub: k.subs[i], t: k.tch[i] };
};
const MAIN: Record<string, string> = {};
CL.forEach((k) => k.subs.forEach((s, i) => { if (!MAIN[k.tch[i]]) MAIN[k.tch[i]] = s; }));
const TEACH = Object.keys(MAIN).sort();
const hs = (x: string) => { let h = 2166136261; for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const SUBW: Record<string, number> = { "Ms. Bhati": 1, "Mr. Trivedi": 2, "Mr. Bhatt": 3, "Ms. Shekhawat": 2, "Ms. Dave": 1, "Mr. Gurjar": 2 };

const SUBJECTS: [name: string, code: string, hi: string][] = [
  ["English", "ENG", "अंग्रेज़ी"], ["Maths", "MATH", "गणित"], ["Hindi", "HIN", "हिंदी"], ["EVS", "EVS", "पर्यावरण"], ["Drawing", "DRAW", "चित्रकला"],
  ["Rhymes & play", "ART-PLAY", "कविता व खेल"], ["Social Sci.", "SST", "सामाजिक विज्ञान"], ["Sanskrit", "SKT", "संस्कृत"], ["Computer", "COMP", "कंप्यूटर"],
  ["Science", "SCI", "विज्ञान"], ["Physics", "PHY", "भौतिकी"], ["Chemistry", "CHEM", "रसायन"], ["Maths / Bio", "MATH-BIO", "गणित / जीव विज्ञान"],
  ["Accountancy", "ACC", "लेखाशास्त्र"], ["Business St.", "BST", "व्यवसाय अध्ययन"], ["Economics", "ECO", "अर्थशास्त्र"], ["History", "HIST", "इतिहास"],
  ["Geography", "GEO", "भूगोल"], ["Political Sci.", "POL", "राजनीति विज्ञान"], ["Hindi Lit.", "HIN-LIT", "हिंदी साहित्य"], ["Activity", "ACT", "गतिविधि"],
];
const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const tid = (name: string) => `t-${slug(name)}`;
const cid = (name: string) => `c-${slug(name)}`;
const sid = (name: string) => `s-${slug(name)}`;
const code = (name: string) => SUBJECTS.find((s) => s[0] === name)?.[1] ?? name;
// The design's `TINT`: two subjects are "the same" for cover when they share a colour.
const TINT: Record<string, string> = {
  English: "c1", Hindi: "warn", "Hindi Lit.": "warn", Sanskrit: "warn", Maths: "info", "Maths / Bio": "info", Science: "ok", Physics: "ok", Chemistry: "ok", EVS: "ok",
  "Social Sci.": "c3", History: "c3", Geography: "c3", "Political Sci.": "c3", Computer: "c2", Accountancy: "acc", "Business St.": "acc", Economics: "acc",
  Drawing: "bad", "Rhymes & play": "bad", Activity: "bad",
};
const family = (name: string) => TINT[name] ?? name;

const slots: Slot[] = CL.flatMap((k) =>
  WEEK.flatMap((day, d) =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((p): Slot => {
      const b = base(k, d, p);
      return b.t
        ? { day, period: p, classId: cid(k.name), classLabel: k.name, subjectId: sid(b.sub), subjectCode: code(b.sub), staffProfileId: tid(b.t), teacherShortName: b.t, parallel: false, shared: false }
        : { day, period: p, classId: cid(k.name), classLabel: k.name, subjectId: sid(b.sub), subjectCode: code(b.sub), staffProfileId: "ground", teacherShortName: "Ground", parallel: false, shared: true };
    }),
  ),
);

const change = (cls: string, d: number, p: number, to: { sub: string; t: string }, id: string): PendingChange => {
  const k = CL.find((x) => x.name === cls)!;
  const from = base(k, d, p);
  return { id, day: WEEK[d], period: p, classId: cid(cls), classLabel: cls, fromSubjectCode: code(from.sub), fromTeacher: from.t, subjectId: sid(to.sub), subjectCode: code(to.sub), staffProfileId: tid(to.t), teacherShortName: to.t, createdBy: "Janmejay", createdAt: "2026-10-08T09:05:00+05:30" };
};
const changes = [change("Class 7", 0, 1, { sub: "Maths", t: "Mr. Joshi" }, "chg-1"), change("Class 7", 0, 7, { sub: "Sanskrit", t: "Mr. Solanki" }, "chg-2")];

const leave: LeaveView[] = [
  { id: "lv-1", staffId: tid("Mr. Meena"), name: "Mr. Meena", from: "2026-10-08", to: "2026-10-09", span: "full", note: "Fever", status: "approved", createdAt: "2026-10-07T08:10:00+05:30", decidedBy: "Janmejay", decidedAt: "2026-10-07T10:00:00+05:30" },
  { id: "lv-2", staffId: tid("Ms. Jain"), name: "Ms. Jain", from: "2026-10-08", to: "2026-10-08", span: "second_half", note: "PTM at her son’s school", status: "approved", createdAt: "2026-10-06T08:10:00+05:30", decidedBy: "Janmejay", decidedAt: "2026-10-06T10:00:00+05:30" },
  { id: "lv-3", staffId: tid("Mr. Rawal"), name: "Mr. Rawal", from: "2026-10-15", to: "2026-10-15", span: "full", note: "Board exam duty", status: "approved", createdAt: "2026-10-05T08:10:00+05:30", decidedBy: "Janmejay", decidedAt: "2026-10-05T10:00:00+05:30" },
  { id: "lv-4", staffId: tid("Ms. Paliwal"), name: "Ms. Paliwal", from: "2026-10-12", to: "2026-10-13", span: "full", note: "Family wedding", status: "asked", createdAt: "2026-10-06T16:20:00+05:30" },
  { id: "lv-5", staffId: tid("Mr. Sen"), name: "Mr. Sen", from: "2026-10-09", to: "2026-10-09", span: "second_half", note: "Doctor visit", status: "asked", createdAt: "2026-10-08T07:40:00+05:30" },
  { id: "lv-6", staffId: tid("Ms. Singh"), name: "Ms. Singh", from: "2026-10-16", to: "2026-10-16", span: "full", note: "Personal work", status: "asked", createdAt: "2026-10-07T18:00:00+05:30" },
];

// Thursday (day 3): who is away when, who already covers what.
const away = (t: string, p: number) => (t === "Mr. Meena") || (t === "Ms. Jain" && p >= 5);
const cover: Record<string, string> = { "Class 10|1": "Mr. Bhatt", "Class 9|5": "Ms. Dave", "Class 1|7": "Mr. Gurjar" };
const busy = (t: string, p: number) => CL.some((k) => base(k, 3, p).t === t);
const todayN = (t: string) => Object.values(cover).filter((x) => x === t).length;
const subsW = (t: string) => (SUBW[t] ?? Math.floor(hs(t) * 3)) + todayN(t);
const needs = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((p) => CL.filter((k) => { const b = base(k, 3, p); return b.t && away(b.t, p); }).map((k) => ({ k, p, b: base(k, 3, p), key: `${k.name}|${p}` })));
const duty = (n: (typeof needs)[number]): CoverDutyView => {
  const by = cover[n.key] ?? null;
  const list = TEACH.filter((t) => !away(t, n.p) && !busy(t, n.p) && (!Object.entries(cover).some(([key, x]) => x === t && Number(key.split("|")[1]) === n.p) || by === t))
    .map((t) => {
      const same = family(MAIN[t]) === family(n.b.sub);
      const w = subsW(t) - (by === t ? 1 : 0);
      return { t, same, w };
    })
    .sort((a, b) => (a.same === b.same ? a.w - b.w : a.same ? -1 : 1));
  return {
    id: `duty-${slug(n.key)}`,
    needKey: n.key,
    period: n.p,
    classLabels: [n.k.name],
    subjectCode: code(n.b.sub),
    status: by ? "assigned" : "needs_help",
    coveringStaffId: by ? tid(by) : null,
    coveringName: by,
    suggestedStaffId: null,
    absentNames: [n.b.t],
    absentIds: [tid(n.b.t)],
    reason: by ? null : { en: "No suitable teacher could be assigned automatically", hi: "कोई योग्य अध्यापक अपने-आप नहीं मिला" },
    reasonKey: by ? null : "no_candidate",
    notice: by ? (n.p < 2 ? "read" : "delivered") : null,
    candidates: list.map((o) => ({ id: tid(o.t), name: o.t, detail: o.same ? `${MAIN[o.t]} teacher` : `teaches ${MAIN[o.t]}`, detailHi: null, blocked: false, subsThisWeek: o.w })),
  };
};

const data: TimetableData = {
  sessionLabel: "2026-27",
  today: "2026-10-08",
  week: ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"],
  version: { id: "v13", label: "v13" },
  versions: [{ id: "v13", label: "v13", publishedAt: "2026-09-28T10:00:00+05:30" }, { id: "v12", label: "v12", publishedAt: "2026-08-14T10:00:00+05:30" }, { id: "v11", label: "v11", publishedAt: "2026-07-01T10:00:00+05:30" }],
  slots,
  classes: CL.map((k) => ({ id: cid(k.name), label: k.name, classTeacher: k.ct })),
  teachers: TEACH.map((t) => ({ id: tid(t), name: t, shortName: t.split(" ")[1] })),
  subjects: SUBJECTS.map(([name, c, hi]) => ({ id: sid(name), code: c, name, nameHi: hi })),
  bells: [["08:00", "08:40"], ["08:40", "09:20"], ["09:20", "10:00"], ["10:00", "10:40"], ["11:20", "12:00"], ["12:00", "12:40"], ["12:40", "13:20"], ["13:20", "14:00"]].map(([starts, ends], index) => ({ index, starts, ends })),
  clock: "09:30",
  changes,
  leave,
  cover: {
    day: "2026-10-08",
    dayRevision: 7,
    canCommand: true,
    hasTimetable: true,
    absences: [
      { id: "ab-1", staffId: tid("Mr. Meena"), name: "Mr. Meena", periods: [0, 1, 2, 3, 4, 5, 6, 7], reason: "Fever" },
      { id: "ab-2", staffId: tid("Ms. Jain"), name: "Ms. Jain", periods: [5, 6, 7], reason: "PTM at her son’s school" },
    ],
    duties: needs.map(duty),
    staff: TEACH.map((t) => ({ id: tid(t), name: t })),
  },
  subsThisWeek: Object.fromEntries(TEACH.map((t) => [tid(t), subsW(t)])),
  me: { id: "t-janmejay", mayEdit: true, mayCover: true, mayViewCover: true },
};

const state = (s: Partial<TimetableState>): TimetableState => ({ view: "class", classId: cid("Class 9"), teacherId: null, cell: null, pick: null, duty: null, sheet: null, ...s });

// Sheets portal into `#vx-layer`, which academics.fixture.tsx creates once.
function Screen({ s }: { s: Partial<TimetableState> }) {
  return <TimetableScreen data={data} state={state(s)} previewing={false} />;
}

const path = "/timetable";
const classView = { view: "class" } as const;
const subs = { view: "subs", classId: null } as const;

export const views: Record<string, DesignView> = {
  Timetable: { render: () => <Screen s={classView} />, path },
  "DX-Timetable-Subs": { render: () => <Screen s={subs} />, path },
  "DX-Timetable-Clash": { render: () => <Screen s={{ view: "class", cell: { day: "Thursday", period: 4 }, pick: tid("Mr. Meena") }} />, path },
  "DX-Timetable-Teacher": { render: () => <Screen s={{ view: "teacher", classId: null, teacherId: tid("Mr. Meena") }} />, path },
  "M-Timetable": { render: () => <Screen s={classView} />, path },
  "M-Timetable-Subs": { render: () => <Screen s={subs} />, path },
  "M-Timetable-Assign": { render: () => <Screen s={{ ...subs, duty: "Class 9|2" }} />, path },
  "M-Timetable-Leave": { render: () => <Screen s={{ view: "leave", classId: null }} />, path },
  "M-Timetable-Publish": { render: () => <Screen s={{ view: "class", sheet: "publish" }} />, path },
  "AD-Timetable": { render: () => <Screen s={classView} />, path, menu: "academic" },
  "MAD-Timetable": { render: () => <Screen s={classView} />, path, menu: "academic" },
};
