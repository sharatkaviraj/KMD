import Link from "@/ui/link";
import type { CSSProperties, ReactNode } from "react";

import type { Language } from "@/platform/i18n/language";
import { renderReminder } from "@/modules/staff-notices/domain/notices";
import { COST_PER_MESSAGE } from "@/modules/whatsapp/vx/domain/reminders";
import { agoP, clock, shortDayHi } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { HelpButton } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";
import { Btn, EmptyState } from "@/vx/ui/primitives";

import { CallSheet, PrintButton, RemindSheet } from "./client";
import type { ChronicChild, ClassRef, ClassToday, DayAttendance, DayDetail, MonthAttendance, RegisterSheet } from "./data";
import { isSunday, monthRange, telHref, type AttStatus } from "./domain";
import { MarkSheet } from "./mark-sheet";
import { followLabel } from "./progress-labels";
import { AutoSelect } from "./select";
import { CoordTop, dayName, nameInitials, qs, sayer, toneOf, type Say } from "./ui";

/*
 * AcadAttendance (SCREENS "Academic coordinator · Attendance"), drawn from
 * props: today, the month, children below 75% with their calls, and a class
 * register; sheets to remind, to mark for a teacher on leave, and to log a
 * call. There is no change-request tab: a saved register is corrected by its
 * class teacher or the office directly, with a reason (D-248). Not marked is
 * never counted as present (UI-22).
 */

const BASE = "/academics/attendance";

export type AttendanceSheet =
  | { kind: "remind"; who: string | null }
  | { kind: "mark"; roll: { classId: string; label: string; day: string; revision: number; students: { studentId: string; name: string; rollNo: string | null; status: AttStatus | null }[] }; teacher: string; allowed: boolean }
  | { kind: "call"; child: ChronicChild; lastNote: { body: string; by: string } | null }
  | null;

type Common = {
  language: Language;
  today: string;
  /** "9:41 am", the server's clock when the page was read. */
  nowLabel: string;
  /** This deployment's origin, for the reminder's link. */
  origin: string;
  attendance: DayAttendance;
  chronicCount: number;
  registerClass: ClassRef | null;
  mayRemind: boolean;
  everyClass: boolean;
  notesHref: string | null;
  sheet: AttendanceSheet;
};

export type AcadAttendanceProps = Common &
  (
    | { view: "today"; filter: "all" | "not" | "marked"; chronicAway: number; monthAvg: number | null }
    | { view: "month"; month: MonthAttendance; months: { key: string; label: string }[]; holidays: { day: string; label: string | null }[]; teachers: Record<string, string>; day: string | null; detail?: DayDetail | null }
    | { view: "chronic"; list: ChronicChild[]; recent: Record<string, { day: string; status: AttStatus }[]>; notes: Record<string, { body: string; by: string }>; filter: "all" | "away" | "nocall"; teachers: Record<string, string> }
    | { view: "register"; sheetData: RegisterSheet | null; classes: ClassRef[]; teacher: string | null; filter: "all" | "low" | "abs"; months: { key: string; label: string }[] }
    | { view: "empty" }
  );

