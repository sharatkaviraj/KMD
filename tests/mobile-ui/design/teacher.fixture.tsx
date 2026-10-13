import { useEffect, type ReactNode } from "react";

import type { AttendData, HomeData } from "@/vx/screens/teach/data";
import type { Mark } from "@/vx/screens/teach/domain/teach";
import { TeachAttend } from "@/vx/screens/teach/ui/attend";
import { TeachHome } from "@/vx/screens/teach/ui/home";

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

export const views: Record<string, DesignView> = {
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
