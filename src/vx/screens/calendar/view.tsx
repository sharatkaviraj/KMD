import Link from "next/link";
import type { CSSProperties } from "react";

import type { Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";
import { lead, p, under, type Pair } from "@/vx/text";
import { HelpButton } from "@/vx/ui/overlays";
import { EmptyState } from "@/vx/ui/primitives";
import { TopBar, VxPage } from "@/vx/ui/page";
import { WHATSAPP_MESSAGE_COST_RUPEES } from "@/modules/whatsapp/domain/run-measurement";

import { AddEventForm, Bubble, CancelEventButton, NotifySheet, type AddInitial } from "./client";
import { kindStyle } from "./domain";
import type { AgendaModel, Badge, CalendarModel, Chip, Common, DayModel, DayPanelModel, EventModel, HolidaysModel, MonthModel, Row, ToldCard } from "./model";

import "./calendar.css";

/*
 * The school calendar as the design draws it (design/src/Calendar.dc.html):
 * month with the day beside it, a day, an event, add, the next 30 days,
 * holidays, and the notice sheet. Presentational: everything it shows comes
 * in `model` (model.ts), so the design fixture can draw it with no server.
 */

type T = { t: (x: Pair) => string; u: (x: Pair) => string | null; language: Language };

function words(language: Language): T {
  return { t: (x) => lead(x, language), u: (x) => under(x, language), language };
}

const TONE: Record<Badge["tone"], [string, string]> = {
  ok: ["var(--oks)", "var(--ok)"],
  warn: ["var(--warns)", "var(--warnfg)"],
  bad: ["var(--bads)", "var(--bad)"],
  info: ["var(--infos)", "var(--info)"],
  mut: ["var(--s3)", "var(--mut)"],
  acc: ["var(--accs)", "var(--accfg)"],
};

const delay = (i: number) => `${Math.min(i, 14) * 30}ms`;

export function CalendarView({ model, addInitial }: { model: CalendarModel; addInitial?: AddInitial }) {
  if (model.screen === "closed") {
    const w = words(model.language);
    return (
      <VxPage>
        <TopBar title={w.t(p("Calendar", "कैलेंडर"))} mBack="/menu" />
        <main className="pad cal-pg">
          <EmptyState icon="calendar" title={w.t(p("No session is open", "कोई सत्र खुला नहीं है"))} />
        </main>
      </VxPage>
    );
  }
  const w = words(model.common.language);
  const c = model.common;
  return (
    <VxPage>
      <Top c={c} w={w} />
      <main>
        {c.head.top ? (
          <div className="only-m" style={{ padding: "14px 16px 0" }}>
            <ViewSeg c={c} w={w} />
          </div>
        ) : null}
        {model.screen === "month" ? <MonthScreen m={model.month} w={w} /> : null}
        {model.screen === "agenda" ? <AgendaScreen a={model.agenda} w={w} /> : null}
        {model.screen === "holidays" ? <HolidaysScreen h={model.holidays} w={w} /> : null}
        {model.screen === "day" ? <DayScreen d={model.day} w={w} /> : null}
        {model.screen === "event" ? <EventScreen e={model.event} back={c.head.back?.href ?? "/calendar"} w={w} /> : null}
        {model.screen === "add" ? <AddEventForm model={model.add} rate={WHATSAPP_MESSAGE_COST_RUPEES} initial={addInitial} /> : null}
      </main>
      {model.screen !== "add" && model.notify ? <NotifySheet model={model.notify} rate={WHATSAPP_MESSAGE_COST_RUPEES} /> : null}
    </VxPage>
  );
}

/* ------------------------------------------------------------------ top */

function Help({ w }: { w: T }) {
  return (
    <HelpButton
      title={w.t(p("School calendar", "विद्यालय कैलेंडर"))}
      steps={[
        { icon: "calendar", title: w.t(p("One calendar", "एक कैलेंडर")), body: w.t(p("Holidays, exams, PTMs and events for the whole school, in one place.", "पूरे विद्यालय की छुट्टियाँ, परीक्षाएँ, अभिभावक बैठकें और कार्यक्रम एक जगह।")) },
        { icon: "lock", title: w.t(p("Holidays close the register", "छुट्टी पर रजिस्टर बंद")), body: w.t(p("On a holiday nobody is asked to mark attendance and the timetable is off.", "छुट्टी के दिन हाज़िरी नहीं माँगी जाती और समय सारणी बंद रहती है।")) },
        { icon: "send", title: w.t(p("Telling parents", "अभिभावकों को सूचना")), body: w.t(p("A notice to parents is saved with the day and waits for approval in Messages → To send, where it is sent on WhatsApp by hand.", "अभिभावकों की सूचना दिन के साथ सहेजी जाती है और संदेश → भेजने को में मंज़ूरी के बाद व्हाट्सऐप से हाथ से भेजी जाती है।")) },
      ]}
    />
  );
}

function ViewSeg({ c, w, style }: { c: Common; w: T; style?: CSSProperties }) {
  const views = [
    ["month", c.seg.month, p("Month", "महीना")],
    ["agenda", c.seg.agenda, p("Agenda", "आगे")],
    ["holidays", c.seg.holidays, p("Holidays", "छुट्टियाँ")],
  ] as const;
  const i = Math.max(0, views.findIndex((v) => v[0] === c.view));
  return (
    <nav className="seg cal-seg" aria-label={w.t(p("Calendar view", "कैलेंडर दृश्य"))} style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", ...style }}>
      <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 3)", transform: `translateX(${i * 100}%)` }} />
      {views.map(([key, h, label]) => (
        <Link key={key} href={h} scroll={false} className={`tap${key === c.view ? " on" : ""}`} aria-current={key === c.view ? "page" : undefined}>
          {w.t(label)}
        </Link>
      ))}
    </nav>
  );
}