const pct1 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 10) / 10}%`);
const ST: Record<AttStatus | "none", string> = { present: "var(--ok)", late: "var(--ok)", absent: "var(--bad)", leave: "var(--warn)", half_day: "var(--warn)", none: "transparent" };

function Seg({ tabs, current, width, label, style }: { tabs: { key: string; href: string; label: ReactNode }[]; current: string; width: number; label: string; style?: CSSProperties }) {
  const at = Math.max(0, tabs.findIndex((t) => t.key === current));
  return (
    <nav aria-label={label} className="seg" style={{ gridTemplateColumns: `repeat(${tabs.length},minmax(0,1fr))`, width, maxWidth: "100%", ...style }}>
      <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${tabs.length})`, transform: `translateX(${at * 100}%)` }} />
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} scroll={false} replace className="tap" aria-current={t.key === current ? "page" : undefined} style={{ position: "relative", height: 34, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 8px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", color: t.key === current ? "var(--fg)" : "var(--mut)" }}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function Chip({ href, on, label, n, dot }: { href: string; on: boolean; label: string; n: number; dot?: string }) {
  return (
    <Link href={href} scroll={false} replace className={`tap chip${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
      {dot ? <span style={{ width: 9, height: 9, borderRadius: 5, background: on ? "var(--prifg)" : dot }} /> : null}
      {label}
      <span className="num" style={{ opacity: 0.7 }}>{n}</span>
    </Link>
  );
}

const CARD: CSSProperties = { padding: "18px 20px", display: "flex", flexDirection: "column" };

export function AcadAttendanceView(p: AcadAttendanceProps) {
  const say = sayer(p.language);
  const today = p.attendance;
  const help = (
    <HelpButton
      title={say("Attendance", "हाज़िरी")}
      steps={[
        { icon: "calCheck", title: say("Watch the ring", "रिंग देखें"), body: say("It fills as each class teacher presses Save. A class counts only after Save; not marked is never counted as present.", "हर कक्षा-अध्यापक के सहेजने पर भरती है। सहेजने के बाद ही कक्षा गिनी जाती है; दर्ज न होना कभी उपस्थित नहीं गिना जाता।") },
        { icon: "bell", title: say("Remind in one tap", "एक टैप में याद"), body: say("Preview the WhatsApp to teachers who have not saved, then send. You can undo.", "जिन्होंने सहेजा नहीं उन्हें WhatsApp का नमूना देखें, फिर भेजें। वापस ले सकते हैं।") },
        { icon: "edit", title: say("Changing a saved register", "सहेजा रजिस्टर बदलना"), body: say("The class teacher or the office changes it directly, with a reason. Nobody has to approve it.", "कक्षा-अध्यापक या ऑफ़िस कारण के साथ सीधे बदलते हैं। किसी की मंज़ूरी नहीं चाहिए।") },
      ]}
    />
  );
  const crumb = say(`Academics · ${dayName(p.today)}`, `शैक्षणिक · ${dayName(p.today)}`);
  const view = p.view;
  const tab = view === "empty" ? "today" : view;
  const regHref = qs(BASE, { view: "register", class: p.registerClass?.id });
  const tabs = (
    <div className="pad" style={{ padding: "16px 28px 0" }}>
      <nav aria-label={say("Views", "दृश्य")} className="seg acad-tabs" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))", width: 592, maxWidth: "100%" }}>
        <style>{`.acad-tabs>a{display:flex;align-items:center;justify-content:center;gap:6px;height:38px;min-width:0;padding:0 6px;position:relative;font-size:13px;font-weight:700}@container vx (max-width:899px){.acad-tabs{width:100%!important}.acad-tabs>a{flex-direction:column;gap:1px;height:38px;font-size:11px;padding:0 1px;letter-spacing:-.01em}.acad-tabs>a svg{width:16px;height:16px}.acad-tabs .acad-bdg{position:absolute;top:1px;right:4px}}`}</style>
        <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 4)", transform: `translateX(${["today", "month", "chronic", "register"].indexOf(tab) * 100}%)` }} />
        {(
          [
            ["today", BASE, "calCheck", say("Today", "आज"), 0],
            ["month", qs(BASE, { view: "month" }), "chart", say("Month", "महीना"), 0],
            ["chronic", qs(BASE, { view: "chronic" }), "alert", "< 75%", p.chronicCount],
            ["register", regHref, "table", say("Register", "रजिस्टर"), 0],
          ] as [string, string, IconName, string, number][]
        ).map(([key, href, icon, label, n]) => (
          <Link key={key} href={href} scroll={false} className="tap" aria-current={tab === key ? "page" : undefined} style={{ color: tab === key ? "var(--fg)" : "var(--mut)" }}>
            <Ic n={icon} size={18} />
            <span className="clip" style={{ maxWidth: "100%" }}>{label}</span>
            {n ? <span className="num acad-bdg" style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "var(--bad)", color: "var(--onsolid)", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{n}</span> : null}
          </Link>
        ))}
      </nav>
    </div>
  );

  /* -------------------------------------------------------------- sheets */
  const closeHref = qs(BASE, { view: tab === "today" ? undefined : tab, class: tab === "register" ? p.registerClass?.id : undefined });
  let sheet: ReactNode = null;
  if (p.sheet?.kind === "remind" && p.mayRemind) {
    const left = today.notMarked.filter((c) => c.teacherId && (!p.sheet || p.sheet.kind !== "remind" || !p.sheet.who || c.classId === p.sheet.who));
    const pool = left.length ? left : today.notMarked.filter((c) => c.teacherId);
    sheet = (
      <RemindSheet
        closeHref={closeHref}
        mode="registers"
        pick="list"
        title={pool.length === 1 ? { en: `Remind ${pool[0].teacherName}?`, hi: `${pool[0].teacherName} को याद दिलाएँ?` } : { en: `Remind ${pool.length} teachers?`, hi: `${pool.length} शिक्षकों को याद दिलाएँ?` }}
        sub={{ en: "Teachers who have not pressed Save today", hi: "जिन शिक्षकों ने आज सहेजा नहीं" }}
        people={pool.map((c) => ({ id: c.classId, name: c.teacherName, tag: c.teacherAway ? { en: "on leave", hi: "छुट्टी पर" } : undefined, sub: `${c.label} · ${say(`${c.roll} children · not saved yet`, `${c.roll} बच्चे · अभी सहेजा नहीं`)}`, on: !c.teacherAway || pool.length === 1 }))}
        previews={Object.fromEntries(
          pool.map((c) => {
            const r = renderReminder({ staffName: c.teacherName, language: "both", day: p.today, classLabel: c.label, link: `${p.origin}/teach/attendance?class=${c.classId}&day=${p.today}` });
            return [c.classId, { hi: r.text.hi, en: r.text.en }];
          }),
        )}
        unit={{ one: { en: "teacher", hi: "शिक्षक" }, many: { en: "teachers", hi: "शिक्षक" } }}
        costEach={COST_PER_MESSAGE}
        channel={{ en: "AiSensy · WhatsApp", hi: "AiSensy · WhatsApp" }}
        note={{ en: "Sent once per class per day. If the register is saved before it goes, it is not sent. You can undo for a few seconds.", hi: "हर कक्षा के लिए दिन में एक बार। रजिस्टर पहले सहेजा गया तो नहीं जाएगा। कुछ सेकंड तक वापस ले सकते हैं।" }}
      />
    );
  } else if (p.sheet?.kind === "mark") {
    const s = p.sheet;
    sheet = <MarkSheet closeHref={closeHref} classId={s.roll.classId} label={s.roll.label} day={s.roll.day} teacher={s.teacher} revision={s.roll.revision} students={s.roll.students} allowed={s.allowed} refusal={{ en: "Marking for a teacher is the office's job. Ask the office, or remind the teacher.", hi: "शिक्षक की ओर से दर्ज करना कार्यालय का काम है। कार्यालय से कहें या शिक्षक को याद दिलाएँ।" }} />;
  } else if (p.sheet?.kind === "call" && p.everyClass) {
    const c = p.sheet.child;
    const digits = (c.phone ?? "").replace(/\D/g, "").slice(-10);
    sheet = <CallSheet closeHref={qs(BASE, { view: "chronic" })} studentId={c.studentId} name={c.name} sub={say(`${c.father ? `${c.father} · ` : ""}${c.classLabel} · ${Math.round(c.pct)}% this session`, `${c.father ? `${c.father} · ` : ""}${c.classLabel} · इस सत्र ${Math.round(c.pct)}%`)} phoneHref={telHref(c.phone)} phoneLabel={digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : null} lastNote={p.sheet.lastNote} figures={{ father: c.father, classLabel: c.classLabel, pct: c.pct, absentDays: c.absentDays, absentLastWeek: c.absentLastWeek, lastOutcome: c.lastCall?.outcome ?? null }} />;
  }

  if (view === "empty") {
    return (
      <VxPage>
        <CoordTop crumb={crumb} title={say("Attendance", "हाज़िरी")} actions={help} mAction={help} />
        <main>
          <div className="pad" style={{ padding: "20px 28px 40px" }}>
            <EmptyState title={say("No classes to show", "दिखाने को कोई कक्षा नहीं")} />
          </div>
        </main>
      </VxPage>
    );
  }

  /* --------------------------------------------------------------- month */
  if (p.view === "month") {
    const m = p.month;
    const { first, last } = monthRange(m.month);
    const monthLong = new Date(`${m.month}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
    const monthShort = new Date(`${m.month}-15T12:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" }).replace("Sept", "Sep");
    const isCurrent = p.today.slice(0, 7) === m.month;
    const hol = new Map(p.holidays.map((h) => [h.day, h.label]));
    const byDay = new Map(m.byDay.map((d) => [d.day, d.pct]));
    const days: { day: string; n: number; kind: "day" | "hol" | "sun" | "fut" | "none"; pct: number | null }[] = [];
    for (let d = first; d <= last; d = nextDay(d)) {
      const kind = hol.has(d) ? "hol" : isSunday(d) ? "sun" : d > p.today ? "fut" : byDay.get(d) != null ? "day" : "none";
      days.push({ day: d, n: Number(d.slice(8)), kind, pct: byDay.get(d) ?? null });
    }
    const school = days.filter((d) => d.kind === "day");
    const best = school.reduce<(typeof school)[number] | null>((a, d) => (!a || (d.pct ?? 0) > (a.pct ?? 0) ? d : a), null);
    const worst = school.reduce<(typeof school)[number] | null>((a, d) => (!a || (d.pct ?? 101) < (a.pct ?? 101) ? d : a), null);
    const notSaved = m.byClass.reduce((s, c) => s + c.daysOpen, 0);
    const selDay = days.find((d) => d.day === p.day) ?? days.find((d) => d.day === p.today) ?? school[school.length - 1] ?? null;
    const isToday = (d: string) => d === p.today;
    const selLook = !selDay || selDay.kind !== "day" ? ["var(--s3)", "var(--mut)", "calendar"] : isToday(selDay.day) ? ["var(--accs)", "var(--accfg)", "clock"] : (selDay.pct ?? 100) < 90 ? ["var(--warns)", "var(--warnfg)", "alert"] : ["var(--oks)", "var(--ok)", "check"];
    const ranked = m.byClass.filter((c) => c.pct !== null).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const dips = school.filter((d) => (d.pct ?? 100) < 90 && !isToday(d.day));
    const kpis: [string, string, string, string][] = [
      [say("Average", "औसत"), pct1(m.average), say(`${school.length} school days`, `${school.length} स्कूल दिवस`), "var(--fg)"],
      [say("Best day", "सबसे अच्छा दिन"), pct1(best?.pct), best ? dayName(best.day) : "—", "var(--ok)"],
      [say("Lowest day", "सबसे कम दिन"), pct1(worst?.pct), worst ? dayName(worst.day) : "—", "var(--warnfg)"],
      [say("Class-days not saved", "बिना सहेजे कक्षा-दिवस"), String(notSaved), say("never counted as present", "कभी उपस्थित नहीं गिने"), notSaved ? "var(--bad)" : "var(--fg)"],
    ];
    const savedToday = today.marked;
    return (
      <VxPage>
        <CoordTop crumb={crumb} title={say("This month", "इस महीने की हाज़िरी")} dBack={BASE} mBack={BASE} mSub={say(`${monthLong} · average ${pct1(m.average)}`, `${monthLong} · औसत ${pct1(m.average)}`)} actions={<>{help}<PrintButton label={{ en: `Download ${monthShort} report`, hi: `${monthShort} रिपोर्ट` }} icon="download" /></>} mAction={help} />
        <main>
          {tabs}
          <div className="pad" style={{ padding: "18px 28px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <Seg label={say("Month", "महीना")} current={m.month} width={240} tabs={p.months.map((x) => ({ key: x.key, href: qs(BASE, { view: "month", month: x.key }), label: x.label }))} />
              <span style={{ flex: 1, minWidth: 200, fontSize: 12, color: "var(--mut)" }}>{say(`${monthLong}${isCurrent ? " so far" : ""} · ${school.length} school days · tap a bar to see the day`, `${monthLong} · ${school.length} स्कूल दिवस · दिन देखने को बार पर टैप करें`)}</span>
            </div>
            <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
              {kpis.map(([l, v, s, c], i) => (
                <div key={l} className="card rise" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 2, animationDelay: `${i * 50}ms` }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{l}</span>
                  <span className="num" style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{s}</span>
                </div>
              ))}
            </div>
            <div className="card" style={{ ...CARD, gap: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{say(`${monthLong} ${m.month.slice(0, 4)} · school attendance`, `${monthLong} ${m.month.slice(0, 4)} · स्कूल की हाज़िरी`)}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("Each bar = one school day · % of children present", "हर बार = एक स्कूल दिवस · उपस्थित बच्चों का %")}</span>
              </div>
              <div className="acad-chart" style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 3, paddingLeft: 34, borderBottom: "1px solid var(--bds)", marginTop: 18 }}>
                <style>{`.acad-chart{height:220px}.acad-chx{gap:3px}@container vx (max-width:899px){.acad-chart{height:180px;gap:2px!important}.acad-chx{gap:2px}.acad-chx>span:not(.acad-k){visibility:hidden}.acad-hl{display:none}}`}</style>
                {[[100, "100%"], [50, "90%"], [0, "80%"]].map(([b, t]) => (
                  <span key={t} style={{ position: "absolute", left: 34, right: 0, bottom: `${b}%`, borderTop: "1px dashed var(--bd)", pointerEvents: "none" }}>
                    <span style={{ position: "absolute", left: -34, top: -8, fontSize: 10, color: "var(--sub)" }}>{t}</span>
                  </span>
                ))}
                {days.map((d, i) => {
                  const sel = selDay?.day === d.day;
                  const h = d.pct === null ? 0 : Math.max(2, Math.min(100, ((d.pct - 80) / 20) * 100));
                  const colour = isToday(d.day) ? "var(--acc)" : (d.pct ?? 100) < 90 ? "var(--c3)" : "var(--c2)";
                  return (
                    <Link key={d.day} href={qs(BASE, { view: "month", month: m.month, day: d.day })} scroll={false} replace aria-label={`${dayName(d.day)} · ${d.kind === "day" ? `${pct1(d.pct)} ${say("present", "उपस्थित")}` : d.kind === "hol" ? `${say("Holiday", "अवकाश")} · ${hol.get(d.day) ?? ""}` : d.kind === "sun" ? say("Sunday", "रविवार") : say("Not yet", "अभी नहीं")}`} className="tap" style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", borderRadius: 5, position: "relative" }}>
                      {d.kind === "day" ? (
                        <span style={{ position: "relative", width: "100%", maxWidth: 22, height: `${h}%`, background: colour, borderRadius: "5px 5px 2px 2px", boxShadow: sel ? "0 0 0 2px var(--card), 0 0 0 3.5px var(--fg)" : undefined, transformOrigin: "bottom", animation: `xGrowY .7s var(--ease) ${i * 20}ms both` }}>
                          {(d.pct ?? 100) < 90 && !isToday(d.day) ? <span className="num acad-hl" style={{ position: "absolute", bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)", fontSize: 10, fontWeight: 700, color: "var(--warnfg)", whiteSpace: "nowrap" }}>{pct1(d.pct)}</span> : null}
                        </span>
                      ) : d.kind === "hol" ? (
                        <span style={{ width: "100%", maxWidth: 22, height: "100%", borderRadius: 5, background: "repeating-linear-gradient(135deg,var(--s3) 0 4px,transparent 4px 8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span className="acad-hl" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 10, fontWeight: 700, color: "var(--mut)", whiteSpace: "nowrap" }}>{hol.get(d.day) ?? say("Holiday", "अवकाश")}</span>
                        </span>
                      ) : d.kind === "fut" || d.kind === "none" ? (
                        <span style={{ width: "100%", maxWidth: 22, height: 6, borderRadius: 3, background: "var(--s3)" }} />
                      ) : null}
                    </Link>
                  );
                })}
              </div>
              <div className="acad-chx" style={{ display: "flex", paddingLeft: 34 }}>
                {days.map((d, i) => (
                  <span key={d.day} className={i % 7 === 0 ? "acad-k" : undefined} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 10, fontWeight: 600, color: d.kind === "day" || d.kind === "hol" ? "var(--mut)" : "var(--sub)" }}>{d.n}</span>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 12, color: "var(--mut)" }}>
                {[[say("Normal day", "सामान्य दिन"), "var(--c2)"], [say("Dip (below 90%)", "गिरावट (90% से कम)"), "var(--c3)"], ...(isCurrent ? [[say("Today, so far", "आज, अब तक"), "var(--acc)"]] : []), [say("Holiday", "अवकाश"), "var(--s3)"]].map(([t, c]) => (
                  <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: c }} />
                    {t}
                  </span>
                ))}
              </div>
              {selDay ? (
                <div className="fadein" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--s2)" }}>
                  <span style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: selLook[0], color: selLook[1], display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Ic n={selLook[2] as IconName} size={18} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <b>{dayName(selDay.day)}{isToday(selDay.day) ? say(" · today", " · आज") : ""}</b>
                    <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.45 }}>
                      {selDay.kind === "day"
                        ? isToday(selDay.day)
                          ? say(`${savedToday} of ${today.classes.length} classes saved so far · classes not marked are left out`, `अब तक ${today.classes.length} में से ${savedToday} कक्षाएँ सहेजीं · दर्ज न हुई कक्षाएँ शामिल नहीं`)
                          : say("Classes not saved that day are left out, never counted as present.", "उस दिन न सहेजी कक्षाएँ शामिल नहीं, कभी उपस्थित नहीं गिनी गईं।")
                        : selDay.kind === "hol"
                          ? say(`${hol.get(selDay.day) ?? "Holiday"} · school closed`, `${hol.get(selDay.day) ?? "अवकाश"} · विद्यालय बंद`)
                          : selDay.kind === "sun"
                            ? say("School closed", "विद्यालय बंद")
                            : say("This day has not come yet", "यह दिन अभी नहीं आया")}
                    </span>
                  </span>
                  <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{selDay.kind === "day" ? pct1(selDay.pct) : selDay.kind === "hol" ? say("Holiday", "अवकाश") : "—"}</span>
                </div>
              ) : null}
              {selDay && p.detail && p.detail.day === selDay.day && (selDay.kind === "day" || selDay.kind === "none") ? <DayPanel detail={p.detail} say={say} month={m.month} /> : null}
            </div>
            <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", gap: 14, alignItems: "start" }}>
              <div className="card" style={CARD}>
                <span style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{say("Dips and holidays", "गिरावट और अवकाश")}</span>
                {dips.length + p.holidays.length === 0 ? <span style={{ fontSize: 12, color: "var(--mut)", padding: "10px 0" }}>{say("No dips below 90% and no holidays this month.", "इस महीने न 90% से नीचे गिरावट, न अवकाश।")}</span> : null}
                {[
                  ...dips.map((d) => ({ when: dayName(d.day), v: pct1(d.pct), why: say("Lower than usual. Classes not saved are left out.", "सामान्य से कम। न सहेजी कक्षाएँ शामिल नहीं।"), icon: "alert" as IconName, bg: "var(--warns)", fg: "var(--warnfg)" })),
                  ...p.holidays.map((h) => ({ when: dayName(h.day), v: say("Holiday", "अवकाश"), why: say(`${h.label ?? "Holiday"} · school closed, not counted`, `${h.label ?? "अवकाश"} · विद्यालय बंद, गिना नहीं`), icon: "calendar" as IconName, bg: "var(--s2)", fg: "var(--mut)" })),
                ].map((n, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderTop: i ? "1px solid var(--bd)" : undefined }}>
                    <span style={{ flex: "none", width: 34, height: 34, borderRadius: 10, background: n.bg, color: n.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Ic n={n.icon} size={16} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{n.when}</span>
                        <b className="num" style={{ fontSize: 13, color: n.fg }}>{n.v}</b>
                      </span>
                      <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.45 }}>{n.why}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="card" style={CARD}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{say("Classes ranked", "कक्षाओं का क्रम")}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`average · ${monthLong}`, `औसत · ${monthLong}`)}</span>
                </div>
                {ranked.map((c, i) => (
                  <Link key={c.classId} href={qs(BASE, { view: "register", class: c.classId, month: m.month })} className="tap row" style={{ display: "grid", gridTemplateColumns: "24px minmax(0,1fr) minmax(70px,1.2fr) 52px", gap: 10, alignItems: "center", padding: "7px 0", borderTop: i ? "1px solid var(--bd)" : undefined, color: "var(--fg)", animation: `xIn .3s var(--ease) ${Math.min(i * 30, 300)}ms both` }}>
                    <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{i + 1}</span>
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span className="clip" style={{ fontWeight: 600 }}>{c.label}</span>
                      <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{p.teachers[c.classId] ?? "—"}</span>
                    </span>
                    <span style={{ display: "flex", height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }}>
                      <span style={{ width: `${c.pct}%`, height: "100%", borderRadius: 4, background: (c.pct ?? 0) < 90 ? "var(--c3)" : "var(--c2)", transformOrigin: "left", animation: "xGrowX .7s var(--ease) both" }} />
                    </span>
                    <span className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: "right", color: (c.pct ?? 0) < 90 ? "var(--warnfg)" : "var(--fg)" }}>{pct1(c.pct)}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </main>
        {sheet}
      </VxPage>
    );
  }

  /* ------------------------------------------------------------- chronic */
  if (p.view === "chronic") {
    const rows = p.list.map((c) => {
      const recent = p.recent[c.studentId] ?? [];
      let streak = 0;
      for (let i = recent.length - 1; i >= 0 && recent[i].status === "absent"; i -= 1) streak += 1;
      return { c, recent, streak, away: streak >= 2 || c.absentLastWeek >= 2, called: !!c.lastCall };
    });
    const shown = rows.filter((r) => (p.filter === "away" ? r.away : p.filter === "nocall" ? !r.called : true));
    return (
      <VxPage>
        <CoordTop crumb={crumb} title={say("Below 75%", "75% से कम हाज़िरी")} dBack={BASE} mBack={BASE} mSub={say(`${p.list.length} children · this session`, `${p.list.length} बच्चे · इस सत्र`)} actions={help} mAction={help} />
        <main>
          {tabs}
          <div className="pad" style={{ padding: "18px 28px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card" style={{ ...CARD, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: "14px 20px" }}>
              <span style={{ flex: "none", width: 56, height: 56, borderRadius: 16, background: "var(--bads)", color: "var(--bad)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n="alert" size={26} />
              </span>
              <span style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{say(`${p.list.length} children below 75%`, `75% से कम हाज़िरी वाले ${p.list.length} बच्चे`)}</span>
                <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.5 }}>{say("This session, at least 5 school days counted. The list builds itself. Late counts as present; leave is not counted.", "इस सत्र, कम से कम 5 दिन गिने। सूची अपने आप बनती है। देर उपस्थित गिनी जाती है; छुट्टी नहीं गिनी जाती।")}</span>
              </span>
              <div className="hs" style={{ display: "flex", gap: 6, maxWidth: "100%" }}>
                <Chip href={qs(BASE, { view: "chronic" })} on={p.filter === "all"} label={say("All", "सभी")} n={rows.length} />
                <Chip href={qs(BASE, { view: "chronic", filter: "away" })} on={p.filter === "away"} label={say("Absent 2+ days now", "अभी 2+ दिन अनुपस्थित")} n={rows.filter((r) => r.away).length} />
                <Chip href={qs(BASE, { view: "chronic", filter: "nocall" })} on={p.filter === "nocall"} label={say("Not called yet", "अभी कॉल नहीं")} n={rows.filter((r) => !r.called).length} />
              </div>
            </div>
            {shown.length === 0 ? (
              <div className="card fadein" style={{ ...CARD, alignItems: "center", gap: 10, padding: "36px 24px", textAlign: "center" }}>
                <span style={{ width: 56, height: 56, borderRadius: 28, background: "var(--oks)", color: "var(--ok)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic n="check" size={26} />
                </span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{p.list.length ? say("Nobody in this group", "इस समूह में कोई नहीं") : say("Nobody is below 75%", "कोई 75% से कम नहीं")}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("Calls you log stay on each child.", "आपकी कॉल हर बच्चे के रिकॉर्ड में रहती हैं।")}</span>
                {p.list.length ? <Btn variant="sec" href={qs(BASE, { view: "chronic" })}>{say("Show all children", "सभी बच्चे दिखाएँ")}</Btn> : null}
              </div>
            ) : null}
            <div className="stack" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14, alignItems: "start" }}>
              {shown.map(({ c, recent, streak }, i) => {
                const tone = c.pct < 70 ? "var(--bad)" : "var(--warnfg)";
                const t = toneOf(c.name);
                const note = p.notes[c.studentId];
                const last = recent[recent.length - 1];
                const pill = streak ? [say(`Absent ${streak} ${streak === 1 ? "day" : "days in a row"}`, `लगातार ${streak} दिन अनुपस्थित`), streak >= 2 ? "var(--bads)" : "var(--warns)", streak >= 2 ? "var(--bad)" : "var(--warnfg)"] : last ? [last.day === p.today ? say("Came today", "आज आया") : say(`Present ${dayName(last.day)}`, `${dayName(last.day)} उपस्थित`), "var(--oks)", "var(--ok)"] : [say("No register yet", "अभी कोई रजिस्टर नहीं"), "var(--s2)", "var(--mut)"];
                const digits = (c.phone ?? "").replace(/\D/g, "").slice(-10);
                return (
                  <div key={c.studentId} className="card" style={{ ...CARD, gap: 10, animation: `xIn .32s var(--ease) ${Math.min(i * 40, 300)}ms both` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span aria-hidden="true" style={{ flex: "none", width: 38, height: 38, borderRadius: 19, background: t.bg, color: t.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{nameInitials(c.name)}</span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <span className="clip" style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</span>
                        <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{c.classLabel}{p.teachers[c.classId] ? ` · ${p.teachers[c.classId]}` : ""}</span>
                      </span>
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                        <span className="num" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1, color: tone }}>{Math.round(c.pct)}%</span>
                        <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("this session", "इस सत्र")}</span>
                      </span>
                    </div>
                    <div style={{ position: "relative", display: "flex", height: 10, borderRadius: 5, background: "var(--s3)" }}>
                      <span style={{ width: `${c.pct}%`, height: "100%", borderRadius: 5, background: tone }} />
                      <i title="75%" style={{ position: "absolute", left: "75%", top: -4, bottom: -4, width: 2, borderRadius: 1, background: "var(--fg)", opacity: 0.45 }} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: pill[1], color: pill[2] }}>{pill[0]}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, color: "var(--mut)", marginRight: 4 }}>{say(`Last ${recent.length || 10} days`, `पिछले ${recent.length || 10} दिन`)}</span>
                        {recent.map((r) => (
                          <i key={r.day} title={`${dayName(r.day)} · ${r.status}`} style={{ width: 10, height: 10, borderRadius: 5, background: ST[r.status], display: "inline-block" }} />
                        ))}
                      </span>
                    </div>
                    {note ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "10px 12px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--s2)" }}>
                        <span>“{note.body}”</span>
                        <span style={{ fontSize: 12, color: "var(--mut)" }}>{note.by}</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`No note yet${c.father ? ` · ${c.father}` : ""}${digits.length === 10 ? ` · ${digits.slice(0, 5)} ••${digits.slice(7)}` : ""}`, `अभी कोई नोट नहीं${c.father ? ` · ${c.father}` : ""}`)}</span>
                    )}
                    {c.lastCall ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "var(--ok)" }}>
                        <Ic n="checkCircle" size={18} />
                        <span className="clip">{say(`Called ${agoP(c.lastCall.at).en} · ${followLabel("call", c.lastCall.outcome, say)} · ${c.lastCall.by}`, `${agoP(c.lastCall.at).hi} कॉल · ${followLabel("call", c.lastCall.outcome, say)}`)}</span>
                      </div>
                    ) : null}
                    {p.everyClass ? (
                      <Btn variant={c.lastCall ? "sec" : "pri"} icon="phone" href={qs(BASE, { view: "chronic", sheet: "call", student: c.studentId })} style={{ height: 46 }}>
                        {c.lastCall ? say("Call again", "फिर कॉल करें") : say("Call parents", "अभिभावक को कॉल करें")}
                      </Btn>
                    ) : null}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                      {p.notesHref ? <Btn variant="sec" icon="notePen" href={`${p.notesHref}?add=1&student=${c.studentId}`}>{say("Add note", "नोट जोड़ें")}</Btn> : <span />}
                      <Btn variant="sec" icon="trend" href={`/academics/progress?view=student&student=${c.studentId}`}>
                        <span className="only-d">{say("Open progress", "प्रगति खोलें")}</span>
                        <span className="only-m">{say("Progress", "प्रगति")}</span>
                      </Btn>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
        {sheet}
      </VxPage>
    );
  }

  /* ------------------------------------------------------------ register */
  if (p.view === "register") {
    const r = p.sheetData;
    const month = r?.month ?? p.today.slice(0, 7);
    const { first, last } = monthRange(month);
    const closed = new Set(r?.closed ?? []);
    const monthLong = new Date(`${month}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
    const all: { day: string; n: number; wd: string; kind: "day" | "off" | "fut" }[] = [];
    for (let d = first; d <= last; d = nextDay(d)) {
      all.push({ day: d, n: Number(d.slice(8)), wd: new Date(`${d}T12:00:00Z`).toLocaleString("en-IN", { weekday: "short", timeZone: "UTC" }).slice(0, 2), kind: closed.has(d) || isSunday(d) ? "off" : d > p.today ? "fut" : "day" });
    }
    const schoolDays = all.filter((d) => d.kind === "day").map((d) => d.day);
    const unsaved = r ? schoolDays.filter((d) => !r.students.some((s) => s.marks.has(d))) : [];
    const lastDay = schoolDays[schoolDays.length - 1];
    const rows = (r?.students ?? []).map((s) => ({ s, low: s.pct !== null && s.pct < 75, abs: !!lastDay && s.marks.get(lastDay) === "absent" }));
    const shown = rows.filter((x) => (p.filter === "low" ? x.low : p.filter === "abs" ? x.abs : true));
    // The class's month, every child-day pooled: the same number as "Classes ranked" (smoke 20 Oct).
    const avg = r?.classPct !== undefined ? r.classPct : rows.length ? rows.reduce((a, x) => a + (x.s.pct ?? 0), 0) / Math.max(1, rows.filter((x) => x.s.pct !== null).length) : null;
    // A day the class never saved has no absent count to give (smoke 20 Oct: "Absent on Mon 19 Oct 0").
    const lastUnsaved = !!lastDay && unsaved.includes(lastDay);
    // Phone squares: every day up to today, closed days as a grey mark, so a square's place is its date.
    const shownDays = all.filter((d) => d.kind !== "fut");
    const cols = `190px repeat(${all.length}, minmax(0, 1fr)) 50px`;
    const dot = (st: AttStatus | undefined): CSSProperties => (st ? { background: ST[st], border: 0 } : { background: "transparent", border: "2px solid var(--bds)" });
    const tone = (v: number | null) => (v === null ? "var(--mut)" : v < 75 ? "var(--bad)" : v < 90 ? "var(--warnfg)" : "var(--ok)");
    const isLast = lastDay === p.today;
    return (
      <VxPage>
        <CoordTop crumb={crumb} title={r ? say(`${r.label} register`, `${r.label} रजिस्टर`) : say("Class register", "कक्षा रजिस्टर")} dBack={BASE} mBack={BASE} mSub={r ? say(`${monthLong} · ${r.students.length} children`, `${monthLong} · ${r.students.length} बच्चे`) : undefined} actions={<>{help}<PrintButton label={{ en: "Print register", hi: "रजिस्टर प्रिंट" }} /></>} mAction={help} />
        <main>
          {tabs}
          <div className="pad" style={{ padding: "18px 28px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card" style={{ ...CARD, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: "14px 18px" }}>
              <span style={{ flex: "none", width: 48, height: 48, borderRadius: 14, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n="table" size={22} />
              </span>
              <span style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{r ? `${r.label} · ${monthLong}` : say("Class register", "कक्षा रजिस्टर")}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>
                  {r ? say(`${p.teacher ? `${p.teacher} · ` : ""}${r.students.length} children · class average ${pct1(avg)}${month === p.today.slice(0, 7) ? ` · ${monthLong} so far` : ""}`, `${p.teacher ? `${p.teacher} · ` : ""}${r.students.length} बच्चे · कक्षा औसत ${pct1(avg)}`) : ""}
                </span>
              </span>
              <AutoSelect name="class" label={say("Class", "कक्षा")} value={r?.classId ?? ""} options={p.classes.map((c) => ({ value: c.id, label: c.label }))} hidden={{ view: "register", month }} action={BASE} />
              <Seg label={say("Month", "महीना")} current={month} width={240} tabs={p.months.map((x) => ({ key: x.key, href: qs(BASE, { view: "register", class: r?.classId, month: x.key }), label: x.label }))} />
            </div>
            {r ? (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div className="hs" style={{ display: "flex", gap: 6 }}>
                    <Chip href={qs(BASE, { view: "register", class: r.classId, month })} on={p.filter === "all"} label={say("All", "सभी")} n={rows.length} />
                    <Chip href={qs(BASE, { view: "register", class: r.classId, month, filter: "low" })} on={p.filter === "low"} label={say("Below 75%", "75% से कम")} n={rows.filter((x) => x.low).length} />
                    {lastUnsaved && lastDay ? (
                      <span className="chip" style={{ color: "var(--warnfg)", background: "var(--warns)", borderColor: "transparent" }}>
                        {isLast ? say("Today not saved yet", "आज अभी सहेजा नहीं") : say(`${dayName(lastDay)} not saved`, `${shortDayHi(lastDay)} सहेजा नहीं`)}
                      </span>
                    ) : (
                      <Chip href={qs(BASE, { view: "register", class: r.classId, month, filter: "abs" })} on={p.filter === "abs"} label={isLast ? say("Absent today", "आज अनुपस्थित") : say(`Absent on ${lastDay ? dayName(lastDay) : "—"}`, `${lastDay ? shortDayHi(lastDay) : "—"} अनुपस्थित`)} n={rows.filter((x) => x.abs).length} />
                    )}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", fontSize: 12, color: "var(--mut)" }}>
                    {([[say("Present", "उपस्थित"), dot("present")], [say("Absent", "अनुपस्थित"), dot("absent")], [say("Half-day / leave", "आधा दिन / छुट्टी"), dot("half_day")], [say("Not marked", "दर्ज नहीं"), dot(undefined)], [say("Holiday / Sunday", "अवकाश / रविवार"), { background: "var(--s3)", border: 0 }]] as [string, CSSProperties][]).map(([t, st]) => (
                      <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <i style={{ width: 11, height: 11, borderRadius: 6, boxSizing: "border-box", display: "inline-block", ...st }} />
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                {unsaved.length ? (
                  <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--warns)", color: "var(--warnfg)" }}>
                    <Ic n="alert" size={18} style={{ flex: "none", marginTop: 1 }} />
                    <span>{say(`${unsaved.map((d) => dayName(d)).join(", ")} ${unsaved.length === 1 ? "was" : "were"} not saved by the class teacher. ${unsaved.length === 1 ? "It shows" : "They show"} as an empty ring and ${unsaved.length === 1 ? "is" : "are"} never counted as present.`, `${unsaved.map((d) => dayName(d)).join(", ")} कक्षा-अध्यापक ने सहेजा नहीं। खाली गोले के रूप में दिखता है और कभी उपस्थित नहीं गिना जाता।`)}</span>
                  </div>
                ) : null}
                <div className="only-d card" style={{ overflow: "hidden", padding: 0 }}>
                  <div style={{ display: "grid", gridTemplateColumns: cols, gap: 2, alignItems: "center", padding: "0 14px", minHeight: 46, background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
                    <span className="sech">{say("Child", "बच्चा")}</span>
                    {all.map((d) => (
                      <span key={d.day} className="num" style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.1, padding: "3px 0", borderRadius: 4, color: d.kind === "day" ? "var(--mut)" : "var(--sub)", background: d.kind === "off" ? "var(--s3)" : "transparent" }}>
                        <b style={{ fontSize: 11 }}>{d.n}</b>
                        <span style={{ fontSize: 9 }}>{d.wd}</span>
                      </span>
                    ))}
                    <span className="sech" style={{ textAlign: "right" }}>%</span>
                  </div>
                  {shown.map(({ s }, i) => (
                    // No entrance animation: the register is read at once, every row (smoke 20 Oct: rows faded in and it looked empty).
                    <div key={s.studentId} className="row" style={{ display: "grid", gridTemplateColumns: cols, gap: 2, alignItems: "center", padding: "0 14px", minHeight: 34, borderTop: i ? "1px solid var(--bd)" : undefined }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span className="num" style={{ width: 18, fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{s.rollNo ?? ""}</span>
                        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                          <span className="clip" style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                          {s.tellApart ? <span className="clip" style={{ fontSize: 11, color: "var(--mut)" }}>{s.tellApart}</span> : null}
                        </span>
                      </span>
                      {all.map((d) => (
                        <span key={d.day} title={`${dayName(d.day)}${d.kind === "off" ? ` · ${say("closed", "बंद")}` : ""}`} style={{ height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, background: d.kind === "off" ? "var(--s2)" : "transparent" }}>
                          {d.kind === "day" ? <i style={{ width: 12, height: 12, borderRadius: 6, boxSizing: "border-box", ...dot(s.marks.get(d.day)) }} /> : null}
                        </span>
                      ))}
                      <span className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: "right", color: tone(s.pct) }}>{s.pct === null ? "—" : `${Math.round(s.pct)}%`}</span>
                    </div>
                  ))}
                </div>
                <div className="only-m card" style={{ overflow: "hidden", padding: 0 }}>
                  {/* The day numbers over the squares, so a square can be read as a date (smoke 20 Oct). */}
                  <div aria-hidden="true" style={{ display: "flex", alignItems: "flex-end", gap: 10, padding: "8px 14px 6px", background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
                    <span style={{ width: 20, flex: "none" }} />
                    <span style={{ flex: 1, minWidth: 0, display: "flex", gap: 2 }}>
                      {shownDays.map((d) => (
                        <span key={d.day} className="num" style={{ flex: 1, maxWidth: 12, minWidth: 0, textAlign: "center", fontSize: 8, lineHeight: 1, fontWeight: 700, color: d.kind === "off" ? "var(--sub)" : "var(--mut)", overflow: "visible", whiteSpace: "nowrap" }}>
                          {d.n % 2 === 1 || shownDays.length <= 16 ? d.n : ""}
                        </span>
                      ))}
                    </span>
                    <span style={{ width: 64, flex: "none", fontSize: 11, color: "var(--mut)", textAlign: "right" }}>{say("date", "तारीख़")}</span>
                  </div>
                  {shown.map(({ s }, i) => {
                    const c = { P: 0, A: 0, L: 0 };
                    for (const d of schoolDays) {
                      const st = s.marks.get(d);
                      if (st === "present" || st === "late") c.P += 1;
                      else if (st === "absent") c.A += 1;
                      else if (st) c.L += 1;
                    }
                    const cnt = `${c.P} P · ${c.A} A${c.L ? ` · ${c.L} L` : ""}`;
                    return (
                      <div key={s.studentId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", minHeight: 56, borderTop: i ? "1px solid var(--bd)" : undefined }}>
                        <span className="num" style={{ width: 20, fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{s.rollNo ?? ""}</span>
                        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                          <span className="clip" style={{ fontSize: 15, fontWeight: 600 }}>{s.name}{s.tellApart ? <span style={{ fontSize: 12, fontWeight: 500, color: "var(--mut)" }}>{` · ${s.tellApart}`}</span> : null}</span>
                          <span aria-label={cnt} style={{ display: "flex", gap: 2 }}>
                            {shownDays.map((d) =>
                              d.kind === "off" ? (
                                <i key={d.day} title={`${dayName(d.day)} · ${say("closed", "बंद")}`} style={{ flex: 1, maxWidth: 12, height: 10, borderRadius: 3, background: "var(--s3)" }} />
                              ) : (
                                <i key={d.day} title={dayName(d.day)} style={{ flex: 1, maxWidth: 12, height: 10, borderRadius: 3, boxSizing: "border-box", ...dot(s.marks.get(d.day)) }} />
                              ),
                            )}
                          </span>
                        </span>
                        <span style={{ width: 64, flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                          <span className="num" style={{ fontSize: 15, fontWeight: 700, color: tone(s.pct) }}>{s.pct === null ? "—" : `${Math.round(s.pct)}%`}</span>
                          <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{cnt}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                {shown.length === 0 ? (
                  <div className="card fadein" style={{ ...CARD, alignItems: "center", gap: 8, padding: "32px 24px", textAlign: "center" }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{say("Nobody in this list", "इस सूची में कोई नहीं")}</span>
                    <Btn variant="sec" href={qs(BASE, { view: "register", class: r.classId, month })}>{say(`Show all ${rows.length} children`, `सभी ${rows.length} बच्चे दिखाएँ`)}</Btn>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState icon="lock" title={say("No class to show", "दिखाने को कोई कक्षा नहीं")} />
            )}
          </div>
        </main>
        {sheet}
      </VxPage>
    );
  }

  /* --------------------------------------------------------------- today */
  const t = today.total;
  const totalKids = today.classes.reduce((s, c) => s + c.roll, 0);
  const present = t.present + t.late;
  const left = today.notMarked;
  // The percentage gives a half-day ½ and leaves leave out, so the line under
  // it says the same thing in counts (AC-03: "56.3% · 4 of 8" could not be
  // reconciled).
  const presentSub = say(
    `${present} present${t.halfDay ? ` + ${t.halfDay} half-day (½)` : ""} of ${t.counted} counted${t.leave ? ` · ${t.leave} on leave not counted` : ""}`,
    `${t.counted} में से ${present} उपस्थित${t.halfDay ? ` + ${t.halfDay} आधा दिन (½)` : ""}${t.leave ? ` · ${t.leave} छुट्टी पर, गिने नहीं` : ""}`,
  );
  const closedName = today.closed ? say(today.closed.label ?? (today.closed.kind === "sunday" ? "Sunday" : "Holiday"), today.closed.labelHi ?? today.closed.label ?? (today.closed.kind === "sunday" ? "रविवार" : "छुट्टी")) : null;
  const parts: [string, number, string][] = [
    [say("Present", "उपस्थित"), present, "var(--ok)"],
    [say("Absent", "अनुपस्थित"), t.absent, "var(--bad)"],
    // Half-days are their own figure; they used to be added to Leave (day-run 6 Nov 2026, AC-04).
    [say("Leave", "छुट्टी"), t.leave, "var(--warn)"],
    [say("Half day", "आधा दिन"), t.halfDay, "var(--warns)"],
    [say("Not marked", "दर्ज नहीं"), today.unmarkedChildren, "var(--bds)"],
  ];
  const L = Math.max(0.5, (263.9 * today.marked) / Math.max(1, today.classes.length));
  const shown = today.classes.filter((c) => (p.filter === "all" ? true : p.filter === "not" ? !c.saved : c.saved));
  const lateClasses = today.classes.filter((c) => c.tally.late > 0).sort((a, b) => b.tally.late - a.tally.late);
  return (
    <VxPage>
      <CoordTop crumb={crumb} title={say("Attendance today", "आज की हाज़िरी")} mBack="/academics?view=menu" mSub={closedName ? say(`School closed · ${closedName}`, `विद्यालय बंद · ${closedName}`) : say(`${today.marked} of ${today.classes.length} marked · ${pct1(today.pct)} present`, `${today.classes.length} में से ${today.marked} दर्ज · ${pct1(today.pct)} उपस्थित`)} actions={help} mAction={help} />
      <main>
        {tabs}
        <div className="pad stack" style={{ padding: "16px 28px 40px", display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 20, alignItems: "start" }}>
          <style>{`@container vx (max-width:899px){.acad-ring{width:100px!important;height:100px!important}.acad-ring svg{width:100px;height:100px}.acad-ring .num{font-size:24px!important}.acad-hti{order:3;flex-basis:100%}.acad-tl{grid-template-columns:repeat(2,minmax(0,1fr))!important}}.acad-tl .btn{height:36px;font-size:13px;padding:0 10px}`}</style>
          <section style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {closedName ? (
              // A closed day: no "not marked" count, no reminders, and the way to the last school day.
              <div className="card" style={{ ...CARD, gap: 12 }}>
                <EmptyState
                  icon="calendar"
                  title={say(`School is closed today · ${closedName}`, `आज विद्यालय बंद है · ${closedName}`)}
                  body={say("No register today, so nobody is reminded. To see the last school day, open the month and tap that day.", "आज हाज़िरी नहीं लगेगी, इसलिए किसी को याद नहीं दिलाया जाएगा। पिछला स्कूल दिवस देखने को महीना खोलें और उस दिन पर टैप करें।")}
                  action={<Btn variant="sec" icon="chart" href={qs(BASE, { view: "month" })}>{say("Open this month", "यह महीना खोलें")}</Btn>}
                  style={{ padding: 16 }}
                />
              </div>
            ) : (
            <div className="card" style={{ ...CARD, gap: 14 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 22 }}>
                <div className="acad-ring" style={{ position: "relative", flex: "none", width: 128, height: 128 }}>
                  <svg width={128} height={128} viewBox="0 0 100 100" aria-hidden="true">
                    <circle cx={50} cy={50} r={42} fill="none" stroke="var(--s3)" strokeWidth={9} />
                    <circle cx={50} cy={50} r={42} fill="none" stroke={left.length ? "var(--acc)" : "var(--ok)"} strokeWidth={9} strokeLinecap="round" strokeDasharray={`${L.toFixed(1)} 263.9`} style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", ["--len" as string]: L.toFixed(1), animation: "xDraw .9s var(--ease) both" }} />
                  </svg>
                  <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <span className="num" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{today.marked}/{today.classes.length}</span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("classes", "कक्षाएँ")}</span>
                  </span>
                </div>
                <div className="acad-hti" style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="pill" style={{ alignSelf: "flex-start", background: "var(--accs)", color: "var(--accfg)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 5, background: "var(--acc)", animation: "xPulse 1.8s ease infinite" }} />
                    {say(`Live · ${dayName(p.today)} · ${p.nowLabel}`, `लाइव · ${dayName(p.today)} · ${p.nowLabel}`)}
                  </span>
                  <span className="serif" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.12 }}>{left.length ? say(`${today.marked} of ${today.classes.length} classes marked`, `${today.classes.length} में से ${today.marked} कक्षाओं की हाज़िरी लगी`) : say(`All ${today.classes.length} classes marked`, `सभी ${today.classes.length} कक्षाओं की हाज़िरी लगी`)}</span>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>{left.length ? say(`${left.length} not saved yet: ${left.map((c) => `${c.label} (${c.teacherAway ? `${c.teacherName} on leave` : c.teacherName})`).join(", ")}`, `${left.length} अभी सहेजी नहीं: ${left.map((c) => `${c.label} (${c.teacherName})`).join(", ")}`) : say("Every class teacher pressed Save.", "हर कक्षा-अध्यापक ने सहेजा।")}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 150 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{say("Present today", "आज उपस्थित")}</span>
                  <span className="num" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.05, color: "var(--ok)" }}>{pct1(today.pct)}</span>
                  <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{presentSub}</span>
                </div>
              </div>
              <div style={{ display: "flex", height: 12, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }} aria-hidden="true">
                {parts.map(([l, n, c]) => (
                  <span key={l} style={{ width: `${(n / Math.max(1, totalKids)) * 100}%`, height: "100%", background: c, transition: "width .5s var(--ease)" }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 13 }}>
                {parts.map(([l, n, c]) => (
                  <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: c }} />
                    {l}
                    <b className="num">{n}</b>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 240, display: "flex", gap: 10, padding: "10px 12px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--s2)" }}>
                  <Ic n="info" size={18} style={{ flex: "none", marginTop: 1, color: "var(--acc)" }} />
                  <span>{say("A class counts as marked only after its teacher presses Save. Not marked is never counted as present.", "कक्षा तभी दर्ज मानी जाती है जब शिक्षक सहेजें। दर्ज न होना कभी उपस्थित नहीं गिना जाता।")}</span>
                </div>
                {p.mayRemind && left.length ? (
                  <Link href={qs(BASE, { sheet: "remind" })} className="tap btn pri mfull" style={{ height: 48 }}>
                    <Ic n="send" size={18} />
                    {say(`Remind ${left.length} ${left.length === 1 ? "teacher" : "teachers"}`, `${left.length} शिक्षकों को याद दिलाएँ`)}
                  </Link>
                ) : null}
              </div>
            </div>
            )}

            <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
              {(
                [
                  [say("Present", "उपस्थित"), present, say(`${pct1(today.pct)} of marked`, `दर्ज का ${pct1(today.pct)}`), "var(--ok)"],
                  [say("Absent", "अनुपस्थित"), t.absent, say(`in ${today.marked} classes`, `${today.marked} कक्षाओं में`), "var(--bad)"],
                  [say("On leave", "छुट्टी पर"), t.leave, t.halfDay ? say(`not counted · ${t.halfDay} half-day`, `गिने नहीं · ${t.halfDay} आधा दिन`) : say("not counted", "गिने नहीं"), "var(--warn)"],
                  [say("Came late", "देर से आए"), t.late, say("counted present", "उपस्थित गिने"), "var(--info)"],
                ] as [string, number, string, string][]
              ).map(([l, v, s, c], i) => (
                <div key={l} className="card rise" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 2, animationDelay: `${i * 50}ms` }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 5, background: c }} />
                    {l}
                  </span>
                  <span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{v}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{s}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span className="sech">{say("Classes today", "आज की कक्षाएँ")}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <Chip href={BASE} on={p.filter === "all"} label={say("All", "सभी")} n={today.classes.length} dot="var(--bds)" />
                <Chip href={qs(BASE, { filter: "not" })} on={p.filter === "not"} label={say("Not marked", "दर्ज नहीं")} n={left.length} dot="var(--mut)" />
                <Chip href={qs(BASE, { filter: "marked" })} on={p.filter === "marked"} label={say("Marked", "दर्ज")} n={today.marked} dot="var(--ok)" />
              </div>
            </div>
            <div className="acad-tl" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10, alignItems: "start" }}>
              {shown.map((c, i) => (
                <ClassTile key={c.classId} c={c} i={i} say={say} mayRemind={p.mayRemind} closed={!!closedName} />
              ))}
            </div>
          </section>

          <aside style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: "none", width: 38, height: 38, borderRadius: 12, background: "var(--infos)", color: "var(--info)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic n="clock" size={18} />
                </span>
                <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{say(`Came late today · ${t.late}`, `आज देर से आए · ${t.late}`)}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("Counted present · late is noted", "उपस्थित गिने · देर दर्ज")}</span>
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {lateClasses.slice(0, 4).map((c, i) => (
                  <div key={c.classId} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", fontSize: 13, borderTop: i ? "1px solid var(--bd)" : undefined }}>
                    <span>{c.label}</span>
                    <b className="num" style={{ whiteSpace: "nowrap" }}>{say(`${c.tally.late} ${c.tally.late === 1 ? "child" : "children"}`, `${c.tally.late} बच्चे`)}</b>
                  </div>
                ))}
                {lateClasses.length === 0 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{say("Nobody late so far.", "अभी तक कोई देर से नहीं।")}</span> : null}
              </div>
            </div>
            <div className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>
              <span className="sech" style={{ padding: "14px 16px 6px" }}>{say("Look closer", "और देखें")}</span>
              {(
                [
                  [qs(BASE, { view: "month" }), "chart", "var(--infos)", "var(--info)", say("This month", "इस महीने"), say(`${new Date(`${p.today.slice(0, 7)}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" })} so far · average ${pct1(p.monthAvg)}`, `अब तक · औसत ${pct1(p.monthAvg)}`)],
                  [qs(BASE, { view: "chronic" }), "alert", "var(--bads)", "var(--bad)", say("Below 75%", "75% से कम"), say(`${p.chronicCount} children · ${p.chronicAway} absent 2+ days now`, `${p.chronicCount} बच्चे · ${p.chronicAway} अभी 2+ दिन अनुपस्थित`)],
                  ...(p.registerClass ? [[regHref, "table", "var(--accs)", "var(--accfg)", say(`${p.registerClass.label} register`, `${p.registerClass.label} रजिस्टर`), say("A dot for every child, every day", "हर बच्चा, हर दिन")]] : []),
                ] as [string, IconName, string, string, string, string][]
              ).map(([href, icon, bg, fg, label, sub]) => (
                <Link key={href} href={href} className="tap row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--bd)", color: "var(--fg)" }}>
                  <span style={{ flex: "none", width: 38, height: 38, borderRadius: 12, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Ic n={icon} size={18} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{label}</span>
                    <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span>
                  </span>
                  <Ic n="chevRight" size={18} style={{ color: "var(--sub)" }} />
                </Link>
              ))}
            </div>
            <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column" }}>
              <span className="sech" style={{ marginBottom: 6 }}>{say("Today · who did what", "आज · किसने क्या किया")}</span>
              {today.activity.length === 0 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{say("Nothing saved yet today.", "आज अभी कुछ सहेजा नहीं।")}</span> : null}
              {today.activity.map((a, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr) auto", gap: 10, alignItems: "start", padding: "6px 0", fontSize: 13, animation: `xIn .3s var(--ease) ${i * 30}ms both` }}>
                  <i style={{ width: 10, height: 10, marginTop: 4, borderRadius: 5, background: a.tone === "warn" ? "var(--warn)" : a.tone === "info" ? "var(--info)" : "var(--ok)" }} />
                  <span>{say(a.text.en, a.text.hi)}</span>
                  <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{clock(a.at).replace(/^0/, "")}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </main>
      {sheet}
    </VxPage>
  );
}

/**
 * One day of the month, opened: each class saved or not with its absent
 * count, and the children who were absent, so nobody has to open eight
 * registers to find yesterday's absentees (smoke 20 Oct).
 */
function DayPanel({ detail, say, month }: { detail: DayDetail; say: Say; month: string }) {
  const saved = detail.classes.filter((c) => c.saved);
  const notSaved = detail.classes.filter((c) => !c.saved);
  const byClass = new Map<string, DayDetail["absent"]>();
  for (const a of detail.absent) byClass.set(a.classId, [...(byClass.get(a.classId) ?? []), a]);
  return (
    <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 14px", borderRadius: 14, border: "1px solid var(--bd)" }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>
        {say(
          `${saved.length} of ${detail.classes.length} classes saved · ${detail.absent.length} ${detail.absent.length === 1 ? "child" : "children"} absent`,
          `${detail.classes.length} में से ${saved.length} कक्षाओं ने सहेजा · ${detail.absent.length} बच्चे अनुपस्थित`,
        )}
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 6 }}>
        {detail.classes.map((c) => (
          <Link
            key={c.classId}
            href={qs(BASE, { view: "register", class: c.classId, month })}
            className="tap"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minHeight: 44, padding: "6px 10px", borderRadius: 10, fontSize: 13, color: "var(--fg)", background: c.saved ? "var(--s2)" : "var(--warns)" }}
          >
            <span className="clip" style={{ fontWeight: 600 }}>{c.label}</span>
            <span className="num" style={{ flex: "none", fontSize: 12, fontWeight: 700, color: !c.saved ? "var(--warnfg)" : c.absent ? "var(--bad)" : "var(--ok)" }}>
              {!c.saved ? say("not saved", "सहेजा नहीं") : c.absent ? say(`${c.absent} absent`, `${c.absent} अनुपस्थित`) : say("all present", "सभी उपस्थित")}
            </span>
          </Link>
        ))}
      </div>
      {notSaved.length ? (
        <span style={{ fontSize: 12, color: "var(--warnfg)", lineHeight: 1.45 }}>
          {say(`${notSaved.length} ${notSaved.length === 1 ? "class was" : "classes were"} not saved that day, so ${notSaved.length === 1 ? "its" : "their"} absent children are not known.`, `उस दिन ${notSaved.length} कक्षाओं ने सहेजा नहीं, इसलिए उनके अनुपस्थित बच्चे पता नहीं।`)}
        </span>
      ) : null}
      <span className="sech">{say("Absent that day", "उस दिन अनुपस्थित")}</span>
      {detail.absent.length === 0 ? (
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{say("Nobody was marked absent in the classes that saved.", "सहेजी गई कक्षाओं में कोई अनुपस्थित नहीं।")}</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...byClass.entries()].map(([classId, kids]) => (
            <div key={classId} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)", minWidth: 90 }}>{kids[0].classLabel}</span>
              {kids.map((k) => (
                <Link key={k.studentId} href={`/academics/progress?view=student&student=${k.studentId}`} className="tap chip" style={{ color: "var(--bad)" }}>
                  {k.name}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClassTile({ c, i, say, mayRemind, closed }: { c: ClassToday; i: number; say: Say; mayRemind: boolean; closed?: boolean }) {
  const base: CSSProperties = { padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, animation: `xIn .32s var(--ease) ${Math.min(i * 20, 300)}ms both` };
  const head = (who: string, icon: IconName, ibg: string, ifg: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span className="clip" style={{ fontSize: 15, fontWeight: 700 }}>{c.label}</span>
        <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{who}</span>
      </span>
      <span style={{ flex: "none", width: 30, height: 30, borderRadius: 15, background: ibg, color: ifg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Ic n={icon} size={16} />
      </span>
    </div>
  );
  if (!c.saved && closed) {
    // A closed day asks nobody to mark: no Remind, no "Mark for them".
    return (
      <div className="card" style={{ ...base, background: "var(--s2)" }}>
        {head(c.teacherName, "calendar", "var(--s3)", "var(--mut)")}
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mut)" }}>{say("School closed", "विद्यालय बंद")}</span>
      </div>
    );
  }
  if (!c.saved && c.teacherAway) {
    return (
      <div className="card" style={{ ...base, borderColor: "var(--warn)", background: "var(--warns)" }}>
        {head(say(`${c.teacherName} · on leave`, `${c.teacherName} · छुट्टी पर`), "user", "var(--card)", "var(--warnfg)")}
        <span style={{ fontSize: 13, lineHeight: 1.35, color: "var(--warnfg)" }}>{say("Nobody has marked yet. Mark it yourself.", "अभी किसी ने दर्ज नहीं किया। आप स्वयं दर्ज करें।")}</span>
        <Btn variant="pri" icon="calCheck" href={qs(BASE, { sheet: "mark", class: c.classId })}>{say("Mark for them", "उनकी ओर से दर्ज करें")}</Btn>
      </div>
    );
  }
  if (!c.saved) {
    return (
      <div className="card" style={{ ...base, borderColor: "var(--bds)", borderStyle: "dashed", background: "var(--s2)" }}>
        {head(c.teacherName, "clock", "var(--s2)", "var(--mut)")}
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mut)" }}>{say("Not marked yet", "अभी दर्ज नहीं")}</span>
        {mayRemind && c.teacherId ? (
          <Btn variant="sec" icon="bell" href={qs(BASE, { sheet: "remind", who: c.classId })}>{say("Remind", "याद दिलाएँ")}</Btn>
        ) : null}
      </div>
    );
  }
  const present = c.tally.present + c.tally.late;
  const parts = [c.tally.absent ? say(`${c.tally.absent} absent`, `${c.tally.absent} अनुपस्थित`) : null, c.tally.leave ? say(`${c.tally.leave} leave`, `${c.tally.leave} छुट्टी`) : null, c.tally.halfDay ? say(`${c.tally.halfDay} half day`, `${c.tally.halfDay} आधा दिन`) : null].filter(Boolean);
  return (
    <Link href={qs(BASE, { view: "register", class: c.classId })} className="card tap lift" style={{ ...base, color: "var(--fg)" }}>
      {head(c.onBehalf && c.savedBy ? say(`Saved by ${c.savedBy}`, `${c.savedBy} ने सहेजा`) : c.teacherName, "check", "var(--oks)", "var(--ok)")}
      <span style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 13 }}>
        <span>
          <b className="num">{present}/{c.roll}</b> {say("present", "उपस्थित")}
        </span>
        <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{c.savedAt ? clock(c.savedAt).replace(/^0/, "") : ""}</span>
      </span>
      <span style={{ display: "flex", height: 6, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }}>
        {[[present, "var(--ok)"], [c.tally.absent, "var(--bad)"], [c.tally.leave + c.tally.halfDay, "var(--warn)"]].map(([n, col], j) => (
          <span key={j} style={{ width: `${((n as number) / Math.max(1, c.roll)) * 100}%`, height: "100%", background: col as string }} />
        ))}
      </span>
      <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{parts.length ? parts.join(" · ") : say("Everyone present", "सभी उपस्थित")}</span>
    </Link>
  );
}

function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function monthsAround(today: string, month: string): { key: string; label: string }[] {
  const prev = new Date(`${month}-15T12:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const keys = [prev.toISOString().slice(0, 7), month];
  if (month < today.slice(0, 7)) {
    const next = new Date(`${month}-15T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    keys.splice(0, 2, month, next.toISOString().slice(0, 7));
  }
  return keys.map((k) => ({ key: k, label: new Date(`${k}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" }) }));
}

