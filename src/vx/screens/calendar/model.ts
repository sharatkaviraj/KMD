import type { Language } from "@/platform/i18n/language";
import type { IconName } from "@/vx/icons";
import { addDays, isDay, isMonth, isUuid, monthRange, shiftMonth } from "@/vx/screens/academics/domain";
import { initials } from "@/vx/format";
import { p, type Pair } from "@/vx/text";

import {
  asKind,
  attendanceLine,
  cellBars,
  dayHi,
  dayLong,
  dayPair,
  dayShort,
  daysApart,
  EVENT_KINDS,
  eventItem,
  eventNotice,
  holidayItems,
  holidayNotice,
  itemsOn,
  itemTitle,
  kindStyle,
  monShort,
  monthTitle,
  monthWeeks,
  relDay,
  schoolDays,
  sessionMonths,
  sessionText,
  time12,
  toldBadge,
  toldOf,
  visibleTo,
  weekdayOf,
  type AttendanceFacts,
  type AttendanceLine,
  type CalEvent,
  type CalHoliday,
  type CalItem,
  type CellBar,
  type EventKind,
  type NoticeAudience,
  type NoticeCounts,
  type Told,
} from "./domain";

/*
 * The school calendar as plain, serialisable props (SCREENS "Calendar").
 * `load.ts` reads the database into `CalendarData`; this turns it into what
 * each state draws; `view.tsx` draws it. Pure, so the design fixture feeds it
 * the frames' sample records and gets the same composition production does.
 */

export const BASE = "/calendar";

export type ClassRef = { id: string; label: string; roll: number };
export type Away = { name: string; reason: string | null; periods: number[] };
export type Birthday = { studentId: string; name: string; classId: string };
export type NoticeRow = {
  id: string;
  eventId: string | null;
  holidayDay: string | null;
  audience: string;
  recipients: number;
  status: string;
  requestedAt: string;
  decidedAt: string | null;
  by: string;
  textHi: string;
  textEn: string;
  campaignId: string | null;
};

export type CalendarParams = { view?: string; month?: string; day?: string; eventId?: string; sheet?: string; holiday?: string; hide?: string; kind?: string };

/** Everything the calendar reads, for the state asked for. */
export type CalendarData = {
  language: Language;
  session: string;
  today: string;
  /** `academics:manage`: add, cancel, ask to notify. */
  manage: boolean;
  /** `fees:view`: fee dates and the fee card. */
  seesMoney: boolean;
  everyClass: boolean;
  /** The reader's classes, in school order, with children on the roll. */
  classes: ClassRef[];
  /** Every class's name, for events that name classes outside the reader's. */
  classLabels: Record<string, string>;
  events: CalEvent[];
  holidays: CalHoliday[];
  /** Children's birthdays by "MM-DD". */
  birthdays: Record<string, Birthday[]>;
  /** Staff away, by day. */
  away: Record<string, Away[]>;
  /** The register, by day, for the days asked about. */
  attendance: Record<string, AttendanceFacts>;
  /** Notices, newest first. */
  notices: NoticeRow[];
  /** What happened to an approved notice's messages, by campaign. */
  counts: Record<string, NoticeCounts>;
  /** Whole school: children on the roll (one message each) and active staff. */
  audience: { parents: number; staff: number };
  /** Children on the roll of an event's classes, by event id. */
  eventParents?: Record<string, number>;
  /** Class teacher by class id. */
  classTeachers?: Record<string, string>;
  /** Who added an event, by event id. */
  addedBy?: Record<string, string>;
  /** The event asked for by `?event=`, read even when cancelled or outside the window. */
  event?: CalEvent | null;
  /** The next fee date on the calendar after the day shown. */
  nextFeeDue?: CalEvent | null;
};

/* ------------------------------------------------------------ the model */

export type Tone = "ok" | "warn" | "bad" | "info" | "mut" | "acc";
export type Badge = { text: Pair; tone: Tone };

export type Row = {
  id: string;
  kind: EventKind;
  title: Pair;
  /** "11:00 am – 12:30 pm", "Mon 5 Oct – Fri 9 Oct", "All day". */
  time: Pair;
  /** "School hall · All classes". */
  sub: Pair;
  /** The time column: "2:00 pm" over "3:30 pm", or "All day" over "Day 4 of 5". */
  t1: Pair;
  t2: Pair | null;
  badge: Badge | null;
  cancelled: boolean;
  href: string;
};

export type Chip = { kind: EventKind; label: Pair; n: number; on: boolean; href: string };
export type Cell = { day: string; d: number; inMonth: boolean; sunday: boolean; selected: boolean; today: boolean; births: number; bars: CellBar[]; more: number; dots: EventKind[]; href: string; aria: string };
export type Fact = { icon: IconName; tone: string; text: Pair };

export type Head = {
  crumb: Pair;
  title: Pair;
  mTitle: Pair;
  mSub: Pair;
  /** A top screen (month, agenda, holidays) shows the view switch and Add; the rest show Back. */
  top: boolean;
  back: { href: string; label: Pair } | null;
  /** Where the phone's back arrow goes. */
  mBack: string;
};

