import Link from "next/link";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dateLabel, dayMonth, greeting, initials, shortDay } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { HelpButton } from "@/vx/ui/overlays";
import { Banner, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, Btn, Card, CardHead, EmptyState, IconTile, Kpi, Pill, Progress, Ring, SecHead } from "@/vx/ui/primitives";

import { RemindMarksButton, RemindRegistersButton, RemindSheet, SendSummaryButton } from "./client";
import { academicContext, attendanceOn, marksEntry, needsAttention, notesNeedingAction, upcomingEvents, weekFacts } from "./data";
import { subjectName, weeklySummary } from "./domain";
import { AttentionRow, HeatCell, HeatLegend, kindOf, LinkTabs, sayer, Two } from "./ui";

/*
 * AcadHome (docs/design-handoff SCREENS "Academic coordinator · Today"):
 * attendance today, marks entry, children needing attention, notes needing
 * action, with one-tap reminders. States: home, menu (?view=menu), week
 * (?view=week), remind (?sheet=remind).
 */

type Props = { staff: CurrentStaff; view?: string; sheet?: string; marks?: string; what?: string };

export async function AcadHome({ staff, view, sheet, marks, what }: Props) {
  const language = staff.language;
  const say = sayer(language);
  const ctx = await academicContext(staff);
  if (!ctx) {
    return (
      <VxPage>
        <TopBar title={say("Today", "आज")} />
        <Section>
          <EmptyState icon="calendar" title={say("No session is open", "कोई सत्र खुला नहीं है")} body={say("Set the active session in the fee settings first.", "पहले फीस सेटिंग में सक्रिय सत्र चुनें।")} />
        </Section>
      </VxPage>
    );
  }

  const mode = view === "menu" || view === "week" ? view : "home";
  const help = (
    <HelpButton
      title={say("How this page works", "यह पेज कैसे काम करता है")}
      steps={[
        { icon: "calCheck", title: say("Attendance first", "पहले हाज़िरी"), body: say("A class counts as marked only after its teacher presses Save. Ask the late ones in one tap.", "कक्षा तभी दर्ज मानी जाती है जब शिक्षक सहेजें। देर वालों को एक टैप में कहें।") },
        { icon: "clipboard", title: say("Marks entry", "अंक प्रविष्टि"), body: say("See who is behind on the current exam and remind them all at once on WhatsApp.", "देखें कौन पीछे है और सबको एक साथ WhatsApp पर याद दिलाएँ।") },
        { icon: "users", title: say("Needs attention", "ध्यान चाहिए"), body: say("The app lists children under 75% attendance, under 33% in a subject, whose marks fell 15+ points, or with 2+ open notes.", "75% से कम हाज़िरी, किसी विषय में 33% से कम, 15+ अंक गिरे या 2+ खुले नोट वाले बच्चे।") },
      ]}
    />
  );

  const [today, entry, attention, notes, events] = await Promise.all([
    attendanceOn(ctx, ctx.today),
    marksEntry(ctx),
    needsAttention(ctx),
    notesNeedingAction(ctx),
    upcomingEvents(ctx.session, ctx.today, 14),
  ]);
  const late = entry.late;
  const examName = entry.exam ? (language === "hi" && entry.exam.labelHi ? entry.exam.labelHi : entry.exam.label) : say("Marks", "अंक");
  const mayRemind = can(staff, "messages:send");
  // The exam coordinator opens this page too and has no notes screen.
  const notesHref = can(staff, "notes:view") ? "/notes" : undefined;
  const firstName = staff.displayName;
  const summary = say(
    `${today.notMarked.length} ${today.notMarked.length === 1 ? "class has" : "classes have"} not marked attendance, ${late.length} teachers are behind on ${examName} marks and ${attention.length} children need attention.`,
    `${today.notMarked.length} कक्षाओं ने हाज़िरी नहीं ली, ${late.length} शिक्षक ${examName} के अंकों में पीछे हैं और ${attention.length} बच्चों पर ध्यान चाहिए।`,
  );

  const topActions = (
    <>
      {help}
      <Btn variant="ghost" icon="grid" href="/academics?view=menu">{say("All sections", "सभी हिस्से")}</Btn>
      <Btn variant="sec" icon="file" href="/academics?view=week">{say("Weekly summary", "साप्ताहिक सारांश")}</Btn>
      {mayRemind ? <Btn variant="pri" icon="send" href="/academics?sheet=remind">{say(`Remind all late (${late.length})`, `सभी देर वालों को याद (${late.length})`)}</Btn> : null}
    </>
  );

  const remindSheet =
    sheet === "remind" && mayRemind ? (
      what === "registers" ? (
        <RemindSheet
          closeHref={mode === "home" ? "/academics" : `/academics?view=${mode}`}
          mode="registers"
          people={today.notMarked.filter((c) => c.teacherId).map((c) => ({ id: c.classId, name: c.label, sub: `${c.teacherName}${c.teacherAway ? say(" · on leave", " · छुट्टी पर") : ""}`, on: true }))}
          preview={[say("Attendance reminder", "हाज़िरी रिमाइंडर"), say(`${today.notMarked[0]?.label ?? "Your class"}'s register for today is not saved yet. Please mark it in VPPS One.`, `${today.notMarked[0]?.label ?? "आपकी कक्षा"} का आज का रजिस्टर अभी सहेजा नहीं गया है। कृपया VPPS One में दर्ज करें।`)]}
        />
      ) : (
        <RemindSheet
          closeHref={mode === "home" ? "/academics" : `/academics?view=${mode}`}
          mode="marks"
          people={late.map((t) => ({ id: t.teacherId, name: t.name, sub: t.papers.map((p) => `${p.classLabel} ${subjectName(p.subject)} ${p.entered}/${p.roll}`).join(" · "), on: true }))}
          preview={late[0] ? [say(`Hello ${late[0].name},`, `नमस्ते ${late[0].name},`), say(`${examName} marks are still open for: ${late[0].papers.map((p) => `${p.classLabel} ${subjectName(p.subject)}`).join(", ")}.`, `${examName} के अंक अभी बाकी हैं: ${late[0].papers.map((p) => `${p.classLabel} ${subjectName(p.subject)}`).join(", ")}।`), say("Please enter them in VPPS One.", "कृपया VPPS One में दर्ज करें।")] : []}
        />
      )
    ) : null;

  if (mode === "menu") {
    const tiles: { href: string; icon: IconName; title: string; sub: string; badge?: number }[] = [
      { href: "/academics", icon: "home", title: say("Today", "आज"), sub: say("Attendance, marks and who needs you", "हाज़िरी, अंक और किसे ज़रूरत है") },
      { href: "/academics/progress", icon: "trend", title: say("Student progress", "विद्यार्थी प्रगति"), sub: say("Classes, subjects and each child", "कक्षाएँ, विषय और हर बच्चा") },
      { href: "/academics/attendance", icon: "calCheck", title: say("Attendance", "हाज़िरी"), sub: say(`${today.marked} of ${today.classes.length} classes marked today`, `आज ${today.classes.length} में ${today.marked} कक्षाएँ दर्ज`) },
      ...(notesHref ? [{ href: notesHref, icon: "note" as IconName, title: say("Notes on children", "बच्चों पर नोट"), sub: say(`${notes.open} need action`, `${notes.open} पर कार्रवाई`), badge: notes.open || undefined }] : []),
      { href: "/exams", icon: "clipboard", title: say("Marks & results", "अंक और परिणाम"), sub: say(`${examName} ${entry.pct}% entered`, `${examName} ${entry.pct}% दर्ज`) },
      { href: "/timetable", icon: "clock", title: say("Timetable", "समय सारणी"), sub: say("Classes, teachers and cover", "कक्षाएँ, शिक्षक और व्यवस्था") },
      { href: "/calendar", icon: "calendar", title: say("Calendar", "कैलेंडर"), sub: say("Exams, PTMs and holidays", "परीक्षा, बैठकें और छुट्टियाँ") },
      { href: "/academics/setup", icon: "settings", title: say("Academic set-up", "शैक्षणिक सेटअप"), sub: say("Subjects, classes, class teachers", "विषय, कक्षाएँ, कक्षा-अध्यापक") },
    ];
    return (
      <VxPage>
        <TopBar crumb={say("Academics", "शैक्षणिक")} title={say("All sections", "सभी हिस्से")} mTitle={say("Menu", "मेन्यू")} mBack="/academics" actions={help} mAction={help} />
        <Section>
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
            {tiles.map((t, i) => (
              <Link key={t.href} href={t.href} className="card tap lift rise" style={{ padding: 16, display: "flex", alignItems: "center", gap: 14, animationDelay: `${i * 40}ms` }}>
                <IconTile icon={t.icon} size={48} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {t.title}
                    {t.badge ? <Pill tone="bad">{t.badge}</Pill> : null}
                  </strong>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>{t.sub}</span>
                </span>
                <Ic n="chevRight" size={18} style={{ color: "var(--mut)" }} />
              </Link>
            ))}
          </div>
        </Section>
      </VxPage>
    );
  }

  if (mode === "week") {
    const week = await weekFacts(ctx);
    const lines = weeklySummary(week.facts);
    return (
      <VxPage>
        <TopBar
          crumb={say(`Academics · week of ${dayMonth(week.monday)}`, `शैक्षणिक · ${dayMonth(week.monday)} का सप्ताह`)}
          title={say("Weekly summary", "साप्ताहिक सारांश")}
          mBack="/academics"
          actions={<>{help}{mayRemind ? <SendSummaryButton label={{ en: "Send to principal", hi: "प्रधानाचार्य को भेजें" }} /> : null}</>}
          mAction={help}
        />
        <Section>
          <LinkTabs label={say("Views", "दृश्य")} current="week" tabs={[{ key: "home", href: "/academics", label: say("Today", "आज") }, { key: "week", href: "/academics?view=week", label: say("This week", "यह सप्ताह") }]} />
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
            <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <CardHead title={say("For the principal", "प्रधानाचार्य के लिए")} sub={say(`Built from this week's registers, marks and notes · ${shortDay(ctx.today)}`, `इस सप्ताह के रजिस्टर, अंकों और नोट से · ${shortDay(ctx.today)}`)} />
              <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10, fontSize: 15, lineHeight: 1.5 }}>
                {lines.map((line, i) => (
                  <li key={i}>
                    <Two pair={line} language={language} />
                  </li>
                ))}
              </ol>
              {mayRemind ? (
                <div className="only-m">
                  <SendSummaryButton label={{ en: "Send to principal", hi: "प्रधानाचार्य को भेजें" }} />
                </div>
              ) : null}
            </Card>
            <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <CardHead title={say("Attendance each day", "हर दिन की हाज़िरी")} sub={week.facts.attendanceBefore !== null ? say(`Last week ${week.facts.attendanceBefore}%`, `पिछले सप्ताह ${week.facts.attendanceBefore}%`) : undefined} />
              {week.daily.map((d) => (
                <div key={d.day} style={{ display: "grid", gridTemplateColumns: "70px minmax(0,1fr) 52px", gap: 10, alignItems: "center", fontSize: 14 }}>
                  <span style={{ color: "var(--mut)" }}>{shortDay(d.day).split(" ")[0]} {dayMonth(d.day)}</span>
                  <Progress value={d.pct ?? 0} max={100} tone={d.pct !== null && d.pct < 90 ? "var(--warn)" : "var(--pri)"} />
                  <span className="num" style={{ textAlign: "right", fontWeight: 700 }}>{d.pct === null ? "—" : `${Math.round(d.pct)}%`}</span>
                </div>
              ))}
            </Card>
          </div>
          <Card pad={false}>
            <div style={{ padding: "16px 16px 8px" }}>
              <CardHead title={say(`Needs attention · ${week.attention.length}`, `ध्यान चाहिए · ${week.attention.length}`)} action={<Btn variant="ghost" href="/academics/progress?view=attention">{say("Open list", "सूची खोलें")}</Btn>} />
            </div>
            {week.attention.slice(0, 5).map((child, i) => (
              <AttentionRow key={child.studentId} child={child} language={language} href={`/academics/progress?view=student&student=${child.studentId}`} delay={i * 30} />
            ))}
          </Card>
        </Section>
        {remindSheet}
      </VxPage>
    );
  }

  const marksTab = marks === "class" ? "class" : "late";
  const unmarked = today.notMarked;
  const strip = today.classes;

  return (
    <VxPage>
      <TopBar crumb={say(`Academics · ${dateLabel(ctx.today)}`, `शैक्षणिक · ${dateLabel(ctx.today)}`)} title={say("Today", "आज")} actions={topActions} mAction={<>{help}<Link href="/academics?view=menu" className="tap icon-btn" aria-label={say("All sections", "सभी हिस्से")}><Ic n="grid" size={20} /></Link></>} />
      <Section>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>{say(`${greeting()}, ${firstName}`, `नमस्ते, ${firstName}`)}</h2>
          <p style={{ margin: 0, color: "var(--mut)" }}>{summary}</p>
        </div>

        {today.closed ? <Banner tone="info">{say(`School is closed today${today.closed.label ? ` · ${today.closed.label}` : ""}.`, `आज विद्यालय बंद है${today.closed.label ? ` · ${today.closed.label}` : ""}।`)}</Banner> : null}

        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
          <Kpi
            href="/academics/attendance"
            icon="calCheck"
            label={say("Attendance today", "आज की हाज़िरी")}
            value={today.pct === null ? "—" : `${Math.round(today.pct)}%`}
            sub={
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {unmarked.length ? <Pill tone="warn">{say(`${unmarked.length} not marked`, `${unmarked.length} दर्ज नहीं`)}</Pill> : <Pill tone="ok">{say("All marked", "सभी दर्ज")}</Pill>}
                {say(`${today.marked} of ${today.classes.length} classes`, `${today.classes.length} में ${today.marked} कक्षाएँ`)}
              </span>
            }
          />
          <Kpi
            href="/academics?marks=late"
            icon="clipboard"
            label={say(`${examName} marks entered`, `${examName} अंक दर्ज`)}
            value={`${entry.pct}%`}
            sub={
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {late.length ? <Pill tone="bad">{say(`${late.length} teachers late`, `${late.length} शिक्षक पीछे`)}</Pill> : <Pill tone="ok">{say("Nobody late", "कोई पीछे नहीं")}</Pill>}
                {entry.exam?.endsOn ? say(`Exam ended ${dayMonth(entry.exam.endsOn)}`, `परीक्षा ${dayMonth(entry.exam.endsOn)} को समाप्त`) : null}
              </span>
            }
          />
          <Kpi
            href="/academics/progress?view=attention"
            icon="users"
            label={say("Children needing attention", "ध्यान चाहिए")}
            value={attention.length}
            sub={say("From marks, attendance & notes", "अंक, हाज़िरी और नोट से")}
          />
          <Kpi
            href={notesHref}
            icon="note"
            label={say("Notes needing action", "कार्रवाई वाले नोट")}
            value={notes.open}
            sub={
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {notes.due ? <Pill tone="acc">{say(`${notes.due} due${notes.dueOn ? ` ${dayMonth(notes.dueOn)}` : ""}`, `${notes.due} देय`)}</Pill> : null}
                {say("Follow-ups from teachers", "शिक्षकों के फ़ॉलो-अप")}
              </span>
            }
          />
        </div>

        <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.55fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <CardHead
                title={say("Today's attendance by class", "आज की कक्षावार हाज़िरी")}
                sub={say(
                  `${today.pct === null ? "—" : `${Math.round(today.pct)}%`} present in ${today.marked} marked classes · ${today.total.present + today.total.late} of ${today.total.counted + today.total.leave} children`,
                  `${today.marked} दर्ज कक्षाओं में ${today.pct === null ? "—" : `${Math.round(today.pct)}%`} उपस्थित`,
                )}
                action={<Btn variant="ghost" href="/academics/attendance">{say("Open", "खोलें")}<Ic n="chevRight" size={16} /></Btn>}
              />
              <div className="hs" style={{ display: "flex", gap: 6, paddingBottom: 4 }}>
                {strip.map((c) => (
                  <HeatCell key={c.classId} label={c.label} pct={c.pct} href={`/academics/attendance?view=register&class=${c.classId}`} title={`${c.label} · ${c.pct === null ? say("not marked", "दर्ज नहीं") : `${Math.round(c.pct)}%`}`} />
                ))}
              </div>
              <HeatLegend say={say} />
              {unmarked.length ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, background: "var(--s2)", flexWrap: "wrap" }}>
                  <Ic n="info" size={18} style={{ color: "var(--info)" }} />
                  <span style={{ flex: 1, minWidth: 200, fontSize: 14 }}>
                    {say(
                      `${unmarked.length} ${unmarked.length === 1 ? "class" : "classes"} not marked yet: ${unmarked.map((c) => `${c.label} (${c.teacherName}${c.teacherAway ? " on leave" : ""})`).join(", ")}. Tap any class to see who marked.`,
                      `${unmarked.length} कक्षाएँ अभी दर्ज नहीं: ${unmarked.map((c) => `${c.label} (${c.teacherName}${c.teacherAway ? " छुट्टी पर" : ""})`).join(", ")}।`,
                    )}
                  </span>
                  {mayRemind ? <RemindRegistersButton classIds={unmarked.map((c) => c.classId)} label={unmarked.length === 2 ? { en: "Ask both to mark", hi: "दोनों से कहें" } : { en: `Ask ${unmarked.length} to mark`, hi: `${unmarked.length} से कहें` }} /> : null}
                </div>
              ) : null}
            </Card>

            <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <Ring value={entry.pct} size={58} stroke={7} tone="var(--pri)">
                  <span className="num" style={{ fontWeight: 700, fontSize: 14 }}>{entry.pct}%</span>
                </Ring>
                <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
                  <strong style={{ fontSize: 17 }}>{say(`${examName} marks entry`, `${examName} अंक प्रविष्टि`)}</strong>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>{say(`${late.length} teachers behind · ${entry.papers.filter((p) => p.submitted).length} of ${entry.papers.length} papers submitted`, `${late.length} शिक्षक पीछे · ${entry.papers.length} में ${entry.papers.filter((p) => p.submitted).length} पेपर जमा`)}</span>
                </span>
                {mayRemind && late.length ? <RemindMarksButton teacherIds={late.map((t) => t.teacherId)} label={{ en: `Remind all late (${late.length})`, hi: `सभी को याद दिलाएँ (${late.length})` }} /> : null}
              </div>
              <LinkTabs label={say("Marks entry", "अंक प्रविष्टि")} current={marksTab} tabs={[{ key: "late", href: "/academics?marks=late", label: say(`Late teachers · ${late.length}`, `देर वाले · ${late.length}`) }, { key: "class", href: "/academics?marks=class", label: say(`By class · ${entry.byClass.length}`, `कक्षावार · ${entry.byClass.length}`) }]} />
              {marksTab === "late" ? (
                late.length === 0 ? (
                  <EmptyState icon="checkCircle" title={say("Everyone is up to date", "सब समय पर हैं")} style={{ padding: 20 }} />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {late.slice(0, 8).map((t) => (
                      <div key={t.teacherId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: "1px solid var(--bd)" }}>
                        <Avatar text={initials(t.name)} seed={t.teacherId} size={38} />
                        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                          <strong className="clip">{t.name}</strong>
                          <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{t.papers.map((p) => `${p.classLabel} ${subjectName(p.subject)} ${p.entered}/${p.roll}`).join(" · ")}</span>
                          <Progress value={t.entered} max={t.roll} height={5} tone={t.entered / t.roll < 0.25 ? "var(--bad)" : "var(--warn)"} style={{ maxWidth: 320 }} />
                        </span>
                        {mayRemind ? <RemindMarksButton teacherIds={[t.teacherId]} label={{ en: "Remind", hi: "याद दिलाएँ" }} variant="soft" /> : null}
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {entry.byClass.map((c) => (
                    <div key={c.classId} style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr) 92px", gap: 12, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--bd)", fontSize: 14 }}>
                      <strong className="clip">{c.label}</strong>
                      <Progress value={c.pct} max={100} height={6} tone={c.pct === 100 ? "var(--ok)" : c.pct < 50 ? "var(--warn)" : "var(--pri)"} />
                      <span className="num" style={{ textAlign: "right", color: "var(--mut)" }}>{say(`${c.done}/${c.total} papers`, `${c.done}/${c.total} पेपर`)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <Card pad={false}>
              <div style={{ padding: "16px 16px 10px" }}>
                <CardHead title={say(`Needs attention · ${attention.length}`, `ध्यान चाहिए · ${attention.length}`)} sub={say("Built by the app from attendance, marks and notes", "हाज़िरी, अंक और नोट से ऐप ने बनाई")} />
              </div>
              {attention.length === 0 ? (
                <EmptyState icon="smile" title={say("Nobody on the list", "सूची खाली है")} style={{ padding: 24 }} />
              ) : (
                attention.slice(0, 6).map((child, i) => <AttentionRow key={child.studentId} child={child} language={language} href={`/academics/progress?view=student&student=${child.studentId}`} delay={i * 30} />)
              )}
              {attention.length > 6 ? (
                <div style={{ padding: 12, borderTop: "1px solid var(--bd)" }}>
                  <Btn variant="ghost" full href="/academics/progress?view=attention">{say(`See all ${attention.length}`, `सभी ${attention.length} देखें`)}</Btn>
                </div>
              ) : null}
            </Card>

            <Card pad={false}>
              <div style={{ padding: "16px 16px 10px" }}>
                <SecHead action={<Btn variant="ghost" href="/calendar?view=agenda">{say("Calendar", "कैलेंडर")}</Btn>}>{say("Coming up", "आगे क्या है")}</SecHead>
              </div>
              {events.length === 0 ? (
                <p style={{ margin: 0, padding: "0 16px 16px", color: "var(--mut)" }}>{say("Nothing in the next two weeks.", "अगले दो सप्ताह में कुछ नहीं।")}</p>
              ) : (
                events.slice(0, 5).map((e) => {
                  const k = kindOf(e.kind);
                  return (
                    <Link key={e.id} href={e.id.startsWith("day:") ? `/calendar?view=month&day=${e.startsOn}` : `/calendar?event=${e.id}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--bd)" }}>
                      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: k.dot }} />
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <strong className="clip">{language === "hi" && e.titleHi ? e.titleHi : e.title}</strong>
                        <span style={{ fontSize: 13, color: "var(--mut)" }}>
                          {e.startsOn === e.endsOn ? shortDay(e.startsOn) : `${dayMonth(e.startsOn)} – ${dayMonth(e.endsOn)}`}
                          {e.startsAt ? ` · ${e.startsAt.slice(0, 5)}` : ""}
                        </span>
                      </span>
                      <span className="pill" style={{ background: k.bg, color: k.fg }}>{language === "hi" ? k.label.hi : k.label.en}</span>
                    </Link>
                  );
                })
              )}
            </Card>
          </div>
        </div>

        {mayRemind ? (
          <div className="only-m" style={{ position: "sticky", bottom: 76, display: "flex", gap: 8 }}>
            <Btn variant="pri" icon="send" full href="/academics?sheet=remind">{say(`Remind all late (${late.length})`, `सभी को याद दिलाएँ (${late.length})`)}</Btn>
          </div>
        ) : null}
      </Section>
      {remindSheet}
    </VxPage>
  );
}

