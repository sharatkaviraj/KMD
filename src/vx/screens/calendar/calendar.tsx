import Link from "next/link";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { agoP, dateLabel, longDay, shortDay } from "@/vx/format";
import { Ic } from "@/vx/icons";
import { HelpButton } from "@/vx/ui/overlays";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, CardHead, EmptyState, Kpi, Pill, SecHead } from "@/vx/ui/primitives";
import { academicContext, attendanceOn, type Ctx } from "@/vx/screens/academics/data";
import { addDays, isDay, isMonth, isUuid, monthRange, shiftMonth } from "@/vx/screens/academics/domain";
import { kindOf, LinkTabs, qs, sayer, type Say } from "@/vx/screens/academics/ui";

import { AddEventSheet, CancelEventButton, NotifySheet } from "./client";
import { audienceSize, birthdays, eventById, eventsBetween, holidaysBetween, noticesFor, staffAway, type Notice } from "./data";
import { eventNotice, eventsOn, holidayNotice, holidayRuns, kindCounts, monthWeeks, schoolDays, sessionMonths, visibleTo, whenLabel, type CalEvent, type CalHoliday } from "./domain";

/*
 * School calendar (SCREENS "Calendar"). One calendar for the school:
 * holidays and vacations from `academic_calendar_days` (the register and
 * the timetable close on them) and events from `calendar_events`.
 * States: `?view=` month | agenda | holidays | day, `?event=<id>`, and
 * `?sheet=` add | notify. Every state is a URL.
 */

type Props = { staff: CurrentStaff; view?: string; month?: string; day?: string; eventId?: string; sheet?: string; holiday?: string };

const BASE = "/calendar";
const WEEKDAYS: [string, string][] = [["Mon", "सोम"], ["Tue", "मंगल"], ["Wed", "बुध"], ["Thu", "गुरु"], ["Fri", "शुक्र"], ["Sat", "शनि"], ["Sun", "रवि"]];

