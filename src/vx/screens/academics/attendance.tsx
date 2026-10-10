import Link from "next/link";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { listCorrections } from "@/modules/attendance/data/corrections-repo";
import { withinScope } from "@/modules/attendance/domain/class-scope";
import { canDecide, type Correction } from "@/modules/attendance/domain/corrections";
import { ago, clock, dateLabel, dayMonth, shortDay } from "@/vx/format";
import { Ic } from "@/vx/icons";
import { HelpButton } from "@/vx/ui/overlays";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { ATT_COLORS, Btn, Card, CardHead, EmptyState, Kpi, Pill, Progress, Ring, SecHead } from "@/vx/ui/primitives";

import { CallSheet, DecideButtons, PrintButton, RemindRegistersButton, RemindSheet } from "./client";
import { academicContext, attendanceMonth, attendanceOn, chronicAbsentees, markSheet, pendingCorrections, registerSheet } from "./data";
import { attendanceBand, BAND_STYLE, isMonth, shiftMonth, telHref, type AttStatus } from "./domain";
import { MarkSheet } from "./mark-sheet";
import { followLabel } from "./progress-labels";
import { LinkCard, LinkTabs, qs, sayer, type Say } from "./ui";

/*
 * AcadAttendance (SCREENS "Academic coordinator · Attendance"): today, the
 * month, children below 75% with call outcomes, change requests from
 * teachers and a class register. States: `?view=` today | month | chronic |
 * corrections | register, and `?sheet=` remind | mark | call.
 */

type Props = { staff: CurrentStaff; view?: string; sheet?: string; classId?: string; month?: string; studentId?: string; filter?: string };

const BASE = "/academics/attendance";

const DOT: Record<AttStatus, keyof typeof ATT_COLORS> = { present: "P", late: "P", absent: "A", leave: "L", half_day: "H" };

