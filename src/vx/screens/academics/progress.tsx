import Link from "next/link";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { ago, dateLabel, initials } from "@/vx/format";
import { Ic } from "@/vx/icons";
import { HelpButton } from "@/vx/ui/overlays";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, Btn, Card, CardHead, EmptyState, Kpi, Pill, Progress, SecHead } from "@/vx/ui/primitives";

import { FollowupButtons, StepToggle } from "./client";
import { academicContext, classDetail, classResults, currentExam, examsOf, needsAttention, staffDirectory, studentDetail, type Exam } from "./data";
import { attentionChips, deltaLabel, marksTone, subjectName, telHref, type AttentionReason } from "./domain";
import { PlanEditor } from "./plan-editor";
import { followLabel } from "./progress-labels";
import { AttentionRow, LinkTabs, qs, sayer } from "./ui";

/*
 * AcadProgress (SCREENS "Academic coordinator · Student progress"): classes
 * and subjects at a glance, one class, one child, compare two classes, the
 * needs-attention list and the support plan editor. States are `?view=`
 * overview (default) | class | student | compare | attention | plan.
 */

type Props = { staff: CurrentStaff; view?: string; exam?: string; classId?: string; studentId?: string; a?: string; b?: string; reason?: string };

const BASE = "/academics/progress";

function examName(e: Exam | null, language: string): string {
  if (!e) return "—";
  return language === "hi" && e.labelHi ? e.labelHi : e.label;
}