export type Common = {
  language: Language;
  today: string;
  manage: boolean;
  view: "month" | "agenda" | "holidays";
  seg: { month: string; agenda: string; holidays: string };
  addHref: string | null;
  head: Head;
};

export type DayPanelModel = { day: string; rel: Pair; isToday: boolean; title: Pair; addHref: string | null; rows: Row[]; empty: Pair; facts: Fact[]; openHref: string };

export type MonthModel = {
  title: Pair;
  sub: Pair;
  todayHref: string;
  prevHref: string;
  nextHref: string;
  chips: Chip[];
  weekdays: { long: Pair; short: Pair; sunday: boolean }[];
  weeks: Cell[][];
  panel: DayPanelModel;
};

export type DayModel = {
  day: string;
  mon: string;
  d: number;
  rel: Pair;
  isToday: boolean;
  long: Pair;
  short: Pair;
  prevHref: string;
  nextHref: string;
  addHref: string | null;
  attendance: AttendanceLine;
  rows: Row[];
  empty: Pair;
  fee: { line: Pair; sub: Pair; href: string } | null;
  leave: { name: string; ini: string; line: Pair }[];
  births: { name: string; ini: string; sub: Pair }[];
};

export type AgendaModel = {
  range: Pair;
  chips: Chip[];
  groups: { day: string; head: Pair; date: Pair; isToday: boolean; note: Pair | null; href: string; rows: Row[] }[];
  empty: "none" | "filtered" | null;
  clearHref: string;
};

export type HolidayRow = { key: string; mon: string; d: number; name: Pair; when: string; days: Pair; past: boolean; badge: Badge | null; tellHref: string | null; href: string };

export type HolidaysModel = {
  kpis: { k: Pair; v: Pair; sub: Pair; tone: string }[];
  title: Pair;
  line: Pair;
  addHref: string | null;
  editHref: string | null;
  rows: HolidayRow[];
};

export type ToldCard =
  | { state: "none" | "declined"; head: Pair; line: Pair; tell: { href: string; label: Pair } | null }
  | { state: "asked"; head: Pair; line: Pair; open: string }
  | { state: "approved"; head: Pair; when: string; line: Pair; sent: number; total: number; rows: { k: Pair; v: number; c: string }[]; open: string | null };

export type EventModel = {
  id: string;
  kind: EventKind;
  holiday: boolean;
  title: Pair;
  sub: Pair;
  rel: Pair;
  cancelled: boolean;
  facts: { k: Pair; v: Pair; icon: IconName }[];
  note: Pair | null;
  who: { icon: IconName; label: Pair; sub: Pair }[];
  told: ToldCard;
  bubbleHead: Pair;
  bubble: Pair;
  bubbleTime: string;
  ticks: boolean;
  cancel: { id: string; title: Pair } | null;
};

export type AddModel = {
  day: string;
  kind: EventKind;
  classes: ClassRef[];
  parents: number;
  staff: number;
  feeKinds: boolean;
  backHref: string;
};

export type NotifyModel = {
  closeHref: string;
  holidayDay?: string;
  eventId?: string;
  head: Pair;
  line: Pair;
  options: { key: NoticeAudience; label: Pair; sub: Pair; n: number; preview: Pair }[];
  initial: NoticeAudience;
  already: Pair | null;
};

export type CalendarModel =
  | { screen: "closed"; language: Language }
  | { screen: "month"; common: Common; month: MonthModel; notify: NotifyModel | null }
  | { screen: "agenda"; common: Common; agenda: AgendaModel; notify: NotifyModel | null }
  | { screen: "holidays"; common: Common; holidays: HolidaysModel; notify: NotifyModel | null }
  | { screen: "day"; common: Common; day: DayModel; notify: NotifyModel | null }
  | { screen: "event"; common: Common; event: EventModel | null; notify: NotifyModel | null }
  | { screen: "add"; common: Common; add: AddModel };

/* ------------------------------------------------------------- helpers */

export function href(params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `${BASE}?${s}` : BASE;
}