function Top({ c, w }: { c: Common; w: T }) {
  const h = c.head;
  const actions = h.top ? (
    <>
      <Help w={w} />
      <ViewSeg c={c} w={w} style={{ width: 312 }} />
      {c.addHref ? (
        <Link href={c.addHref} scroll={false} className="tap btn pri">
          <Ic n="plus" />
          {w.t(p("Add event", "कार्यक्रम जोड़ें"))}
        </Link>
      ) : null}
    </>
  ) : h.back ? (
    <Link href={h.back.href} className="tap btn ghost">
      <Ic n="chevLeft" />
      {w.t(h.back.label)}
    </Link>
  ) : null;
  const mAction = h.top ? (
    c.addHref ? (
      <Link href={c.addHref} scroll={false} className="tap btn pri" aria-label={w.t(p("Add event", "कार्यक्रम जोड़ें"))} style={{ width: 44, height: 44, padding: 0, borderRadius: 22 }}>
        <Ic n="plus" size={22} />
      </Link>
    ) : (
      <Help w={w} />
    )
  ) : undefined;
  return (
    <TopBar
      crumb={w.t(h.crumb)}
      title={
        <>
          {w.t(h.title)}
          <span className="pill" aria-hidden="true" style={{ marginLeft: 10, verticalAlign: "middle", background: "var(--s3)", color: "var(--mut)", fontFamily: "var(--font-sans), Inter, sans-serif" }}>
            {w.t(p("school calendar", "विद्यालय कैलेंडर"))}
          </span>
        </>
      }
      actions={actions}
      mTitle={w.t(h.mTitle)}
      mSub={w.t(h.mSub)}
      mBack={h.mBack}
      mAction={mAction}
    />
  );
}

/* --------------------------------------------------------------- pieces */