export async function AcadProgress(props: Props) {
  const { staff } = props;
  const language = staff.language;
  const say = sayer(language);
  const ctx = await academicContext(staff);
  if (!ctx) {
    return (
      <VxPage>
        <TopBar title={say("Student progress", "विद्यार्थी प्रगति")} />
        <Section><EmptyState title={say("No session is open", "कोई सत्र खुला नहीं है")} /></Section>
      </VxPage>
    );
  }
  const exams = await examsOf(ctx.session);
  const chosen = exams.find((e) => e.code === props.exam) ?? currentExam(exams, ctx.today).current;
  const idx = chosen ? exams.indexOf(chosen) : -1;
  const previous = idx > 0 ? exams[idx - 1] : null;
  const attention = await needsAttention(ctx);
  const view = ["class", "student", "compare", "attention", "plan"].includes(props.view ?? "") ? props.view! : "overview";
  const help = (
    <HelpButton
      title={say("Student progress", "विद्यार्थी प्रगति")}
      steps={[
        { icon: "grid", title: say("Classes at a glance", "एक नज़र में कक्षाएँ"), body: say("Each card is a class's average in the chosen exam; the arrow is the change since the exam before.", "हर कार्ड चुनी परीक्षा में कक्षा का औसत है; तीर पिछली परीक्षा से बदलाव है।") },
        { icon: "users", title: say("One child", "एक बच्चा"), body: say("Open a child to see marks by subject, attendance by month, notes and their support plan.", "बच्चे को खोलें: विषयवार अंक, महीनेवार हाज़िरी, नोट और सहायता योजना।") },
        { icon: "alert", title: say("Needs attention", "ध्यान चाहिए"), body: say("Built by the app every time you open it — nobody has to keep the list by hand.", "हर बार खोलने पर ऐप बनाता है — हाथ से सूची नहीं रखनी।") },
      ]}
    />
  );
  const examQ = chosen ? chosen.code : undefined;
  const tabs = (
    <LinkTabs
      label={say("Views", "दृश्य")}
      current={view === "attention" ? "attention" : view === "compare" ? "compare" : "overview"}
      tabs={[
        { key: "overview", href: qs(BASE, { exam: examQ }), label: say("Classes", "कक्षाएँ") },
        { key: "attention", href: qs(BASE, { view: "attention", exam: examQ }), label: say(`Attention · ${attention.length}`, `ध्यान · ${attention.length}`) },
        { key: "compare", href: qs(BASE, { view: "compare", exam: examQ }), label: say("Compare", "तुलना") },
      ]}
    />
  );
  const examSeg = exams.length ? (
    <LinkTabs
      label={say("Exam", "परीक्षा")}
      current={chosen?.code ?? ""}
      tabs={exams.map((e) => ({ key: e.code, href: qs(BASE, { view: view === "overview" ? undefined : view, exam: e.code, class: props.classId, student: props.studentId, a: props.a, b: props.b }), label: examName(e, language) }))}
    />
  ) : null;
  const topActions = (
    <>
      {help}
      <Btn variant="sec" icon="swap" href={qs(BASE, { view: "compare", exam: examQ })}>{say("Compare classes", "कक्षाओं की तुलना")}</Btn>
      <Btn variant="pri" icon="alert" href={qs(BASE, { view: "attention", exam: examQ })}>{say(`Needs attention · ${attention.length}`, `ध्यान चाहिए · ${attention.length}`)}</Btn>
    </>
  );

  if (!chosen) {
    return (
      <VxPage>
        <TopBar crumb={say("Academics", "शैक्षणिक")} title={say("Student progress", "विद्यार्थी प्रगति")} actions={help} mAction={help} />
        <Section><EmptyState icon="clipboard" title={say("No exam has started yet", "अभी कोई परीक्षा शुरू नहीं हुई")} body={say("Progress appears once marks are entered.", "अंक दर्ज होने पर प्रगति दिखेगी।")} /></Section>
      </VxPage>
    );
  }

  /* ------------------------------------------------------- one child */
  if ((view === "student" || view === "plan") && props.studentId) {
    const child = await studentDetail(ctx, props.studentId);
    if (!child) {
      return (
        <VxPage>
          <TopBar title={say("Student progress", "विद्यार्थी प्रगति")} mBack={BASE} />
          <Section><EmptyState icon="lock" title={say("That child is not in your classes", "यह बच्चा आपकी कक्षाओं में नहीं")} action={<Btn href={BASE}>{say("Back", "वापस")}</Btn>} /></Section>
        </VxPage>
      );
    }
    const staffList = [...(await staffDirectory()).values()].filter((s) => s.is_active && s.is_teaching !== false).map((s) => ({ id: s.id, name: s.display_name })).sort((x, y) => x.name.localeCompare(y.name));
    const backHref = qs(BASE, { view: "student", student: child.studentId, exam: examQ });
    if (view === "plan") {
      const suggestions = [
        ...(child.facts?.below33Subjects ?? []).slice(0, 2).map((s) => say(`Extra ${subjectName(s)} practice twice a week`, `सप्ताह में दो बार ${subjectName(s)} का अतिरिक्त अभ्यास`)),
        ...(child.facts?.reasons.includes("attendance") ? [say("Call the parent about attendance", "हाज़िरी के बारे में अभिभावक से बात")] : []),
        say("Check progress at the next unit test", "अगले यूनिट टेस्ट पर प्रगति देखें"),
      ];
      return (
        <VxPage>
          <TopBar crumb={say(`Student progress · ${child.name}`, `विद्यार्थी प्रगति · ${child.name}`)} title={say("Support plan", "सहायता योजना")} mSub={child.name} mBack={backHref} actions={<>{help}<Btn variant="ghost" icon="chevLeft" href={backHref}>{child.name}</Btn></>} mAction={help} />
          <Section style={{ maxWidth: 860 }}>
            <Card style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar text={initials(child.name)} seed={child.studentId} size={44} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <strong>{child.name}</strong>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{child.classLabel}{child.rollNo ? ` · ${say("Roll", "रोल")} ${child.rollNo}` : ""}</span>
                {child.facts ? <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{attentionChips(child.facts).map((c, i) => <Pill key={i} tone={c.tone}>{say(c.text.en, c.text.hi)}</Pill>)}</span> : null}
              </span>
              {child.plan ? <Pill tone={child.plan.status === "active" ? "ok" : "mut"}>{child.plan.status === "active" ? say("Active", "चालू") : say("Draft", "ड्राफ़्ट")}</Pill> : null}
            </Card>
            <PlanEditor
              studentId={child.studentId}
              studentName={child.name}
              backHref={backHref}
              staff={staffList}
              editable={can(staff, "academics:manage")}
              suggestions={suggestions}
              initial={{ goal: child.plan?.goal ?? "", status: child.plan?.status ?? null, steps: child.plan?.steps.map((s) => ({ id: s.id, text: s.text, ownerId: s.ownerId, due: s.due, done: s.done })) ?? [] }}
            />
          </Section>
        </VxPage>
      );
    }
    const phone = telHref(child.phone);
    const latest = child.exams.filter((e) => child.subjects.some((s) => s.byExam.has(e.id)));
    const shown = latest.slice(-3);
    const lastExam = shown[shown.length - 1];
    const lastAvg = lastExam ? avgOf(child.subjects.map((s) => s.byExam.get(lastExam.id) ?? null)) : null;
    const prevExam = shown[shown.length - 2];
    const prevAvg = prevExam ? avgOf(child.subjects.map((s) => s.byExam.get(prevExam.id) ?? null)) : null;
    const d = deltaLabel(lastAvg, prevAvg);
    const mayFollow = ctx.everyClass;
    return (
      <VxPage>
        <TopBar
          crumb={say(`Student progress · ${child.classLabel}`, `विद्यार्थी प्रगति · ${child.classLabel}`)}
          title={child.name}
          mSub={child.classLabel}
          mBack={qs(BASE, { view: "class", class: child.classId, exam: examQ })}
          actions={
            <>
              {help}
              {phone ? <a className="tap btn sec" href={phone}><Ic n="phone" size={18} />{say("Call parent", "अभिभावक को कॉल")}</a> : null}
              <Btn variant="pri" icon="clipboard" href={qs(BASE, { view: "plan", student: child.studentId, exam: examQ })}>{child.plan ? say("Open support plan", "सहायता योजना खोलें") : say("Make a support plan", "सहायता योजना बनाएँ")}</Btn>
            </>
          }
          mAction={help}
        />
        <Section>
          <Card style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <Avatar text={initials(child.name)} seed={child.studentId} size={56} />
            <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 4 }}>
              <strong style={{ fontSize: 19 }}>{child.name}</strong>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>
                {child.classLabel}
                {child.rollNo ? ` · ${say("Roll", "रोल")} ${child.rollNo}` : ""}
                {child.father ? ` · ${say("Father", "पिता")} ${child.father}` : ""}
              </span>
              {child.facts ? <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{attentionChips(child.facts).map((c, i) => <Pill key={i} tone={c.tone}>{say(c.text.en, c.text.hi)}</Pill>)}</span> : <Pill tone="ok">{say("Not on the attention list", "ध्यान सूची में नहीं")}</Pill>}
            </span>
            <span className="only-m" style={{ display: "flex", gap: 8, width: "100%" }}>
              {phone ? <a className="tap btn sec" style={{ flex: 1 }} href={phone}><Ic n="phone" size={18} />{say("Call", "कॉल")}</a> : null}
              <Btn variant="pri" icon="clipboard" style={{ flex: 1 }} href={qs(BASE, { view: "plan", student: child.studentId, exam: examQ })}>{say("Plan", "योजना")}</Btn>
            </span>
          </Card>

          <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
            <Kpi label={say(`Average · ${examName(lastExam ?? null, language)}`, `औसत · ${examName(lastExam ?? null, language)}`)} value={lastAvg === null ? "—" : `${lastAvg}%`} delta={d.text !== "—" ? d.text : undefined} deltaTone={d.tone === "mut" ? "mut" : d.tone} sub={prevExam ? say(`vs ${examName(prevExam, language)}`, `${examName(prevExam, language)} से`) : undefined} />
            <Kpi label={say("Attendance this term", "इस सत्र की हाज़िरी")} value={child.attendance.pct === null ? "—" : `${Math.round(child.attendance.pct)}%`} tone={child.attendance.pct !== null && child.attendance.pct < 75 ? "var(--bad)" : undefined} sub={say(`${child.attendance.absent} days absent of ${child.attendance.counted}`, `${child.attendance.counted} में ${child.attendance.absent} दिन अनुपस्थित`)} />
            <Kpi label={say("Open notes", "खुले नोट")} value={child.notes.filter((n) => n.status !== "done").length} sub={say(`${child.notes.length} notes this session`, `इस सत्र ${child.notes.length} नोट`)} />
            <Kpi label={say("Support plan", "सहायता योजना")} value={child.plan ? `${child.plan.steps.filter((s) => s.done).length}/${child.plan.steps.length}` : "—"} sub={child.plan ? (child.plan.status === "active" ? say("steps done · active", "कदम पूरे · चालू") : say("draft", "ड्राफ़्ट")) : say("none yet", "अभी नहीं")} />
          </div>

          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <CardHead title={say("Marks by subject", "विषयवार अंक")} sub={say("Percent in each exam · red is below 33%", "हर परीक्षा में प्रतिशत · लाल 33% से कम")} />
                {child.subjects.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--mut)" }}>{say("No marks yet.", "अभी कोई अंक नहीं।")}</p>
                ) : (
                  <div style={{ overflowX: "auto" }} className="hs">
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                      <thead>
                        <tr style={{ color: "var(--mut)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>
                          <th style={{ textAlign: "left", padding: "6px 4px" }}>{say("Subject", "विषय")}</th>
                          {shown.map((e) => <th key={e.id} style={{ textAlign: "right", padding: "6px 4px" }}>{examName(e, language)}</th>)}
                          <th style={{ textAlign: "right", padding: "6px 4px" }}>{say("Change", "बदलाव")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {child.subjects.map((s) => {
                          const now = lastExam ? s.byExam.get(lastExam.id) ?? null : null;
                          const before = prevExam ? s.byExam.get(prevExam.id) ?? null : null;
                          const dd = deltaLabel(now, before);
                          return (
                            <tr key={s.subject} style={{ borderTop: "1px solid var(--bd)" }}>
                              <td style={{ padding: "10px 4px", fontWeight: 600 }}>{subjectName(s.subject)}</td>
                              {shown.map((e) => {
                                const v = s.byExam.get(e.id) ?? null;
                                return <td key={e.id} className="num" style={{ textAlign: "right", padding: "10px 4px", color: v !== null && v < 33 ? "var(--bad)" : undefined, fontWeight: v !== null && v < 33 ? 700 : 500 }}>{v === null ? "—" : `${v}%`}</td>;
                              })}
                              <td style={{ textAlign: "right", padding: "10px 4px" }}><Pill tone={dd.tone === "mut" ? "mut" : dd.tone}>{dd.text}</Pill></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <CardHead title={say("Attendance by month", "महीनेवार हाज़िरी")} sub={say("Below 75% is marked red", "75% से कम लाल")} />
                <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 140 }}>
                  {child.months.map((m) => (
                    <span key={m.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
                      <span className="num" style={{ fontSize: 12, fontWeight: 700 }}>{m.pct === null ? "—" : Math.round(m.pct)}</span>
                      <span style={{ width: "70%", maxWidth: 46, height: `${Math.max(4, (m.pct ?? 0) * 0.9)}px`, borderRadius: 8, background: m.pct !== null && m.pct < 75 ? "var(--bad)" : "var(--pri)" }} />
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{new Date(`${m.month}-15T12:00:00Z`).toLocaleString("en-IN", { month: "short" })}</span>
                    </span>
                  ))}
                  {child.months.length === 0 ? <p style={{ margin: 0, color: "var(--mut)" }}>{say("No registers yet.", "अभी कोई रजिस्टर नहीं।")}</p> : null}
                </div>
              </Card>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <Card style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <CardHead
                  title={say("Support plan", "सहायता योजना")}
                  sub={child.plan?.goal ?? say("No plan yet", "अभी कोई योजना नहीं")}
                  action={<Btn variant="ghost" href={qs(BASE, { view: "plan", student: child.studentId, exam: examQ })}>{child.plan ? say("Edit", "बदलें") : say("Make one", "बनाएँ")}</Btn>}
                />
                {child.plan?.steps.map((s) => (
                  <StepToggle key={s.id} stepId={s.id} done={s.done} disabled={!can(staff, "academics:manage")}>
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <span>{s.text}</span>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{[s.owner, s.due].filter(Boolean).join(" · ")}</span>
                    </span>
                  </StepToggle>
                ))}
              </Card>
              {mayFollow ? (
                <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <CardHead title={say("Follow-up", "फ़ॉलो-अप")} sub={child.followups[0] ? say(`Last: ${followLabel(child.followups[0].kind, child.followups[0].outcome, say)} · ${child.followups[0].by} · ${ago(child.followups[0].at)}`, `पिछला: ${followLabel(child.followups[0].kind, child.followups[0].outcome, say)} · ${child.followups[0].by}`) : say("Nothing recorded yet", "अभी कुछ दर्ज नहीं")} />
                  <FollowupButtons studentId={child.studentId} staff={staffList} />
                </Card>
              ) : null}
              <Card pad={false}>
                <div style={{ padding: "16px 16px 8px" }}>
                  <CardHead title={say("Notes from teachers", "शिक्षकों के नोट")} action={<Btn variant="ghost" href="/notes">{say("All notes", "सभी नोट")}</Btn>} />
                </div>
                {child.notes.length === 0 ? <p style={{ margin: 0, padding: "0 16px 16px", color: "var(--mut)" }}>{say("No notes.", "कोई नोट नहीं।")}</p> : null}
                {child.notes.slice(0, 6).map((n) => (
                  <div key={n.id} style={{ padding: "10px 16px", borderTop: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <Pill tone={n.tone === "concern" ? "warn" : n.tone === "good" ? "ok" : "mut"}>{n.kind}</Pill>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{n.by} · {ago(n.at)}</span>
                      {n.status !== "done" ? <Pill tone="acc">{n.status === "working" ? say("Working", "चल रहा") : say("Open", "खुला")}</Pill> : null}
                    </span>
                    <span style={{ fontSize: 14 }}>{n.body}</span>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </Section>
      </VxPage>
    );
  }

  /* -------------------------------------------------------- attention */
  if (view === "attention") {
    const reasons: { key: AttentionReason; label: string }[] = [
      { key: "attendance", label: say("Attendance < 75%", "हाज़िरी < 75%") },
      { key: "below_33", label: say("Below 33%", "33% से कम") },
      { key: "dropped", label: say("Marks dropped", "अंक गिरे") },
      { key: "notes", label: say("Open notes", "खुले नोट") },
    ];
    const filter = reasons.find((r) => r.key === props.reason)?.key;
    const list = filter ? attention.filter((a) => a.reasons.includes(filter)) : attention;
    return (
      <VxPage>
        <TopBar crumb={say("Academics · Student progress", "शैक्षणिक · विद्यार्थी प्रगति")} title={say(`Needs attention · ${attention.length}`, `ध्यान चाहिए · ${attention.length}`)} mBack={BASE} actions={topActions} mAction={help} />
        <Section>
          {tabs}
          <Card style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "var(--s2)" }}>
            <Ic n="info" size={18} style={{ color: "var(--info)", marginTop: 2 }} />
            <span style={{ fontSize: 14 }}>{say("Built by the app from four rules: attendance below 75%, below 33% in a subject's latest paper, marks dropped 15 points or more since the paper before, or 2 or more open notes.", "चार नियमों से ऐप ने बनाई: 75% से कम हाज़िरी, किसी विषय में 33% से कम, पिछले पेपर से 15+ अंक गिरे, या 2+ खुले नोट।")}</span>
          </Card>
          <nav className="hs" aria-label={say("Filter", "छाँटें")} style={{ display: "flex", gap: 8 }}>
            <Link href={qs(BASE, { view: "attention", exam: examQ })} className={`tap chip${!filter ? " on" : ""}`} aria-current={!filter ? "page" : undefined}>{say("All", "सभी")} <span className="num">{attention.length}</span></Link>
            {reasons.map((r) => (
              <Link key={r.key} href={qs(BASE, { view: "attention", reason: r.key, exam: examQ })} className={`tap chip${filter === r.key ? " on" : ""}`} aria-current={filter === r.key ? "page" : undefined}>
                {r.label} <span className="num">{attention.filter((a) => a.reasons.includes(r.key)).length}</span>
              </Link>
            ))}
          </nav>
          <Card pad={false}>
            {list.length === 0 ? <EmptyState icon="smile" title={say("Nobody here", "यहाँ कोई नहीं")} /> : null}
            {list.map((child, i) => (
              <div key={child.studentId} style={{ position: "relative" }}>
                <AttentionRow
                  child={child}
                  language={language}
                  href={qs(BASE, { view: "student", student: child.studentId, exam: examQ })}
                  delay={i * 20}
                  trail={
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, fontSize: 12, color: "var(--mut)", textAlign: "right", maxWidth: 180 }}>
                      {child.plan ? <Pill tone={child.plan === "active" ? "ok" : "mut"}>{child.plan === "active" ? say("Plan active", "योजना चालू") : say("Plan draft", "योजना ड्राफ़्ट")}</Pill> : null}
                      {child.followup ? <span>{followLabel(child.followup.kind, child.followup.outcome, say)} · {ago(child.followup.at)}</span> : <span>{say("No follow-up yet", "अभी कोई फ़ॉलो-अप नहीं")}</span>}
                    </span>
                  }
                />
              </div>
            ))}
          </Card>
          {ctx.everyClass && list[0] ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
              {say("Open a child to mark them improving, assign a follow-up or start a support plan.", "बच्चे को खोलकर सुधार चिह्नित करें, फ़ॉलो-अप सौंपें या सहायता योजना शुरू करें।")}
            </p>
          ) : null}
        </Section>
      </VxPage>
    );
  }

  const results = await classResults(ctx, chosen, previous);

  /* ----------------------------------------------------------- compare */
  if (view === "compare") {
    const a = ctx.classes.find((c) => c.id === props.a) ?? ctx.classes[Math.max(0, ctx.classes.length - 5)];
    const b = ctx.classes.find((c) => c.id === props.b && c.id !== a?.id) ?? ctx.classes.find((c) => c.id !== a?.id && c.label.split(" ")[1] === a?.label.split(" ")[1]) ?? ctx.classes.find((c) => c.id !== a?.id);
    const subjectsOf = (classId: string) => results.stats.filter((s) => s.classId === classId);
    const names = [...new Set([...(a ? subjectsOf(a.id) : []), ...(b ? subjectsOf(b.id) : [])].map((s) => s.subject))];
    const ra = results.classes.find((c) => c.classId === a?.id);
    const rb = results.classes.find((c) => c.classId === b?.id);
    return (
      <VxPage>
        <TopBar crumb={say("Academics · Student progress", "शैक्षणिक · विद्यार्थी प्रगति")} title={say("Compare classes", "कक्षाओं की तुलना")} mBack={BASE} actions={topActions} mAction={help} />
        <Section>
          {tabs}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>{examSeg}</div>
          <form action={BASE} method="get" className="card" style={{ padding: 16, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <input type="hidden" name="view" value="compare" />
            <input type="hidden" name="exam" value={chosen.code} />
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              <span>{say("First class", "पहली कक्षा")}</span>
              <select className="inp" name="a" defaultValue={a?.id}>
                {ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              <span>{say("Second class", "दूसरी कक्षा")}</span>
              <select className="inp" name="b" defaultValue={b?.id}>
                {ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <button type="submit" className="tap btn pri"><Ic n="swap" size={18} />{say("Compare", "तुलना करें")}</button>
          </form>
          {a && b ? (
            <>
              <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
                {[ra, rb].map((r, i) => (
                  <Card key={i} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `4px solid ${i === 0 ? "var(--pri)" : "var(--acc)"}` }}>
                    <strong style={{ fontSize: 17 }}>{r?.label}</strong>
                    <span className="num" style={{ fontSize: 28, fontWeight: 700 }}>{r?.avg ?? "—"}%</span>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>{say(`Pass ${r?.pass ?? "—"}% · Att. ${r?.attendance ?? "—"}%`, `पास ${r?.pass ?? "—"}% · हाज़िरी ${r?.attendance ?? "—"}%`)}</span>
                  </Card>
                ))}
              </div>
              <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <CardHead title={say("Subject by subject", "विषयवार")} sub={say(`${examName(chosen, language)} averages`, `${examName(chosen, language)} औसत`)} />
                {names.map((name) => {
                  const va = subjectsOf(a.id).find((s) => s.subject === name)?.avgPct ?? null;
                  const vb = subjectsOf(b.id).find((s) => s.subject === name)?.avgPct ?? null;
                  return (
                    <div key={name} style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", gap: 12, alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--bd)" }}>
                      <strong>{subjectName(name)}</strong>
                      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 44px", gap: 8, alignItems: "center" }}><Progress value={va ?? 0} max={100} tone="var(--pri)" /><span className="num" style={{ textAlign: "right", fontSize: 13 }}>{va === null ? "—" : Math.round(va)}</span></span>
                        <span style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 44px", gap: 8, alignItems: "center" }}><Progress value={vb ?? 0} max={100} tone="var(--acc)" /><span className="num" style={{ textAlign: "right", fontSize: 13 }}>{vb === null ? "—" : Math.round(vb)}</span></span>
                      </span>
                    </div>
                  );
                })}
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--mut)" }}>
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><span style={{ width: 12, height: 12, borderRadius: 4, background: "var(--pri)" }} />{a.label}</span>
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><span style={{ width: 12, height: 12, borderRadius: 4, background: "var(--acc)" }} />{b.label}</span>
                </div>
              </Card>
            </>
          ) : (
            <EmptyState title={say("Choose two classes", "दो कक्षाएँ चुनें")} />
          )}
        </Section>
      </VxPage>
    );
  }

  /* ------------------------------------------------------- one class */
  if (view === "class" && props.classId) {
    const detail = await classDetail(ctx, props.classId, chosen, previous);
    if (!detail) {
      return (
        <VxPage>
          <TopBar title={say("Student progress", "विद्यार्थी प्रगति")} mBack={BASE} />
          <Section><EmptyState icon="lock" title={say("That class is not yours", "वह कक्षा आपकी नहीं")} action={<Btn href={BASE}>{say("Back", "वापस")}</Btn>} /></Section>
        </VxPage>
      );
    }
    const r = results.classes.find((c) => c.classId === detail.classId);
    const d = deltaLabel(r?.avg ?? null, r?.before ?? null);
    const flagged = detail.students.filter((s) => s.attention);
    return (
      <VxPage>
        <TopBar crumb={say("Academics · Student progress", "शैक्षणिक · विद्यार्थी प्रगति")} title={detail.label} mSub={examName(chosen, language)} mBack={qs(BASE, { exam: examQ })} actions={<>{help}<Btn variant="sec" icon="swap" href={qs(BASE, { view: "compare", a: detail.classId, exam: examQ })}>{say("Compare", "तुलना")}</Btn><Btn variant="sec" icon="calCheck" href={`/academics/attendance?view=register&class=${detail.classId}`}>{say("Register", "रजिस्टर")}</Btn></>} mAction={help} />
        <Section>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>{examSeg}</div>
          <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
            <Kpi label={say("Class average", "कक्षा औसत")} value={r?.avg === null || r?.avg === undefined ? "—" : `${r.avg}%`} delta={d.text !== "—" ? d.text : undefined} deltaTone={d.tone === "mut" ? "mut" : d.tone} sub={previous ? say(`vs ${examName(previous, language)}`, `${examName(previous, language)} से`) : undefined} />
            <Kpi label={say("Passed every subject", "सभी विषयों में पास")} value={detail.pass === null ? "—" : `${detail.pass}%`} sub={say(`${detail.roll} children`, `${detail.roll} बच्चे`)} />
            <Kpi label={say("Attendance this term", "इस सत्र की हाज़िरी")} value={detail.attendance === null ? "—" : `${detail.attendance}%`} />
            <Kpi label={say("Needs attention", "ध्यान चाहिए")} value={flagged.length} tone={flagged.length ? "var(--bad)" : undefined} />
          </div>
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 16, alignItems: "start" }}>
            <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <CardHead title={say("Subjects", "विषय")} sub={say("Average · change since the exam before", "औसत · पिछली परीक्षा से बदलाव")} />
              {detail.subjects.map((s) => {
                const dd = deltaLabel(s.avg, s.before);
                return (
                  <div key={s.subject} style={{ display: "grid", gridTemplateColumns: "100px minmax(0,1fr) 40px 56px", gap: 10, alignItems: "center", fontSize: 14 }}>
                    <strong className="clip">{subjectName(s.subject)}</strong>
                    <Progress value={s.avg ?? 0} max={100} tone={s.avg !== null && s.avg < 40 ? "var(--bad)" : s.avg !== null && s.avg < 55 ? "var(--warn)" : "var(--pri)"} />
                    <span className="num" style={{ textAlign: "right", fontWeight: 700 }}>{s.avg ?? "—"}</span>
                    <Pill tone={dd.tone === "mut" ? "mut" : dd.tone}>{dd.text}</Pill>
                  </div>
                );
              })}
              {detail.subjects.length === 0 ? <p style={{ margin: 0, color: "var(--mut)" }}>{say("No papers for this exam.", "इस परीक्षा के पेपर नहीं।")}</p> : null}
            </Card>
            <Card pad={false}>
              <div style={{ padding: "16px 16px 8px" }}><CardHead title={say("Children · lowest first", "बच्चे · सबसे कम पहले")} /></div>
              {detail.students.map((s, i) => {
                const dd = deltaLabel(s.avg, s.before);
                return (
                  <Link key={s.studentId} href={qs(BASE, { view: "student", student: s.studentId, exam: examQ })} className="row tap" style={{ display: "grid", gridTemplateColumns: "36px minmax(0,1fr) 54px 54px 56px", gap: 10, alignItems: "center", padding: "10px 16px", borderTop: "1px solid var(--bd)", animation: `xIn .32s var(--ease) ${Math.min(i * 15, 400)}ms both` }}>
                    <Avatar text={initials(s.name)} seed={s.studentId} size={34} />
                    <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <strong className="clip">{s.name}</strong>
                      <span className="clip" style={{ fontSize: 12, color: s.attention ? "var(--bad)" : "var(--mut)" }}>{s.attention ? attentionChips(s.attention).map((c) => say(c.text.en, c.text.hi)).join(" · ") : s.rollNo ? `${say("Roll", "रोल")} ${s.rollNo}` : ""}</span>
                    </span>
                    <span className="num" style={{ textAlign: "right", fontWeight: 700, color: s.avg !== null && s.avg < 33 ? "var(--bad)" : undefined }}>{s.avg === null ? "—" : `${s.avg}%`}</span>
                    <span className="num" style={{ textAlign: "right", fontSize: 13, color: s.attention?.reasons.includes("attendance") ? "var(--bad)" : "var(--mut)" }}>{s.attendance === null ? "—" : `${Math.round(s.attendance)}%`}</span>
                    <span style={{ textAlign: "right" }}><Pill tone={dd.tone === "mut" ? "mut" : dd.tone}>{dd.text}</Pill></span>
                  </Link>
                );
              })}
            </Card>
          </div>
        </Section>
      </VxPage>
    );
  }

  /* ---------------------------------------------------------- overview */
  const withAvg = results.classes.filter((c) => c.avg !== null);
  const schoolAvg = withAvg.length ? Math.round(withAvg.reduce((s, c) => s + (c.avg ?? 0), 0) / withAvg.length) : null;
  const beforeVals = results.classes.filter((c) => c.before !== null);
  const schoolBefore = beforeVals.length ? Math.round(beforeVals.reduce((s, c) => s + (c.before ?? 0), 0) / beforeVals.length) : null;
  const attVals = results.classes.filter((c) => c.attendance !== null);
  const schoolAtt = attVals.length ? Math.round(attVals.reduce((s, c) => s + (c.attendance ?? 0), 0) / attVals.length) : null;
  const d = deltaLabel(schoolAvg, schoolBefore);
  const enteredNote = results.stats.length ? Math.round((results.stats.filter((s) => s.submitted).length / results.stats.length) * 100) : 0;
  const subjects = [...new Set(results.stats.map((s) => s.subject))];
  const heatClasses = ctx.classes.filter((c) => results.stats.some((s) => s.classId === c.id));

  return (
    <VxPage>
      <TopBar crumb={say(`Academics · Session ${ctx.session}`, `शैक्षणिक · सत्र ${ctx.session}`)} title={say("Student progress", "विद्यार्थी प्रगति")} actions={topActions} mAction={help} />
      <Section>
        {tabs}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {examSeg}
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{say(`${examName(chosen, language)}: ${enteredNote}% of papers submitted — averages use marks entered so far.`, `${examName(chosen, language)}: ${enteredNote}% पेपर जमा — औसत अब तक दर्ज अंकों से।`)}</span>
        </div>
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
          <Kpi label={say("School average", "विद्यालय औसत")} value={schoolAvg === null ? "—" : `${schoolAvg}%`} delta={d.text !== "—" && previous ? `${d.text} vs ${previous.code}` : undefined} deltaTone={d.tone === "mut" ? "mut" : d.tone} sub={examName(chosen, language)} />
          <Kpi label={say("Passed every subject", "सभी विषयों में पास")} value={results.studentPass === null ? "—" : `${results.studentPass}%`} sub={results.lowest ? say(`Lowest ${results.lowest.label} ${results.lowest.pass}%`, `सबसे कम ${results.lowest.label} ${results.lowest.pass}%`) : undefined} />
          <Kpi label={say("Attendance this term", "इस सत्र की हाज़िरी")} value={schoolAtt === null ? "—" : `${schoolAtt}%`} sub={say("all classes", "सभी कक्षाएँ")} />
          <Kpi label={say("Needs attention", "ध्यान चाहिए")} value={attention.length} tone="var(--bad)" href={qs(BASE, { view: "attention", exam: examQ })} sub={say("built by the app", "ऐप ने बनाई")} />
        </div>
        <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <CardHead title={say("Class by class", "कक्षावार")} sub={say(`${examName(chosen, language)} · average, pass % and attendance · arrow = change since ${examName(previous, language)}`, `${examName(chosen, language)} · औसत, पास % और हाज़िरी`)} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {results.classes.map((c, i) => {
              const dd = deltaLabel(c.avg, c.before);
              return (
                <Link key={c.classId} href={qs(BASE, { view: "class", class: c.classId, exam: examQ })} className="card tap lift rise" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, animationDelay: `${Math.min(i * 25, 400)}ms` }}>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <strong className="clip" style={{ fontSize: 14 }}>{c.label}</strong>
                    <Pill tone={dd.tone === "mut" ? "mut" : dd.tone}>{dd.text}</Pill>
                  </span>
                  <span className="num" style={{ fontSize: 26, fontWeight: 700 }}>{c.avg === null ? "—" : `${c.avg}%`}</span>
                  <Progress value={c.avg ?? 0} max={100} height={5} tone={c.avg !== null && c.avg < 60 ? "var(--warn)" : "var(--pri)"} />
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`Pass ${c.pass ?? "—"}% · Att. ${c.attendance ?? "—"}%`, `पास ${c.pass ?? "—"}% · हाज़िरी ${c.attendance ?? "—"}%`)}</span>
                </Link>
              );
            })}
          </div>
        </Card>
        {subjects.length ? (
          <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SecHead>{say("Subjects across classes", "कक्षाओं में विषय")}</SecHead>
            <div className="hs" style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 4, fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", color: "var(--mut)", fontSize: 11 }}>{say("Subject", "विषय")}</th>
                    {heatClasses.map((c) => <th key={c.id} style={{ color: "var(--mut)", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{c.label.replace(/^Class /, "")}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((name) => (
                    <tr key={name}>
                      <th scope="row" style={{ textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", paddingRight: 8 }}>{subjectName(name)}</th>
                      {heatClasses.map((c) => {
                        const s = results.stats.find((x) => x.classId === c.id && x.subject === name);
                        const v = s?.avgPct === null || s?.avgPct === undefined ? null : Math.round(s.avgPct);
                        const tone = marksTone(v);
                        return (
                          <td key={c.id} style={{ padding: 0 }}>
                            {s ? (
                              <Link href={qs(BASE, { view: "class", class: c.id, exam: examQ })} className="tap num" title={`${c.label} · ${subjectName(name)}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 32, minWidth: 44, borderRadius: 8, background: tone.bg, color: tone.fg, fontWeight: 700 }}>{v ?? "·"}</Link>
                            ) : <span style={{ display: "block", minWidth: 44 }} />}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
        <Card pad={false} className="only-m">
          <div style={{ padding: "16px 16px 8px" }}><CardHead title={say(`Needs attention · ${attention.length}`, `ध्यान चाहिए · ${attention.length}`)} /></div>
          {attention.slice(0, 4).map((child) => <AttentionRow key={child.studentId} child={child} language={language} href={qs(BASE, { view: "student", student: child.studentId, exam: examQ })} />)}
        </Card>
        <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{say(`Updated ${dateLabel(ctx.today)} · teachers see only their own classes here.`, `${dateLabel(ctx.today)} अपडेट · शिक्षक यहाँ केवल अपनी कक्षाएँ देखते हैं।`)}</p>
      </Section>
    </VxPage>
  );
}

function avgOf(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
}