export async function AcadAttendance(props: Props) {
  const { staff } = props;
  const language = staff.language;
  const say = sayer(language);
  const ctx = await academicContext(staff);
  if (!ctx) {
    return (
      <VxPage>
        <TopBar title={say("Attendance", "हाज़िरी")} />
        <Section><EmptyState title={say("No session is open", "कोई सत्र खुला नहीं है")} /></Section>
      </VxPage>
    );
  }
  const view = ["month", "chronic", "corrections", "register"].includes(props.view ?? "") ? props.view! : "today";
  const month = isMonth(props.month) ? props.month : ctx.today.slice(0, 7);
  const [today, chronic, pending] = await Promise.all([attendanceOn(ctx, ctx.today), chronicAbsentees(ctx), pendingCorrections(ctx)]);
  const mayRemind = can(staff, "messages:send");
  const help = (
    <HelpButton
      title={say("Attendance", "हाज़िरी")}
      steps={[
        { icon: "calCheck", title: say("Marked means saved", "दर्ज यानी सहेजा"), body: say("A class counts only after its teacher presses Save. Not marked is never counted as present.", "कक्षा तभी गिनी जाती है जब शिक्षक सहेजें। दर्ज न होना कभी उपस्थित नहीं गिना जाता।") },
        { icon: "alert", title: say("Below 75%", "75% से कम"), body: say("Children under 75% this session, with the last call to their parents.", "इस सत्र 75% से कम वाले बच्चे, अभिभावक को पिछली कॉल के साथ।") },
        { icon: "edit", title: say("Change requests", "बदलाव अनुरोध"), body: say("Teachers ask to change a saved register; somebody else approves it.", "शिक्षक सहेजे रजिस्टर में बदलाव माँगते हैं; कोई दूसरा स्वीकार करता है।") },
      ]}
    />
  );
  const firstRegisterClass = props.classId && ctx.classes.some((c) => c.id === props.classId) ? props.classId : ctx.classes[0]?.id;
  const tabs = (
    <LinkTabs
      label={say("Views", "दृश्य")}
      current={view}
      tabs={[
        { key: "today", href: BASE, label: say("Today", "आज"), icon: "calCheck" },
        { key: "month", href: qs(BASE, { view: "month" }), label: say("Month", "महीना"), icon: "chart" },
        { key: "chronic", href: qs(BASE, { view: "chronic" }), label: "< 75%", icon: "alert", badge: chronic.length || undefined },
        { key: "corrections", href: qs(BASE, { view: "corrections" }), label: say("Changes", "बदलाव"), icon: "edit", badge: pending || undefined },
        { key: "register", href: qs(BASE, { view: "register", class: firstRegisterClass }), label: say("Register", "रजिस्टर"), icon: "table" },
      ]}
    />
  );
  const crumb = say(`Academics · ${shortDay(ctx.today)}`, `शैक्षणिक · ${shortDay(ctx.today)}`);
  const titles: Record<string, string> = {
    today: say("Attendance today", "आज की हाज़िरी"),
    month: say("Attendance this month", "इस महीने की हाज़िरी"),
    chronic: say("Below 75%", "75% से कम"),
    corrections: say("Change requests", "बदलाव अनुरोध"),
    register: say("Class register", "कक्षा रजिस्टर"),
  };
  const top = <TopBar crumb={crumb} title={titles[view]} mBack={view === "today" ? "/academics" : BASE} actions={help} mAction={help} />;

  /* ------------------------------------------------------------ sheets */
  const closeHref = qs(BASE, { view: view === "today" ? undefined : view, class: view === "register" ? props.classId : undefined, month: props.month });
  let sheet = null;
  if (props.sheet === "remind" && mayRemind) {
    sheet = (
      <RemindSheet
        closeHref={closeHref}
        mode="registers"
        people={today.notMarked.filter((c) => c.teacherId).map((c) => ({ id: c.classId, name: `${c.label} · ${c.teacherName}`, sub: c.teacherAway ? say("On leave today — mark it for her instead", "आज छुट्टी पर — उनकी ओर से दर्ज करें") : say(`${c.roll} children · not saved yet`, `${c.roll} बच्चे · अभी सहेजा नहीं`), on: !c.teacherAway }))}
        preview={[say("Attendance reminder", "हाज़िरी रिमाइंडर"), say(`The register for ${today.notMarked[0]?.label ?? "your class"} today is not saved yet. Please mark it now.`, `${today.notMarked[0]?.label ?? "आपकी कक्षा"} का आज का रजिस्टर अभी सहेजा नहीं गया है। कृपया अभी दर्ज करें।`)]}
      />
    );
  } else if (props.sheet === "mark" && props.classId) {
    const roll = await markSheet(ctx, props.classId, ctx.today);
    const row = today.classes.find((c) => c.classId === props.classId);
    if (roll) {
      const allowed = can(staff, "attendance:mark_on_behalf");
      sheet = (
        <MarkSheet
          closeHref={closeHref}
          classId={roll.classId}
          label={roll.label}
          day={roll.day}
          teacher={row?.teacherName ?? "—"}
          revision={roll.revision}
          students={roll.students}
          allowed={allowed}
          refusal={{ en: "Marking for a teacher is the office's job. Ask the office, or remind the teacher.", hi: "शिक्षक की ओर से दर्ज करना कार्यालय का काम है। कार्यालय से कहें या शिक्षक को याद दिलाएँ।" }}
        />
      );
    }
  } else if (props.sheet === "call" && props.studentId) {
    const child = chronic.find((c) => c.studentId === props.studentId);
    if (child && ctx.everyClass) {
      sheet = <CallSheet closeHref={qs(BASE, { view: "chronic" })} studentId={child.studentId} name={child.name} sub={say(`${child.classLabel} · ${Math.round(child.pct)}% · ${child.absentDays} days absent`, `${child.classLabel} · ${Math.round(child.pct)}% · ${child.absentDays} दिन अनुपस्थित`)} phoneHref={telHref(child.phone)} father={child.father} />;
    }
  }

  /* ------------------------------------------------------------ month */
  if (view === "month") {
    const data = await attendanceMonth(ctx, month);
    const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric" });
    const lowest = [...data.byClass].filter((c) => c.pct !== null).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))[0];
    return (
      <VxPage>
        {top}
        <Section>
          {tabs}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 className="serif" style={{ margin: 0, fontSize: 24, flex: 1 }}>{monthName}</h2>
            <Btn variant="sec" icon="chevLeft" ariaLabel={say("Previous month", "पिछला महीना")} href={qs(BASE, { view: "month", month: shiftMonth(month, -1) })} />
            <Btn variant="sec" icon="chevRight" ariaLabel={say("Next month", "अगला महीना")} href={qs(BASE, { view: "month", month: shiftMonth(month, 1) })} />
          </div>
          <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
            <Kpi label={say("Average", "औसत")} value={data.average === null ? "—" : `${data.average}%`} sub={say(`${data.days.length} school days so far`, `अब तक ${data.days.length} स्कूल दिवस`)} />
            <Kpi label={say("Lowest class", "सबसे कम कक्षा")} value={lowest?.pct == null ? "—" : `${Math.round(lowest.pct)}%`} sub={lowest?.label} tone="var(--warnfg)" />
            <Kpi label={say("Below 75%", "75% से कम")} value={chronic.length} tone="var(--bad)" href={qs(BASE, { view: "chronic" })} sub={say("children this session", "बच्चे इस सत्र")} />
            <Kpi label={say("Days not saved", "बिना सहेजे दिन")} value={data.byClass.reduce((s, c) => s + c.daysOpen, 0)} sub={say("class-days", "कक्षा-दिवस")} />
          </div>
          <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <CardHead title={say("School, day by day", "विद्यालय, दिन-ब-दिन")} sub={say("Percent present of children counted", "गिने गए बच्चों में उपस्थित प्रतिशत")} />
            <div className="hs" style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 170, overflowX: "auto" }}>
              {data.byDay.map((d) => (
                <span key={d.day} style={{ flex: "1 0 22px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4, height: "100%" }} title={`${shortDay(d.day)} · ${d.pct ?? "—"}%`}>
                  <span className="num" style={{ fontSize: 10, color: "var(--mut)" }}>{d.pct === null ? "" : Math.round(d.pct)}</span>
                  <span style={{ width: "100%", maxWidth: 26, height: `${d.pct === null ? 4 : Math.max(4, (d.pct - 70) * 4)}px`, borderRadius: 6, background: d.pct === null ? "var(--s3)" : d.pct < 90 ? "var(--warn)" : "var(--pri)" }} />
                  <span className="num" style={{ fontSize: 11, color: "var(--mut)" }}>{Number(d.day.slice(8))}</span>
                </span>
              ))}
            </div>
          </Card>
          <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <CardHead title={say("Class by class", "कक्षावार")} sub={say("Each square is a day · tap a class for its register", "हर खाना एक दिन · रजिस्टर के लिए कक्षा टैप करें")} />
            <div className="hs" style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 3, fontSize: 11 }}>
                <thead>
                  <tr>
                    <th />
                    {data.days.map((d) => <th key={d} className="num" style={{ color: "var(--mut)", fontWeight: 600 }}>{Number(d.slice(8))}</th>)}
                    <th style={{ color: "var(--mut)", textAlign: "right", paddingLeft: 8 }}>{say("Avg", "औसत")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byClass.map((c) => (
                    <tr key={c.classId}>
                      <th scope="row" style={{ textAlign: "left", whiteSpace: "nowrap", paddingRight: 8, fontSize: 13 }}>
                        <Link href={qs(BASE, { view: "register", class: c.classId, month })} className="tap">{c.label}</Link>
                      </th>
                      {data.days.map((d) => {
                        const v = data.grid.get(c.classId)?.get(d) ?? null;
                        const s = BAND_STYLE[attendanceBand(v)];
                        return <td key={d} title={`${c.label} · ${dayMonth(d)} · ${v === null ? say("not saved", "सहेजा नहीं") : `${Math.round(v)}%`}`} style={{ width: 20, height: 20, borderRadius: 5, background: s.bg, border: s.border }} />;
                      })}
                      <td className="num" style={{ textAlign: "right", fontWeight: 700, fontSize: 13, paddingLeft: 8 }}>{c.pct === null ? "—" : `${Math.round(c.pct)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Section>
        {sheet}
      </VxPage>
    );
  }

  /* ---------------------------------------------------------- chronic */
  if (view === "chronic") {
    return (
      <VxPage>
        {top}
        <Section>
          {tabs}
          <Card style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "var(--s2)" }}>
            <Ic n="info" size={18} style={{ color: "var(--info)", marginTop: 2 }} />
            <span style={{ fontSize: 14 }}>{say(`${chronic.length} children are below 75% this session (at least 5 school days counted). Late counts as present; leave is not counted.`, `${chronic.length} बच्चे इस सत्र 75% से कम हैं (कम से कम 5 दिन गिने)। देर उपस्थित गिनी जाती है; छुट्टी नहीं गिनी जाती।`)}</span>
          </Card>
          <Card pad={false}>
            {chronic.length === 0 ? <EmptyState icon="smile" title={say("Nobody is below 75%", "कोई 75% से कम नहीं")} /> : null}
            {chronic.map((c, i) => (
              <div key={c.studentId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i ? "1px solid var(--bd)" : undefined, flexWrap: "wrap" }}>
                <Ring value={c.pct} size={52} stroke={6} tone={c.pct < 60 ? "var(--bad)" : "var(--warn)"}>
                  <span className="num" style={{ fontSize: 12, fontWeight: 700 }}>{Math.round(c.pct)}%</span>
                </Ring>
                <Link href={`/academics/progress?view=student&student=${c.studentId}`} className="tap" style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column", gap: 3 }}>
                  <strong>{c.name}</strong>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>{c.classLabel} · {say(`${c.absentDays} days absent`, `${c.absentDays} दिन अनुपस्थित`)}{c.absentLastWeek >= 2 ? ` · ${say(`${c.absentLastWeek} this week`, `इस सप्ताह ${c.absentLastWeek}`)}` : ""}</span>
                  <span style={{ fontSize: 12, color: c.lastCall ? "var(--fg)" : "var(--mut)" }}>
                    {c.lastCall ? say(`Last call: ${followLabel("call", c.lastCall.outcome, say)} · ${c.lastCall.by} · ${ago(c.lastCall.at)}`, `पिछली कॉल: ${followLabel("call", c.lastCall.outcome, say)} · ${c.lastCall.by}`) : say("Parents not called yet", "अभिभावक को अभी कॉल नहीं")}
                  </span>
                </Link>
                {c.absentLastWeek >= 2 ? <Pill tone="bad">{say("Absent 2+ days now", "अभी 2+ दिन अनुपस्थित")}</Pill> : null}
                {ctx.everyClass ? <Btn variant="soft" icon="phone" href={qs(BASE, { view: "chronic", sheet: "call", student: c.studentId })}>{say("Call", "कॉल")}</Btn> : null}
              </div>
            ))}
          </Card>
        </Section>
        {sheet}
      </VxPage>
    );
  }

  /* ------------------------------------------------------ corrections */
  if (view === "corrections") {
    const labels = new Map(ctx.classes.map((c) => [c.id, c.label]));
    const all: Correction[] = withinScope(ctx.scope, await listCorrections(ctx.session, labels), (c) => c.classId);
    const waiting = all.filter((c) => c.status === "pending");
    const decided = all.filter((c) => c.status !== "pending").slice(0, 10);
    const statusName = (s: string | null) => (s ? say(ATT_COLORS[DOT[s as AttStatus] ?? "N"].label, ATT_COLORS[DOT[s as AttStatus] ?? "N"].hi) : "—");
    const mayDecide = can(staff, "attendance:correct");
    return (
      <VxPage>
        {top}
        <Section>
          {tabs}
          {!mayDecide ? (
            <Card style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "var(--warns)", color: "var(--warnfg)" }}>
              <Ic n="lock" size={18} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{say("You can see these requests. Approving them is the office's — the person who approves must hold attendance correction rights.", "आप ये अनुरोध देख सकते हैं। स्वीकार करना कार्यालय का काम है।")}</span>
            </Card>
          ) : null}
          <SecHead>{say(`Waiting · ${waiting.length}`, `प्रतीक्षा में · ${waiting.length}`)}</SecHead>
          {waiting.length === 0 ? <Card><EmptyState icon="checkCircle" title={say("No requests waiting", "कोई अनुरोध नहीं")} style={{ padding: 20 }} /></Card> : null}
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
            {waiting.map((c) => {
              const verdict = canDecide({ hasCorrectPermission: mayDecide, requestedByStaffId: c.requestedById, deciderStaffId: staff.id, status: c.status });
              const from = ATT_COLORS[DOT[(c.fromStatus ?? "present") as AttStatus] ?? "N"];
              const to = ATT_COLORS[DOT[c.toStatus] ?? "N"];
              return (
                <Card key={c.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <strong>{c.studentName}</strong>
                      <span style={{ fontSize: 13, color: "var(--mut)" }}>{c.classLabel} · {shortDay(c.day)}</span>
                    </span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{ago(c.requestedAt)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="pill" style={{ background: from.bg, color: from.fg }}>{statusName(c.fromStatus)}</span>
                    <Ic n="arrowRight" size={16} style={{ color: "var(--mut)" }} />
                    <span className="pill" style={{ background: to.bg, color: to.fg }}>{statusName(c.toStatus)}</span>
                  </div>
                  <blockquote style={{ margin: 0, padding: "8px 12px", borderLeft: "3px solid var(--bd)", background: "var(--s2)", borderRadius: 8, fontSize: 14 }}>
                    “{c.reason}”
                    <span style={{ display: "block", fontSize: 12, color: "var(--mut)", marginTop: 4 }}>— {c.requestedByName}</span>
                  </blockquote>
                  <DecideButtons correctionId={c.id} canDecide={verdict.allowed} reason={verdict.reason ? { en: verdict.reason.en, hi: verdict.reason.hi } : undefined} />
                </Card>
              );
            })}
          </div>
          {decided.length ? (
            <Card pad={false}>
              <div style={{ padding: "16px 16px 8px" }}><CardHead title={say("Decided recently", "हाल में तय")} /></div>
              {decided.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--bd)", fontSize: 14 }}>
                  <Pill tone={c.status === "approved" ? "ok" : "bad"}>{c.status === "approved" ? say("Approved", "स्वीकृत") : say("Declined", "अस्वीकृत")}</Pill>
                  <span style={{ flex: 1, minWidth: 0 }} className="clip">{c.studentName} · {c.classLabel} · {shortDay(c.day)} · {statusName(c.toStatus)}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{c.decidedByName ?? ""}</span>
                </div>
              ))}
            </Card>
          ) : null}
        </Section>
        {sheet}
      </VxPage>
    );
  }

  /* --------------------------------------------------------- register */
  if (view === "register") {
    const classId = firstRegisterClass;
    const sheetData = classId ? await registerSheet(ctx, classId, month) : null;
    const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric" });
    return (
      <VxPage>
        <TopBar crumb={crumb} title={sheetData ? say(`${sheetData.label} register`, `${sheetData.label} रजिस्टर`) : titles.register} mBack={BASE} actions={<>{help}<PrintButton label={{ en: "Print", hi: "प्रिंट" }} /></>} mAction={help} />
        <Section>
          {tabs}
          <form action={BASE} method="get" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <input type="hidden" name="view" value="register" />
            <label className="field" style={{ minWidth: 160 }}>
              <span>{say("Class", "कक्षा")}</span>
              <select className="inp" name="class" defaultValue={classId}>
                {ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{say("Month", "महीना")}</span>
              <input className="inp" type="month" name="month" defaultValue={month} />
            </label>
            <button type="submit" className="tap btn sec">{say("Show", "दिखाएँ")}</button>
          </form>
          {!sheetData ? (
            <EmptyState icon="lock" title={say("No class to show", "दिखाने को कोई कक्षा नहीं")} />
          ) : (
            <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <CardHead title={`${sheetData.label} · ${monthName}`} sub={say(`${sheetData.students.length} children · ${sheetData.savedDays} of ${sheetData.days.length} days saved`, `${sheetData.students.length} बच्चे · ${sheetData.days.length} में ${sheetData.savedDays} दिन सहेजे`)} />
              <div className="hs" style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}>
                  <thead>
                    <tr style={{ color: "var(--mut)" }}>
                      <th style={{ textAlign: "left", padding: "4px 6px", position: "sticky", left: 0, background: "var(--card)" }}>{say("Child", "बच्चा")}</th>
                      {sheetData.days.map((d) => <th key={d} className="num" style={{ padding: "4px 2px", fontWeight: 600 }}>{Number(d.slice(8))}</th>)}
                      <th style={{ textAlign: "right", padding: "4px 6px" }}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheetData.students.map((s) => (
                      <tr key={s.studentId} style={{ borderTop: "1px solid var(--bd)" }}>
                        <th scope="row" style={{ textAlign: "left", padding: "6px", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--card)" }}>
                          <span className="num" style={{ color: "var(--mut)", marginRight: 6 }}>{s.rollNo ?? ""}</span>
                          {s.name}
                        </th>
                        {sheetData.days.map((d) => {
                          const st = s.marks.get(d);
                          const c = ATT_COLORS[st ? DOT[st] : "N"];
                          return (
                            <td key={d} style={{ padding: "2px", textAlign: "center" }} title={`${dayMonth(d)} · ${st ? say(c.label, c.hi) : say("Not marked", "दर्ज नहीं")}`}>
                              <span style={{ display: "inline-flex", width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", background: st ? c.bg : "transparent", color: c.fg, fontSize: 10, fontWeight: 700, border: st ? undefined : "1px dashed var(--bd)" }}>
                                {st === "absent" ? "A" : st === "leave" ? "L" : st === "half_day" ? "½" : st === "late" ? "•" : ""}
                              </span>
                            </td>
                          );
                        })}
                        <td className="num" style={{ textAlign: "right", padding: "6px", fontWeight: 700, color: s.pct !== null && s.pct < 75 ? "var(--bad)" : undefined }}>{s.pct === null ? "—" : Math.round(s.pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12, color: "var(--mut)" }}>
                {(["P", "A", "L", "H", "N"] as const).map((k) => (
                  <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 6, background: k === "N" ? "transparent" : ATT_COLORS[k].bg, border: k === "N" ? "1px dashed var(--bd)" : `1px solid ${ATT_COLORS[k].fg}` }} />
                    {say(ATT_COLORS[k].label, ATT_COLORS[k].hi)}
                  </span>
                ))}
                <span>{say("• late (counted present)", "• देर (उपस्थित गिना)")}</span>
              </div>
            </Card>
          )}
        </Section>
        {sheet}
      </VxPage>
    );
  }

  /* ------------------------------------------------------------ today */
  const filter = props.filter === "not" || props.filter === "marked" ? props.filter : "all";
  const shown = today.classes.filter((c) => (filter === "all" ? true : filter === "not" ? !c.saved : c.saved));
  const t = today.total;
  const totalKids = today.classes.reduce((s, c) => s + c.roll, 0);
  const late = t.late;
  const notMarkedCount = today.notMarked.length;
  const lastSaved = today.activity[0];
  return (
    <VxPage>
      {top}
      <Section>
        {tabs}
        <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <Card style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {today.closed ? (
                <EmptyState icon="calendar" title={say(`School is closed today${today.closed.label ? ` · ${today.closed.label}` : ""}`, `आज विद्यालय बंद है${today.closed.label ? ` · ${today.closed.label}` : ""}`)} style={{ padding: 16 }} />
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <Ring value={today.marked} max={Math.max(1, today.classes.length)} size={112} stroke={11} tone="var(--pri)">
                  <span className="num serif" style={{ fontSize: 26, fontWeight: 700 }}>{today.marked}/{today.classes.length}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("classes", "कक्षाएँ")}</span>
                </Ring>
                <span style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 6 }}>
                  <Pill tone="ok" icon="activity">{say(`Live · ${shortDay(ctx.today)}${lastSaved ? ` · ${clock(lastSaved.at)}` : ""}`, `लाइव · ${shortDay(ctx.today)}`)}</Pill>
                  <h2 className="serif" style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>{say(`${today.marked} of ${today.classes.length} classes marked`, `${today.classes.length} में ${today.marked} कक्षाएँ दर्ज`)}</h2>
                  {notMarkedCount ? <span style={{ color: "var(--mut)", fontSize: 14 }}>{say(`${notMarkedCount} not saved yet: ${today.notMarked.map((c) => `${c.label} (${c.teacherName}${c.teacherAway ? " on leave" : ""})`).join(", ")}`, `${notMarkedCount} अभी सहेजे नहीं: ${today.notMarked.map((c) => `${c.label} (${c.teacherName})`).join(", ")}`)}</span> : <span style={{ color: "var(--ok)", fontWeight: 600 }}>{say("Every class is marked.", "हर कक्षा दर्ज है।")}</span>}
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                  <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600 }}>{say("Present today", "आज उपस्थित")}</span>
                  <span className="num serif" style={{ fontSize: 40, fontWeight: 700, color: "var(--pri)", lineHeight: 1 }}>{today.pct === null ? "—" : `${today.pct}%`}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`${t.present + t.late} of ${t.counted + t.leave} in marked classes`, `दर्ज कक्षाओं में ${t.counted + t.leave} में ${t.present + t.late}`)}</span>
                </span>
              </div>
              <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: "var(--s3)" }} aria-hidden="true">
                <span style={{ width: `${((t.present + t.late) / Math.max(1, totalKids)) * 100}%`, background: "var(--ok)" }} />
                <span style={{ width: `${(t.absent / Math.max(1, totalKids)) * 100}%`, background: "var(--bad)" }} />
                <span style={{ width: `${((t.leave + t.halfDay) / Math.max(1, totalKids)) * 100}%`, background: "var(--warn)" }} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: 13 }}>
                <Legend color="var(--ok)" label={say("Present", "उपस्थित")} value={t.present + t.late} />
                <Legend color="var(--bad)" label={say("Absent", "अनुपस्थित")} value={t.absent} />
                <Legend color="var(--warn)" label={say("Leave", "छुट्टी")} value={t.leave + t.halfDay} />
                <Legend color="var(--s3)" label={say("Not marked", "दर्ज नहीं")} value={today.unmarkedChildren} />
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 220, display: "flex", gap: 10, padding: "10px 14px", borderRadius: 14, background: "var(--s2)", fontSize: 14 }}>
                  <Ic n="info" size={18} style={{ color: "var(--info)" }} />
                  <span>{say("A class counts as marked only after its teacher presses Save. Not marked is never counted as present.", "कक्षा तभी दर्ज मानी जाती है जब शिक्षक सहेजें। दर्ज न होना कभी उपस्थित नहीं गिना जाता।")}</span>
                </span>
                {mayRemind && notMarkedCount ? <Btn variant="pri" big icon="send" href={qs(BASE, { sheet: "remind" })}>{say(`Remind ${notMarkedCount} ${notMarkedCount === 1 ? "teacher" : "teachers"}`, `${notMarkedCount} शिक्षकों को याद दिलाएँ`)}</Btn> : null}
              </div>
            </Card>

            <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
              <Kpi label={<Dot color="var(--ok)" text={say("Present", "उपस्थित")} />} value={t.present + t.late} sub={today.pct === null ? undefined : say(`${today.pct}% of marked`, `दर्ज का ${today.pct}%`)} />
              <Kpi label={<Dot color="var(--bad)" text={say("Absent", "अनुपस्थित")} />} value={t.absent} sub={say(`in ${today.classes.filter((c) => c.tally.absent > 0).length} classes`, `${today.classes.filter((c) => c.tally.absent > 0).length} कक्षाओं में`)} />
              <Kpi label={<Dot color="var(--warn)" text={say("On leave", "छुट्टी पर")} />} value={t.leave} sub={say("with a reason", "कारण सहित")} />
              <Kpi label={<Dot color="var(--info)" text={say("Came late", "देर से आए")} />} value={late} sub={say("counted present", "उपस्थित गिने")} />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 className="sech" style={{ flex: 1 }}>{say("Classes today", "आज की कक्षाएँ")}</h2>
              <nav className="hs" aria-label={say("Filter", "छाँटें")} style={{ display: "flex", gap: 8 }}>
                <Link href={qs(BASE, {})} className={`tap chip${filter === "all" ? " on" : ""}`}>{say("All", "सभी")} <span className="num">{today.classes.length}</span></Link>
                <Link href={qs(BASE, { filter: "not" })} className={`tap chip${filter === "not" ? " on" : ""}`}>{say("Not marked", "दर्ज नहीं")} <span className="num">{notMarkedCount}</span></Link>
                <Link href={qs(BASE, { filter: "marked" })} className={`tap chip${filter === "marked" ? " on" : ""}`}>{say("Marked", "दर्ज")} <span className="num">{today.marked}</span></Link>
              </nav>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
              {shown.map((c, i) => (
                <ClassCard key={c.classId} c={c} i={i} say={say} mayRemind={mayRemind} />
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <CardHead title={say(`Came late today · ${late}`, `आज देर से आए · ${late}`)} sub={say("Counted present · late is noted", "उपस्थित गिने · देर दर्ज")} />
              {today.classes
                .filter((c) => c.tally.late > 0)
                .slice(0, 5)
                .map((c) => (
                  <div key={c.classId} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, paddingTop: 8, borderTop: "1px solid var(--bd)" }}>
                    <span>{c.label}</span>
                    <strong className="num">{say(`${c.tally.late} children`, `${c.tally.late} बच्चे`)}</strong>
                  </div>
                ))}
              {late === 0 ? <span style={{ fontSize: 14, color: "var(--mut)" }}>{say("Nobody late so far.", "अभी तक कोई देर से नहीं।")}</span> : null}
            </Card>
            <Card pad={false}>
              <div style={{ padding: "14px 16px 6px" }}><SecHead>{say("Look closer", "और देखें")}</SecHead></div>
              <LinkCard href={qs(BASE, { view: "month" })} icon="chart" tone="info" title={say("This month", "यह महीना")} sub={say("Every class, every day", "हर कक्षा, हर दिन")} />
              <LinkCard href={qs(BASE, { view: "chronic" })} icon="alert" tone="bad" title={say("Below 75%", "75% से कम")} sub={say(`${chronic.length} children · ${chronic.filter((c) => c.absentLastWeek >= 2).length} absent 2+ days this week`, `${chronic.length} बच्चे`)} />
              <LinkCard href={qs(BASE, { view: "corrections" })} icon="edit" tone="warn" title={say("Change requests", "बदलाव अनुरोध")} sub={say(`${pending} waiting`, `${pending} प्रतीक्षा में`)} />
              {firstRegisterClass ? <LinkCard href={qs(BASE, { view: "register", class: firstRegisterClass })} icon="table" title={say(`${ctx.label(firstRegisterClass)} register`, `${ctx.label(firstRegisterClass)} रजिस्टर`)} sub={say("A dot for every child, every day", "हर बच्चा, हर दिन")} /> : null}
            </Card>
            <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SecHead>{say("Today · who did what", "आज · किसने क्या किया")}</SecHead>
              {today.activity.length === 0 ? <span style={{ fontSize: 14, color: "var(--mut)" }}>{say("Nothing saved yet today.", "आज अभी कुछ सहेजा नहीं।")}</span> : null}
              {today.activity.map((a, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr) auto", gap: 10, alignItems: "baseline", fontSize: 14 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--ok)" }} />
                  <span>{say(a.text.en, a.text.hi)}</span>
                  <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{clock(a.at)}</span>
                </div>
              ))}
            </Card>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{say(`As of ${dateLabel(ctx.today)}.`, `${dateLabel(ctx.today)} तक।`)}</p>
      </Section>
      {sheet}
    </VxPage>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      {label} <strong className="num">{value}</strong>
    </span>
  );
}

function Dot({ color, text }: { color: string; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
      {text}
    </span>
  );
}

function ClassCard({ c, i, say, mayRemind }: { c: Awaited<ReturnType<typeof attendanceOn>>["classes"][number]; i: number; say: Say; mayRemind: boolean }) {
  const style = { padding: 14, display: "flex", flexDirection: "column" as const, gap: 6, animationDelay: `${Math.min(i * 20, 400)}ms` };
  if (!c.saved) {
    return (
      <div className="card rise" style={{ ...style, borderStyle: "dashed" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <strong>{c.label}</strong>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{c.teacherName}{c.teacherAway ? say(" · on leave", " · छुट्टी पर") : ""}</span>
          </span>
          <Ic n="clock" size={20} style={{ color: "var(--mut)" }} />
        </div>
        <span style={{ fontWeight: 600, color: "var(--warnfg)" }}>{say("Not marked yet", "अभी दर्ज नहीं")}</span>
        {c.teacherAway ? (
          <Btn variant="soft" icon="calCheck" href={qs(BASE, { sheet: "mark", class: c.classId })}>{say("Mark for her", "उनकी ओर से दर्ज")}</Btn>
        ) : mayRemind ? (
          <RemindRegistersButton classIds={[c.classId]} label={{ en: "Remind", hi: "याद दिलाएँ" }} variant="sec" icon="bell" />
        ) : null}
      </div>
    );
  }
  const present = c.tally.present + c.tally.late;
  const parts = [c.tally.absent ? say(`${c.tally.absent} absent`, `${c.tally.absent} अनुपस्थित`) : null, c.tally.leave ? say(`${c.tally.leave} leave`, `${c.tally.leave} छुट्टी`) : null, c.tally.late ? say(`${c.tally.late} late`, `${c.tally.late} देर`) : null].filter(Boolean);
  return (
    <Link href={qs(BASE, { view: "register", class: c.classId })} className="card tap lift rise" style={style}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <strong className="clip">{c.label}</strong>
          <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{c.teacherName}{c.onBehalf ? say(" · marked for her", " · उनकी ओर से") : ""}</span>
        </span>
        <span style={{ width: 28, height: 28, borderRadius: 14, background: "var(--oks)", color: "var(--ok)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Ic n="check" size={16} />
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
        <strong className="num">{say(`${present}/${c.roll} present`, `${c.roll} में ${present} उपस्थित`)}</strong>
        <span className="num" style={{ color: "var(--mut)", fontSize: 13 }}>{c.savedAt ? clock(c.savedAt) : ""}</span>
      </div>
      <Progress value={present} max={Math.max(1, c.roll)} height={5} tone="var(--ok)" />
      <span style={{ fontSize: 12, color: "var(--mut)" }}>{parts.length ? parts.join(" · ") : say("Everyone present", "सभी उपस्थित")}</span>
    </Link>
  );
}