function Chips({ chips, w }: { chips: Chip[]; w: T }) {
  return (
    <div className="hs cal-r" role="group" aria-label={w.t(p("Show kinds", "प्रकार दिखाएँ"))} style={{ gap: 6 }}>
      {chips.map((c) => {
        const k = kindStyle(c.kind);
        return (
          <Link
            key={c.kind}
            href={c.href}
            scroll={false}
            className="tap chip"
            aria-label={w.t(c.on ? p(`Hide ${c.label.en}`, `${c.label.hi} छिपाएँ`) : p(`Show ${c.label.en}`, `${c.label.hi} दिखाएँ`))}
            style={{ background: c.on ? k.s : "var(--card)", borderColor: c.on ? k.c : "var(--bd)", color: c.on ? k.f : "var(--sub)" }}
          >
            <span className="cal-dot" style={{ background: c.on ? k.c : "transparent", boxShadow: `inset 0 0 0 2px ${k.c}` }} />
            {w.t(c.label)}
            {c.n >= 0 ? <span className="num" style={{ fontSize: 11, opacity: 0.7 }}>{c.n}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

function BadgePill({ b, w }: { b: Badge; w: T }) {
  const [bg, fg] = TONE[b.tone];
  return (
    <span className="pill" style={{ background: bg, color: fg }}>
      {b.tone === "ok" ? <Ic n="check" size={12} stroke={2.4} /> : null}
      {w.t(b.text)}
    </span>
  );
}

function Cancelled({ w, cls = "" }: { w: T; cls?: string }) {
  return <span className={`pill ${cls}`} style={{ background: "var(--bads)", color: "var(--bad)" }}>{w.t(p("Cancelled", "रद्द"))}</span>;
}

function line(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

/** A row in the month's day panel: colour bar, title, when · where, kind and notice pills. */
function PanelRow({ r, i, w }: { r: Row; i: number; w: T }) {
  const k = kindStyle(r.kind);
  return (
    <Link href={r.href} className="tap card lift cal-ev" style={{ alignItems: "stretch", opacity: r.cancelled ? 0.55 : 1, animation: "xIn .32s var(--ease) both", animationDelay: delay(i) }}>
      <span className="cal-b4" style={{ background: k.c }} />
      <span className="cal-c cal-f" style={{ gap: 2 }}>
        <span className="cal-t" style={{ textDecoration: r.cancelled ? "line-through" : "none" }}>{w.t(r.title)}</span>
        <span className="cal-m">{line(w.t(r.time), w.t(r.sub))}</span>
        <span className="cal-r cal-w" style={{ gap: 6, marginTop: 3 }}>
          <span className="pill" style={{ background: k.s, color: k.f }}>{w.t(k.label)}</span>
          {r.badge ? <BadgePill b={r.badge} w={w} /> : null}
          {r.cancelled ? <Cancelled w={w} /> : null}
        </span>
      </span>
      <Ic n="chevRight" style={{ alignSelf: "center", color: "var(--sub)" }} />
    </Link>
  );
}

function TimeCol({ r, w }: { r: Row; w: T }) {
  return (
    <span className="cal-tc num">
      <b>{w.t(r.t1)}</b>
      {r.t2 ? w.t(r.t2) : null}
    </span>
  );
}

/* --------------------------------------------------------------- month */

function MonthScreen({ m, w }: { m: MonthModel; w: T }) {
  return (
    <div className="cal-month" style={{ minHeight: "100%" }}>
      <section className="pad cal-c" style={{ gap: 12, padding: "18px 24px 28px 28px", minWidth: 0 }}>
        <div className="cal-r" style={{ gap: 8 }}>
          <div className="cal-c cal-f">
            <h2 className="cal-tt" style={{ fontSize: 24 }}>{w.t(m.title)}</h2>
            <span className="cal-m">{w.t(m.sub)}</span>
          </div>
          <Link href={m.todayHref} scroll={false} className="tap btn sec" style={{ height: 38, padding: "0 12px" }}>{w.t(p("Today", "आज"))}</Link>
          <Link href={m.prevHref} scroll={false} className="tap btn sec cal-sq" aria-label={w.t(p("Previous month", "पिछला महीना"))}><Ic n="chevLeft" /></Link>
          <Link href={m.nextHref} scroll={false} className="tap btn sec cal-sq" aria-label={w.t(p("Next month", "अगला महीना"))}><Ic n="chevRight" /></Link>
        </div>
        <Chips chips={m.chips} w={w} />
        <div className="card cal-mg">
          <div className="cal-g7 cal-gl">
            {m.weekdays.map((d) => (
              <span key={d.long.en} className="cal-wd" style={{ color: d.sunday ? "var(--bad)" : "var(--mut)" }}>
                <span className="hide-m">{w.t(d.long)}</span>
                <span className="hide-d">{w.t(d.short)}</span>
              </span>
            ))}
            {m.weeks.flat().map((c) => {
              const sunC = c.sunday ? "var(--bad)" : "var(--fg)";
              const vars = {
                "--kb": c.selected ? "var(--accs)" : c.sunday ? "var(--s2)" : "var(--card)",
                "--kr": c.selected ? "inset 0 0 0 2px var(--acc)" : "none",
                opacity: c.inMonth ? 1 : 0.42,
              } as CSSProperties;
              const nvars = {
                "--knb": c.today ? "var(--pri)" : "transparent",
                "--knf": c.today ? "var(--prifg)" : sunC,
                "--knr": c.today ? "0 0 0 2px var(--card), 0 0 0 4px var(--acc)" : "none",
                "--kmb": c.selected ? "var(--pri)" : "transparent",
                "--kmf": c.selected ? "var(--prifg)" : c.today ? "var(--acc)" : sunC,
                "--kmr": c.today ? "inset 0 0 0 2px var(--acc)" : "none",
                fontWeight: c.today || c.selected ? 700 : 500,
              } as CSSProperties;
              return (
                <Link key={c.day} href={c.href} scroll={false} className="tap cal-cell" aria-label={c.aria} aria-current={c.today ? "date" : undefined} style={vars}>
                  <span className="cal-ct">
                    <span className="num cal-num cal-i" style={nvars}>{c.d}</span>
                    {c.births ? (
                      <span className="pill num cal-cb" title={w.t(p("Birthdays", "जन्मदिन"))} style={{ height: 20, padding: "0 6px", background: "var(--warns)", color: "var(--warnfg)" }}>
                        <Ic n="cake" size={12} />
                        {c.births}
                      </span>
                    ) : null}
                  </span>
                  {c.bars.map((b) => {
                    const k = kindStyle(b.kind);
                    const first = b.labelled;
                    return (
                      <span
                        key={b.id}
                        className="cal-bar"
                        title={`${w.t(b.title)} · ${w.t(k.label)}`}
                        style={{
                          margin: `0 ${b.end || c.sunday ? "0" : "-7px"} 0 ${first ? "0" : "-7px"}`,
                          borderRadius: `${b.start ? "6px" : "0"} ${b.end ? "6px 6px" : "0 0"} ${b.start ? "6px" : "0"}`,
                          borderLeft: b.start ? `3px solid ${k.c}` : "0 solid transparent",
                          background: k.s,
                          color: k.f,
                        }}
                      >
                        {first ? <span>{w.t(b.title)}</span> : null}
                      </span>
                    );
                  })}
                  {c.more ? <span className="cal-m cal-cb" style={{ fontSize: 11, fontWeight: 700, paddingLeft: 4 }}>{w.t(p(`+${c.more} more`, `+${c.more} और`))}</span> : null}
                  <span className="cal-dots">
                    {c.dots.map((k) => (
                      <span key={k} style={{ background: kindStyle(k).c }} />
                    ))}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
        <span className="only-d" style={{ fontSize: 12, color: "var(--sub)" }}>{w.t(p("Click a day to see its events, staff on leave and birthdays. Today has a ring.", "किसी दिन पर क्लिक करें — उसके कार्यक्रम, छुट्टी पर स्टाफ़ और जन्मदिन दिखेंगे। आज के दिन पर घेरा है।"))}</span>
      </section>
      <aside className="cal-aside">
        <DayPanel d={m.panel} w={w} />
      </aside>
    </div>
  );
}

function DayPanel({ d, w }: { d: DayPanelModel; w: T }) {
  const hi = w.u(d.title);
  return (
    <div key={d.day} className="pad cal-c cal-in" style={{ gap: 12, padding: "18px 22px 28px" }}>
      <div className="cal-r cal-st" style={{ gap: 10 }}>
        <div className="cal-c cal-f">
          <span className="sech" style={{ color: d.isToday ? "var(--acc)" : "var(--mut)" }}>{w.t(d.rel)}</span>
          <h2 className="cal-tt" style={{ fontSize: 24 }}>{w.t(d.title)}</h2>
          {hi ? <span className="cal-m3">{hi}</span> : null}
        </div>
        {d.addHref ? (
          <Link href={d.addHref} scroll={false} className="tap btn soft cal-ib" aria-label={w.t(p("Add event on this day", "इस दिन कार्यक्रम जोड़ें"))}>
            <Ic n="plus" />
          </Link>
        ) : null}
      </div>
      {d.rows.map((r, i) => <PanelRow key={r.id} r={r} i={i} w={w} />)}
      {d.rows.length === 0 ? <div className="cal-d">{w.t(d.empty)}</div> : null}
      <div className="cal-x cal-c" style={{ gap: 8 }}>
        {d.facts.map((f, i) => (
          <span key={i} className="cal-r cal-st" style={{ gap: 8, fontSize: 13 }}>
            <Ic n={f.icon} size={15} style={{ color: f.tone, marginTop: 2 }} />
            {w.t(f.text)}
          </span>
        ))}
      </div>
      <Link href={d.openHref} className="tap btn sec" style={{ height: 44 }}>
        {w.t(p("Open full day", "पूरा दिन खोलें"))}
        <Ic n="arrowRight" />
      </Link>
    </div>
  );
}

/* ----------------------------------------------------------------- day */

function DayScreen({ d, w }: { d: DayModel; w: T }) {
  const a = d.attendance;
  const tone = a.tone === "ok" ? "var(--ok)" : a.tone === "warn" ? "var(--warnfg)" : "var(--mut)";
  const hi = w.u(d.long);
  return (
    <>
      <div className="pad cal-pg">
        <div className="cal-c cal-in" style={{ gap: 16, maxWidth: 1180 }}>
          <div className="card cal-r" style={{ gap: 12, padding: "14px 16px" }}>
            <span className="cal-i cal-c" style={{ width: 58, height: 62, borderRadius: 16, background: d.isToday ? "var(--pri)" : "var(--s3)", color: d.isToday ? "var(--prifg)" : "var(--fg)" }}>
              <span className="cal-cap" style={{ color: "inherit" }}>{d.mon}</span>
              <span className="num cal-tt" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{d.d}</span>
            </span>
            <span className="cal-c cal-f">
              <span className="sech" style={{ color: d.isToday ? "var(--acc)" : "var(--mut)" }}>{w.t(d.rel)}</span>
              <h2 className="cal-tt" style={{ fontSize: 21 }}>
                <span className="hide-m">{w.t(d.long)}</span>
                <span className="hide-d">{w.t(d.short)}</span>
              </h2>
              {hi ? <span className="cal-m3">{hi}</span> : null}
            </span>
            <Link href={d.prevHref} scroll={false} className="tap btn sec cal-ib" aria-label={w.t(p("Previous day", "पिछला दिन"))}><Ic n="chevLeft" /></Link>
            <Link href={d.nextHref} scroll={false} className="tap btn sec cal-ib" aria-label={w.t(p("Next day", "अगला दिन"))}><Ic n="chevRight" /></Link>
            {d.addHref ? (
              <Link href={d.addHref} className="only-d tap btn pri">
                <Ic n="plus" />
                {w.t(p("Add event on this day", "इस दिन कार्यक्रम जोड़ें"))}
              </Link>
            ) : null}
          </div>
          <div className="stack cal-2">
            <div className="cal-c" style={{ gap: 16, minWidth: 0 }}>
              <div className="card cal-b">
                <div className="cal-r cal-sp">
                  <span className="cal-h">{w.t(p("Attendance", "हाज़िरी"))}</span>
                  <span className="pill" style={{ background: "var(--s3)", color: tone }}>{w.t(a.pill)}</span>
                </div>
                <span className="cal-t">{w.t(a.line)}</span>
                {a.bar !== null ? (
                  <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.bar} style={{ height: 10, borderRadius: 5, background: "var(--s3)", overflow: "hidden" }}>
                    <div style={{ height: 10, width: `${a.bar}%`, background: "var(--acc)", borderRadius: 5, transformOrigin: "left", animation: "xGrowX .7s var(--ease) both" }} />
                  </div>
                ) : null}
                <span className="cal-m">{w.t(a.sub)}</span>
              </div>
              <div className="card cal-b">
                <div className="cal-r cal-sp">
                  <span className="cal-h">{w.t(d.rows.length ? p(`Events · ${d.rows.length}`, `कार्यक्रम · ${d.rows.length}`) : p("Events", "कार्यक्रम"))}</span>
                  {d.addHref ? (
                    <Link href={d.addHref} className="tap btn ghost cal-sm" style={{ color: "var(--acc)" }}>
                      <Ic n="plus" size={15} />
                      {w.t(p("Add", "जोड़ें"))}
                    </Link>
                  ) : null}
                </div>
                {d.rows.map((r, i) => {
                  const k = kindStyle(r.kind);
                  return (
                    <Link key={r.id} href={r.href} className="tap row cal-ev cal-rw" style={{ opacity: r.cancelled ? 0.55 : 1, animation: "xIn .32s var(--ease) both", animationDelay: delay(i) }}>
                      <TimeCol r={r} w={w} />
                      <span className="cal-i cal-ic hide-m" style={{ background: k.s, color: k.f }}><Ic n={k.icon} /></span>
                      <span className="cal-c cal-f" style={{ gap: 2 }}>
                        <span className="cal-t" style={{ textDecoration: r.cancelled ? "line-through" : "none" }}>{w.t(r.title)}</span>
                        <span className="cal-m">{w.t(r.sub)}</span>
                        {r.badge ? <span style={{ fontSize: 12, color: TONE[r.badge.tone][1], fontWeight: 600 }}>{w.t(r.badge.text)}</span> : null}
                      </span>
                      <Ic n="chevRight" style={{ color: "var(--sub)" }} />
                    </Link>
                  );
                })}
                {d.rows.length === 0 ? <div className="cal-d">{w.t(d.empty)}</div> : null}
              </div>
              {d.fee ? (
                <div className="card cal-b" style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <span className="cal-i cal-ic" style={{ background: "var(--s3)", color: "var(--mut)" }}><Ic n="rupee" /></span>
                  <span className="cal-c cal-f" style={{ gap: 2 }}>
                    <span className="cal-t">{w.t(d.fee.line)}</span>
                    <span className="cal-m">{w.t(d.fee.sub)}</span>
                  </span>
                  <Link href={d.fee.href} className="tap btn ghost cal-sm" style={{ color: "var(--acc)" }}>{w.t(p("Dues", "बकाया"))}</Link>
                </div>
              ) : null}
            </div>
            <div className="cal-c" style={{ gap: 16, minWidth: 0 }}>
              <div className="card cal-b">
                <span className="cal-h">{w.t(p("Staff on leave", "छुट्टी पर स्टाफ़"))}</span>
                {d.leave.map((l, i) => (
                  <div key={`${l.name}-${i}`} className="cal-r cal-in" style={{ gap: 10 }}>
                    <span className="cal-a" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>{l.ini}</span>
                    <span className="cal-c" style={{ minWidth: 0 }}>
                      <span className="cal-t">{l.name}</span>
                      <span className="cal-m">{w.t(l.line)}</span>
                    </span>
                  </div>
                ))}
                {d.leave.length === 0 ? <span className="cal-m3">{w.t(p("Everyone is in.", "सब उपस्थित हैं।"))}</span> : null}
              </div>
              <div className="card cal-b">
                <span className="cal-h">{w.t(d.births.length ? p(`Birthdays · ${d.births.length}`, `जन्मदिन · ${d.births.length}`) : p("Birthdays", "जन्मदिन"))}</span>
                {d.births.map((b, i) => (
                  <div key={`${b.name}-${i}`} className="cal-r cal-in" style={{ gap: 10, animationDelay: delay(i) }}>
                    <span className="cal-a" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>{b.ini}</span>
                    <span className="cal-c cal-f">
                      <span className="cal-t">{b.name}</span>
                      <span className="cal-m">{w.t(b.sub)}</span>
                    </span>
                  </div>
                ))}
                {d.births.length === 0 ? <span className="cal-m3">{w.t(p("No birthdays on this day.", "इस दिन कोई जन्मदिन नहीं।"))}</span> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      {d.addHref ? (
        <div className="only-m glass cal-sb">
          <Link href={d.addHref} className="tap btn pri" style={{ width: "100%", height: 48 }}>
            <Ic n="plus" />
            {w.t(p("Add event on this day", "इस दिन कार्यक्रम जोड़ें"))}
          </Link>
        </div>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------- agenda */

function AgendaScreen({ a, w }: { a: AgendaModel; w: T }) {
  return (
    <div className="pad cal-c" style={{ gap: 12, padding: "18px 28px 40px", maxWidth: 940 }}>
      <div className="cal-r cal-w cal-sp" style={{ gap: 10, alignItems: "baseline" }}>
        <h2 className="cal-tt" style={{ fontSize: 24 }}>{w.t(p("Next 30 days", "अगले 30 दिन"))}</h2>
        <span className="cal-m3">{w.t(a.range)}</span>
      </div>
      <Chips chips={a.chips} w={w} />
      {a.groups.map((g) => {
        const hi = w.u(g.date);
        return (
          <div key={g.day} className="cal-c">
            <Link href={g.href} className="tap glass cal-r cal-w cal-gh" style={{ gap: 10, alignItems: "baseline", padding: "10px 4px 8px" }}>
              <span className="cal-h" style={{ color: g.isToday ? "var(--acc)" : "var(--fg)" }}>{w.t(g.head)}</span>
              {hi ? <span className="cal-m">{hi}</span> : null}
              <span className="cal-f" />
              {g.note ? <span className="cal-m">{w.t(g.note)}</span> : null}
            </Link>
            <div className="cal-c" style={{ gap: 8, padding: "10px 0 14px" }}>
              {g.rows.map((r, i) => {
                const k = kindStyle(r.kind);
                return (
                  <Link key={r.id} href={r.href} className="tap card lift cal-ev" style={{ padding: "12px 14px", opacity: r.cancelled ? 0.55 : 1, animation: "xIn .32s var(--ease) both", animationDelay: delay(i) }}>
                    <TimeCol r={r} w={w} />
                    <span className="cal-b4" style={{ background: k.c }} />
                    <span className="cal-c cal-f" style={{ gap: 2 }}>
                      <span className="cal-t" style={{ textDecoration: r.cancelled ? "line-through" : "none" }}>{w.t(r.title)}</span>
                      <span className="cal-m">{w.t(r.sub)}</span>
                    </span>
                    <span className="pill hide-m" style={{ background: k.s, color: k.f }}>{w.t(k.label)}</span>
                    <Ic n="chevRight" style={{ color: "var(--sub)" }} />
                  </Link>
                );
              })}
              {g.rows.length === 0 ? <span className="cal-m3" style={{ padding: "2px 4px" }}>{w.t(p("No school events — a normal day.", "कोई कार्यक्रम नहीं — सामान्य दिन।"))}</span> : null}
            </div>
          </div>
        );
      })}
      {a.empty ? (
        <div className="card fadein cal-c" style={{ gap: 10, padding: "32px 20px", alignItems: "center" }}>
          <span className="cal-h">{w.t(a.empty === "filtered" ? p("Nothing with these filters", "इन फ़िल्टर के साथ कुछ नहीं") : p("Nothing in the next 30 days", "अगले 30 दिनों में कुछ नहीं"))}</span>
          {a.empty === "filtered" ? <Link href={a.clearHref} className="tap btn sec">{w.t(p("Show all types", "सभी प्रकार दिखाएँ"))}</Link> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- holidays */

function HolidaysScreen({ h, w }: { h: HolidaysModel; w: T }) {
  return (
    <div className="pad cal-c" style={{ gap: 16, padding: "18px 28px 40px", maxWidth: 900 }}>
      <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", overflow: "hidden" }}>
        {h.kpis.map((k, i) => (
          <div key={k.k.en} className="rise cal-c" style={{ gap: 2, padding: "14px 16px", borderLeft: i ? "1px solid var(--bd)" : 0, animationDelay: delay(i), minWidth: 0 }}>
            <span className="cal-m" style={{ fontWeight: 600 }}>{w.t(k.k)}</span>
            <span className="num cal-kv cal-e" style={{ color: k.tone }}>{w.t(k.v)}</span>
            <span className="cal-m cal-e">{w.t(k.sub)}</span>
          </div>
        ))}
      </div>
      <div className="card" style={{ overflow: "hidden", minWidth: 0 }}>
        <div className="cal-r cal-w" style={{ gap: 8, padding: "14px 16px", borderBottom: "1px solid var(--bd)" }}>
          <span className="cal-c cal-f" style={{ minWidth: 240 }}>
            <span className="cal-h">{w.t(h.title)}</span>
            <span className="num cal-m">{w.t(h.line)}</span>
          </span>
          {h.addHref ? (
            <Link href={h.addHref} className="tap btn soft cal-sm">
              <Ic n="plus" size={15} />
              {w.t(p("Add", "जोड़ें"))}
            </Link>
          ) : null}
          {h.editHref ? (
            <Link href={h.editHref} className="tap btn ghost cal-sm">
              <Ic n="edit" size={15} />
              {w.t(p("Edit", "बदलें"))}
            </Link>
          ) : null}
        </div>
        {h.rows.map((r, i) => {
          const hi = w.u(r.name);
          return (
            <div key={r.key} className="cal-r" style={{ gap: 4, padding: "0 10px 0 6px", borderBottom: "1px solid var(--bd)", opacity: r.past ? 0.62 : 1, overflow: "hidden", animation: "xIn .32s var(--ease) both", animationDelay: delay(i) }}>
              <Link href={r.href} className="tap row cal-r cal-f" style={{ gap: 12, padding: "10px 8px", borderRadius: 12, color: "var(--fg)" }}>
                <span className="cal-i cal-c" style={{ width: 46, height: 50, borderRadius: 12, background: "var(--bads)", color: "var(--bad)" }}>
                  <span className="cal-cap" style={{ fontSize: 10, color: "inherit" }}>{r.mon}</span>
                  <span className="num" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>{r.d}</span>
                </span>
                <span className="cal-c cal-f">
                  <span className="cal-t cal-e">{w.t(r.name)}</span>
                  <span className="cal-m">{line(hi, r.when)}</span>
                </span>
                <span className="pill num" style={{ background: "var(--s3)", color: "var(--mut)" }}>{w.t(r.days)}</span>
              </Link>
              {r.tellHref ? (
                <Link href={r.tellHref} scroll={false} className="tap btn soft cal-sm" aria-label={w.t(p(`Tell parents about ${r.name.en}`, `${r.name.hi ?? r.name.en} के बारे में अभिभावकों को बताएँ`))}>
                  <Ic n="send" size={15} />
                  <span className="hide-m">{w.t(p("Tell parents", "अभिभावकों को बताएँ"))}</span>
                </Link>
              ) : null}
              {r.badge ? <BadgePill b={r.badge} w={w} /> : null}
            </div>
          );
        })}
        {h.rows.length === 0 ? <div className="cal-d" style={{ margin: 16 }}>{w.t(p("No holidays set for this session yet.", "इस सत्र की कोई छुट्टी अभी तय नहीं।"))}</div> : null}
        <span className="cal-m" style={{ display: "block", padding: "12px 16px" }}>{w.t(p("Holidays show on everyone’s calendar, close attendance for the day and are skipped by the timetable.", "छुट्टियाँ सबके कैलेंडर में दिखती हैं, उस दिन हाज़िरी बंद रहती है और समय सारणी उसे छोड़ देती है।"))}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- event */

function Ring({ sent, waiting, total }: { sent: number; waiting: number; total: number }) {
  const C = 263.89;
  const arc = (v: number) => (total ? (v / total) * C : 0).toFixed(1);
  return (
    <svg width="108" height="108" viewBox="0 0 108 108" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
      <circle cx="54" cy="54" r="42" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 11 }} />
      <circle cx="54" cy="54" r="42" style={{ fill: "none", stroke: "var(--okm)", strokeWidth: 11, strokeLinecap: "round", strokeDasharray: `${arc(sent + waiting)} ${C}`, ["--len" as string]: arc(sent + waiting), animation: "xDraw .8s var(--ease) both" }} />
      <circle cx="54" cy="54" r="42" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 11, strokeLinecap: "round", strokeDasharray: `${arc(sent)} ${C}`, ["--len" as string]: arc(sent), animation: "xDraw .9s .15s var(--ease) both" }} />
    </svg>
  );
}

function Told({ c, w }: { c: ToldCard; w: T }) {
  if (c.state === "approved") {
    const waiting = c.rows[1]?.v ?? 0;
    return (
      <div className="card cal-b" style={{ gap: 12 }}>
        <div className="cal-r cal-sp" style={{ gap: 8 }}>
          <span className="cal-h">{w.t(c.head)}</span>
          <span className="cal-m">{c.when}</span>
        </div>
        <div className="cal-r" style={{ gap: 16 }}>
          <div style={{ position: "relative", flex: "none", width: 108, height: 108 }}>
            <Ring sent={c.sent} waiting={waiting} total={c.total} />
            <span className="cal-c cal-i" style={{ position: "absolute", inset: 0 }}>
              <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{c.sent}/{c.total}</span>
              <span className="cal-m" style={{ fontSize: 11 }}>{w.t(p("sent", "भेजे"))}</span>
            </span>
          </div>
          <div className="cal-c cal-f" style={{ gap: 6 }}>
            <span className="cal-t">{w.t(c.line)}</span>
            {c.rows.filter((r, i) => i < 2 || r.v > 0).map((r) => (
              <div key={r.k.en} className="cal-r" style={{ gap: 8, fontSize: 13 }}>
                <span className="cal-dot" style={{ borderRadius: 3, background: r.c }} />
                <span className="cal-f" style={{ color: "var(--mut)" }}>{w.t(r.k)}</span>
                <span className="num" style={{ fontWeight: 700 }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>
        {c.open ? (
          <Link href={c.open} className="tap btn soft" style={{ height: 44 }}>
            <Ic n="send" />
            {w.t(p("Open Messages → To send", "संदेश → भेजने को खोलें"))}
          </Link>
        ) : null}
      </div>
    );
  }
  return (
    <div className="card cal-b">
      <span className="cal-h">{w.t(c.head)}</span>
      <span className="cal-m3">{w.t(c.line)}</span>
      {c.state === "asked" ? (
        <Link href={c.open} className="tap btn soft" style={{ height: 44 }}>
          <Ic n="send" />
          {w.t(p("Open Messages → To send", "संदेश → भेजने को खोलें"))}
        </Link>
      ) : c.tell ? (
        <Link href={c.tell.href} scroll={false} className="tap btn pri" style={{ height: 44 }}>
          <Ic n="send" />
          {w.t(c.tell.label)}
        </Link>
      ) : null}
    </div>
  );
}

function EventScreen({ e, back, w }: { e: EventModel | null; back: string; w: T }) {
  if (!e) {
    return (
      <div className="pad cal-pg">
        <div className="card">
          <EmptyState icon="calendar" title={w.t(p("That event is not on the calendar", "वह कार्यक्रम कैलेंडर में नहीं है"))} action={<Link href={back} className="tap btn sec">{w.t(p("Back to the calendar", "कैलेंडर पर लौटें"))}</Link>} />
        </div>
      </div>
    );
  }
  const k = kindStyle(e.kind);
  const hi = w.u(e.sub);
  return (
    <div className="pad cal-pg">
      <div className="stack cal-2">
        <div className="cal-c" style={{ gap: 16, minWidth: 0 }}>
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ height: 6, background: k.c }} />
            <div className="cal-c" style={{ padding: "16px 20px 20px", gap: 14 }}>
              <div className="cal-r cal-w" style={{ gap: 8 }}>
                <span className="pill cal-pl" style={{ background: k.s, color: k.f }}>
                  <Ic n={k.icon} size={14} />
                  {w.t(k.label)}
                </span>
                <span className="pill cal-pl" style={{ background: "var(--s3)", color: "var(--mut)" }}>{w.t(e.rel)}</span>
                {e.cancelled ? <Cancelled w={w} cls="cal-pl" /> : null}
              </div>
              <div className="cal-c" style={{ gap: 4 }}>
                <h2 className="cal-tt" style={{ fontSize: 28, lineHeight: 1.15, textDecoration: e.cancelled ? "line-through" : "none" }}>{w.t(e.title)}</h2>
                {hi ? <span className="cal-m3">{hi}</span> : null}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                {e.facts.map((f, i) => (
                  <div key={f.k.en} className="cal-x cal-r cal-st cal-in" style={{ gap: 10, animationDelay: delay(i) }}>
                    <Ic n={f.icon} style={{ color: "var(--mut)", marginTop: 2 }} />
                    <span className="cal-c" style={{ minWidth: 0 }}>
                      <span className="cal-cap">{w.t(f.k)}</span>
                      <span className="cal-t">{w.t(f.v)}</span>
                    </span>
                  </div>
                ))}
              </div>
              {e.note ? (
                <div className="cal-r cal-st" style={{ gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--infos)", color: "var(--info)", fontSize: 13, lineHeight: 1.5 }}>
                  <Ic n="info" />
                  <span style={{ whiteSpace: "pre-wrap" }}>{w.t(e.note)}</span>
                </div>
              ) : null}
              {e.cancel ? (
                <div className="cal-r cal-w" style={{ gap: 8 }}>
                  <CancelEventButton id={e.cancel.id} title={e.cancel.title} told={e.told.state === "approved" || e.told.state === "asked"} />
                </div>
              ) : null}
            </div>
          </div>
          <div className="card cal-b" style={{ gap: 4 }}>
            <span className="sech" style={{ marginBottom: 6 }}>{w.t(p("Who is invited", "किसे बुलाया है"))}</span>
            {e.who.map((x, i) => (
              <div key={`${x.label.en}-${i}`} className="cal-r" style={{ gap: 12, padding: "8px 0", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <span className="cal-i cal-ic" style={{ background: "var(--accs)", color: "var(--accfg)" }}><Ic n={x.icon} /></span>
                <span className="cal-c cal-f">
                  <span className="cal-t">{w.t(x.label)}</span>
                  <span className="cal-m">{w.t(x.sub)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="cal-c" style={{ gap: 16, minWidth: 0 }}>
          <Told c={e.told} w={w} />
          <div className="card cal-b">
            <span className="sech">{w.t(e.bubbleHead)}</span>
            <Bubble text={e.bubble} time={e.bubbleTime === "preview" ? w.t(p("preview", "पूर्वावलोकन")) : e.bubbleTime} ticks={e.ticks} />
          </div>
        </div>
      </div>
    </div>
  );
}