function monthName(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

function title(e: Pick<CalEvent, "title" | "titleHi">, say: Say): string {
  return say(e.title, e.titleHi ?? undefined);
}

function holidayTitle(h: { label: string | null; labelHi: string | null }, say: Say): string {
  return h.label ? say(h.label, h.labelHi ?? undefined) : say("Holiday", "अवकाश");
}

function noticeStatus(n: Notice | undefined, say: Say): { text: string; tone: "ok" | "warn" | "mut" | "bad" } {
  if (!n) return { text: say("Parents not told", "अभिभावकों को सूचना नहीं"), tone: "mut" };
  if (n.status === "sent") return { text: say(`Told ${n.recipients}`, `${n.recipients} को बताया`), tone: "ok" };
  if (n.status === "awaiting_approval") return { text: say(`Saved, not sent · ${n.recipients}`, `सहेजी, भेजी नहीं · ${n.recipients}`), tone: "warn" };
  if (n.status === "rejected") return { text: say("Notice turned down", "सूचना अस्वीकृत"), tone: "bad" };
  return { text: n.status, tone: "mut" };
}

function EventRow({ e, say, href, top }: { e: CalEvent; say: Say; href: string; top?: boolean }) {
  const k = kindOf(e.kind);
  return (
    <Link href={href} className="row tap" style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", borderTop: top ? "1px solid var(--bd)" : undefined }}>
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: k.dot, flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <strong className="clip">{title(e, say)}</strong>
        <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>
          {e.allDay ? say("All day", "पूरे दिन") : `${e.startsAt}${e.endsAt ? `–${e.endsAt}` : ""}`}
          {e.place ? ` · ${e.place}` : ""}
        </span>
      </span>
      <Pill style={{ background: k.bg, color: k.fg }}>{say(k.label.en, k.label.hi)}</Pill>
    </Link>
  );
}

export async function SchoolCalendar(props: Props) {
  const { staff } = props;
  const say = sayer(staff.language);
  const ctx = await academicContext(staff);
  if (!ctx) {
    return (
      <VxPage>
        <TopBar title={say("Calendar", "कैलेंडर")} />
        <Section><EmptyState title={say("No session is open", "कोई सत्र खुला नहीं है")} /></Section>
      </VxPage>
    );
  }
  const manage = can(staff, "academics:manage");
  const seesMoney = can(staff, "fees:view");
  const mine = new Set(ctx.classes.map((c) => c.id));
  const shown = (e: CalEvent) => visibleTo(e, ctx.everyClass, mine) && (seesMoney || e.kind !== "fee_due");

  const view = ["agenda", "holidays", "day"].includes(props.view ?? "") ? props.view! : "month";
  const day = isDay(props.day) ? props.day : ctx.today;
  const month = isMonth(props.month) ? props.month : day.slice(0, 7);
  const help = (
    <HelpButton
      title={say("School calendar", "विद्यालय कैलेंडर")}
      steps={[
        { icon: "calendar", title: say("One calendar", "एक कैलेंडर"), body: say("Holidays, exams, PTMs and events for the whole school, in one place.", "पूरे विद्यालय की छुट्टियाँ, परीक्षाएँ, अभिभावक बैठकें और कार्यक्रम एक जगह।") },
        { icon: "lock", title: say("Holidays close the register", "छुट्टी पर रजिस्टर बंद"), body: say("On a holiday nobody is asked to mark attendance and the timetable is off.", "छुट्टी के दिन हाज़िरी नहीं माँगी जाती और समय सारणी बंद रहती है।") },
        { icon: "send", title: say("Telling parents", "अभिभावकों को सूचना"), body: say("A notice to parents is saved with the day. Nothing is sent to parents from here yet.", "अभिभावकों की सूचना दिन के साथ सहेजी जाती है। अभी यहाँ से अभिभावकों को कुछ नहीं भेजा जाता।") },
      ]}
    />
  );
  const addHref = qs(BASE, { view: view === "month" ? undefined : view, month: props.month, day: props.day, sheet: "add" });
  const actions = (
    <span style={{ display: "flex", gap: 8 }}>
      {help}
      {manage ? <Btn variant="pri" icon="plus" href={addHref}>{say("Add", "जोड़ें")}</Btn> : null}
    </span>
  );
  const mAction = manage ? <Btn variant="pri" icon="plus" ariaLabel={say("Add an event", "कार्यक्रम जोड़ें")} href={addHref} /> : help;
  const tabs = (
    <LinkTabs
      label={say("Views", "दृश्य")}
      current={view === "day" ? "month" : view}
      tabs={[
        { key: "month", href: qs(BASE, { month: props.month }), label: say("Month", "महीना"), icon: "calendar" },
        { key: "agenda", href: qs(BASE, { view: "agenda" }), label: say("Next 30 days", "अगले 30 दिन"), icon: "list" },
        { key: "holidays", href: qs(BASE, { view: "holidays" }), label: say("Holidays", "छुट्टियाँ"), icon: "calMinus" },
      ]}
    />
  );

  /* ------------------------------------------------------------ sheets */
  const closeHref = qs(BASE, { view: view === "month" ? undefined : view, month: props.month, day: props.day });
  let sheet = null;
  if (props.sheet === "add" && manage) {
    const size = await audienceSize(ctx.session, []);
    sheet = <AddEventSheet closeHref={closeHref} day={day < ctx.today ? ctx.today : day} classes={ctx.classes} parents={size.parents} />;
  } else if (props.sheet === "notify" && manage) {
    if (isDay(props.holiday)) {
      const [hol] = await holidaysBetween(ctx.session, props.holiday, props.holiday);
      if (hol) {
        const run = holidayRuns(await holidaysBetween(ctx.session, props.holiday, addDays(props.holiday, 40))).find((r) => r.from === props.holiday);
        const [size, notices] = await Promise.all([audienceSize(ctx.session, []), noticesFor(ctx.session, { holidayDays: [props.holiday] })]);
        const dayText = run && run.to !== run.from ? `${dateLabel(run.from)} – ${dateLabel(run.to)}` : dateLabel(props.holiday);
        sheet = (
          <NotifySheet
            closeHref={closeHref}
            holidayDay={props.holiday}
            title={holidayTitle(hol, say)}
            preview={holidayNotice(hol.label ?? "the holiday", hol.labelHi, dayText)}
            parents={size.parents}
            staff={size.staff}
            already={notices[0] ? noticeStatus(notices[0], say).text : null}
          />
        );
      }
    } else if (isUuid(props.eventId)) {
      const e = await eventById(ctx.session, props.eventId);
      if (e && !e.cancelled) {
        const [size, notices] = await Promise.all([audienceSize(ctx.session, e.classIds), noticesFor(ctx.session, { eventId: e.id })]);
        sheet = (
          <NotifySheet
            closeHref={qs(BASE, { event: e.id })}
            eventId={e.id}
            title={title(e, say)}
            preview={eventNotice(e, whenLabel(e, shortDay))}
            parents={size.parents}
            staff={size.staff}
            already={notices[0] ? noticeStatus(notices[0], say).text : null}
          />
        );
      }
    }
  }

  /* ------------------------------------------------------------ event */
  if (isUuid(props.eventId)) {
    const e = await eventById(ctx.session, props.eventId);
    const top = <TopBar crumb={say("Calendar", "कैलेंडर")} title={e ? title(e, say) : say("Event", "कार्यक्रम")} mBack={qs(BASE, { month: e?.startsOn.slice(0, 7) })} actions={help} mAction={help} />;
    if (!e || !shown(e)) {
      return (
        <VxPage>
          {top}
          <Section><EmptyState icon="calendar" title={say("That event is not on the calendar", "वह कार्यक्रम कैलेंडर में नहीं है")} action={<Btn href={BASE}>{say("Back to the calendar", "कैलेंडर पर लौटें")}</Btn>} /></Section>
        </VxPage>
      );
    }
    const k = kindOf(e.kind);
    const notices = await noticesFor(ctx.session, { eventId: e.id });
    const classNames = e.classIds.map((id) => ctx.label(id)).filter(Boolean);
    return (
      <VxPage>
        {top}
        <Section>
          <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <span style={{ flex: "none", width: 48, height: 48, borderRadius: 14, background: k.bg, color: k.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n="calendar" size={22} />
              </span>
              <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 4 }}>
                <h2 className="serif" style={{ margin: 0, fontSize: 24 }}>{title(e, say)}</h2>
                <span style={{ color: "var(--mut)" }}>{whenLabel(e, longDay)}</span>
              </span>
              <Pill style={{ background: k.bg, color: k.fg }}>{say(k.label.en, k.label.hi)}</Pill>
              {e.cancelled ? <Pill tone="bad">{say("Cancelled", "रद्द")}</Pill> : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
              {e.place ? <span style={{ display: "flex", gap: 8 }}><Ic n="mapPin" size={18} style={{ color: "var(--mut)" }} />{e.place}</span> : null}
              <span style={{ display: "flex", gap: 8 }}><Ic n="users" size={18} style={{ color: "var(--mut)" }} />{classNames.length ? classNames.join(", ") : say("Whole school", "पूरा विद्यालय")}</span>
              {e.details ? <span style={{ display: "flex", gap: 8, whiteSpace: "pre-wrap" }}><Ic n="note" size={18} style={{ color: "var(--mut)", flex: "none" }} />{e.details}</span> : null}
            </div>
            {manage && !e.cancelled ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="pri" icon="send" href={qs(BASE, { event: e.id, sheet: "notify" })}>{say("Tell people", "सूचना दें")}</Btn>
                <Btn variant="sec" icon="calendar" href={qs(BASE, { view: "day", day: e.startsOn })}>{say("Open the day", "दिन खोलें")}</Btn>
                <CancelEventButton id={e.id} title={title(e, say)} />
              </div>
            ) : null}
          </Card>
          <SecHead>{say("Notices", "सूचनाएँ")}</SecHead>
          <Card pad={false}>
            {notices.length === 0 ? <EmptyState icon="send" title={say("Nobody has been told yet", "अभी किसी को सूचना नहीं")} style={{ padding: 20 }} /> : null}
            {notices.map((n, i) => {
              const s = noticeStatus(n, say);
              return (
                <div key={n.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 16px", borderTop: i ? "1px solid var(--bd)" : undefined }}>
                  <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Pill tone={s.tone}>{s.text}</Pill>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>{n.by} · {say(agoP(n.requestedAt).en, agoP(n.requestedAt).hi)}</span>
                  </span>
                  <span style={{ fontSize: 14 }}>{say(n.textEn, n.textHi)}</span>
                </div>
              );
            })}
          </Card>
        </Section>
        {sheet}
      </VxPage>
    );
  }

  const crumb = say("School", "विद्यालय");

  /* ----------------------------------------------------------- agenda */
  if (view === "agenda") {
    const to = addDays(ctx.today, 30);
    const [events, holidays, bdays] = await Promise.all([eventsBetween(ctx.session, ctx.today, to), holidaysBetween(ctx.session, ctx.today, to), birthdays(ctx.session)]);
    const list = events.filter(shown);
    const holidayOn = new Map(holidays.map((h) => [h.day, h]));
    const days: string[] = [];
    for (let d = ctx.today; d <= to; d = addDays(d, 1)) {
      if (holidayOn.has(d) || eventsOn(list, d).length) days.push(d);
    }
    return (
      <VxPage>
        <TopBar crumb={crumb} title={say("Next 30 days", "अगले 30 दिन")} mBack={BASE} actions={actions} mAction={mAction} />
        <Section>
          {tabs}
          {days.length === 0 ? <Card><EmptyState icon="calendar" title={say("Nothing in the next 30 days", "अगले 30 दिनों में कुछ नहीं")} /></Card> : null}
          {days.map((d) => {
            const h = holidayOn.get(d);
            const todays = eventsOn(list, d);
            const kids = (bdays.get(d.slice(5)) ?? []).filter((b) => mine.has(b.classId)).length;
            return (
              <Card key={d} pad={false}>
                <Link href={qs(BASE, { view: "day", day: d })} className="tap" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                  <strong style={{ flex: 1 }}>{longDay(d)}</strong>
                  {d === ctx.today ? <Pill tone="acc">{say("Today", "आज")}</Pill> : null}
                  {kids ? <Pill tone="mut" icon="cake">{kids}</Pill> : null}
                </Link>
                {h ? (
                  <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", borderTop: "1px solid var(--bd)", background: "var(--bads)", color: "var(--bad)" }}>
                    <Ic n="calMinus" size={18} />
                    <strong style={{ flex: 1 }}>{holidayTitle(h, say)}</strong>
                    <span style={{ fontSize: 13 }}>{say("School closed", "विद्यालय बंद")}</span>
                  </div>
                ) : null}
                {todays.map((e) => <EventRow key={e.id} e={e} say={say} href={qs(BASE, { event: e.id })} top />)}
              </Card>
            );
          })}
        </Section>
        {sheet}
      </VxPage>
    );
  }

  /* --------------------------------------------------------- holidays */
  if (view === "holidays") {
    const months = sessionMonths(ctx.session, ctx.today);
    const first = monthRange(months[0]).first;
    const last = monthRange(months[months.length - 1]).last;
    const holidays = await holidaysBetween(ctx.session, first, last);
    const runs = holidayRuns(holidays);
    const notices = await noticesFor(ctx.session, { holidayDays: runs.map((r) => r.from) });
    const latest = new Map<string, Notice>();
    for (const n of notices) if (n.holidayDay && !latest.has(n.holidayDay)) latest.set(n.holidayDay, n);
    const closed = new Set(holidays.filter((h) => h.kind === "holiday" || h.kind === "vacation").map((h) => h.day));
    const perMonth = months.map((m) => ({ month: m, days: schoolDays(m, closed) }));
    const total = perMonth.reduce((s, m) => s + m.days, 0);
    const upcoming = runs.filter((r) => r.to >= ctx.today);
    return (
      <VxPage>
        <TopBar crumb={crumb} title={say("Holidays", "छुट्टियाँ")} mBack={BASE} actions={actions} mAction={mAction} />
        <Section>
          {tabs}
          <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
            <Kpi label={say("Holidays this session", "इस सत्र छुट्टियाँ")} value={runs.length} sub={say(`${closed.size} days closed`, `${closed.size} दिन बंद`)} tone="var(--bad)" />
            <Kpi label={say("Still to come", "आने वाली")} value={upcoming.length} />
            <Kpi label={say("School days", "स्कूल दिवस")} value={total} sub={say("Not Sunday, not a holiday", "रविवार और छुट्टी छोड़कर")} />
            <Kpi label={say("Parents not told", "सूचना नहीं दी")} value={upcoming.filter((r) => !latest.has(r.from)).length} tone="var(--warnfg)" />
          </div>
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 16, alignItems: "start" }}>
            <Card pad={false}>
              <div style={{ padding: "14px 16px" }}>
                <CardHead
                  title={say("Holidays and vacations", "छुट्टियाँ और अवकाश")}
                  sub={say("These close the register and the timetable", "इन दिनों रजिस्टर और समय सारणी बंद रहते हैं")}
                  action={manage ? <Btn variant="soft" icon="edit" href="/calendar/days">{say("Edit days", "दिन बदलें")}</Btn> : null}
                />
              </div>
              {runs.length === 0 ? <EmptyState icon="calMinus" title={say("No holidays set", "कोई छुट्टी तय नहीं")} style={{ padding: 20 }} /> : null}
              {runs.map((r) => {
                const s = noticeStatus(latest.get(r.from), say);
                const past = r.to < ctx.today;
                return (
                  <div key={r.from} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--bd)", flexWrap: "wrap", opacity: past ? 0.6 : 1 }}>
                    <span style={{ flex: "none", width: 48, textAlign: "center", borderRadius: 12, background: "var(--bads)", color: "var(--bad)", padding: "6px 0", display: "flex", flexDirection: "column" }}>
                      <strong className="num" style={{ fontSize: 18 }}>{Number(r.from.slice(8))}</strong>
                      <span style={{ fontSize: 11 }}>{new Date(`${r.from}T12:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" })}</span>
                    </span>
                    <Link href={qs(BASE, { month: r.from.slice(0, 7), day: r.from })} className="tap" style={{ flex: 1, minWidth: 160, display: "flex", flexDirection: "column", gap: 2 }}>
                      <strong>{holidayTitle(r, say)}</strong>
                      <span style={{ fontSize: 13, color: "var(--mut)" }}>
                        {r.days > 1 ? `${shortDay(r.from)} – ${shortDay(r.to)} · ${say(`${r.days} days`, `${r.days} दिन`)}` : shortDay(r.from)}
                      </span>
                    </Link>
                    {past ? null : <Pill tone={s.tone}>{s.text}</Pill>}
                    {manage && !past && !latest.has(r.from) ? <Btn variant="soft" icon="send" href={qs(BASE, { view: "holidays", sheet: "notify", holiday: r.from })}>{say("Tell parents", "अभिभावकों को बताएँ")}</Btn> : null}
                  </div>
                );
              })}
            </Card>
            <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <CardHead title={say("School days by month", "महीनेवार स्कूल दिवस")} />
              {perMonth.map((m) => (
                <Link key={m.month} href={qs(BASE, { month: m.month })} className="tap" style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "4px 0", fontWeight: m.month === ctx.today.slice(0, 7) ? 700 : 400 }}>
                  <span>{monthName(m.month)}</span>
                  <span className="num">{m.days}</span>
                </Link>
              ))}
            </Card>
          </div>
        </Section>
        {sheet}
      </VxPage>
    );
  }

  /* ---------------------------------------------- month and day panel */
  const weeks = monthWeeks(month);
  const gridFrom = weeks[0][0].day;
  const gridTo = weeks[weeks.length - 1][6].day;
  const panelDay = view === "day" || props.day ? day : month === ctx.today.slice(0, 7) ? ctx.today : monthRange(month).first;
  const [events, holidays, bdays, away] = await Promise.all([
    eventsBetween(ctx.session, gridFrom < panelDay ? gridFrom : panelDay, gridTo > panelDay ? gridTo : panelDay),
    holidaysBetween(ctx.session, gridFrom < panelDay ? gridFrom : panelDay, gridTo > panelDay ? gridTo : panelDay),
    birthdays(ctx.session),
    staffAway(ctx.session, panelDay, panelDay),
  ]);
  const list = events.filter(shown);
  const holidayOn = new Map<string, CalHoliday>(holidays.map((h) => [h.day, h]));
  const counts = kindCounts(list.filter((e) => e.startsOn.slice(0, 7) === month || e.endsOn.slice(0, 7) === month), holidays.filter((h) => h.day.slice(0, 7) === month));
  const kidsOn = (d: string) => (bdays.get(d.slice(5)) ?? []).filter((b) => mine.has(b.classId));

  const panel = await dayPanel({ ctx, say, day: panelDay, events: eventsOn(list, panelDay), holiday: holidayOn.get(panelDay) ?? null, kids: kidsOn(panelDay), away: away.get(panelDay) ?? [], full: view === "day", manage });

  if (view === "day") {
    return (
      <VxPage>
        <TopBar crumb={crumb} title={longDay(panelDay)} mBack={qs(BASE, { month: panelDay.slice(0, 7), day: panelDay })} actions={actions} mAction={mAction} />
        <Section>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Btn variant="sec" icon="chevLeft" ariaLabel={say("Previous day", "पिछला दिन")} href={qs(BASE, { view: "day", day: addDays(panelDay, -1) })} />
            <Btn variant="sec" icon="chevRight" ariaLabel={say("Next day", "अगला दिन")} href={qs(BASE, { view: "day", day: addDays(panelDay, 1) })} />
            <Btn variant="soft" href={qs(BASE, { month: panelDay.slice(0, 7), day: panelDay })} icon="calendar">{say("Back to the month", "महीने पर लौटें")}</Btn>
          </div>
          {panel}
        </Section>
        {sheet}
      </VxPage>
    );
  }

  const grid = (
    <Card pad={false} style={{ overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", background: "var(--s2)" }}>
        {WEEKDAYS.map(([en, hi], i) => (
          <span key={en} style={{ padding: "8px 6px", fontSize: 12, fontWeight: 700, textAlign: "center", color: i === 6 ? "var(--bad)" : "var(--mut)" }}>{say(en, hi)}</span>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0].day} style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))" }}>
          {week.map((g) => {
            const h = holidayOn.get(g.day);
            const todays = eventsOn(list, g.day);
            const kids = kidsOn(g.day).length;
            const selected = g.day === panelDay;
            const closed = !!h && (h.kind === "holiday" || h.kind === "vacation");
            const sunday = g.weekday === 6;
            return (
              <Link
                key={g.day}
                aria-current={g.day === ctx.today ? "date" : undefined}
                aria-label={`${longDay(g.day)}${h ? ` · ${holidayTitle(h, say)}` : ""}${todays.length ? ` · ${todays.length}` : ""}`}
                href={qs(BASE, { month, day: g.day })}
                scroll={false}
                className="tap"
                style={{
                  minHeight: 84,
                  padding: 6,
                  borderTop: "1px solid var(--bd)",
                  borderLeft: g.weekday ? "1px solid var(--bd)" : undefined,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  minWidth: 0,
                  background: selected ? "var(--accs)" : closed ? "var(--bads)" : g.inMonth ? undefined : "var(--s2)",
                  opacity: g.inMonth ? 1 : 0.55,
                  outline: g.day === ctx.today ? "2px solid var(--acc)" : undefined,
                  outlineOffset: -2,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="num" style={{ fontWeight: 700, fontSize: 13, color: closed || sunday ? "var(--bad)" : undefined }}>{Number(g.day.slice(8))}</span>
                  {kids ? <span title={say(`${kids} birthdays`, `${kids} जन्मदिन`)} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, color: "var(--mut)" }}><Ic n="cake" size={12} />{kids}</span> : null}
                </span>
                {h ? <span className="clip hide-m" style={{ fontSize: 11, fontWeight: 700, color: "var(--bad)" }}>{holidayTitle(h, say)}</span> : null}
                {todays.slice(0, 2).map((e) => {
                  const k = kindOf(e.kind);
                  return <span key={e.id} className="clip hide-m" style={{ fontSize: 11, padding: "1px 5px", borderRadius: 6, background: k.bg, color: k.fg, fontWeight: 600 }}>{title(e, say)}</span>;
                })}
                {todays.length > 2 ? <span className="hide-m" style={{ fontSize: 11, color: "var(--mut)" }}>+{todays.length - 2}</span> : null}
                <span className="only-m" style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {h ? <span style={{ width: 6, height: 6, borderRadius: 6, background: "var(--bad)" }} /> : null}
                  {todays.slice(0, 3).map((e) => <span key={e.id} style={{ width: 6, height: 6, borderRadius: 6, background: kindOf(e.kind).dot }} />)}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </Card>
  );

  return (
    <VxPage>
      <TopBar crumb={crumb} title={say("Calendar", "कैलेंडर")} actions={actions} mAction={mAction} />
      <Section>
        {tabs}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 24, flex: 1 }}>{monthName(month)}</h2>
          {month !== ctx.today.slice(0, 7) ? <Btn variant="soft" href={BASE}>{say("Today", "आज")}</Btn> : null}
          <Btn variant="sec" icon="chevLeft" ariaLabel={say("Previous month", "पिछला महीना")} href={qs(BASE, { month: shiftMonth(month, -1) })} />
          <Btn variant="sec" icon="chevRight" ariaLabel={say("Next month", "अगला महीना")} href={qs(BASE, { month: shiftMonth(month, 1) })} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["holiday", "exam", "event", "ptm", "meeting", ...(seesMoney ? ["fee_due"] : [])].map((kind) => {
            const k = kindOf(kind);
            return (
              <span key={kind} className="chip" style={{ background: k.bg, color: k.fg, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 10px", borderRadius: 999, fontSize: 13, fontWeight: 600, height: 30 }}>
                <span style={{ width: 8, height: 8, borderRadius: 8, background: k.dot }} />
                {say(k.label.en, k.label.hi)}
                <span className="num">{counts[kind] ?? 0}</span>
              </span>
            );
          })}
        </div>
        <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 16, alignItems: "start" }}>
          {grid}
          {panel}
        </div>
      </Section>
      {sheet}
    </VxPage>
  );
}

/** The right-hand panel (and the whole `day` view): what is on, who is away, attendance. */
async function dayPanel({ ctx, say, day, events, holiday, kids, away, full, manage }: { ctx: Ctx; say: Say; day: string; events: CalEvent[]; holiday: CalHoliday | null; kids: { studentId: string; name: string; classId: string }[]; away: string[]; full: boolean; manage: boolean }) {
  const att = day <= ctx.today && !holiday && new Date(`${day}T12:00:00Z`).getUTCDay() !== 0 ? await attendanceOn(ctx, day) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <CardHead title={longDay(day)} sub={day === ctx.today ? say("Today", "आज") : undefined} action={manage ? <Btn variant="soft" icon="plus" ariaLabel={say("Add on this day", "इस दिन जोड़ें")} href={qs(BASE, { view: full ? "day" : undefined, month: full ? undefined : day.slice(0, 7), day, sheet: "add" })} /> : null} />
        {holiday ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 12, background: "var(--bads)", color: "var(--bad)" }}>
            <Ic n="calMinus" size={18} />
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong>{holidayTitle(holiday, say)}</strong>
              <span style={{ fontSize: 13 }}>{say("School closed · no register", "विद्यालय बंद · रजिस्टर नहीं")}</span>
            </span>
          </div>
        ) : null}
        {events.length === 0 && !holiday ? <span style={{ fontSize: 14, color: "var(--mut)" }}>{say("Nothing on the calendar.", "कैलेंडर में कुछ नहीं।")}</span> : null}
      </Card>
      {events.length ? (
        <Card pad={false}>
          {events.map((e, i) => <EventRow key={e.id} e={e} say={say} href={qs(BASE, { event: e.id })} top={i > 0} />)}
        </Card>
      ) : null}
      {att ? (
        <Card style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <CardHead title={say("Attendance", "हाज़िरी")} action={<Link href="/academics/attendance" className="tap" style={{ fontSize: 13, color: "var(--acc)" }}>{say("Open", "खोलें")}</Link>} />
          <span style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
            <strong className="num" style={{ fontSize: 26 }}>{att.pct === null ? "—" : `${Math.round(att.pct)}%`}</strong>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{say(`${att.marked} of ${att.classes.length} registers saved`, `${att.classes.length} में से ${att.marked} रजिस्टर सहेजे`)}</span>
          </span>
        </Card>
      ) : null}
      {away.length ? (
        <Card style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <CardHead title={say(`Staff away · ${away.length}`, `स्टाफ़ अनुपस्थित · ${away.length}`)} />
          <span style={{ fontSize: 14 }}>{away.join(", ")}</span>
        </Card>
      ) : null}
      {kids.length ? (
        <Card style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <CardHead title={say(`Birthdays · ${kids.length}`, `जन्मदिन · ${kids.length}`)} />
          {(full ? kids : kids.slice(0, 5)).map((k) => (
            <Link key={k.studentId} href={`/academics/progress?view=student&student=${k.studentId}`} className="tap" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
              <Ic n="cake" size={16} style={{ color: "var(--acc)" }} />
              <span style={{ flex: 1 }} className="clip">{k.name}</span>
              <span style={{ color: "var(--mut)", fontSize: 13 }}>{ctx.label(k.classId)}</span>
            </Link>
          ))}
          {!full && kids.length > 5 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>+{kids.length - 5}</span> : null}
        </Card>
      ) : null}
      {full ? null : <Btn variant="sec" full icon="arrowRight" href={qs(BASE, { view: "day", day })}>{say("Open full day", "पूरा दिन खोलें")}</Btn>}
    </div>
  );
}