const WEEKDAYS: [string, string, string, string][] = [
  ["Mon", "सोम", "M", "सो"],
  ["Tue", "मंगल", "T", "मं"],
  ["Wed", "बुध", "W", "बु"],
  ["Thu", "गुरु", "T", "गु"],
  ["Fri", "शुक्र", "F", "शु"],
  ["Sat", "शनि", "S", "श"],
  ["Sun", "रवि", "S", "र"],
];

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function joinAnd(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A timestamp as the school's calendar day and clock. */
function ist(ts: string): { day: string; time: string } {
  const t = new Date(Date.parse(ts) + 330 * 60_000).toISOString();
  return { day: t.slice(0, 10), time: t.slice(11, 16) };
}

function rupeesAbout(n: number): string {
  return `₹${Math.max(1, Math.round(n)).toLocaleString("en-IN")}`;
}

/* --------------------------------------------------------------- build */

export function buildCalendar(data: CalendarData, params: CalendarParams, rate: number): CalendarModel {
  const { today } = data;
  const mine = new Set(data.classes.map((c) => c.id));
  const order = new Map(data.classes.map((c, i) => [c.id, i]));
  const label = (id: string) => data.classLabels[id] ?? data.classes.find((c) => c.id === id)?.label ?? "—";
  const shown = (e: CalEvent) => !e.cancelled && visibleTo(e, data.everyClass, mine) && (data.seesMoney || e.kind !== "fee_due");
  const hidden = new Set((params.hide ?? "").split(",").filter((k): k is EventKind => (EVENT_KINDS as readonly string[]).includes(k)));
  const hide = hidden.size ? [...hidden].join(",") : undefined;
  const kinds = EVENT_KINDS.filter((k) => data.seesMoney || k !== "fee_due");

  const all: CalItem[] = [...holidayItems(data.holidays), ...data.events.filter(shown).map(eventItem)];
  const vis = all.filter((e) => !hidden.has(e.kind));

  const noticeFor = (e: Pick<CalItem, "id" | "holidayDay">): NoticeRow | undefined =>
    data.notices.find((n) => (e.holidayDay ? n.holidayDay === e.holidayDay : n.eventId === e.id));
  const toldFor = (e: Pick<CalItem, "id" | "holidayDay">): Told => {
    const n = noticeFor(e);
    return toldOf(n, n?.campaignId ? data.counts[n.campaignId] : null);
  };

  const classLine = (e: Pick<CalItem, "classIds" | "holidayDay">): Pair => {
    if (e.holidayDay) return p("Whole school", "पूरा विद्यालय");
    if (!e.classIds.length) return p("All classes", "सभी कक्षाएँ");
    const names = [...e.classIds].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999)).map(label);
    if (names.length <= 3) return p(joinAnd(names), names.join(", "));
    return p(`${names.length} classes`, `${names.length} कक्षाएँ`);
  };

  const itemHref = (e: CalItem) => (e.holidayDay ? href({ holiday: e.holidayDay }) : href({ event: e.id }));

  const row = (e: CalItem, day: string): Row => {
    const multi = e.startsOn !== e.endsOn;
    const timed = !e.allDay && !!e.startsAt;
    const cl = classLine(e);
    const sub = p([e.place, cl.en].filter(Boolean).join(" · "), [e.place, cl.hi ?? cl.en].filter(Boolean).join(" · "));
    const nth = daysApart(e.startsOn, day) + 1;
    const of = daysApart(e.startsOn, e.endsOn) + 1;
    const time = timed
      ? p(`${time12(e.startsAt)}${e.endsAt ? ` – ${time12(e.endsAt)}` : ""}`)
      : multi
        ? p(`${dayShort(e.startsOn)} – ${dayShort(e.endsOn)}`, `${dayHi(e.startsOn)} – ${dayHi(e.endsOn)}`)
        : p("All day", "पूरे दिन");
    const t = toldFor(e);
    const b = toldBadge(t);
    return {
      id: e.id,
      kind: e.kind,
      title: itemTitle(e),
      time,
      sub,
      t1: timed ? p(time12(e.startsAt)) : p("All day", "पूरे दिन"),
      t2: timed ? (e.endsAt ? p(time12(e.endsAt)) : null) : multi ? p(`Day ${nth} of ${of}`, `${of} में से दिन ${nth}`) : null,
      badge: b,
      cancelled: e.cancelled,
      href: itemHref(e),
    };
  };

  const kidsOn = (day: string) => (data.birthdays[day.slice(5)] ?? []).filter((b) => data.everyClass || mine.has(b.classId));
  const closedOn = (day: string): Pair | null => {
    const h = all.find((e) => e.holidayDay && e.startsOn <= day && day <= e.endsOn);
    return h ? itemTitle(h) : null;
  };
  const attendance = (day: string) => attendanceLine(day, today, closedOn(day), data.attendance[day] ?? null);

  /* ------------------------------------------------ which state, and its top */

  const sessionLine = sessionText(data.session);
  const crumbTop = p(`Academics · Session ${sessionLine}`, `शैक्षणिक · सत्र ${sessionLine}`);
  const listView: Common["view"] = params.view === "agenda" ? "agenda" : params.view === "holidays" ? "holidays" : "month";
  const seg = { month: href({ month: params.month, hide }), agenda: href({ view: "agenda", hide }), holidays: href({ view: "holidays" }) };
  const common = (view: Common["view"], head: Head, addHref: string | null): Common => ({ language: data.language, today, manage: data.manage, view, seg, addHref, head });

  const dayParam = isDay(params.day) ? params.day : null;
  const holidayParam = isDay(params.holiday) ? params.holiday : null;

  /* ------------------------------------------------------------ notify */

  const notifyFor = (closeHref: string): NotifyModel | null => {
    if (params.sheet !== "notify" || !data.manage) return null;
    const target = holidayParam
      ? all.find((e) => e.holidayDay && e.startsOn <= holidayParam && holidayParam <= e.endsOn)
      : isUuid(params.eventId)
        ? (data.event && shown(data.event) ? eventItem(data.event) : undefined)
        : undefined;
    if (!target || target.cancelled) return null;
    const staffOnly = target.kind === "meeting";
    const cl = classLine(target);
    const parents = target.holidayDay || !target.classIds.length ? data.audience.parents : data.eventParents?.[target.id] ?? data.audience.parents;
    const staff = data.audience.staff;
    const text = (aud: NoticeAudience) => (target.holidayDay ? holidayNotice(target.title, target.titleHi, target.startsOn, target.endsOn, aud) : eventNotice(target, aud));
    const whole = !!target.holidayDay || !target.classIds.length;
    const opt = (key: NoticeAudience, labelP: Pair, sub: Pair, n: number) => ({ key, label: labelP, sub, n, preview: text(key) });
    const options = staffOnly
      ? [opt("staff", p("All staff", "सारा स्टाफ़"), p("Teachers and office", "अध्यापक और कार्यालय"), staff)]
      : [
          opt("parents", whole ? p("All parents", "सभी अभिभावक") : p(`Parents · ${cl.en}`, `अभिभावक · ${cl.hi}`), whole ? p("One message per student", "हर विद्यार्थी पर एक संदेश") : p("Only the classes in this event", "केवल इस कार्यक्रम की कक्षाएँ"), parents),
          opt("staff", p("All staff", "सारा स्टाफ़"), p("Teachers and office", "अध्यापक और कार्यालय"), staff),
          opt("both", p("Parents and staff", "अभिभावक और स्टाफ़"), p("Everyone", "सभी"), parents + staff),
        ];
    const t = toldFor(target);
    const b = toldBadge(t);
    const multi = target.startsOn !== target.endsOn;
    return {
      closeHref,
      holidayDay: target.holidayDay ?? undefined,
      eventId: target.holidayDay ? undefined : target.id,
      head: target.holidayDay ? p(`Holiday notice · ${target.title}`, `अवकाश सूचना · ${target.titleHi || target.title}`) : p(`Tell about · ${target.title}`, `सूचना · ${target.titleHi || target.title}`),
      line: multi ? p(`${dayShort(target.startsOn)} – ${dayShort(target.endsOn)}`, `${dayHi(target.startsOn)} – ${dayHi(target.endsOn)}`) : dayPair(target.startsOn, true),
      options,
      initial: staffOnly ? "staff" : "parents",
      already: b && t.state !== "declined" ? p(`Already asked: ${b.text.en}`, `पहले ही माँगी: ${b.text.hi ?? b.text.en}`) : null,
    };
  };

  /* --------------------------------------------------------------- add */

  if (params.sheet === "add" && data.manage) {
    const day = dayParam && dayParam >= today ? dayParam : today;
    const backHref = href({ view: params.view === "agenda" || params.view === "holidays" || params.view === "day" ? params.view : undefined, month: params.month, day: params.day });
    const kind = asKind(params.kind ?? "event");
    return {
      screen: "add",
      common: common(listView, { crumb: p("Calendar", "कैलेंडर"), title: p("Add event", "कार्यक्रम जोड़ें"), mTitle: p("Add event", "कार्यक्रम जोड़ें"), mSub: p("Fill in, check the preview, save", "भरें, पूर्वावलोकन देखें, सहेजें"), top: false, back: { href: backHref, label: p("Back to calendar", "कैलेंडर पर लौटें") }, mBack: backHref }, null),
      add: { day, kind: kind === "fee_due" && !data.seesMoney ? "event" : kind, classes: data.classes, parents: data.audience.parents, staff: data.audience.staff, feeKinds: data.seesMoney, backHref },
    };
  }

  /* ------------------------------------------------------- event / holiday */

  if (isUuid(params.eventId) || (holidayParam && !params.view)) {
    const item = holidayParam && !isUuid(params.eventId)
      ? all.find((e) => e.holidayDay && e.startsOn <= holidayParam && holidayParam <= e.endsOn) ?? null
      : data.event && visibleTo(data.event, data.everyClass, mine) && (data.seesMoney || data.event.kind !== "fee_due")
        ? eventItem(data.event)
        : null;
    const back = href({ month: item ? item.startsOn.slice(0, 7) : undefined, day: item?.startsOn });
    const k = item ? kindStyle(item.kind) : kindStyle("event");
    const head: Head = {
      crumb: p(`Calendar · ${k.label.en}`, `कैलेंडर · ${k.label.hi}`),
      title: item ? itemTitle(item) : p("Event", "कार्यक्रम"),
      mTitle: item ? itemTitle(item) : p("Event", "कार्यक्रम"),
      mSub: item ? p(`${item.startsOn !== item.endsOn ? `${dayShort(item.startsOn)} – ${dayShort(item.endsOn)}` : dayShort(item.startsOn)}${!item.allDay && item.startsAt ? ` · ${time12(item.startsAt)}` : ""}`) : p(""),
      top: false,
      back: { href: back, label: p("Back to calendar", "कैलेंडर पर लौटें") },
      mBack: back,
    };
    const selfHref = item?.holidayDay ? href({ holiday: item.holidayDay }) : href({ event: params.eventId });
    if (!item) return { screen: "event", common: common(listView, head, null), event: null, notify: null };

    const staffAud = item.kind === "meeting";
    const aud = staffAud ? p("staff", "स्टाफ़") : p("parents", "अभिभावक");
    const n = item.holidayDay || !item.classIds.length ? data.audience.parents : data.eventParents?.[item.id] ?? data.audience.parents;
    const reach = staffAud ? data.audience.staff : n;
    const dEv = daysApart(today, item.startsOn);
    const rel = dEv === 0 ? p("Today", "आज") : dEv > 0 ? p(`In ${plural(dEv, "day")}`, `${dEv} दिन बाद`) : item.endsOn >= today ? p("On now", "चल रहा है") : p("Done", "हो गया");
    const cl = classLine(item);
    const multi = item.startsOn !== item.endsOn;
    const facts: EventModel["facts"] = [
      { k: p("Date", "तारीख़"), v: multi ? p(`${dayShort(item.startsOn)} – ${dayShort(item.endsOn)}`, `${dayHi(item.startsOn)} – ${dayHi(item.endsOn)}`) : dayPair(item.startsOn, true), icon: "calendar" },
      { k: p("Time", "समय"), v: !item.allDay && item.startsAt ? p(`${time12(item.startsAt)}${item.endsAt ? ` – ${time12(item.endsAt)}` : ""}`) : p("All day", "पूरे दिन"), icon: "clock" },
      { k: p("Place", "जगह"), v: item.place ? p(item.place) : p("School", "विद्यालय"), icon: "mapPin" },
      { k: p("Classes", "कक्षाएँ"), v: cl, icon: "users" },
    ];
    const teachers = item.classIds.map((id) => data.classTeachers?.[id]).filter((x): x is string => !!x);
    const who: EventModel["who"] = item.holidayDay
      ? [{ icon: "home", label: p("Whole school", "पूरा विद्यालय"), sub: p(`${data.audience.parents} students and ${data.audience.staff} staff · school closed`, `${data.audience.parents} विद्यार्थी और ${data.audience.staff} स्टाफ़ · विद्यालय बंद`) }]
      : staffAud
        ? [
            { icon: "users", label: item.classIds.length ? cl : p("All staff", "सारा स्टाफ़"), sub: p(`${data.audience.staff} people`, `${data.audience.staff} लोग`) },
            ...(data.addedBy?.[item.id] ? [{ icon: "user" as IconName, label: p(data.addedBy[item.id]), sub: p("Added it to the calendar", "कैलेंडर में जोड़ा") }] : []),
          ]
        : [
            { icon: "users", label: item.classIds.length ? p(`Parents of ${cl.en}`, `${cl.hi} के अभिभावक`) : p("Parents · All classes", "अभिभावक · सभी कक्षाएँ"), sub: p(`${n} ${n === 1 ? "parent" : "parents"} · one message per child`, `${n} अभिभावक · हर बच्चे पर एक संदेश`) },
            ...(item.kind === "fee_due"
              ? []
              : [{ icon: "user" as IconName, label: p("Class teachers", "कक्षा अध्यापक"), sub: teachers.length && teachers.length <= 3 ? p(joinAnd(teachers), teachers.join(", ")) : p("Of the classes taking part", "भाग लेने वाली कक्षाओं के") }]),
          ];

    const notice = noticeFor(item);
    const t = toldOf(notice, notice?.campaignId ? data.counts[notice.campaignId] : null);
    const canTell = data.manage && !item.cancelled;
    const tellHref = canTell ? (item.holidayDay ? href({ holiday: item.holidayDay, sheet: "notify" }) : href({ event: item.id, sheet: "notify" })) : null;
    const tellLabel = p(`Tell ${reach} ${aud.en} · about ${rupeesAbout(reach * rate)}`, `${reach} ${aud.hi} को बताएँ · लगभग ${rupeesAbout(reach * rate)}`);
    let told: ToldCard;
    if (t.state === "approved") {
      const when = notice?.decidedAt ? ist(notice.decidedAt) : null;
      told = {
        state: "approved",
        head: p("Told on WhatsApp", "WhatsApp पर बताया"),
        when: when ? `${dayShort(when.day)}, ${time12(when.time)}` : "",
        line: p(`Sent to ${t.sent} of ${t.n} ${aud.en}`, `${t.n} ${aud.hi} में से ${t.sent} को भेजा`),
        sent: t.sent,
        total: t.n,
        rows: [
          { k: p("Sent by hand", "हाथ से भेजा"), v: t.sent, c: "var(--ok)" },
          { k: p("Waiting in To send", "भेजने को में बाक़ी"), v: t.waiting, c: "var(--okm)" },
          { k: p("Not sent", "नहीं भेजा"), v: t.notSent, c: "var(--bad)" },
        ],
        open: t.waiting > 0 ? "/messages?view=outbox" : null,
      };
    } else if (t.state === "asked") {
      const at = notice ? ist(notice.requestedAt) : null;
      told = { state: "asked", head: p("Saved, not sent", "सहेजी, भेजी नहीं"), line: p(`Waits for approval in Messages → To send · ${t.n} ${aud.en}${notice ? ` · asked by ${notice.by}${at ? ` on ${dayShort(at.day)}` : ""}` : ""}.`, `संदेश → भेजने को में मंज़ूरी की प्रतीक्षा · ${t.n} ${aud.hi}${notice ? ` · ${notice.by} ने माँगी` : ""}।`), open: "/messages?view=outbox" };
    } else {
      told = {
        state: t.state,
        head: p("Not told yet", "अभी नहीं बताया"),
        line: item.cancelled ? p("This event is cancelled.", "यह कार्यक्रम रद्द है।") : t.state === "declined" ? p("The last notice was turned down in Messages.", "पिछली सूचना संदेश में अस्वीकृत हुई।") : p(`No WhatsApp has gone to ${aud.en} about this yet.`, `इसके बारे में अभी ${aud.hi} को कोई WhatsApp नहीं गया।`),
        tell: tellHref ? { href: tellHref, label: tellLabel } : null,
      };
    }
    const audience: NoticeAudience = staffAud ? "staff" : "parents";
    const preview = item.holidayDay ? holidayNotice(item.title, item.titleHi, item.startsOn, item.endsOn, audience) : eventNotice(item, audience);
    const bubble = notice && t.state !== "declined" ? p(notice.textEn, notice.textHi) : preview;
    const sentAt = t.state === "approved" && notice?.decidedAt ? ist(notice.decidedAt) : null;
    const event: EventModel = {
      id: item.id,
      kind: item.kind,
      holiday: !!item.holidayDay,
      title: itemTitle(item),
      sub: p(`${k.label.en} · ${dayLong(item.startsOn)}`, `${item.titleHi && item.titleHi !== item.title ? item.titleHi : k.noun} · ${dayHi(item.startsOn)}`),
      rel,
      cancelled: item.cancelled,
      facts,
      note: item.holidayDay ? p("School is closed. Attendance is not taken and the timetable skips this day.", "विद्यालय बंद है। हाज़िरी नहीं लगती और समय सारणी यह दिन छोड़ देती है।") : item.details ? p(item.details) : null,
      who,
      told,
      bubbleHead: t.state === "approved" && t.sent > 0 ? p("What they got", "उन्हें क्या मिला") : t.state === "asked" || t.state === "approved" ? p("What they will get", "उन्हें क्या मिलेगा") : p("What they would get", "उन्हें क्या मिलेगा"),
      bubble,
      bubbleTime: sentAt ? time12(sentAt.time) : "preview",
      ticks: t.state === "approved" && t.sent > 0,
      cancel: data.manage && !item.holidayDay && !item.cancelled ? { id: item.id, title: itemTitle(item) } : null,
    };
    return { screen: "event", common: common(listView, head, null), event, notify: notifyFor(selfHref) };
  }

  const addHrefFor = (extra: Record<string, string | undefined>) => (data.manage ? href({ ...extra, sheet: "add" }) : null);
  const topHead = (mTitle: Pair, mSub: Pair): Head => ({ crumb: crumbTop, title: p("Calendar", "कैलेंडर"), mTitle, mSub, top: true, back: null, mBack: "/menu" });

  const chipsFor = (counts: Record<string, number> | null, extra: Record<string, string | undefined>): Chip[] =>
    kinds.map((kind) => {
      const next = new Set(hidden);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return { kind, label: kindStyle(kind).label, n: counts ? counts[kind] ?? 0 : -1, on: !hidden.has(kind), href: href({ ...extra, hide: next.size ? [...next].join(",") : undefined }) };
    });

  /* --------------------------------------------------------------- day */

  if (params.view === "day") {
    const day = dayParam ?? today;
    const rows = itemsOn(all, day).map((e) => row(e, day));
    const lv = data.away[day] ?? [];
    const kids = kidsOn(day);
    const fe = itemsOn(all, day).find((e) => e.kind === "fee_due");
    const rel = relDay(day, today);
    const sunday = weekdayOf(day) === 0;
    const model: DayModel = {
      day,
      mon: monShort(day),
      d: Number(day.slice(8)),
      rel,
      isToday: day === today,
      long: dayPair(day, true),
      short: dayPair(day),
      prevHref: href({ view: "day", day: addDays(day, -1) }),
      nextHref: href({ view: "day", day: addDays(day, 1) }),
      addHref: addHrefFor({ view: "day", day }),
      attendance: attendance(day),
      rows,
      empty: sunday ? p("Sunday — school is closed.", "रविवार — विद्यालय बंद।") : p("Nothing planned — a normal school day.", "कुछ तय नहीं — सामान्य दिन।"),
      fee: data.seesMoney
        ? fe
          ? { line: itemTitle(fe), sub: fe.details ? p(fe.details) : p("Late fee is shown separately.", "विलंब शुल्क अलग दिखाया जाता है।"), href: "/dues" }
          : {
              line: p("No fee date on this day", "इस दिन कोई फीस तारीख़ नहीं"),
              sub: data.nextFeeDue ? p(`Next: ${data.nextFeeDue.title} on ${dayShort(data.nextFeeDue.startsOn)}.`, `अगली: ${data.nextFeeDue.titleHi || data.nextFeeDue.title}, ${dayHi(data.nextFeeDue.startsOn)}।`) : p("No later fee date is on the calendar.", "कैलेंडर में आगे कोई फीस तारीख़ नहीं।"),
              href: "/dues",
            }
        : null,
      leave: lv.map((l) => ({ name: l.name, ini: initials(l.name), line: awayLine(l) })),
      births: kids.map((b) => ({ name: b.name, ini: initials(b.name), sub: p(`${label(b.classId)} · student`, `${label(b.classId)} · विद्यार्थी`) })),
    };
    const head: Head = {
      crumb: p(`Calendar · ${monthTitle(day.slice(0, 7)).en}`, `कैलेंडर · ${monthTitle(day.slice(0, 7)).hi}`),
      title: dayPair(day, true),
      mTitle: dayPair(day),
      mSub: p(`${rel.en} · events · ${rows.length}`, `${rel.hi} · कार्यक्रम · ${rows.length}`),
      top: false,
      back: { href: href({ month: day.slice(0, 7), day }), label: p("Back to calendar", "कैलेंडर पर लौटें") },
      mBack: href({ month: day.slice(0, 7), day }),
    };
    return { screen: "day", common: common("month", head, model.addHref), day: model, notify: notifyFor(href({ view: "day", day })) };
  }

  /* ------------------------------------------------------------ agenda */

  if (params.view === "agenda") {
    const groups: AgendaModel["groups"] = [];
    let count = 0;
    for (let i = 0; i < 30; i++) {
      const dk = addDays(today, i);
      const de = itemsOn(vis, dk);
      const dl = data.away[dk] ?? [];
      if (!de.length && !dl.length) continue;
      const bn = kidsOn(dk).length;
      const notes: Pair[] = [];
      if (bn) notes.push(p(plural(bn, "birthday"), `${bn} जन्मदिन`));
      if (dl.length) notes.push(p(`${dl.map((l) => l.name).join(", ")} on leave`, `${dl.map((l) => l.name).join(", ")} छुट्टी पर`));
      const pre = i === 0 ? p("Today", "आज") : i === 1 ? p("Tomorrow", "कल") : null;
      groups.push({
        day: dk,
        head: pre ? p(`${pre.en} · ${dayShort(dk)}`, `${pre.hi} · ${dayHi(dk)}`) : dayPair(dk),
        date: dayPair(dk),
        isToday: i === 0,
        note: notes.length ? p(notes.map((x) => x.en).join(" · "), notes.map((x) => x.hi ?? x.en).join(" · ")) : null,
        href: href({ view: "day", day: dk }),
        rows: de.map((e) => row(e, dk)),
      });
      count += de.length;
    }
    const last = addDays(today, 29);
    const model: AgendaModel = {
      range: p(`${dayShort(today)} – ${dayShort(last)} · ${plural(count, "event")}`, `${dayHi(today)} – ${dayHi(last)} · ${count} कार्यक्रम`),
      chips: chipsFor(null, { view: "agenda" }),
      groups,
      empty: groups.length ? null : hidden.size ? "filtered" : "none",
      clearHref: href({ view: "agenda" }),
    };
    return { screen: "agenda", common: common("agenda", topHead(p("Calendar", "कैलेंडर"), p("Next 30 days", "अगले 30 दिन")), addHrefFor({ view: "agenda" })), agenda: model, notify: notifyFor(href({ view: "agenda", hide })) };
  }

  /* ---------------------------------------------------------- holidays */

  if (params.view === "holidays") {
    const runs = all.filter((e) => e.holidayDay).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    const closed = new Set<string>();
    for (const r of runs) for (let d = r.startsOn; d <= r.endsOn; d = addDays(d, 1)) closed.add(d);
    const work = sessionMonths(data.session, today).reduce((s, m) => s + schoolDays(m, closed), 0);
    const totalH = runs.reduce((s, r) => s + daysApart(r.startsOn, r.endsOn) + 1, 0);
    const next = runs.find((r) => r.startsOn > today);
    const nd = next ? daysApart(today, next.startsOn) : 0;
    const model: HolidaysModel = {
      kpis: [
        { k: p("Working days", "कार्य दिवस"), v: p(String(work)), sub: p("this session", "इस सत्र"), tone: "var(--fg)" },
        { k: p("Holidays", "छुट्टियाँ"), v: p(String(totalH)), sub: p(plural(runs.length, "date"), `${runs.length} तारीख़ें`), tone: "var(--bad)" },
        { k: p("Next holiday", "अगली छुट्टी"), v: next ? p(plural(nd, "day"), `${nd} दिन`) : p("—"), sub: next ? p(`${next.title} · ${dayShort(next.startsOn)}`, `${next.titleHi || next.title} · ${dayHi(next.startsOn)}`) : p("None left", "कोई नहीं बची"), tone: "var(--acc)" },
      ],
      title: p(`Session holidays ${sessionLine}`, `सत्र की छुट्टियाँ ${sessionLine}`),
      line: p(`Working days this session: ${work} · holidays ${totalH}`, `इस सत्र कार्य दिवस: ${work} · छुट्टियाँ ${totalH}`),
      addHref: data.manage ? href({ view: "holidays", sheet: "add", kind: "holiday" }) : null,
      editHref: data.manage ? "/calendar/days" : null,
      rows: runs.map((r) => {
        const past = r.endsOn < today;
        const t = toldFor(r);
        const days = daysApart(r.startsOn, r.endsOn) + 1;
        return {
          key: r.id,
          mon: monShort(r.startsOn),
          d: Number(r.startsOn.slice(8)),
          name: itemTitle(r),
          when: r.startsOn !== r.endsOn ? `${dayShort(r.startsOn)} – ${dayShort(r.endsOn)}` : dayShort(r.startsOn),
          days: p(plural(days, "day"), `${days} दिन`),
          past,
          badge: toldBadge(t, true),
          tellHref: data.manage && !past && (t.state === "none" || t.state === "declined") ? href({ view: "holidays", sheet: "notify", holiday: r.startsOn }) : null,
          href: href({ holiday: r.startsOn }),
        };
      }),
    };
    return { screen: "holidays", common: common("holidays", topHead(p("Holidays", "छुट्टियाँ"), p(`Session ${sessionLine}`, `सत्र ${sessionLine}`)), addHrefFor({ view: "holidays", kind: "holiday" })), holidays: model, notify: notifyFor(href({ view: "holidays" })) };
  }

  /* ------------------------------------------------------------- month */

  const month = isMonth(params.month) ? params.month : (dayParam ?? today).slice(0, 7);
  const panelDay = dayParam ?? (month === today.slice(0, 7) ? today : monthRange(month).first);
  const { first, last } = monthRange(month);
  const inMonth = all.filter((e) => e.startsOn <= last && e.endsOn >= first);
  const counts: Record<string, number> = {};
  for (const e of inMonth) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  let open = 0;
  let shut = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    if (weekdayOf(d) === 0) continue;
    if (closedOn(d)) shut += 1;
    else open += 1;
  }
  const weeks: Cell[][] = monthWeeks(month).map((week) =>
    week.map((g) => {
      const { bars, more } = cellBars(vis, g.day, g.weekday);
      const on = itemsOn(vis, g.day);
      const dots: EventKind[] = [];
      for (const e of on) if (!dots.includes(e.kind)) dots.push(e.kind);
      const births = kidsOn(g.day).length;
      return {
        day: g.day,
        d: Number(g.day.slice(8)),
        inMonth: g.inMonth,
        sunday: g.weekday === 6,
        selected: g.day === panelDay,
        today: g.day === today,
        births,
        bars,
        more,
        dots: dots.slice(0, 3),
        href: href({ month, day: g.day, hide }),
        aria: `${dayLong(g.day)}${on.length ? `, ${plural(on.length, "event")}` : ""}${births ? `, ${plural(births, "birthday")}` : ""}`,
      };
    }),
  );
  const panelRows = itemsOn(vis, panelDay).map((e) => row(e, panelDay));
  const att = attendance(panelDay);
  const lv = data.away[panelDay] ?? [];
  const kids = kidsOn(panelDay);
  const facts: Fact[] = [{ icon: att.icon, tone: att.tone === "ok" ? "var(--ok)" : att.tone === "warn" ? "var(--warnfg)" : "var(--mut)", text: att.line }];
  if (lv.length) facts.push({ icon: "user", tone: "var(--warnfg)", text: p(lv.map((l) => `${l.name} on leave`).join(" · "), lv.map((l) => `${l.name} छुट्टी पर`).join(" · ")) });
  if (kids.length) facts.push({ icon: "cake", tone: "var(--warnfg)", text: p(`${plural(kids.length, "birthday")} · ${kids.map((b) => b.name).join(", ")}`, `${kids.length} जन्मदिन · ${kids.map((b) => b.name).join(", ")}`) });
  const model: MonthModel = {
    title: monthTitle(month),
    sub: p(`${open} school days · ${plural(shut, "holiday")}`, `${open} स्कूल दिवस · ${shut} छुट्टी`),
    todayHref: href({ hide }),
    prevHref: href({ month: shiftMonth(month, -1), hide }),
    nextHref: href({ month: shiftMonth(month, 1), hide }),
    chips: chipsFor(counts, { month: params.month }),
    weekdays: WEEKDAYS.map(([en, hi, s, sh], i) => ({ long: p(en, hi), short: p(s, sh), sunday: i === 6 })),
    weeks,
    panel: {
      day: panelDay,
      rel: relDay(panelDay, today),
      isToday: panelDay === today,
      title: dayPair(panelDay),
      addHref: addHrefFor({ month, day: panelDay }),
      rows: panelRows,
      empty: weekdayOf(panelDay) === 0 ? p("Sunday — school is closed.", "रविवार — विद्यालय बंद।") : hidden.size ? p("Nothing here with the current filters.", "इन फ़िल्टर के साथ यहाँ कुछ नहीं।") : p("Nothing planned — a normal school day.", "कुछ तय नहीं — सामान्य दिन।"),
      facts,
      openHref: href({ view: "day", day: panelDay }),
    },
  };
  return { screen: "month", common: common("month", topHead(p("Calendar", "कैलेंडर"), p("School calendar", "विद्यालय कैलेंडर")), addHrefFor({ month: params.month, day: params.day })), month: model, notify: notifyFor(href({ month: params.month, day: params.day, hide })) };
}

/** "Casual leave", or which periods when no reason was given. */
function awayLine(a: Away): Pair {
  if (a.reason) return p(a.reason);
  const ps = [...a.periods].sort((x, y) => x - y);
  if (!ps.length) return p("Away", "अनुपस्थित");
  const run = ps.every((n, i) => i === 0 || n === ps[i - 1] + 1);
  const list = run && ps.length > 1 ? `${ps[0]}–${ps[ps.length - 1]}` : ps.join(", ");
  return p(`${ps.length === 1 ? "Period" : "Periods"} ${list}`, `पीरियड ${list}`);
}
