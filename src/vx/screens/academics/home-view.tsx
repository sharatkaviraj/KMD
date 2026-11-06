import Link from "@/vx/ui/link";

import { logoutAction } from "@/app/login/actions";
import type { Language } from "@/platform/i18n/language";
import { renderReminder } from "@/modules/staff-notices/domain/notices";
import { COST_PER_MESSAGE } from "@/modules/whatsapp/vx/domain/reminders";
import { daysBetween, dayMonth, dayMonthHi, shortDayHi } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { lead as leadText, under, type Pair } from "@/vx/text";
import { HelpButton } from "@/vx/ui/overlays";
import { Banner, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState, Pill } from "@/vx/ui/primitives";

import { PrintButton, RemindRegistersButton, RemindSheet, type SendPreview } from "./client";
import type { AttentionChild, DayAttendance, MarksEntry, UpcomingEvent } from "./data";
import { classPair, fillTemplate, subjectName, type WeekFacts } from "./domain";
import { WeekDraft } from "./week-draft";
import { AttentionRow, CardTitle, CoordKpi, CoordTop, dayName, dayNameHi, dayNameYear, dayNameYearHi, formalName, GhostLink, HeatCell, HeatLegend, HeatStrip, joinAnd, LinkSeg, nameInitials, sayer, subjectHi, ToneAvatar } from "./ui";

/*
 * AcadHome (docs/design-handoff SCREENS "Academic coordinator · Today"), drawn
 * from props so the design fixture can draw it too: attendance today, marks
 * entry, children needing attention, notes needing action, with one-tap
 * reminders. States: home, menu (?view=menu), week (?view=week), remind
 * (?sheet=remind, one teacher with &who=).
 */

export type AcadHomeWeek = {
  monday: string;
  /** `holiday`: the school was closed that day, with the calendar's name for it. */
  daily: { day: string; pct: number | null; holiday?: { label: string | null; labelHi: string | null } }[];
  trend: { monday: string; pct: number | null }[];
  facts: WeekFacts;
  improved: { studentId: string; name: string; classLabel: string; by: string }[];
  help: AttentionChild[];
  papers: { locked: number; done: number; inProgress: number; notStarted: number };
  principals: string[];
  /** When the summary last went to the principal. */
  lastSent: string | null;
};

export type AcadHomeProps = {
  language: Language;
  mode: "home" | "menu" | "week";
  sheet: "remind" | null;
  /** Remind about registers rather than marks. */
  what: "marks" | "registers";
  /** One teacher's reminder (a row's Remind). */
  who: string | null;
  marksTab: "late" | "class";
  me: { name: string };
  /** The academic session ("2026–27"), from the session setting, never by sorting labels. */
  session: string;
  /** "Good morning" etc., worked out on the server's clock. */
  hello: Pair;
  today: string;
  attendance: DayAttendance;
  entry: MarksEntry;
  /** Teachers on leave today (marks reminders can leave them out). */
  away: string[];
  attention: AttentionChild[];
  attentionNew: number;
  notes: { open: number; due: number; dueOn: string | null };
  events: UpcomingEvent[];
  marksTemplate: { hi: string; en: string } | null;
  week: AcadHomeWeek | null;
  summaryTemplate: { hi: string; en: string } | null;
  mayRemind: boolean;
  notesHref: string | null;
  /** This deployment's origin, for the attendance reminder's link. */
  origin: string;
};

const EVENT_TONE: Record<string, [string, string]> = {
  deadline: ["var(--warns)", "var(--warnfg)"],
  exam: ["var(--infos)", "var(--info)"],
  ptm: ["var(--accs)", "var(--accfg)"],
  event: ["var(--accs)", "var(--accfg)"],
  meeting: ["var(--accs)", "var(--accfg)"],
  holiday: ["var(--s2)", "var(--mut)"],
  vacation: ["var(--s2)", "var(--mut)"],
  fee_due: ["var(--warns)", "var(--warnfg)"],
};

