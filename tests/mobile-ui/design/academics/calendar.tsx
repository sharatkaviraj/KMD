import type { DesignView } from "../../design.fixture";
import { WHATSAPP_MESSAGE_COST_RUPEES } from "@/modules/whatsapp/domain/run-measurement";
import type { AddInitial } from "@/vx/screens/calendar/client";
import { eventNotice, type CalEvent, type CalHoliday, type EventKind, type NoticeCounts } from "@/vx/screens/calendar/domain";
import { buildCalendar, type Away, type Birthday, type CalendarData, type CalendarParams, type NoticeRow } from "@/vx/screens/calendar/model";
import { CalendarView } from "@/vx/screens/calendar/view";

/*
 * School calendar: one view per design frame
 * (docs/design-handoff/screenshots/academics/*Calendar*, r-academic/*Calendar*,
 * r-exam/*Calendar*). The records copy the design's sample
 * (`Calendar.dc.html` → `data()`): October 2026 seen on Thu 8 Oct, its
 * events, the session's holidays, teachers on leave and the told PTMs. The
 * names are the design's, synthetic. The real loader (load.ts) is skipped;
 * the same pure `buildCalendar` shapes the screen.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const t24 = (t: string) => {
  const m = /^(\d{1,2}):(\d{2}) (am|pm)$/.exec(t);
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${m[2]}`;
};

const CLS: [string, number, string][] = [
  ["Nursery", 18, "Ms. Kanwar"], ["LKG", 20, "Ms. Rathore"], ["UKG", 22, "Ms. Mehta"], ["Class 1", 23, "Ms. Jain"], ["Class 2", 25, "Ms. Vyas"], ["Class 3", 24, "Ms. Sharma"], ["Class 4", 29, "Mr. Verma"],
  ["Class 5", 26, "Ms. Paliwal"], ["Class 6", 31, "Ms. Bhati"], ["Class 7", 27, "Mr. Choudhary"], ["Class 8", 28, "Mr. Solanki"], ["Class 9", 28, "Mr. Meena"], ["Class 10", 30, "Ms. Dave"],
  ["11 Science", 22, "Mr. Trivedi"], ["11 Commerce", 18, "Mr. Purohit"], ["11 Arts", 14, "Ms. Chouhan"], ["12 Science", 20, "Mr. Bhatt"], ["12 Commerce", 17, "Ms. Kothari"], ["12 Arts", 12, "Mr. Rawal"],
];
const classes = CLS.map(([label, roll], i) => ({ id: uuid(100 + i), label, roll }));
const ALL = CLS.map((_, i) => i);

type E = [key: string, kind: EventKind, title: string, s: string, e: string, tm: string, te: string, place: string, ci: number[] | null, details?: string, staff?: boolean];
const E: E[] = [
  ["teach", "event", "Teachers’ Day celebration", "2026-09-05", "", "11:00 am", "12:30 pm", "School hall", null],
  ["inst2", "fee_due", "Installment 2 due", "2026-09-15", "", "", "", "Fee counter", null, "Late fee is worked out from the fee setup and shown separately."],
  ["hy", "exam", "Half-yearly exams", "2026-09-23", "2026-10-03", "8:30 am", "11:30 am", "Exam hall", null, "No paper on Fri 2 Oct (Gandhi Jayanti)."],
  ["marks", "exam", "Half-yearly marks entry", "2026-10-05", "2026-10-09", "", "", "Sampark links", null, "Teachers enter marks through their Sampark link. Closes Fri 9 Oct, 5 pm.", true],
  ["board", "exam", "Board exam forms due", "2026-10-08", "", "", "", "School office", [12, 16, 17, 18], "Last day for signed board forms with photos."],
  ["staffm", "meeting", "Staff meeting · results review", "2026-10-10", "", "2:00 pm", "3:30 pm", "Staff room", null, undefined, true],
  ["feerem", "fee_due", "Fee reminders · Installment 2", "2026-10-12", "", "", "", "WhatsApp", null],
  ["quiz", "event", "Inter-house quiz", "2026-10-14", "", "10:00 am", "12:00 pm", "School hall", [8, 9, 10, 11]],
  ["ptm", "ptm", "Results PTM · Nursery to Class 9", "2026-10-17", "", "9:00 am", "11:30 am", "Classrooms", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
  ["ptm10", "ptm", "PTM · Class 10", "2026-10-17", "", "12:00 pm", "1:30 pm", "Class 10 room, first floor", [12], "Report cards, the board exam plan, and five minutes with each subject teacher."],
  ["ptm11", "ptm", "Results PTM · Classes 11–12", "2026-10-17", "", "12:00 pm", "1:30 pm", "Science block", [13, 14, 15, 16, 17, 18]],
  ["trials", "event", "District sports trials (U-17)", "2026-10-23", "", "8:00 am", "2:00 pm", "Govt. stadium, Rajsamand", [13, 16]],
  ["drill", "event", "Fire safety drill", "2026-10-28", "", "11:00 am", "11:30 am", "Whole campus", null],
  ["sports", "event", "Sports day", "2026-10-31", "", "8:00 am", "1:00 pm", "School ground", null, "Parents are welcome from 9 am. Prizes at 12 noon."],
  ["child", "event", "Children’s Day fun fair", "2026-11-14", "", "9:00 am", "12:00 pm", "School ground", [0, 1, 2, 3, 4, 5, 6, 7]],
  ["inst3", "fee_due", "Installment 3 due", "2026-11-15", "", "", "", "Fee counter", null],
  ["ut2", "exam", "Unit Test 2", "2026-12-07", "2026-12-12", "8:30 am", "10:30 am", "Classrooms", null],
];
const idOf = (key: string) => uuid(200 + E.findIndex((e) => e[0] === key));
const events: CalEvent[] = E.map(([key, kind, title, s, e, tm, te, place, ci, details]) => ({
  id: idOf(key),
  kind,
  title,
  titleHi: null,
  startsOn: s,
  endsOn: e || s,
  allDay: !tm,
  startsAt: t24(tm),
  endsAt: t24(te),
  place,
  classIds: (ci ?? []).map((i) => classes[i].id),
  details: details ?? null,
  createdBy: "staff-janmejay",
  cancelled: false,
}));

const H: [string, string, string, string][] = [
  ["2026-08-12", "", "Hariyali Teej", "हरियाली तीज"], ["2026-08-15", "", "Independence Day", "स्वतंत्रता दिवस"], ["2026-08-26", "", "Eid-e-Milad", "ईद-ए-मिलाद"], ["2026-08-28", "", "Raksha Bandhan", "रक्षाबंधन"],
  ["2026-09-04", "", "Janmashtami", "जन्माष्टमी"], ["2026-09-21", "", "Local holiday", "स्थानीय अवकाश"], ["2026-10-02", "", "Gandhi Jayanti", "गांधी जयंती"], ["2026-10-20", "", "Dussehra", "दशहरा"],
  ["2026-11-07", "2026-11-12", "Diwali break", "दीपावली अवकाश"], ["2026-11-24", "", "Guru Nanak Jayanti", "गुरु नानक जयंती"], ["2026-12-25", "2027-01-05", "Winter break", "शीतकालीन अवकाश"], ["2027-01-14", "", "Makar Sankranti", "मकर संक्रांति"],
  ["2027-01-26", "", "Republic Day", "गणतंत्र दिवस"], ["2027-03-06", "", "Maha Shivratri", "महाशिवरात्रि"], ["2027-03-10", "", "Eid-ul-Fitr", "ईद-उल-फ़ित्र"], ["2027-03-20", "2027-03-23", "Holi break", "होली अवकाश"],
  ["2027-03-26", "", "Good Friday", "गुड फ्राइडे"], ["2027-03-30", "", "Rajasthan Diwas", "राजस्थान दिवस"],
];
const addDay = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const holidays: CalHoliday[] = H.flatMap(([s, e, label, hi], i) => {
  const out: CalHoliday[] = [];
  for (let d = s; d <= (e || s); d = addDay(d, 1)) out.push({ id: uuid(400 + i * 20 + out.length), day: d, kind: e ? "vacation" : "holiday", label, labelHi: hi });
  return out;
});

// Teachers away (the design's `L`), by day.
const L: [string, string, string, string][] = [
  ["2026-09-29", "", "Ms. Jain", "Casual leave"], ["2026-10-08", "", "Ms. Vyas", "Casual leave"], ["2026-10-09", "", "Mr. Purohit", "Half day, after 11 am"], ["2026-10-12", "2026-10-14", "Mr. Meena", "Medical leave"],
  ["2026-10-19", "", "Ms. Kothari", "Casual leave"], ["2026-10-23", "", "Mr. Trivedi", "On duty · sports trials"], ["2026-11-02", "2026-11-03", "Ms. Rathore", "Family function"],
];
const away: Record<string, Away[]> = {};
for (const [s, e, name, reason] of L) for (let d = s; d <= (e || s); d = addDay(d, 1)) (away[d] ??= []).push({ name, reason, periods: [1, 2, 3, 4, 5, 6, 7, 8] });

// A few children's birthdays a day, as the cake counts in the month.
const KIDS = ["Kavya Jain", "Rohan Gurjar", "Aarav Sharma", "Diya Sen", "Ishaan Rathore", "Meera Paliwal", "Kabir Dave", "Saanvi Bhati"];
const birthdays: Record<string, Birthday[]> = {};
const CAKES: Record<string, number> = { "09-28": 2, "10-01": 2, "10-04": 2, "10-05": 3, "10-07": 2, "10-08": 2, "10-09": 1, "10-10": 1, "10-11": 1, "10-12": 1, "10-13": 2, "10-16": 2, "10-17": 4, "10-19": 2, "10-20": 1, "10-21": 1, "10-22": 2, "10-23": 1, "10-24": 1, "10-25": 2, "10-27": 1, "10-28": 2, "10-29": 3, "10-31": 2, "11-01": 2 };
let k = 0;
for (const [day, n] of Object.entries(CAKES)) birthdays[day] = Array.from({ length: n }, () => { const i = k++; return { studentId: uuid(900 + i), name: KIDS[i % KIDS.length], classId: classes[(i * 5) % classes.length].id }; });

// Told: the staff meeting and the three PTMs went out (design `told`); approved, sent by hand.
const TOLD: [string, number, number][] = [["staffm", 38, 38], ["ptm", 301, 293], ["ptm10", 30, 29], ["ptm11", 103, 101]];
const notices: NoticeRow[] = TOLD.map(([key, n], i) => ({ id: uuid(600 + i), eventId: idOf(key), holidayDay: null, audience: key === "staffm" ? "staff" : "parents", recipients: n, status: "approved", requestedAt: "2026-10-06T04:25:00Z", decidedAt: "2026-10-06T04:35:00Z", by: "Janmejay Singh", textHi: "", textEn: "", campaignId: uuid(700 + i) }));
const counts: Record<string, NoticeCounts> = Object.fromEntries(TOLD.map(([, n, sent], i) => [uuid(700 + i), { total: n, sent, waiting: n - sent, notSent: 0 }]));
// The text a notice was saved with is the one the calendar builds (domain `eventNotice`).
for (const nt of notices) {
  const e = events.find((x) => x.id === nt.eventId)!;
  const text = eventNotice(e, nt.audience === "staff" ? "staff" : "parents");
  nt.textEn = text.en;
  nt.textHi = text.hi ?? text.en;
}

const roll = (ids: string[]) => ids.reduce((s, id) => s + (classes.find((c) => c.id === id)?.roll ?? 0), 0);
const base: CalendarData = {
  language: "en",
  session: "2026-27",
  today: "2026-10-08",
  manage: true,
  seesMoney: true,
  everyClass: true,
  classes,
  classLabels: Object.fromEntries(classes.map((c) => [c.id, c.label])),
  events,
  holidays,
  birthdays,
  away,
  attendance: { "2026-10-08": { marked: 17, classes: 19, present: 371, counted: 402, roll: 434, notMarked: ["Class 4", "11 Arts"] } },
  notices,
  counts,
  audience: { parents: 434, staff: 38 },
  eventParents: Object.fromEntries(events.filter((e) => e.classIds.length).map((e) => [e.id, roll(e.classIds)])),
  classTeachers: Object.fromEntries(CLS.map(([, , ct], i) => [classes[i].id, ct])),
  addedBy: Object.fromEntries(events.map((e) => [e.id, "Janmejay Singh"])),
  event: null,
  nextFeeDue: events.find((e) => e.id === idOf("feerem")) ?? null,
};
void ALL;

const ADD: AddInitial = { kind: "event", title: "Science exhibition", multi: false, startsOn: "2026-10-24", endsOn: "2026-10-24", allDay: false, startsAt: "10:00", endsAt: "13:00", place: "School hall", classIds: [8, 9, 10, 11, 12].map((i) => classes[i].id), tell: true };

function Cal({ params, data = {}, add }: { params: CalendarParams; data?: Partial<CalendarData>; add?: AddInitial }) {
  const d: CalendarData = { ...base, ...data };
  if (params.eventId) d.event = events.find((e) => e.id === params.eventId) ?? null;
  return <CalendarView model={buildCalendar(d, params, WHATSAPP_MESSAGE_COST_RUPEES)} addInitial={add} />;
}

const path = "/calendar";
const academic: Partial<CalendarData> = { seesMoney: false };
const exam: Partial<CalendarData> = { seesMoney: false, manage: false };

export const views: Record<string, DesignView> = {
  Calendar: { render: () => <Cal params={{}} />, path },
  "DX-Calendar-Event": { render: () => <Cal params={{ eventId: idOf("ptm10") }} />, path },
  "DX-Calendar-Add": { render: () => <Cal params={{ sheet: "add", day: "2026-10-24" }} add={ADD} />, path },
  "DX-Calendar-Holidays": { render: () => <Cal params={{ view: "holidays", sheet: "notify", holiday: "2026-10-20" }} />, path },
  "M-Calendar": { render: () => <Cal params={{}} />, path },
  "M-Calendar-Day": { render: () => <Cal params={{ view: "day", day: "2026-10-08" }} />, path },
  "M-Calendar-Agenda": { render: () => <Cal params={{ view: "agenda" }} />, path },
  "M-Calendar-Add": { render: () => <Cal params={{ sheet: "add", day: "2026-10-24" }} add={ADD} />, path },
  "M-Calendar-Holidays": { render: () => <Cal params={{ view: "holidays" }} />, path },
  "AD-Calendar": { render: () => <Cal params={{}} data={academic} />, path, menu: "academic" },
  "MAD-Calendar": { render: () => <Cal params={{}} data={academic} />, path, menu: "academic" },
  "EX-Calendar": { render: () => <Cal params={{}} data={exam} />, path, menu: "exam" },
  "MEX-Calendar": { render: () => <Cal params={{}} data={exam} />, path, menu: "exam" },
};