export function AcadHomeView(props: AcadHomeProps) {
  const { language, mode, attendance: today, entry, attention, notes, mayRemind, notesHref } = props;
  const say = sayer(language);
  const late = entry.late;
  const examName = entry.exam ? (language === "hi" && entry.exam.labelHi ? entry.exam.labelHi : entry.exam.label) : say("Marks", "अंक");
  const due = entry.dueOn ? dayName(entry.dueOn) : null;
  const dueHi = entry.dueOn ? dayNameHi(entry.dueOn) : null;
  // Dates, classes and subjects in the reader's language (smoke 20 Oct: "अंतिम तिथि Wed 14 Oct").
  const day = (d: string) => say(dayName(d), dayNameHi(d));
  const classHi = (label: string) => classPair(label).hi ?? label;
  const cls = (label: string) => say(label, classHi(label));
  const unmarked = today.notMarked;
  const closed = today.closed;
  const closedName = closed ? say(closed.label ?? (closed.kind === "sunday" ? "Sunday" : "Holiday"), closed.labelHi ?? closed.label ?? (closed.kind === "sunday" ? "रविवार" : "छुट्टी")) : null;
  const away = new Set(props.away);
  const remindHref = (extra = "") => `${mode === "home" ? "/academics?" : `/academics?view=${mode}&`}sheet=remind${extra}`;
  const closeHref = mode === "home" ? "/academics" : `/academics?view=${mode}`;

  const help = (
    <HelpButton
      title={mode === "menu" ? say("Find any section", "कोई भी भाग खोजें") : mode === "week" ? say("Weekly summary", "साप्ताहिक सारांश") : say("Your day at a glance", "एक नज़र में आपका दिन")}
      steps={
        mode === "menu"
          ? [
              { icon: "grid", title: say("Big tiles", "बड़ी टाइलें"), body: say("Each tile opens one part of your work. The small line shows what is waiting.", "हर टाइल आपके काम का एक भाग खोलती है। छोटी पंक्ति बताती है क्या बाकी है।") },
              { icon: "globe", title: say("Hindi or English", "हिंदी या अंग्रेज़ी"), body: say("Switch the language from the menu; your choice is kept.", "भाषा मेन्यू से बदलें; आपकी पसंद याद रहती है।") },
              { icon: "send", title: say("Remind in one tap", "एक टैप में याद"), body: say("The Remind tile asks every late teacher at once, after a preview.", "याद टाइल नमूना दिखाकर सभी देर वाले शिक्षकों को एक साथ कहती है।") },
            ]
          : mode === "week"
            ? [
                { icon: "file", title: say("Read the draft", "मसौदा पढ़ें"), body: say("The app writes it from this week's attendance, marks and notes.", "ऐप इसे इस सप्ताह की हाज़िरी, अंकों और नोट से लिखता है।") },
                { icon: "edit", title: say("Make it yours", "अपना बनाएँ"), body: say("Choose short or detailed, add one line, or hide children's names.", "छोटा या विस्तृत चुनें, एक पंक्ति जोड़ें, या बच्चों के नाम छिपाएँ।") },
                { icon: "send", title: say("Send it", "भेजें"), body: say("Save it as a PDF, or send it to the admin on WhatsApp. You see a preview first.", "PDF बनाएँ, या WhatsApp पर एडमिन को भेजें। पहले नमूना दिखता है।") },
              ]
            : [
                { icon: "home", title: say("Look at the top", "ऊपर देखें"), body: say("Attendance, marks and children who need help are counted for you every morning.", "हाज़िरी, अंक और जिन्हें मदद चाहिए, हर सुबह आपके लिए गिने जाते हैं।") },
                { icon: "send", title: say("Tap to act", "टैप करके काम करें"), body: say("Press Remind next to a late teacher, or tap a child to see why they are on the list.", "देर वाले शिक्षक के आगे 'याद दिलाएँ' दबाएँ, या बच्चे पर टैप करके कारण देखें।") },
                { icon: "file", title: say("Send the week", "सप्ताह भेजें"), body: say("On Friday open Weekly summary, check it, and send it to the admin.", "शुक्रवार को साप्ताहिक सारांश खोलें, जाँचें और एडमिन को भेजें।") },
              ]
      }
    />
  );

  /* ---------------------------------------------------------- the sheet */
  let sheet = null;
  if (props.sheet === "remind" && mayRemind) {
    if (props.what === "registers") {
      const people = unmarked.filter((c) => c.teacherId);
      sheet = (
        <RemindSheet
          closeHref={closeHref}
          mode="registers"
          title={{ en: `Ask ${people.length} ${people.length === 1 ? "class" : "classes"} to mark?`, hi: `${people.length} कक्षाओं से हाज़िरी लेने को कहें?` }}
          sub={{ en: `Today's register · ${dayName(props.today)}`, hi: `आज का रजिस्टर · ${dayNameHi(props.today)}` }}
          people={people.map((c) => ({ id: c.classId, name: `${cls(c.label)} · ${c.teacherName}`, tag: c.teacherAway ? { en: "on leave", hi: "छुट्टी पर" } : undefined, on: true }))}
          previews={Object.fromEntries(
            people.map((c) => {
              // The words the staff-notice dispatcher sends for this reminder.
              const r = renderReminder({ staffName: c.teacherName, language: "both", day: props.today, classLabel: c.label, link: `${props.origin}/teach/attendance?class=${c.classId}&day=${props.today}` });
              return [c.classId, { hi: r.text.hi, en: r.text.en }];
            }),
          )}
          unit={{ one: { en: "class", hi: "कक्षा" }, many: { en: "classes", hi: "कक्षाएँ" } }}
          costEach={COST_PER_MESSAGE}
          channel={{ en: "AiSensy · WhatsApp", hi: "AiSensy · WhatsApp" }}
          note={{ en: "Sent once per class per day. If the register is saved before it goes, it is not sent.", hi: "हर कक्षा के लिए दिन में एक बार। रजिस्टर पहले सहेजा गया तो नहीं जाएगा।" }}
        />
      );
    } else {
      const pool = props.who ? late.filter((t) => t.teacherId === props.who) : late;
      const list = pool.length ? pool : late;
      const papersOf = (t: (typeof late)[number]) => t.papers.map((p) => `${p.classLabel} ${subjectName(p.subject)} ${p.entered}/${p.roll}`).join(" · ");
      const papersOfHi = (t: (typeof late)[number]) => t.papers.map((p) => `${classHi(p.classLabel)} ${subjectHi(p.subject)} ${p.entered}/${p.roll}`).join(" · ");
      const previews: Record<string, SendPreview> = Object.fromEntries(
        list.map((t) => {
          // The same two variables the send action fills: the teacher's name and her open papers.
          const vars = [t.name, t.papers.map((p) => `${p.classLabel} ${p.subject}`).sort().join(", ")];
          return [t.teacherId, props.marksTemplate ? { hi: fillTemplate(props.marksTemplate.hi, vars), en: fillTemplate(props.marksTemplate.en, vars) } : { hi: `${t.name} — ${papersOfHi(t)}`, en: `${examName} marks are pending for ${papersOf(t)}.` }];
        }),
      );
      const onLeave = list.filter((t) => away.has(t.teacherId));
      sheet = (
        <RemindSheet
          closeHref={closeHref}
          mode="marks"
          title={list.length === 1 ? { en: `Remind ${list[0].name}?`, hi: `${list[0].name} को याद दिलाएँ?` } : { en: `Remind ${list.length} late teachers?`, hi: `${list.length} देर वाले शिक्षकों को याद दिलाएँ?` }}
          sub={{ en: `${examName} marks${due ? ` · deadline ${due}` : ""}`, hi: `${examName} अंक${dueHi ? ` · अंतिम तिथि ${dueHi}` : ""}` }}
          people={list.map((t) => ({ id: t.teacherId, name: t.name, tag: away.has(t.teacherId) ? { en: "on leave", hi: "छुट्टी पर" } : undefined, on: true }))}
          whoNote={onLeave.length ? { en: `${joinAnd(onLeave.map((t) => t.name))} ${onLeave.length === 1 ? "is" : "are"} on leave today — you can leave them out.`, hi: `${onLeave.map((t) => t.name).join(", ")} आज छुट्टी पर हैं — चाहें तो हटा दें।` } : null}
          previews={previews}
          unit={{ one: { en: "teacher", hi: "शिक्षक" }, many: { en: "teachers", hi: "शिक्षक" } }}
          costEach={COST_PER_MESSAGE}
          channel={{ en: "AiSensy · WhatsApp", hi: "AiSensy · WhatsApp" }}
          note={{ en: "One message per teacher, naming every paper still open. You can undo for a few seconds after sending.", hi: "हर शिक्षक को एक संदेश, सभी बाकी पेपरों के नाम के साथ। भेजने के बाद कुछ सेकंड तक वापस ले सकते हैं।" }}
        />
      );
    }
  }

  /* ----------------------------------------------------------- the menu */
  if (mode === "menu") {
    const tiles: { href: string; icon: IconName; tone: [string, string]; title: Pair; sub: string; subTone: string }[] = [
      { href: "/academics/progress", icon: "trend", tone: ["var(--accs)", "var(--accfg)"], title: { en: "Student progress", hi: "छात्र प्रगति" }, sub: say(`${attention.length} children need attention`, `${attention.length} बच्चों पर ध्यान चाहिए`), subTone: "var(--accfg)" },
      { href: "/academics/attendance", icon: "calCheck", tone: ["var(--oks)", "var(--ok)"], title: { en: "Attendance", hi: "हाज़िरी" }, sub: closedName ? say(`School closed · ${closedName}`, `विद्यालय बंद · ${closedName}`) : unmarked.length ? say(`${unmarked.length} ${unmarked.length === 1 ? "class" : "classes"} not marked yet`, `${unmarked.length} कक्षाएँ अभी दर्ज नहीं`) : say("Every class marked", "सभी कक्षाएँ दर्ज"), subTone: "var(--ok)" },
      ...(notesHref ? [{ href: notesHref, icon: "notePen" as IconName, tone: ["var(--warns)", "var(--warnfg)"] as [string, string], title: { en: "Notes on children", hi: "बच्चों के नोट्स" }, sub: say(`${notes.open} need action`, `${notes.open} पर कार्रवाई`), subTone: "var(--warnfg)" }] : []),
      { href: "/exams", icon: "clipboard", tone: ["var(--infos)", "var(--info)"], title: { en: "Marks & results", hi: "अंक व परिणाम" }, sub: say(`${examName} ${entry.pct}% entered`, `${examName} ${entry.pct}% दर्ज`), subTone: "var(--info)" },
      { href: "/timetable", icon: "clock", tone: ["var(--s3)", "var(--fg)"], title: { en: "Timetable", hi: "समय सारणी" }, sub: say("Classes, teachers and cover", "कक्षाएँ, शिक्षक और व्यवस्था"), subTone: "var(--mut)" },
      { href: "/calendar", icon: "calendar", tone: ["var(--accs)", "var(--accfg)"], title: { en: "Calendar", hi: "कैलेंडर" }, sub: props.events[0] ? `${language === "hi" && props.events[0].titleHi ? props.events[0].titleHi : props.events[0].title} ${day(props.events[0].startsOn)}` : say("Exams, PTMs and holidays", "परीक्षा, बैठकें और छुट्टियाँ"), subTone: "var(--accfg)" },
      { href: "/academics?view=week", icon: "file", tone: ["var(--infos)", "var(--info)"], title: { en: "Weekly summary", hi: "साप्ताहिक सारांश" }, sub: say("Ready to send", "भेजने को तैयार"), subTone: "var(--info)" },
      ...(mayRemind ? [{ href: "/academics?view=menu&sheet=remind", icon: "send" as IconName, tone: ["var(--warns)", "var(--warnfg)"] as [string, string], title: { en: "Remind late teachers", hi: "शिक्षकों को याद दिलाएँ" }, sub: late.length ? say(`${late.length} still behind`, `${late.length} अभी पीछे`) : say("Nobody is behind", "कोई पीछे नहीं"), subTone: "var(--warnfg)" }] : []),
      { href: "/academics/setup", icon: "settings", tone: ["var(--s3)", "var(--fg)"], title: { en: "Academic set-up", hi: "शैक्षणिक सेटअप" }, sub: say("Subjects, classes, class teachers", "विषय, कक्षाएँ, कक्षा-अध्यापक"), subTone: "var(--mut)" },
    ];
    // UI-6: English alone for EN, Hindi under the key labels for "both", Hindi first for हि.
    const lead = (pair: Pair) => leadText(pair, language);
    const second = (pair: Pair) => under(pair, language) ?? "";
    return (
      <VxPage>
        <CoordTop crumb={say(`Academics · ${props.me.name}`, `शैक्षणिक · ${props.me.name}`)} title={say("Menu", "मेनू")} mSub={say("Academic coordinator", "शैक्षणिक संयोजक")} actions={help} mAction={help} />
        <main>
        <div className="pad" style={{ padding: "20px 28px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: "16px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <span aria-hidden="true" style={{ flex: "none", width: 56, height: 56, borderRadius: 28, background: "#C9D7F8", color: "#082F49", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}>{nameInitials(props.me.name)}</span>
            <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column" }}>
              <span className="serif" style={{ fontSize: 21, fontWeight: 600 }}>{props.me.name}</span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`Academic coordinator · Shri Veer Patta Sr. Sec. School · ${props.session}`, `शैक्षणिक संयोजक · श्री वीर पत्ता सीनियर सेकेंडरी स्कूल · ${props.session}`)}</span>
            </span>
            <span className="pill" style={{ height: 28, padding: "0 12px", background: "var(--accs)", color: "var(--accfg)" }}>{say(`Academics · ${props.session}`, `शैक्षणिक · ${props.session}`)}</span>
          </div>
          <span className="sech">{say("Open a section", "कोई भाग खोलें")}</span>
          <div className="acad-tiles" style={{ display: "grid", gap: 12 }}>
            <style>{`.acad-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}@container vx (max-width:899px){.acad-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}`}</style>
            {tiles.map((t, i) => (
              <Link key={t.href} href={t.href} className="card lift rise tap" style={{ padding: 16, minHeight: 150, display: "flex", flexDirection: "column", gap: 8, color: "var(--fg)", animationDelay: `${i * 40}ms` }}>
                <span aria-hidden="true" style={{ flex: "none", width: 48, height: 48, borderRadius: 15, background: t.tone[0], color: t.tone[1], display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic n={t.icon} size={23} />
                </span>
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.25 }}>{lead(t.title)}</span>
                  {second(t.title) ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{second(t.title)}</span> : null}
                </span>
                <span style={{ marginTop: "auto", fontSize: 13, fontWeight: 600, color: t.subTone }}>{t.sub}</span>
              </Link>
            ))}
            <form action={logoutAction} className="card lift rise" style={{ display: "flex", animationDelay: `${tiles.length * 40}ms` }}>
              <button type="submit" className="tap" style={{ flex: 1, padding: 16, minHeight: 150, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, border: 0, background: "transparent", color: "var(--fg)", textAlign: "left", borderRadius: "inherit" }}>
                <span aria-hidden="true" style={{ flex: "none", width: 48, height: 48, borderRadius: 15, background: "var(--bads)", color: "var(--bad)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic n="logout" size={23} />
                </span>
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.25 }}>{lead({ en: "Sign out", hi: "साइन आउट" })}</span>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>{second({ en: "Sign out", hi: "साइन आउट" })}</span>
                </span>
                <span style={{ marginTop: "auto", fontSize: 13, fontWeight: 600, color: "var(--mut)" }}>{props.me.name}</span>
              </button>
            </form>
          </div>
        </div>
        </main>
        {sheet}
      </VxPage>
    );
  }

  /* ------------------------------------------------ the weekly summary */
  if (mode === "week" && props.week) {
    const w = props.week;
    const last = props.today;
    const range = say(`${dayName(w.monday).replace(/ \w+$/, "")} – ${dayName(last)}`, `${dayNameHi(w.monday).replace(/ \S+$/, "")} – ${dayNameHi(last)}`);
    return (
      <VxPage>
        <CoordTop
          crumb={say("Academics · for the principal", "शैक्षणिक · प्रधानाचार्य के लिए")}
          title={say("Weekly summary", "साप्ताहिक सारांश")}
          dBack="/academics"
          mBack="/academics"
          mSub={say(`${range} · for the principal`, `${range} · प्रधानाचार्य के लिए`)}
          actions={
            <>
              {help}
              <PrintButton label={{ en: "Share as PDF", hi: "PDF के रूप में" }} icon="download" />
            </>
          }
          mAction={help}
        />
        <main>
        <WeekDraft
          facts={w.facts}
          me={props.me.name}
          principals={w.principals}
          range={range}
          trend={w.trend.map((t) => ({ label: say(dayMonth(t.monday).replace("Sept", "Sep"), dayMonthHi(t.monday)), pct: t.pct }))}
          days={w.daily.map((d) => ({
            label: say(dayName(d.day).split(" ")[0], shortDayHi(d.day).split(" ")[0]),
            pct: d.pct,
            // A closed day says so: "Holiday · Dussehra", not a bare "—" (smoke 20 Oct).
            holiday: d.holiday ? say(`Holiday${d.holiday.label ? ` · ${d.holiday.label}` : ""}`, `छुट्टी${d.holiday.labelHi ?? d.holiday.label ? ` · ${d.holiday.labelHi ?? d.holiday.label}` : ""}`) : null,
          }))}
          improved={w.improved.map((c) => ({ id: c.studentId, name: c.name, sub: say(`${c.classLabel} · noted by ${c.by}`, `${classHi(c.classLabel)} · ${c.by} ने दर्ज किया`) }))}
          help={w.help.slice(0, 4).map((c) => ({ id: c.studentId, name: c.name, sub: cls(c.classLabel), chip: c }))}
          marks={{ name: examName, pct: entry.pct, due: due ? say(due, dueHi ?? due) : null, ...w.papers }}
          lastSent={w.lastSent ? day(w.lastSent) : null}
          template={props.summaryTemplate}
          canSend={mayRemind}
        />
        </main>
      </VxPage>
    );
  }

  /* ----------------------------------------------------------- today */
  const marksTab = props.marksTab;
  const counted = today.total.counted + today.total.leave;
  const presentNow = today.total.present + today.total.late;
  const pct = today.pct === null ? "—" : `${Math.round(today.pct)}%`;
  // One class of nineteen is not "the school's attendance": until half the
  // classes have marked, the big number waits (coordinators B19).
  const tooEarly = today.marked > 0 && today.marked * 2 < today.classes.length;
  // On a closed day nobody is asked to mark: the line names the holiday instead of "19 classes have not marked".
  const attendanceClause = closedName
    ? say(`School is closed today (${closedName})`, `आज विद्यालय बंद है (${closedName})`)
    : say(`${unmarked.length} ${unmarked.length === 1 ? "class has" : "classes have"} not marked attendance`, `${unmarked.length} कक्षाओं ने हाज़िरी नहीं ली`);
  const summary = say(
    `${attendanceClause}, ${late.length} ${late.length === 1 ? "teacher is" : "teachers are"} behind on ${examName} marks and ${attention.length} children need attention.`,
    `${attendanceClause}, ${late.length} शिक्षक ${examName} के अंकों में पीछे हैं और ${attention.length} बच्चों पर ध्यान चाहिए।`,
  );
  const remindAllLabel = say(`Remind all late (${late.length})`, `देर वालों को याद दिलाएँ (${late.length})`);
  const unmarkedText = unmarked.map((c) => `${cls(c.label)} (${c.teacherAway ? say(`${c.teacherName} on leave`, `${c.teacherName} छुट्टी पर`) : c.teacherName})`);
  const weekday = (d: string) => say(dayName(d).split(" ")[0], shortDayHi(d).split(" ")[0]);

  const upcoming: { id: string; href: string; day: string; kind: string; title: string; sub: string }[] = [
    ...(entry.dueOn && entry.dueOn >= props.today && late.length
      ? [{ id: "marks-due", href: "/exams", day: entry.dueOn, kind: "deadline", title: say(`${examName} marks deadline`, `${examName} अंकों की अंतिम तिथि`), sub: say(`${weekday(entry.dueOn)} · ${late.length} ${late.length === 1 ? "teacher" : "teachers"} still behind`, `${weekday(entry.dueOn)} · ${late.length} शिक्षक अभी पीछे`) }]
      : []),
    ...props.events.map((e) => ({
      id: e.id,
      href: e.id.startsWith("day:") ? `/calendar?view=month&day=${e.startsOn}` : `/calendar?event=${e.id}`,
      day: e.startsOn,
      kind: e.kind,
      title: language === "hi" && e.titleHi ? e.titleHi : e.title,
      sub: [e.startsOn === e.endsOn ? weekday(e.startsOn) : `${day(e.startsOn)} – ${day(e.endsOn)}`, e.startsAt ? e.startsAt.slice(0, 5) : null, e.place].filter(Boolean).join(" · "),
    })),
  ]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(0, 4);
  const inDays = (day: string) => {
    const n = daysBetween(props.today, day);
    return n <= 0 ? say("today", "आज") : n === 1 ? say("tomorrow", "कल") : say(`in ${n} days`, `${n} दिन में`);
  };

  return (
    <VxPage>
      <CoordTop
        crumb={say(`Academics · ${dayNameYear(props.today)}`, `शैक्षणिक · ${dayNameYearHi(props.today)}`)}
        title={say("Today", "आज")}
        mSub={`${day(props.today)} · ${props.me.name}`}
        mAvatar={nameInitials(props.me.name)}
        actions={
          <>
            {help}
            <Btn variant="ghost" icon="grid" href="/academics?view=menu">{say("All sections", "सभी भाग")}</Btn>
            <Btn variant="sec" icon="file" href="/academics?view=week">{say("Weekly summary", "साप्ताहिक सारांश")}</Btn>
            {mayRemind ? <Btn variant={late.length ? "pri" : "soft"} icon={late.length ? "send" : "checkCircle"} href={late.length ? remindHref() : undefined} disabled={!late.length}>{late.length ? remindAllLabel : say("Nobody is behind", "कोई पीछे नहीं")}</Btn> : null}
          </>
        }
        mAction={help}
      />
      <main>
      <div className="pad" style={{ padding: "20px 28px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 250, display: "flex", flexDirection: "column", gap: 2 }}>
            <h2 className="serif" style={{ margin: 0, fontSize: 26, fontWeight: 600, lineHeight: 1.2 }}>{say(`${props.hello.en}, ${formalName(props.me.name).en}`, `${props.hello.hi ?? props.hello.en}, ${formalName(props.me.name).hi}`)}</h2>
            <span style={{ fontSize: 14, lineHeight: 1.5, color: "var(--mut)" }}>{summary}</span>
          </div>
          <Link href="/academics?view=week" className="only-m tap btn sec" style={{ width: "100%", height: 48 }}>
            <Ic n="file" size={18} />
            {say("Weekly summary for the principal", "प्रधानाचार्य के लिए साप्ताहिक सारांश")}
          </Link>
        </div>

        {closedName ? <Banner tone="info">{say(`School is closed today · ${closedName}. No register today.`, `आज विद्यालय बंद है · ${closedName}। आज हाज़िरी नहीं लगेगी।`)}</Banner> : null}

        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
          <CoordKpi
            href="/academics/attendance"
            icon="calCheck"
            tone="ok"
            label={say("Attendance today", "आज की हाज़िरी")}
            value={closedName || tooEarly ? "—" : pct}
            pill={closedName ? { tone: "mut", text: say("School closed", "विद्यालय बंद") } : unmarked.length ? { tone: "warn", text: say(`${unmarked.length} not marked`, `${unmarked.length} दर्ज नहीं`) } : { tone: "ok", text: say("All marked", "सभी दर्ज") }}
            sub={
              closedName
                ? closedName
                : tooEarly
                  ? say(`${today.marked} of ${today.classes.length} classes marked — too early to tell`, `${today.classes.length} में से ${today.marked} कक्षाएँ दर्ज — अभी कहना जल्दी`)
                  : say(`${today.marked} of ${today.classes.length} classes marked`, `${today.classes.length} में से ${today.marked} कक्षाएँ दर्ज`)
            }
          />
          <CoordKpi
            href="/exams"
            ring={entry.pct}
            label={say(`${examName} marks entered`, `${examName} अंक भरे गए`)}
            value={`${entry.pct}%`}
            pill={late.length ? { tone: "bad", text: say(`${late.length} ${late.length === 1 ? "teacher" : "teachers"} late`, `${late.length} शिक्षक पीछे`) } : { tone: "ok", text: say("Nobody late", "कोई पीछे नहीं") }}
            sub={due ? say(`Deadline ${due}`, `अंतिम तिथि ${dueHi}`) : entry.exam?.endsOn ? say(`Exam ended ${dayName(entry.exam.endsOn)}`, `परीक्षा ${dayNameHi(entry.exam.endsOn)} को समाप्त`) : null}
            delay={60}
          />
          <CoordKpi
            href="/academics/progress?view=attention"
            icon="users"
            tone="info"
            label={say("Children needing attention", "ध्यान देने वाले बच्चे")}
            value={attention.length}
            pill={props.attentionNew ? { tone: "info", text: say(`${props.attentionNew} new this week`, `इस सप्ताह ${props.attentionNew} नए`) } : null}
            sub={say("From marks, attendance & notes", "अंक, हाज़िरी और नोट से")}
            delay={120}
          />
          <CoordKpi
            href={notesHref ?? undefined}
            icon="notePen"
            tone="acc"
            label={say("Notes needing action", "कार्रवाई वाले नोट्स")}
            value={notes.open}
            pill={
              notes.due
                ? {
                    tone: "acc",
                    text: !notes.dueOn
                      ? say(`${notes.due} due this week`, `इस सप्ताह ${notes.due} नोट फिर देखने हैं`)
                      : notes.dueOn < props.today
                        ? say(`${notes.due} late since ${dayName(notes.dueOn)}`, `${dayNameHi(notes.dueOn)} से ${notes.due} बाकी`)
                        : say(`${notes.due} due · from ${dayName(notes.dueOn)}`, `${dayNameHi(notes.dueOn)} से ${notes.due} नोट फिर देखने हैं`),
                  }
                : null
            }
            sub={say("Teachers' notes to look at again", "शिक्षकों के नोट जिन्हें फिर देखना है")}
            delay={180}
          />
        </div>

        <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.45fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <Card as="section" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <CardTitle
                title={say("Today's attendance by class", "कक्षावार आज की हाज़िरी")}
                sub={
                  closedName && today.marked === 0
                    ? say(`School closed today · ${closedName}`, `आज विद्यालय बंद · ${closedName}`)
                    : today.marked === 0
                      ? say("No class has marked attendance yet", "अभी किसी कक्षा ने हाज़िरी नहीं ली")
                      : say(`${pct} present in ${today.marked} marked ${today.marked === 1 ? "class" : "classes"} · ${presentNow} of ${counted} children`, `${today.marked} दर्ज कक्षाओं में ${pct} उपस्थित · ${counted} में से ${presentNow} बच्चे`)
                }
                action={<GhostLink href="/academics/attendance">{say("Open", "खोलें")}</GhostLink>}
              />
              <HeatStrip count={today.classes.length}>
                {today.classes.map((c) => (
                  <HeatCell key={c.classId} label={c.label} pct={c.pct} href={`/academics/attendance?view=register&class=${c.classId}`} title={`${cls(c.label)} · ${c.pct === null ? (closedName ? say("school closed", "विद्यालय बंद") : say("not marked", "दर्ज नहीं")) : `${Math.round(c.pct)}% ${say("present", "उपस्थित")}`}`} />
                ))}
              </HeatStrip>
              <HeatLegend say={say} />
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--s2)" }}>
                <Ic n={closedName ? "calendar" : unmarked.length ? "info" : "checkCircle"} size={18} style={{ flex: "none", color: closedName ? "var(--mut)" : unmarked.length ? "var(--info)" : "var(--ok)" }} />
                <span style={{ flex: 1, minWidth: 200 }}>
                  {closedName
                    ? say(`School is closed today · ${closedName}. Nobody needs to mark a register. The last school day's registers are under Attendance › Month.`, `आज विद्यालय बंद है · ${closedName}। आज किसी को हाज़िरी नहीं लगानी। पिछले स्कूल दिवस के रजिस्टर हाज़िरी › महीना में हैं।`)
                    : unmarked.length
                    ? say(
                        `${unmarked.length} ${unmarked.length === 1 ? "class" : "classes"} not marked yet: ${joinAnd(unmarkedText)}.${today.marked ? " Tap any class to see who marked it." : ""}`,
                        `${unmarked.length} कक्षाएँ अभी दर्ज नहीं: ${joinAnd(unmarkedText, "और")}।${today.marked ? " किसी कक्षा पर टैप करके देखें किसने दर्ज किया।" : ""}`,
                      )
                    : say(`Every class has marked today. Tap any class to see who marked it.`, "आज सभी कक्षाओं ने हाज़िरी ली। किसी कक्षा पर टैप करके देखें किसने दर्ज किया।")}
                </span>
                {mayRemind && unmarked.length ? (
                  <RemindRegistersButton
                    classIds={unmarked.map((c) => c.classId)}
                    label={unmarked.length === 2 ? { en: "Ask both to mark", hi: "दोनों से कहें" } : unmarked.length === 1 ? { en: `Remind ${unmarked[0].teacherName}`, hi: `${unmarked[0].teacherName} को याद दिलाएँ` } : { en: `Ask all ${unmarked.length} to mark`, hi: `सभी ${unmarked.length} से कहें` }}
                    compact
                  />
                ) : null}
              </div>
            </Card>

            <Card as="section" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                <span style={{ position: "relative", flex: "none", width: 58, height: 58 }}>
                  <svg width={58} height={58} viewBox="0 0 100 100" aria-hidden="true">
                    <circle cx={50} cy={50} r={42} fill="none" stroke="var(--s3)" strokeWidth={11} />
                    <circle cx={50} cy={50} r={42} fill="none" stroke="var(--acc)" strokeWidth={11} strokeLinecap="round" strokeDasharray={`${Math.max(0.5, (263.9 * entry.pct) / 100).toFixed(1)} 263.9`} style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", ["--len" as string]: Math.max(0.5, (263.9 * entry.pct) / 100).toFixed(1), animation: "xDraw .9s var(--ease) both" }} />
                  </svg>
                  <span className="num" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{entry.pct}%</span>
                </span>
                <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{say(`${examName} marks entry`, `${examName} के अंक भरना`)}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`${examName}${due ? ` · deadline ${due}` : ""} · ${late.length} ${late.length === 1 ? "teacher" : "teachers"} behind`, `${examName}${dueHi ? ` · अंतिम तिथि ${dueHi}` : ""} · ${late.length} शिक्षक पीछे`)}</span>
                </span>
                {mayRemind ? (
                  late.length ? (
                    <Link href={remindHref()} className="tap btn pri mfull">
                      <Ic n="send" size={18} />
                      {remindAllLabel}
                    </Link>
                  ) : (
                    <span className="tap btn soft mfull" aria-disabled="true">
                      <Ic n="checkCircle" size={18} />
                      {say("Nobody is behind", "कोई पीछे नहीं")}
                    </span>
                  )
                ) : null}
              </div>
              <LinkSeg
                label={say("Marks entry", "अंक भरना")}
                current={marksTab}
                style={{ maxWidth: 340 }}
                tabs={[
                  { key: "late", href: "/academics?marks=late", label: say(`Late teachers · ${late.length}`, `देर वाले · ${late.length}`) },
                  { key: "class", href: "/academics?marks=class", label: say(`By class · ${entry.byClass.length}`, `कक्षावार · ${entry.byClass.length}`) },
                ]}
              />
              {marksTab === "late" ? (
                late.length === 0 ? (
                  <EmptyState icon="checkCircle" title={say("Everyone is up to date", "सब समय पर हैं")} style={{ padding: 20 }} />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {late.slice(0, 8).map((t, i) => {
                      const w = Math.max(3, Math.round((t.entered / Math.max(1, t.roll)) * 100));
                      return (
                        <div key={t.teacherId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i ? "1px solid var(--bd)" : undefined, animation: `xIn .3s var(--ease) ${Math.min(i * 40, 200)}ms both` }}>
                          <ToneAvatar name={t.name} />
                          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>{t.name}</span>
                              {away.has(t.teacherId) ? <Pill tone="warn">{say("On leave today", "आज छुट्टी पर")}</Pill> : null}
                            </span>
                            <span style={{ fontSize: 12, color: "var(--mut)" }}>{t.papers.map((p) => `${cls(p.classLabel)} ${say(subjectName(p.subject), subjectHi(p.subject))} ${p.entered}/${p.roll}`).join(" · ")}</span>
                            <span style={{ height: 6, maxWidth: 320, borderRadius: 4, background: "var(--s3)", overflow: "hidden", display: "flex" }}>
                              <span style={{ width: `${w}%`, height: "100%", borderRadius: 4, background: t.entered ? "var(--c3)" : "var(--bad)", transformOrigin: "left", animation: "xGrowX .7s var(--ease) both" }} />
                            </span>
                          </span>
                          {mayRemind ? (
                            <Link href={remindHref(`&who=${t.teacherId}`)} scroll={false} className="tap btn soft" aria-label={say(`Remind ${t.name} on WhatsApp`, `${t.name} को WhatsApp पर याद दिलाएँ`)} style={{ flex: "none", height: 40, padding: "0 12px", fontSize: 13 }}>
                              <Ic n="send" size={16} />
                              {say("Remind", "याद दिलाएँ")}
                            </Link>
                          ) : null}
                        </div>
                      );
                    })}
                    {late.length > 8 ? (
                      <Link href="/exams?view=remind" className="tap btn soft acad-seeall" style={{ marginTop: 10 }}>
                        {say(`See all ${late.length} late teachers`, `सभी ${late.length} देर वाले शिक्षक देखें`)}
                        <Ic n="arrowRight" size={18} />
                      </Link>
                    ) : null}
                  </div>
                )
              ) : (
                <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "2px 22px" }}>
                  {entry.byClass.map((c, i) => (
                    <div key={c.classId} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 34, animation: `xIn .3s var(--ease) ${Math.min(i * 20, 300)}ms both` }}>
                      <span className="clip" style={{ width: 96, flex: "none", fontSize: 13, fontWeight: 600 }}>{cls(c.label)}</span>
                      <span style={{ flex: 1, minWidth: 0, height: 6, borderRadius: 4, background: "var(--s3)", overflow: "hidden", display: "flex" }}>
                        <span style={{ width: `${c.pct}%`, height: "100%", borderRadius: 4, background: c.pct === 100 ? "var(--ok)" : c.pct < 50 ? "var(--c3)" : "var(--acc)", transformOrigin: "left", animation: "xGrowX .7s var(--ease) both" }} />
                      </span>
                      <span className="num" style={{ width: 42, flex: "none", textAlign: "right", fontSize: 13, fontWeight: 700 }}>{c.pct}%</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <Card as="section" style={{ display: "flex", flexDirection: "column" }}>
              <CardTitle title={say(`Needs attention · ${attention.length}`, `ध्यान दें · ${attention.length}`)} sub={say("Built by the app from attendance, marks and notes", "हाज़िरी, अंकों और नोट से ऐप ने बनाई")} style={{ marginBottom: 6 }} />
              {attention.length === 0 ? (
                <EmptyState icon="smile" title={say("Nobody on the list", "सूची खाली है")} style={{ padding: 24 }} />
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {attention.slice(0, 6).map((child, i) => (
                    <AttentionRow key={child.studentId} first={i === 0} child={child} language={language} href={`/academics/progress?view=student&student=${child.studentId}`} delay={i * 40} />
                  ))}
                </div>
              )}
              {attention.length ? (
                <Link href="/academics/progress?view=attention" className="tap btn soft acad-seeall" style={{ marginTop: 10 }}>
                  {say(`See all ${attention.length} children`, `सभी ${attention.length} बच्चे देखें`)}
                  <Ic n="arrowRight" size={18} />
                </Link>
              ) : null}
            </Card>

            <Card as="section" style={{ display: "flex", flexDirection: "column" }}>
              <CardTitle title={say("Coming up", "आगे क्या है")} action={<GhostLink href="/calendar?view=agenda">{say("Calendar", "कैलेंडर")}</GhostLink>} style={{ marginBottom: 4 }} />
              {upcoming.length === 0 ? (
                <p style={{ margin: 0, padding: "8px 0", color: "var(--mut)", fontSize: 13 }}>{say("Nothing on the calendar yet.", "कैलेंडर पर अभी कुछ नहीं।")}</p>
              ) : (
                upcoming.map((u, i) => {
                  const [bg, fg] = EVENT_TONE[u.kind] ?? EVENT_TONE.event;
                  return (
                    <Link key={u.id} href={u.href} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i ? "1px solid var(--bd)" : undefined, color: "var(--fg)" }}>
                      <span style={{ flex: "none", width: 50, padding: "6px 0", borderRadius: 12, background: bg, color: fg, display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 700 }}>{language === "hi" ? dayMonthHi(u.day).split(" ")[1] : dayMonth(u.day).split(" ")[1]?.toUpperCase()}</span>
                        <span className="num" style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.1 }}>{Number(u.day.slice(8, 10))}</span>
                      </span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <span className="clip" style={{ fontWeight: 600 }}>{u.title}</span>
                        <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{u.sub}</span>
                      </span>
                      <span className="pill num" style={{ background: "var(--s2)", color: "var(--mut)" }}>{inDays(u.day)}</span>
                    </Link>
                  );
                })
              )}
            </Card>
          </div>
        </div>
      </div>
      </main>
      {sheet}
    </VxPage>
  );
}
