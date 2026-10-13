import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import type { Language } from "@/platform/i18n/language";
import { agoP } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { HelpButton } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";
import { Btn, EmptyState, Pill } from "@/vx/ui/primitives";

import { FollowupButtons, StepToggle } from "./client";
import type { AttentionChild, ClassDetail, ClassRef, ClassResult, StudentDetail } from "./data";
import { attentionChips, deltaLabel, heatBand, HEAT_LEGEND, spreadBands, subjectName, telHref, type AttentionReason } from "./domain";
import { PlanEditor } from "./plan-editor";
import { followLabel } from "./progress-labels";
import { CoordTop, dayName, nameInitials, qs, sayer, toneOf, ToneAvatar, type Say } from "./ui";

/*
 * AcadProgress (SCREENS "Academic coordinator · Student progress"), drawn
 * from props: classes and subjects at a glance, one class, one child, compare
 * two classes, the needs-attention list and the support plan. Each state is a
 * URL (`?view=` overview | class | student | compare | attention | plan).
 */

const BASE = "/academics/progress";

export type ExamTab = { code: string; label: string };
export type HeatStat = { classId: string; subject: string; sortOrder: number; avg: number | null; entered: number };

type Common = {
  language: Language;
  today: string;
  session: string;
  exams: ExamTab[];
  exam: ExamTab | null;
  previous: ExamTab | null;
  /** Share of the chosen exam's papers submitted, for the note beside the exam switch. */
  entered: number;
  attentionCount: number;
  mayManage: boolean;
  mayFollow: boolean;
  notesHref: string | null;
};

export type AcadProgressProps = Common &
  (
    | { view: "empty" }
    | { view: "overview"; classes: ClassResult[]; school: { avg: number | null; before: number | null; pass: number | null; lowest: { label: string; pass: number | null } | null; att: number | null }; stats: HeatStat[]; group: "junior" | "senior"; attention: AttentionChild[] }
    | { view: "class"; detail: ClassDetail; result: ClassResult | null; nav: { prev: ClassRef; next: ClassRef; pos: number; total: number }; marks: { studentId: string; subject: string; pct: number }[]; people: { classTeacher: string | null; bySubject: Record<string, string>; locked: boolean; notes: { total: number; followUp: number } } }
    | { view: "student"; child: StudentDetail; classTeacher: { name: string; phone: string | null } | null; hl: string | null }
    | { view: "compare"; classes: ClassRef[]; a: ClassRef; b: ClassRef; results: ClassResult[]; stats: { classId: string; subject: string; avg: number | null }[]; attentionBy: Record<string, number> }
    | { view: "attention"; list: AttentionChild[]; filter: AttentionReason | "improving" | null; staff: { id: string; name: string }[] }
    | { view: "plan"; child: StudentDetail; staff: { id: string; name: string }[]; suggestions: string[]; father: string | null; parentPhone: string | null }
    | { view: "missing"; what: "class" | "student" }
  );

const R = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v)}%`);

function examQ(p: Common) {
  return p.exam?.code;
}

/* ------------------------------------------------------------ small parts */

function Sec({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", minWidth: 0, ...style }}>
      {children}
    </section>
  );
}

function Title({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{children}</span>
        {sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span> : null}
      </span>
      {right}
    </div>
  );
}

function SegLinks({ tabs, current, width, label, style }: { tabs: { key: string; href: string; label: string }[]; current: string; width: number; label: string; style?: CSSProperties }) {
  const at = Math.max(0, tabs.findIndex((t) => t.key === current));
  return (
    <nav aria-label={label} className="seg mfull" style={{ gridTemplateColumns: `repeat(${tabs.length},minmax(0,1fr))`, width, maxWidth: "100%", ...style }}>
      <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${tabs.length})`, transform: `translateX(${at * 100}%)` }} />
      {tabs.map((t) => {
        const on = t.key === current;
        return (
          <Link key={t.key} href={t.href} scroll={false} className="tap" aria-current={on ? "page" : undefined} style={{ position: "relative", height: 34, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 8px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: on ? "var(--fg)" : "var(--mut)" }}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function TrendPill({ now, before }: { now: number | null; before: number | null }) {
  const d = deltaLabel(now, before);
  const tone = d.tone === "ok" ? ["var(--oks)", "var(--ok)"] : d.tone === "bad" ? ["var(--bads)", "var(--bad)"] : ["var(--s2)", "var(--mut)"];
  return (
    <span className="pill num" style={{ background: tone[0], color: tone[1] }}>
      {d.text}
    </span>
  );
}

function Bar({ pct, tone, height = 5, style }: { pct: number; tone: string; height?: number; style?: CSSProperties }) {
  return (
    <span style={{ display: "flex", height, borderRadius: 4, background: "var(--s3)", overflow: "hidden", width: "100%", ...style }}>
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", borderRadius: 4, background: tone, transformOrigin: "left", animation: "xGrowX .7s var(--ease) both" }} />
    </span>
  );
}

function Note({ icon = "info", tone = "info", children, style }: { icon?: IconName; tone?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--s2)", alignItems: "flex-start", ...style }}>
      <Ic n={icon} size={18} style={{ flex: "none", marginTop: 1, color: `var(--${tone})` }} />
      <span>{children}</span>
    </div>
  );
}

const PAD: CSSProperties = { padding: "20px 28px 40px", display: "flex", flexDirection: "column", gap: 16 };
const STACK = (a: string, b: string): CSSProperties => ({ display: "grid", gridTemplateColumns: `minmax(0,${a}) minmax(0,${b})`, gap: 16, alignItems: "start" });

/* ---------------------------------------------------------------- the view */

export function AcadProgressView(p: AcadProgressProps) {
  const say = sayer(p.language);
  const q = examQ(p);
  const help = (
    <HelpButton
      title={say("Student progress", "छात्र प्रगति")}
      steps={[
        { icon: "grid", title: say("Classes at a glance", "एक नज़र में कक्षाएँ"), body: say("Each card is a class's average in the chosen exam; the arrow is the change since the exam before.", "हर कार्ड चुनी परीक्षा में कक्षा का औसत है; तीर पिछली परीक्षा से बदलाव है।") },
        { icon: "users", title: say("One child", "एक बच्चा"), body: say("Open a child to see marks by subject, attendance by month, notes and their support plan.", "बच्चे को खोलें: विषयवार अंक, महीनेवार हाज़िरी, नोट और सहायता योजना।") },
        { icon: "alert", title: say("Needs attention", "ध्यान दें"), body: say("Built by the app every time you open it — nobody has to keep the list by hand.", "हर बार खोलने पर ऐप बनाता है — हाथ से सूची नहीं रखनी।") },
      ]}
    />
  );
  const tabs = (current: string) => (
    <div className="pad" style={{ padding: "16px 28px 0" }}>
      <SegLinks
        label={say("Views", "दृश्य")}
        current={current}
        width={520}
        tabs={[
          { key: "overview", href: qs(BASE, { exam: q }), label: say("Classes", "कक्षाएँ") },
          { key: "attention", href: qs(BASE, { view: "attention", exam: q }), label: say(`Attention · ${p.attentionCount}`, `ध्यान दें · ${p.attentionCount}`) },
          { key: "compare", href: qs(BASE, { view: "compare", exam: q }), label: say("Compare", "तुलना") },
        ]}
      />
    </div>
  );
  const examSeg = (extra: Record<string, string | undefined>) =>
    p.exams.length && p.exam ? (
      <div className="pad" style={{ padding: "14px 28px 0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <SegLinks label={say("Exam", "परीक्षा")} current={p.exam.code} width={Math.min(560, 140 * p.exams.length)} tabs={p.exams.map((e) => ({ key: e.code, href: qs(BASE, { ...extra, exam: e.code }), label: e.label }))} style={{ flex: "none" }} />
        <span style={{ flex: 1, minWidth: 220, fontSize: 12, color: "var(--mut)" }}>
          {p.entered >= 100 ? say(`${p.exam.label} · every paper is in.`, `${p.exam.label} · सभी पेपर आ गए।`) : say(`${p.exam.label} is ${p.entered}% entered — averages use marks entered so far.`, `${p.exam.label} ${p.entered}% भरा गया — औसत अब तक भरे अंकों से।`)}
        </span>
      </div>
    ) : null;
  const menuBack = "/academics?view=menu";

  if (p.view === "empty" || p.view === "missing") {
    return (
      <VxPage>
        <CoordTop crumb={say("Academics", "शैक्षणिक")} title={say("Student progress", "छात्र प्रगति")} mBack={p.view === "missing" ? BASE : menuBack} actions={help} mAction={help} />
        <main>
          <div className="pad" style={PAD}>
            {p.view === "empty" ? (
              <EmptyState icon="clipboard" title={say("No exam has started yet", "अभी कोई परीक्षा शुरू नहीं हुई")} body={say("Progress appears once marks are entered.", "अंक भरे जाने पर प्रगति दिखेगी।")} />
            ) : (
              <EmptyState icon="lock" title={p.what === "class" ? say("That class is not yours", "वह कक्षा आपकी नहीं") : say("That child is not in your classes", "यह बच्चा आपकी कक्षाओं में नहीं")} action={<Btn href={BASE}>{say("Back", "वापस")}</Btn>} />
            )}
          </div>
        </main>
      </VxPage>
    );
  }

  /* ------------------------------------------------------------ overview */
  if (p.view === "overview") {
    // One decimal, as the design writes the school's change ("▼ 0.5 vs UT 1").
    const diff = p.school.avg !== null && p.school.before !== null ? Math.round((p.school.avg - p.school.before) * 10) / 10 : null;
    const kpis: { l: string; v: string; pill: string | null; tone: [string, string]; sub: string; color?: string; href?: string }[] = [
      { l: say("School average", "विद्यालय औसत"), v: R(p.school.avg), pill: p.previous && diff !== null ? `${diff > 0 ? "▲" : diff < 0 ? "▼" : "＝"} ${Math.abs(diff)} vs ${p.previous.label}` : p.previous ? null : say("First exam", "पहली परीक्षा"), tone: diff !== null && diff < 0 ? ["var(--bads)", "var(--bad)"] : ["var(--oks)", "var(--ok)"], sub: p.exam?.label ?? "" },
      { l: say("Passed every subject", "सभी विषयों में पास"), v: R(p.school.pass), pill: p.school.lowest ? say(`Lowest ${p.school.lowest.label} ${R(p.school.lowest.pass)}`, `सबसे कम ${p.school.lowest.label} ${R(p.school.lowest.pass)}`) : null, tone: ["var(--warns)", "var(--warnfg)"], sub: "" },
      { l: say("Attendance this term", "इस सत्र की हाज़िरी"), v: R(p.school.att), pill: say(`till ${dayName(p.today).split(" ").slice(1).join(" ")}`, `${dayName(p.today).split(" ").slice(1).join(" ")} तक`), tone: ["var(--oks)", "var(--ok)"], sub: say("all classes", "सभी कक्षाएँ") },
      { l: say("Needs attention", "ध्यान दें"), v: String(p.attentionCount), pill: say("open the list", "सूची खोलें"), tone: ["var(--bads)", "var(--bad)"], sub: say("built by the app", "ऐप ने बनाई"), color: "var(--bad)", href: qs(BASE, { view: "attention", exam: q }) },
    ];
    // The heat map: Nursery–10 share one subject list; 11–12 each have their own three, so those are positional.
    const senior = (label: string) => /(^|\s)1[12](\s|$)/.test(label.replace(/^Class\s+/i, " "));
    const groupClasses = p.classes.filter((c) => (p.group === "senior" ? senior(c.label) : !senior(c.label)) && p.stats.some((s) => s.classId === c.classId));
    const isLang = (code: string) => /^(eng|hin)/i.test(code);
    const juniorHeads = [...new Map(p.stats.filter((s) => groupClasses.some((c) => c.classId === s.classId)).sort((a, b) => a.sortOrder - b.sortOrder).map((s) => [s.subject, s.subject])).keys()];
    const heads = p.group === "senior" ? ["Subject 1", "Subject 2", "Subject 3", "English", "Hindi"] : juniorHeads.map((s) => subjectName(s));
    const rows = groupClasses.map((c) => {
      const mine = p.stats.filter((s) => s.classId === c.classId).sort((a, b) => a.sortOrder - b.sortOrder);
      const cells =
        p.group === "senior"
          ? [...mine.filter((s) => !isLang(s.subject)).slice(0, 3).concat(Array(3).fill(null)).slice(0, 3), mine.find((s) => /^eng/i.test(s.subject)) ?? null, mine.find((s) => /^hin/i.test(s.subject)) ?? null]
          : juniorHeads.map((code) => mine.find((s) => s.subject === code) ?? null);
      return { c, cells };
    });
    return (
      <VxPage>
        <CoordTop
          crumb={say(`Academics · Session ${p.session}`, `शैक्षणिक · सत्र ${p.session}`)}
          title={say("Student progress", "छात्र प्रगति")}
          mSub={`${p.exam?.label ?? ""} · ${say(`${p.classes.length} classes`, `${p.classes.length} कक्षाएँ`)}`}
          mBack={menuBack}
          actions={
            <>
              {help}
              <Btn variant="sec" icon="swap" href={qs(BASE, { view: "compare", exam: q })}>{say("Compare classes", "कक्षाओं की तुलना")}</Btn>
              <Btn variant="pri" icon="alert" href={qs(BASE, { view: "attention", exam: q })}>{say(`Needs attention · ${p.attentionCount}`, `ध्यान दें · ${p.attentionCount}`)}</Btn>
            </>
          }
          mAction={help}
        />
        <main>
          {tabs("overview")}
          {examSeg({})}
          <div className="pad" style={PAD}>
            <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
              {kpis.map((k, i) => {
                const body = (
                  <>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--mut)" }}>{k.l}</span>
                    <span className="num" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: k.color }}>{k.v}</span>
                    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                      {k.pill ? <span className="pill" style={{ background: k.tone[0], color: k.tone[1] }}>{k.pill}</span> : null}
                      {k.sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{k.sub}</span> : null}
                    </span>
                  </>
                );
                const st: CSSProperties = { padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, animationDelay: `${i * 60}ms`, color: "var(--fg)", minWidth: 0 };
                return k.href ? (
                  <Link key={i} href={k.href} className="card rise tap" style={st}>{body}</Link>
                ) : (
                  <div key={i} className="card rise" style={st}>{body}</div>
                );
              })}
            </div>

            <Sec style={{ gap: 12 }}>
              <Title sub={say(`${p.exam?.label ?? ""} · average, pass % and attendance${p.previous ? ` · arrow = change since ${p.previous.label}` : ""}`, `${p.exam?.label ?? ""} · औसत, पास % और हाज़िरी`)}>{say("Class by class", "कक्षावार")}</Title>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10 }}>
                {p.classes.map((c, i) => (
                  <Link key={c.classId} href={qs(BASE, { view: "class", class: c.classId, exam: q })} className="tap card lift" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4, color: "var(--fg)", boxShadow: "none", animation: `xIn .3s var(--ease) ${Math.min(i * 22, 400)}ms both` }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                      <span className="clip" style={{ flex: 1, minWidth: 0, fontWeight: 700 }}>{c.label}</span>
                      {p.previous ? <TrendPill now={c.avg} before={c.before} /> : <span className="pill" style={{ background: "var(--s2)", color: "var(--mut)" }}>{p.exam?.label}</span>}
                    </span>
                    <span className="num" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{R(c.avg)}</span>
                    <Bar pct={c.avg ?? 0} tone={c.avg !== null && c.avg < 60 ? "var(--c3)" : "var(--c2)"} />
                    <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{say(`Pass ${R(c.pass)} · Att. ${R(c.attendance)}`, `पास ${R(c.pass)} · हाज़िरी ${R(c.attendance)}`)}</span>
                  </Link>
                ))}
              </div>
            </Sec>

            <Sec style={{ gap: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{say("Subjects across classes", "कक्षाओं में विषय")}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("Average % per subject · tap a square to open the class", "विषयवार औसत % · कक्षा खोलने को टैप करें")}</span>
                </span>
                <SegLinks label={say("Classes", "कक्षाएँ")} current={p.group} width={240} tabs={[{ key: "junior", href: qs(BASE, { exam: q }), label: say("Nursery – 10", "नर्सरी – 10") }, { key: "senior", href: qs(BASE, { exam: q, grp: "senior" }), label: say("Classes 11–12", "कक्षा 11–12") }]} style={{ flex: "none" }} />
              </div>
              {rows.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{say("No papers for these classes in this exam yet.", "इस परीक्षा में इन कक्षाओं के पेपर अभी नहीं।")}</p>
              ) : (
                <div className="acad-hm" style={{ display: "grid", gridTemplateColumns: `var(--hl) repeat(${heads.length},minmax(0,1fr))`, gap: 4 }}>
                  <style>{`.acad-hm{--hl:112px}@container vx (max-width:899px){.acad-hm{--hl:58px}}`}</style>
                  <span />
                  {heads.map((h, i) => (
                    <span key={i} style={{ fontSize: 10, lineHeight: 1.15, fontWeight: 700, color: "var(--mut)", textAlign: "center", alignSelf: "end", paddingBottom: 2 }}>{h}</span>
                  ))}
                  {rows.map(({ c, cells }, ri) => (
                    <HeatRow key={c.classId} label={c.label} cells={cells} senior={p.group === "senior"} href={qs(BASE, { view: "class", class: c.classId, exam: q })} row={ri} say={say} />
                  ))}
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "var(--mut)" }}>
                {HEAT_LEGEND.map(([t, v]) => (
                  <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: heatBand(v).bg }} />
                    {t}
                  </span>
                ))}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: "var(--s2)", border: "1.5px dashed var(--bds)", boxSizing: "border-box" }} />
                  {say("Not entered yet", "अभी नहीं भरा")}
                </span>
              </div>
            </Sec>
          </div>
        </main>
      </VxPage>
    );
  }

  /* --------------------------------------------------------------- class */
  if (p.view === "class") {
    const { detail, result, nav, marks, people } = p;
    const flagged = detail.students.filter((s) => s.attention).length;
    const avgs = detail.subjects.map((s) => s.avg).filter((v): v is number => v !== null);
    const minA = avgs.length ? Math.min(...avgs) : null;
    const waits = detail.subjects.filter((s) => s.avg === null);
    const spread = spreadBands(marks.map((m) => m.pct));
    const bMax = Math.max(1, ...spread.map((b) => b.n));
    const names = new Map(detail.students.map((s) => [s.studentId, s.name]));
    const lows = detail.subjects
      .map((s) => ({ s, kids: marks.filter((m) => m.subject === s.subject && m.pct < 33).sort((a, b) => a.pct - b.pct) }))
      .filter((x) => x.kids.length);
    const top = detail.students.filter((s) => s.avg !== null).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0)).slice(0, 5);
    const medal: [string, string][] = [["var(--warns)", "var(--warnfg)"], ["var(--s3)", "var(--fg)"], ["var(--accs)", "var(--accfg)"], ["var(--s2)", "var(--mut)"], ["var(--s2)", "var(--mut)"]];
    const d = deltaLabel(result?.avg ?? null, result?.before ?? null);
    const kpis: [string, string, string, string][] = [
      [say("Average", "औसत"), R(result?.avg), p.previous && d.text !== "—" ? `${d.text} vs ${p.previous.label}` : say("first exam", "पहली परीक्षा"), d.tone === "bad" && (result?.avg ?? 0) - (result?.before ?? 0) <= -3 ? "var(--bad)" : "var(--fg)"],
      [say("Passed all", "सभी में पास"), R(detail.pass), say("every subject 33%+", "हर विषय 33%+"), detail.pass !== null && detail.pass < 85 ? "var(--warnfg)" : "var(--fg)"],
      [say("Attendance", "हाज़िरी"), R(detail.attendance), say("this term", "इस सत्र"), detail.attendance !== null && detail.attendance < 85 ? "var(--warnfg)" : "var(--fg)"],
      [say("Need attention", "ध्यान दें"), String(flagged), say("children", "बच्चे"), flagged ? "var(--bad)" : "var(--fg)"],
    ];
    const status = (s: ClassDetail["subjects"][number]) =>
      people.locked ? [say("Locked", "लॉक"), "var(--oks)", "var(--ok)"] : s.submitted ? [say("Entered", "भरे गए"), "var(--oks)", "var(--ok)"] : s.entered > 0 ? [say(`${s.entered} of ${detail.roll}`, `${detail.roll} में ${s.entered}`), "var(--warns)", "var(--warnfg)"] : [say("Not started", "शुरू नहीं"), "var(--bads)", "var(--bad)"];
    return (
      <VxPage>
        <CoordTop
          crumb={say(`Student progress · ${p.exam?.label ?? ""}`, `छात्र प्रगति · ${p.exam?.label ?? ""}`)}
          title={detail.label}
          dBack={qs(BASE, { exam: q })}
          mBack={qs(BASE, { exam: q })}
          mSub={`${people.classTeacher ?? "—"} · ${say(`${detail.roll} students`, `${detail.roll} विद्यार्थी`)}`}
          actions={
            <>
              {help}
              <Btn variant="sec" icon="swap" href={qs(BASE, { view: "compare", a: detail.classId, exam: q })}>{say("Compare", "तुलना")}</Btn>
            </>
          }
          mAction={help}
        />
        <main>
          {examSeg({ view: "class", class: detail.classId })}
          <div className="pad" style={PAD}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 520 }}>
              <Link href={qs(BASE, { view: "class", class: nav.prev.id, exam: q })} scroll={false} className="tap btn sec" aria-label={say("Previous class", "पिछली कक्षा")} style={{ width: 48, height: 48, padding: 0, flex: "none" }}>
                <Ic n="chevLeft" size={20} />
              </Link>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{detail.label}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`${nav.pos} of ${nav.total} classes`, `${nav.total} में ${nav.pos}वीं कक्षा`)}</span>
              </span>
              <Link href={qs(BASE, { view: "class", class: nav.next.id, exam: q })} scroll={false} className="tap btn sec" aria-label={say("Next class", "अगली कक्षा")} style={{ width: 48, height: 48, padding: 0, flex: "none" }}>
                <Ic n="chevRight" size={20} />
              </Link>
            </div>

            <div className="card acad-ch" style={{ padding: "16px 18px", display: "grid", gap: "12px 16px", alignItems: "center" }}>
              <style>{`.acad-ch{grid-template-columns:minmax(0,1.6fr) repeat(4,minmax(0,1fr))}@container vx (max-width:899px){.acad-ch{grid-template-columns:repeat(2,minmax(0,1fr))}.acad-ch .acad-chn{grid-column:1/-1}}`}</style>
              <span className="acad-chn" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="serif hide-m" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.2 }}>{detail.label}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`${people.classTeacher ?? "—"} · class teacher · ${detail.roll} students · ${p.exam?.label ?? ""}`, `${people.classTeacher ?? "—"} · कक्षा अध्यापक · ${detail.roll} विद्यार्थी · ${p.exam?.label ?? ""}`)}</span>
              </span>
              {kpis.map(([l, v, s, c]) => (
                <span key={l} style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{l}</span>
                  <span className="num" style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</span>
                  <span style={{ fontSize: 11, color: "var(--mut)" }}>{s}</span>
                </span>
              ))}
            </div>

            <div className="stack" style={STACK("1.5fr", "1fr")}>
              <Sec style={{ gap: 12 }}>
                <Title right={<span style={{ fontSize: 12, color: "var(--mut)" }}>{say("% of full marks", "पूरे अंकों का %")}</span>}>{say("Subject averages", "विषयवार औसत")}</Title>
                <div className="only-d" style={{ position: "relative", display: "flex", height: 190, alignItems: "flex-end", gap: 10, borderBottom: "1px solid var(--bd)", paddingRight: 34 }}>
                  <span style={{ position: "absolute", left: 0, right: 0, bottom: "33%", borderTop: "1.5px dashed var(--bad)", opacity: 0.55 }} />
                  <span style={{ position: "absolute", right: 0, bottom: "calc(33% + 3px)", fontSize: 10, fontWeight: 700, color: "var(--bad)" }}>33%</span>
                  {detail.subjects.map((s, i) => (
                    <div key={s.subject} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                      <span className="num" style={{ fontSize: 11, fontWeight: 700 }}>{s.avg === null ? "…" : R(s.avg)}</span>
                      <span style={{ width: "100%", maxWidth: 46, height: s.avg === null ? "100%" : `${Math.max(3, s.avg)}%`, background: s.avg === null ? "transparent" : s.avg === minA ? "var(--c3)" : "var(--c2)", border: s.avg === null ? "1.5px dashed var(--bds)" : 0, boxSizing: "border-box", transformOrigin: "bottom", animation: `xGrowY .7s var(--ease) ${i * 70}ms both` }} />
                    </div>
                  ))}
                </div>
                <div className="only-d" style={{ display: "flex", gap: 10, paddingRight: 34 }}>
                  {detail.subjects.map((s) => (
                    <span key={s.subject} className="clip" style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>{subjectName(s.subject)}</span>
                  ))}
                </div>
                <div className="only-m" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {detail.subjects.map((s) => (
                    <div key={s.subject} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 76, fontSize: 13, fontWeight: 600 }}>{subjectName(s.subject)}</span>
                      <span style={{ flex: 1, position: "relative", display: "flex", height: 20, borderRadius: 6, background: "var(--s2)", overflow: "hidden", border: s.avg === null ? "1.5px dashed var(--bds)" : 0 }}>
                        <span style={{ height: "100%", width: `${s.avg ?? 0}%`, background: s.avg === minA ? "var(--c3)" : "var(--c2)", borderRadius: 6 }} />
                        <span style={{ position: "absolute", top: 0, bottom: 0, left: "33%", borderLeft: "1.5px dashed var(--bad)" }} />
                      </span>
                      <span className="num" style={{ width: 40, textAlign: "right", fontSize: 13, fontWeight: 700 }}>{s.avg === null ? "…" : R(s.avg)}</span>
                    </div>
                  ))}
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("Red dashed line = 33% pass mark.", "लाल रेखा = 33% पास अंक।")}</span>
                </div>
                {waits.length ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`${waits.map((s) => subjectName(s.subject)).join(", ")} — not entered yet, so left out of the average.`, `${waits.map((s) => subjectName(s.subject)).join(", ")} — अभी नहीं भरा, औसत में शामिल नहीं।`)}</span> : null}
              </Sec>
              <Sec style={{ gap: 10 }}>
                <Title right={<span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`${marks.length} papers`, `${marks.length} पेपर`)}</span>}>{say("Marks spread", "अंकों का फैलाव")}</Title>
                {spread.map((b, i) => (
                  <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="num" style={{ width: 52, fontSize: 13, fontWeight: 600 }}>{b.label}</span>
                    <span style={{ flex: 1, display: "flex", height: 24, borderRadius: 7, background: "var(--s2)", overflow: "hidden" }}>
                      <span style={{ height: "100%", width: `${Math.max(1, Math.round((b.n / bMax) * 100))}%`, background: b.tone, borderRadius: 7, transformOrigin: "left", animation: `xGrowX .7s var(--ease) ${i * 70}ms both` }} />
                    </span>
                    <span className="num" style={{ width: 30, textAlign: "right", fontSize: 13, fontWeight: 700 }}>{b.n}</span>
                  </div>
                ))}
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("Each bar counts papers — one child in one subject.", "हर पट्टी पेपर गिनती है — एक बच्चा, एक विषय।")}</span>
              </Sec>
            </div>

            <div className="stack" style={STACK("1.5fr", "1fr")}>
              <Sec>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{say("Below 33% by subject", "विषयवार 33% से कम")}</span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("Tap a child to open their progress", "प्रगति देखने को बच्चे पर टैप करें")}</span>
                  </span>
                  <span className="pill num" style={{ height: 26, padding: "0 10px", background: "var(--bads)", color: "var(--bad)" }}>{lows.reduce((s, x) => s + x.kids.length, 0)}</span>
                </div>
                {lows.map((x, i) => (
                  <div key={x.s.subject} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "9px 0", borderTop: i ? "1px solid var(--bd)" : undefined }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>
                      {subjectName(x.s.subject)} <span style={{ fontSize: 12, color: "var(--mut)" }}>· {people.bySubject[x.s.subjectId] ?? "—"}</span>
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {x.kids.map((k) => (
                        <Link key={k.studentId} href={qs(BASE, { view: "student", student: k.studentId, exam: q })} className="tap chip" style={{ color: "var(--bad)" }}>
                          {names.get(k.studentId) ?? "—"} · {R(k.pct)}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
                {lows.length === 0 ? <span style={{ fontSize: 12, color: "var(--mut)", textAlign: "center", padding: "18px 0" }}>{say("Nobody is below 33% in this class.", "इस कक्षा में कोई 33% से कम नहीं।")}</span> : null}
              </Sec>
              <Sec>
                <span style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{say(`Top ${Math.min(5, top.length) || 5}`, `शीर्ष ${Math.min(5, top.length) || 5}`)}</span>
                {top.map((t, i) => (
                  <Link key={t.studentId} href={qs(BASE, { view: "student", student: t.studentId, exam: q })} className="tap row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 4px", borderTop: i ? "1px solid var(--bd)" : undefined, color: "var(--fg)" }}>
                    <span className="num" style={{ flex: "none", width: 30, height: 30, borderRadius: 15, background: medal[i][0], color: medal[i][1], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className="clip" style={{ fontWeight: 600 }}>{t.name}</span>
                      <Bar pct={t.avg ?? 0} tone="var(--c2)" />
                    </span>
                    <span className="num" style={{ fontWeight: 700 }}>{R(t.avg)}</span>
                  </Link>
                ))}
                {top.length === 0 ? <span style={{ fontSize: 12, color: "var(--mut)", padding: "18px 0", textAlign: "center" }}>{say("No marks yet.", "अभी कोई अंक नहीं।")}</span> : null}
              </Sec>
            </div>

            <div className="stack" style={STACK("1.5fr", "1fr")}>
              <Sec>
                <span style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{say("Subject teachers", "विषय अध्यापक")}</span>
                {detail.subjects.map((s, i) => {
                  const [t, bg, fg] = status(s);
                  return (
                    <div key={s.subject} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--bd)" : undefined }}>
                      <span style={{ width: 96, fontSize: 13, fontWeight: 600 }}>{subjectName(s.subject)}</span>
                      <span className="clip" style={{ flex: 1, fontSize: 13 }}>{people.bySubject[s.subjectId] ?? "—"}</span>
                      <span className="pill" style={{ background: bg, color: fg }}>{t}</span>
                    </div>
                  );
                })}
              </Sec>
              <Sec style={{ gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{say("Teachers’ notes", "शिक्षकों के नोट्स")}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: "none", width: 44, height: 44, borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Ic n="notePen" size={20} />
                  </span>
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{people.notes.total}</span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`notes this term · ${people.notes.followUp} need follow-up`, `इस सत्र के नोट · ${people.notes.followUp} पर फ़ॉलो-अप`)}</span>
                  </span>
                </span>
                {p.notesHref ? (
                  <Link href={`${p.notesHref}?class=${detail.classId}`} className="tap btn soft">{say(`Open notes on ${detail.label}`, `${detail.label} के नोट खोलें`)}</Link>
                ) : null}
              </Sec>
            </div>
          </div>
        </main>
      </VxPage>
    );
  }

  /* ------------------------------------------------------------- student */
  if (p.view === "student") {
    const { child } = p;
    const first = child.name.replace(/^(mr|ms|mrs)\.?\s+/i, "").split(" ")[0];
    const shown = child.exams.filter((e) => child.subjects.some((s) => s.byExam.has(e.id)));
    const now = shown[shown.length - 1] ?? null;
    const before = shown[shown.length - 2] ?? null;
    const phone = telHref(child.phone);
    const ct = p.classTeacher;
    const chips = child.facts ? attentionChips(child.facts) : [];
    const planHref = qs(BASE, { view: "plan", student: child.studentId, exam: q });
    const tone = toneOf(child.name);
    const teacherWa = ct?.phone ? `https://wa.me/91${ct.phone.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(`Can we talk about ${child.name} (${child.classLabel})? I would like to plan the next steps together.`)}` : null;
    const steps = child.plan?.steps ?? [];
    const done = steps.filter((s) => s.done).length;
    const planPct = steps.length ? Math.round((done / steps.length) * 100) : 0;
    const L = Math.max(0.5, (263.9 * planPct) / 100);
    const attPct = child.attendance.pct;
    return (
      <VxPage>
        <CoordTop
          crumb={say(`Student progress · ${child.classLabel}`, `छात्र प्रगति · ${child.classLabel}`)}
          title={child.name}
          dBack={qs(BASE, { view: "class", class: child.classId, exam: q })}
          mBack={qs(BASE, { view: "class", class: child.classId, exam: q })}
          mSub={`${child.classLabel}${child.rollNo ? ` · ${say("Roll", "रोल")} ${child.rollNo}` : ""}`}
          actions={help}
          mAction={help}
        />
        <main>
          <div className="pad" style={PAD}>
            <section className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
                <span aria-hidden="true" style={{ flex: "none", width: 60, height: 60, borderRadius: 30, background: tone.bg, color: tone.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>{nameInitials(child.name)}</span>
                <span style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column" }}>
                  <span className="serif" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>{child.name}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>
                    {[child.classLabel, child.rollNo ? `${say("Roll", "रोल")} ${child.rollNo}` : null, ct ? say(`class teacher ${ct.name}`, `कक्षा अध्यापक ${ct.name}`) : null, child.father ? say(`father ${child.father}`, `पिता ${child.father}`) : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {chips.length ? chips.map((c, i) => <span key={i} className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: `var(--${c.tone}s)`, color: c.tone === "warn" ? "var(--warnfg)" : c.tone === "acc" ? "var(--accfg)" : `var(--${c.tone})` }}>{say(c.text.en, c.text.hi)}</span>) : <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--oks)", color: "var(--ok)" }}>{say("Not on the attention list", "ध्यान सूची में नहीं")}</span>}
                </div>
              </div>
              <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
                {phone ? <a className="tap btn sec" href={phone}><Ic n="phone" size={18} />{say("Call parents", "अभिभावक को कॉल")}</a> : <span className="tap btn sec" aria-disabled="true" style={{ opacity: 0.5 }}><Ic n="phone" size={18} />{say("No phone on file", "फ़ोन नहीं")}</span>}
                {teacherWa ? <a className="tap btn sec" href={teacherWa} target="_blank" rel="noreferrer"><Ic n="message" size={18} /><span className="clip">{say(`Talk to ${ct?.name}`, `${ct?.name} से बात करें`)}</span></a> : <span className="tap btn sec" aria-disabled="true" style={{ opacity: 0.5 }}><Ic n="message" size={18} />{say("Talk to class teacher", "कक्षा अध्यापक से बात")}</span>}
                <Btn variant="pri" icon="clipboard" href={planHref}>{child.plan?.status === "active" ? say("Open support plan", "सहायता योजना खोलें") : say("Start a support plan", "सहायता योजना शुरू करें")}</Btn>
                {p.notesHref ? <Btn variant="soft" icon="notePen" href={`${p.notesHref}?add=1&student=${child.studentId}`}>{say("Add a note", "नोट जोड़ें")}</Btn> : null}
              </div>
            </section>

            <div className="stack" style={STACK("1.3fr", "1fr")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                <Sec style={{ gap: 10 }}>
                  <Title sub={before && now ? say(`${before.label} → ${now.label} · tap a subject to pick it out`, `${before.label} → ${now.label} · किसी विषय को अलग देखने को टैप करें`) : now ? now.label : undefined}>{say("Progress by subject", "विषयवार प्रगति")}</Title>
                  {child.subjects.length === 0 ? (
                    <p style={{ margin: 0, color: "var(--mut)", fontSize: 13 }}>{say("No marks yet.", "अभी कोई अंक नहीं।")}</p>
                  ) : (
                    <SubjectLines child={child} before={before} now={now} hl={p.hl} q={q} say={say} />
                  )}
                </Sec>
                <Sec>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{say("Teachers’ notes", "शिक्षकों के नोट्स")}</span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`${child.notes.filter((n) => n.status !== "done").length} open`, `${child.notes.filter((n) => n.status !== "done").length} खुले`)}</span>
                  </div>
                  {child.notes.length === 0 ? <span style={{ fontSize: 12, color: "var(--mut)", textAlign: "center", padding: "16px 0" }}>{say(`No notes on ${first} yet. Teachers’ notes show here as a timeline.`, `${first} पर अभी कोई नोट नहीं।`)}</span> : null}
                  {child.notes.slice(0, 6).map((n, i, all) => {
                    const t = n.tone === "concern" ? ["var(--warns)", "var(--warnfg)", "calCheck"] : n.tone === "good" ? ["var(--oks)", "var(--ok)", "star"] : ["var(--infos)", "var(--info)", "book"];
                    const st = n.status === "working" ? [say("Working on it", "काम चल रहा"), "var(--warns)", "var(--warnfg)"] : n.status === "done" ? [say("Done", "पूरा"), "var(--oks)", "var(--ok)"] : [say("Open", "खुला"), "var(--bads)", "var(--bad)"];
                    return (
                      <div key={n.id} style={{ display: "grid", gridTemplateColumns: "24px minmax(0,1fr)", gap: 10 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <span style={{ width: 24, height: 24, borderRadius: 12, background: t[0], color: t[1], display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Ic n={t[2] as IconName} size={13} />
                          </span>
                          <span style={{ flex: 1, width: 2, marginTop: 4, background: i === all.length - 1 ? "transparent" : "var(--bd)" }} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 14, animation: `xIn .3s var(--ease) ${i * 80}ms both` }}>
                          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                            <span className="pill" style={{ background: t[0], color: t[1] }}>{n.kind}</span>
                            <span className="pill" style={{ background: st[1], color: st[2] }}>{st[0]}</span>
                            <span style={{ fontSize: 12, color: "var(--mut)" }}>{dayName(n.at)}</span>
                          </span>
                          <span style={{ lineHeight: 1.5 }}>{n.body}</span>
                          <span style={{ fontSize: 12, color: "var(--mut)" }}>{n.by}</span>
                        </div>
                      </div>
                    );
                  })}
                </Sec>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                <Sec style={{ gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{say("Attendance by month", "महीनेवार हाज़िरी")}</span>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{say(`${child.months.length ? `${monthName(child.months[0].month)}–${monthName(child.months[child.months.length - 1].month)} · ` : ""}75% is the minimum`, "75% न्यूनतम है")}</span>
                    </span>
                    <span className="num" style={{ fontSize: 24, fontWeight: 700, color: attPct !== null && attPct < 75 ? "var(--bad)" : "var(--fg)" }}>{R(attPct)}</span>
                  </div>
                  <div style={{ position: "relative", display: "flex", height: 140, alignItems: "flex-end", gap: 14, borderBottom: "1px solid var(--bd)", paddingRight: 34 }}>
                    <span style={{ position: "absolute", left: 0, right: 0, bottom: "63.75%", borderTop: "1.5px dashed var(--warn)", opacity: 0.55 }} />
                    <span style={{ position: "absolute", right: 0, bottom: "calc(63.75% + 3px)", fontSize: 10, fontWeight: 700, color: "var(--warnfg)" }}>75%</span>
                    {child.months.map((m, i) => (
                      <div key={m.month} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                        <span className="num" style={{ fontSize: 11, fontWeight: 700 }}>{R(m.pct)}</span>
                        <span style={{ width: "100%", maxWidth: 46, height: `${((m.pct ?? 0) * 0.85).toFixed(1)}%`, background: m.pct !== null && m.pct < 75 ? "var(--bad)" : m.pct !== null && m.pct < 85 ? "var(--c3)" : "var(--ok)", transformOrigin: "bottom", animation: `xGrowY .7s var(--ease) ${i * 80}ms both` }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 14, paddingRight: 34 }}>
                    {child.months.map((m) => (
                      <span key={m.month} style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>{monthName(m.month)}</span>
                    ))}
                  </div>
                  {child.months.length === 0 ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("No registers yet.", "अभी कोई रजिस्टर नहीं।")}</span> : null}
                </Sec>
                <Sec style={{ gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ position: "relative", flex: "none", width: 58, height: 58 }}>
                      <svg width={58} height={58} viewBox="0 0 100 100" aria-hidden="true">
                        <circle cx={50} cy={50} r={42} fill="none" stroke="var(--s3)" strokeWidth={11} />
                        <circle cx={50} cy={50} r={42} fill="none" stroke="var(--ok)" strokeWidth={11} strokeLinecap="round" strokeDasharray={`${L.toFixed(1)} 263.9`} style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", ["--len" as string]: L.toFixed(1), animation: "xDraw .9s var(--ease) both" }} />
                      </svg>
                      <span className="num" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{planPct}%</span>
                    </span>
                    <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 15, fontWeight: 700 }}>{say("Support plan", "सहायता योजना")}</span>
                        <span className="pill" style={{ background: child.plan?.status === "active" ? "var(--oks)" : "var(--warns)", color: child.plan?.status === "active" ? "var(--ok)" : "var(--warnfg)" }}>{child.plan?.status === "active" ? say("Running", "चल रही") : child.plan ? say("Draft", "ड्राफ़्ट") : say("Not started", "शुरू नहीं")}</span>
                      </span>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{child.plan ? say(`${done} of ${steps.length} steps done${child.plan.goal ? ` · goal: ${child.plan.goal}` : ""}`, `${steps.length} में ${done} कदम पूरे`) : say("No plan yet · the app suggests steps when you start one", "अभी कोई योजना नहीं")}</span>
                    </span>
                  </div>
                  {steps.length ? (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {steps.map((s, i) => (
                        <div key={s.id} style={{ borderTop: i ? "1px solid var(--bd)" : undefined }}>
                          <StepToggle stepId={s.id} done={s.done} disabled={!p.mayManage}>
                            <span style={{ display: "flex", flexDirection: "column" }}>
                              <span style={{ fontSize: 13, fontWeight: 600, textDecoration: s.done ? "line-through" : undefined }}>{s.text}</span>
                              <span style={{ fontSize: 12, color: "var(--mut)" }}>{[s.owner, s.due].filter(Boolean).join(" · ")}</span>
                            </span>
                          </StepToggle>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <Btn variant={child.plan?.status === "active" ? "sec" : "pri"} icon="clipboard" href={planHref}>{child.plan?.status === "active" ? say("Open support plan", "सहायता योजना खोलें") : say("Start a support plan", "सहायता योजना शुरू करें")}</Btn>
                </Sec>
                <Sec>
                  <span className="sech" style={{ marginBottom: 6 }}>{say("History · who did what", "इतिहास · किसने क्या किया")}</span>
                  {child.followups.length === 0 && !child.facts ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("Nothing recorded yet.", "अभी कुछ दर्ज नहीं।")}</span> : null}
                  {child.followups.slice(0, 6).map((f, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr) auto", gap: 10, alignItems: "baseline", padding: "7px 0", fontSize: 13, animation: `xIn .3s var(--ease) ${i * 40}ms both` }}>
                      <i style={{ width: 8, height: 8, borderRadius: 4, background: f.kind === "call" ? "var(--ok)" : f.kind === "improving" ? "var(--acc)" : "var(--info)", display: "block" }} />
                      <span>{`${f.by} · ${followLabel(f.kind, f.outcome, say)}`}</span>
                      <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{say(agoP(f.at).en, agoP(f.at).hi)}</span>
                    </div>
                  ))}
                  {child.facts ? (
                    <div style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr) auto", gap: 10, alignItems: "baseline", padding: "7px 0", fontSize: 13 }}>
                      <i style={{ width: 8, height: 8, borderRadius: 4, background: "var(--warn)", display: "block" }} />
                      <span>{say(`On Needs attention, from the app · ${chips[0] ? chips[0].text.en : ""}`, `ऐप से ध्यान सूची में · ${chips[0] ? chips[0].text.hi ?? chips[0].text.en : ""}`)}</span>
                      <span />
                    </div>
                  ) : null}
                  {p.mayFollow ? (
                    <div style={{ marginTop: 8 }}>
                      <FollowupButtons studentId={child.studentId} staff={[]} compact />
                    </div>
                  ) : null}
                </Sec>
              </div>
            </div>
          </div>
        </main>
      </VxPage>
    );
  }

  /* ------------------------------------------------------------- compare */
  if (p.view === "compare") {
    const { a, b } = p;
    const ra = p.results.find((r) => r.classId === a.id);
    const rb = p.results.find((r) => r.classId === b.id);
    const subA = p.stats.filter((s) => s.classId === a.id);
    const subB = p.stats.filter((s) => s.classId === b.id);
    const common = subA.filter((s) => subB.some((x) => x.subject === s.subject)).map((s) => s.subject);
    const short = (label: string) => label.replace(/^Class\s+/i, "Class ").replace(/Science$/, "Sci").replace(/Commerce$/, "Com");
    return (
      <VxPage>
        <CoordTop crumb={say("Student progress", "छात्र प्रगति")} title={say("Compare classes", "कक्षाओं की तुलना")} mSub={say(`${a.label} vs ${b.label}`, `${a.label} बनाम ${b.label}`)} mBack={menuBack} actions={help} mAction={help} />
        <main>
          {tabs("compare")}
          {examSeg({ view: "compare", a: a.id, b: b.id })}
          <div className="pad" style={PAD}>
            <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="sech">{say("Tap two classes · blue is first, amber is second", "दो कक्षाएँ चुनें · नीली पहली, पीली दूसरी")}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {p.classes.map((c) => {
                  const on = c.id === a.id ? "var(--c1)" : c.id === b.id ? "var(--c3)" : null;
                  // Tapping a class makes it the second; the second becomes the first.
                  const href = on ? qs(BASE, { view: "compare", a: a.id, b: b.id, exam: q }) : qs(BASE, { view: "compare", a: b.id, b: c.id, exam: q });
                  return (
                    <Link key={c.id} href={href} scroll={false} replace className="tap chip" aria-pressed={!!on} style={{ background: on ?? "var(--card)", color: on ? "var(--onsolid)" : "var(--fg)", borderColor: on ?? "var(--bd)" }}>
                      {short(c.label)}
                    </Link>
                  );
                })}
              </div>
            </div>
            <div className="stack" style={STACK("1.5fr", "1fr")}>
              <Sec style={{ gap: 12 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                  <span style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{say("Subject averages", "विषयवार औसत")}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mut)" }}><span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--c1)" }} />{a.label}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mut)" }}><span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--c3)" }} />{b.label}</span>
                </div>
                {common.map((code, i) => {
                  const va = subA.find((s) => s.subject === code)?.avg ?? null;
                  const vb = subB.find((s) => s.subject === code)?.avg ?? null;
                  const dd = va !== null && vb !== null ? Math.round(va - vb) : null;
                  const tone = dd === null || Math.abs(dd) < 5 ? ["var(--s2)", "var(--mut)"] : dd > 0 ? ["var(--oks)", "var(--ok)"] : ["var(--bads)", "var(--bad)"];
                  return (
                    <div key={code} style={{ display: "grid", gridTemplateColumns: "96px minmax(0,1fr) 62px", gap: 10, alignItems: "center", padding: "10px 0", borderTop: i ? "1px solid var(--bd)" : undefined }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{subjectName(code)}</span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {[[va, "var(--c1)"], [vb, "var(--c3)"]].map(([v, c], j) => (
                          <span key={j} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ flex: 1, display: "flex", height: 14, borderRadius: 5, background: "var(--s2)", overflow: "hidden" }}>
                              <span style={{ height: "100%", width: `${v ?? 0}%`, background: c as string, borderRadius: 5, transformOrigin: "left", animation: `xGrowX .7s var(--ease) ${i * 60}ms both` }} />
                            </span>
                            <span className="num" style={{ width: 36, fontSize: 13, fontWeight: 700 }}>{v === null ? "…" : R(v as number)}</span>
                          </span>
                        ))}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        <span className="pill num" style={{ background: tone[0], color: tone[1] }}>{dd === null ? say("waiting", "बाकी") : dd > 0 ? `+${dd}` : dd < 0 ? `−${-dd}` : "0"}</span>
                      </span>
                    </div>
                  );
                })}
                <span style={{ fontSize: 12, color: "var(--mut)" }}>
                  {common.length < Math.max(subA.length, subB.length) ? say(`Only the ${common.length} subjects both classes study are compared. `, `केवल ${common.length} साझा विषयों की तुलना। `) : ""}
                  {say(`The pill shows ${a.label} minus ${b.label} · ${p.exam?.label ?? ""}.`, `पिल ${a.label} में से ${b.label} दिखाती है · ${p.exam?.label ?? ""}।`)}
                </span>
              </Sec>
              <Sec>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 70px 70px", gap: 8, paddingBottom: 6, borderBottom: "1px solid var(--bd)", fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>
                  <span>{say("At a glance", "एक नज़र में")}</span>
                  <span style={{ textAlign: "right" }}>{a.label}</span>
                  <span style={{ textAlign: "right" }}>{b.label}</span>
                </div>
                {[
                  [say("Class average", "कक्षा औसत"), R(ra?.avg), R(rb?.avg)],
                  [say("Passed every subject", "सभी विषयों में पास"), R(ra?.pass), R(rb?.pass)],
                  [say("Attendance", "हाज़िरी"), R(ra?.attendance), R(rb?.attendance)],
                  [say("Need attention", "ध्यान दें"), String(p.attentionBy[a.id] ?? 0), String(p.attentionBy[b.id] ?? 0)],
                ].map(([l, va, vb], i) => (
                  <div key={l} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 70px 70px", gap: 8, padding: "10px 0", alignItems: "center", borderTop: i ? "1px solid var(--bd)" : undefined }}>
                    <span style={{ fontSize: 13 }}>{l}</span>
                    <span className="num" style={{ textAlign: "right", fontWeight: 700, color: "var(--c1)" }}>{va}</span>
                    <span className="num" style={{ textAlign: "right", fontWeight: 700, color: "var(--c3)" }}>{vb}</span>
                  </div>
                ))}
                <Btn variant="soft" href={qs(BASE, { view: "class", class: a.id, exam: q })} style={{ marginTop: 10 }}>{say(`Open ${a.label}`, `${a.label} खोलें`)}</Btn>
              </Sec>
            </div>
          </div>
        </main>
      </VxPage>
    );
  }

  /* ----------------------------------------------------------- attention */
  if (p.view === "attention") {
    const all = p.list;
    const improving = (c: AttentionChild) => c.followup?.kind === "improving";
    const filters: { key: string; label: string; dot: string; n: number }[] = [
      { key: "", label: say("All", "सभी"), dot: "var(--bds)", n: all.length },
      { key: "attendance", label: say("Attendance below 75%", "हाज़िरी 75% से कम"), dot: "var(--warn)", n: all.filter((c) => c.reasons.includes("attendance")).length },
      { key: "below_33", label: say("Below 33%", "33% से कम"), dot: "var(--bad)", n: all.filter((c) => c.reasons.includes("below_33")).length },
      { key: "dropped", label: say("Marks dropped 15%+", "अंक 15%+ गिरे"), dot: "var(--info)", n: all.filter((c) => c.reasons.includes("dropped")).length },
      { key: "notes", label: say("2+ open notes", "2+ खुले नोट"), dot: "var(--acc)", n: all.filter((c) => c.reasons.includes("notes")).length },
      { key: "improving", label: say("Improving", "सुधार"), dot: "var(--ok)", n: all.filter(improving).length },
    ];
    const f = p.filter ?? "";
    const list = (f === "improving" ? all.filter(improving) : f ? all.filter((c) => c.reasons.includes(f as AttentionReason)) : all).slice().sort((x, y) => (improving(x) ? 1 : 0) - (improving(y) ? 1 : 0));
    return (
      <VxPage>
        <CoordTop crumb={say("Student progress · built by the app", "छात्र प्रगति · ऐप ने बनाई")} title={say("Needs attention", "ध्यान दें")} mSub={say(`${all.length} children · updated now`, `${all.length} बच्चे · अभी अपडेट`)} mBack={menuBack} actions={help} mAction={help} />
        <main>
          {tabs("attention")}
          <div className="pad" style={PAD}>
            <Note icon="zap" tone="acc">
              <b>{say("This list builds itself.", "यह सूची अपने आप बनती है।")}</b>{" "}
              {say("A child is added when attendance is below 75%, any subject is below 33%, marks dropped 15 points or more since the exam before, or there are 2 or more open notes.", "बच्चा तब जुड़ता है जब हाज़िरी 75% से कम हो, कोई विषय 33% से कम हो, पिछली परीक्षा से 15+ अंक गिरे हों, या 2+ खुले नोट हों।")}
            </Note>
            <nav className="hs" aria-label={say("Filter", "छाँटें")} style={{ display: "flex", gap: 6 }}>
              {filters.map((x) => {
                const on = x.key === f;
                return (
                  <Link key={x.key || "all"} href={qs(BASE, { view: "attention", reason: x.key || undefined, exam: q })} scroll={false} replace className={`tap chip${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: on ? "var(--prifg)" : x.dot }} />
                    {x.label}
                    <span className="num" style={{ opacity: 0.7 }}>{x.n}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="card" style={{ padding: "4px 16px", display: "flex", flexDirection: "column" }}>
              {list.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", padding: "34px 10px" }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{say("No children in this group", "इस समूह में कोई बच्चा नहीं")}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{say("Pick another reason above to see the rest of the list.", "बाकी सूची देखने को ऊपर दूसरा कारण चुनें।")}</span>
                  <Btn variant="sec" href={qs(BASE, { view: "attention", exam: q })}>{say("Show all", "सभी दिखाएँ")}</Btn>
                </div>
              ) : null}
              {list.map((c, i) => {
                const chips = attentionChips(c);
                const im = improving(c);
                return (
                  <div key={c.studentId} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "12px 0", borderTop: i ? "1px solid var(--bd)" : undefined, opacity: im ? 0.62 : 1, animation: `xIn .3s var(--ease) ${Math.min(i, 12) * 25}ms both` }}>
                    <Link href={qs(BASE, { view: "student", student: c.studentId, exam: q })} className="tap" aria-label={say(`Open ${c.name}`, `${c.name} खोलें`)} style={{ flex: 1, minWidth: 250, display: "flex", alignItems: "flex-start", gap: 12, color: "var(--fg)" }}>
                      <ToneAvatar name={c.name} />
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 600 }}>{c.name}</span>
                          <span style={{ fontSize: 12, color: "var(--mut)" }}>{c.classLabel}</span>
                          {im ? <span className="pill" style={{ background: "var(--oks)", color: "var(--ok)" }}>{say("Improving", "सुधार")}</span> : null}
                          {c.plan ? <span className="pill" style={{ background: c.plan === "active" ? "var(--oks)" : "var(--s2)", color: c.plan === "active" ? "var(--ok)" : "var(--mut)" }}>{c.plan === "active" ? say("Plan running", "योजना चल रही") : say("Plan draft", "योजना ड्राफ़्ट")}</span> : null}
                        </span>
                        <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {chips.map((x, j) => (
                            <Pill key={j} tone={x.tone}>{say(x.text.en, x.text.hi)}</Pill>
                          ))}
                        </span>
                        {c.followup && c.followup.kind === "follow_up" ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--acc)" }}>
                            <Ic n="user" size={14} />
                            {say(`Follow-up: ${c.followup.note ?? followLabel(c.followup.kind, c.followup.outcome, say)} · ${c.followup.by}`, `फ़ॉलो-अप: ${c.followup.by}`)}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                    {p.mayFollow ? <FollowupButtons studentId={c.studentId} staff={p.staff} compact /> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </VxPage>
    );
  }

  /* ---------------------------------------------------------------- plan */
  const { child } = p;
  const backHref = qs(BASE, { view: "student", student: child.studentId, exam: q });
  const steps = child.plan?.steps ?? [];
  return (
    <VxPage>
      <CoordTop
        crumb={`${child.name} · ${child.classLabel}`}
        title={say("Support plan", "सहायता योजना")}
        dBack={backHref}
        mBack={backHref}
        mSub={say(`${child.name.split(" ")[0]} · ${steps.filter((s) => s.done).length} of ${steps.length} steps done`, `${child.name.split(" ")[0]} · ${steps.length} में ${steps.filter((s) => s.done).length} कदम पूरे`)}
        actions={help}
        mAction={help}
      />
      <main>
        <PlanEditor
          studentId={child.studentId}
          studentName={child.name}
          classLabel={child.classLabel}
          backHref={backHref}
          staff={p.staff}
          editable={p.mayManage}
          suggestions={p.suggestions}
          father={p.father}
          parentPhone={p.parentPhone}
          initial={{ goal: child.plan?.goal ?? "", status: child.plan?.status ?? null, steps: steps.map((s) => ({ id: s.id, text: s.text, ownerId: s.ownerId, due: s.due, done: s.done })) }}
        />
      </main>
    </VxPage>
  );
}

/* ------------------------------------------------------------- the pieces */

function monthName(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" }).replace("Sept", "Sep");
}

function HeatRow({ label, cells, senior, href, row, say }: { label: string; cells: (HeatStat | null)[]; senior: boolean; href: string; row: number; say: Say }) {
  const short = label.replace(/^Class\s+/i, "").replace(/Science$/, "Sci").replace(/Commerce$/, "Com");
  return (
    <>
      <span style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
        <span className="clip" style={{ fontSize: 13, fontWeight: 700 }}>{short}</span>
      </span>
      {cells.map((s, ci) => {
        if (!s) return <span key={ci} className="num" style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sub)", fontSize: 13, fontWeight: 700 }}>·</span>;
        const waiting = s.avg === null || s.entered === 0;
        const b = heatBand(waiting ? null : s.avg);
        return (
          <Link key={ci} href={href} className="tap num" aria-label={`${label} ${subjectName(s.subject)} · ${waiting ? say("marks not entered yet", "अंक अभी नहीं भरे") : `${Math.round(s.avg ?? 0)}%`}`} style={{ height: 44, minWidth: 0, borderRadius: 9, background: b.bg, color: b.fg, border: waiting ? "1.5px dashed var(--bds)" : 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", animation: `xFade .45s ease ${(row * 6 + ci) * 12}ms both` }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{waiting ? "…" : Math.round(s.avg ?? 0)}</span>
            {senior && ci < 3 ? <span className="clip" style={{ maxWidth: "100%", fontSize: 9, fontWeight: 600, opacity: 0.85, lineHeight: 1.1 }}>{subjectName(s.subject)}</span> : null}
          </Link>
        );
      })}
    </>
  );
}

function SubjectLines({ child, before, now, hl, q, say }: { child: StudentDetail; before: { id: string; label: string } | null; now: { id: string; label: string } | null; hl: string | null; q: string | undefined; say: Say }) {
  const y = (v: number) => 176 - v * 1.56;
  const both = child.subjects.filter((s) => now && s.byExam.get(now.id) != null && (!before || s.byExam.get(before.id) != null));
  const colour = (s: StudentDetail["subjects"][number]) => {
    const h = now ? s.byExam.get(now.id) ?? null : null;
    const u = before ? s.byExam.get(before.id) ?? null : null;
    if (h === null || u === null) return "var(--c1)";
    const d = h - u;
    return d <= -10 ? "var(--bad)" : d >= 5 ? "var(--ok)" : "var(--c1)";
  };
  const lines = both
    .map((s, i) => ({ s, i, y1: y(before ? s.byExam.get(before.id) ?? 0 : s.byExam.get(now!.id) ?? 0), y2: y(s.byExam.get(now!.id) ?? 0) }))
    .sort((a, b) => a.y2 - b.y2);
  let prev = -99;
  const placed = lines.map((l) => {
    const ty = Math.max(l.y2 + 4, prev + 12);
    prev = ty;
    return { ...l, ty };
  });
  const over = Math.max(0, prev - 186);
  return (
    <>
      <div className="hs" style={{ display: "flex", gap: 6 }}>
        {both.map((s) => {
          const on = hl === s.subject;
          return (
            <Link key={s.subject} href={qs(BASE, { view: "student", student: child.studentId, exam: q, hl: on ? undefined : s.subject })} scroll={false} replace className={`tap chip${on ? " on" : ""}`} aria-pressed={on}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: on ? "var(--prifg)" : colour(s) }} />
              {subjectName(s.subject)}
            </Link>
          );
        })}
      </div>
      <svg viewBox="0 0 340 200" style={{ width: "100%", maxWidth: 440, height: "auto", alignSelf: "center", overflow: "visible" }} role="img" aria-label={say("Marks by subject, exam to exam", "विषयवार अंक, परीक्षा से परीक्षा")}>
        <line x1={70} x2={70} y1={14} y2={182} style={{ stroke: "var(--bd)" }} />
        <line x1={250} x2={250} y1={14} y2={182} style={{ stroke: "var(--bd)" }} />
        {([[33, "var(--bad)", "4 3"], [50, "var(--bds)", "2 4"], [75, "var(--bds)", "2 4"], [100, "var(--bds)", "2 4"]] as const).map(([v, c, da]) => (
          <g key={v}>
            <line x1={40} x2={262} y1={y(v)} y2={y(v)} style={{ stroke: c, strokeDasharray: da, opacity: 0.7 }} />
            <text x={34} y={y(v) + 3} style={{ fontSize: 10, fill: c, textAnchor: "end" }}>{v}%</text>
          </g>
        ))}
        {placed.map((l) => {
          const on = !hl || hl === l.s.subject;
          const c = colour(l.s);
          const len = Math.hypot(180, l.y2 - l.y1);
          return (
            <g key={l.s.subject} style={{ opacity: on ? 1 : 0.18, transition: "opacity .25s ease" }}>
              <line x1={70} y1={l.y1} x2={250} y2={l.y2} style={{ stroke: c, strokeWidth: hl === l.s.subject ? 4 : 2.5, strokeLinecap: "round", ["--len" as string]: len.toFixed(1), strokeDasharray: len.toFixed(1), animation: `xDraw .9s var(--ease) ${l.i * 90}ms both` }} />
              <circle cx={70} cy={l.y1} r={4} style={{ fill: "var(--card)", stroke: c, strokeWidth: 2 }} />
              <circle cx={250} cy={l.y2} r={5} style={{ fill: c }} />
              <text x={260} y={l.ty - over} style={{ fontSize: 12, fontWeight: 700, fill: c }}>{`${subjectName(l.s.subject)} ${l.s.byExam.get(now!.id)}%`}</text>
            </g>
          );
        })}
        {before ? <text x={70} y={198} style={{ fontSize: 10, fill: "var(--mut)", textAnchor: "middle" }}>{before.label}</text> : null}
        {now ? <text x={250} y={198} style={{ fontSize: 10, fill: "var(--mut)", textAnchor: "middle" }}>{now.label}</text> : null}
      </svg>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 50px 84px 62px", gap: 6, padding: "6px 0", borderBottom: "1px solid var(--bd)", fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>
          <span>{say("Subject", "विषय")}</span>
          <span className="clip" style={{ textAlign: "right" }}>{before?.label ?? ""}</span>
          <span className="clip" style={{ textAlign: "right" }}>{now?.label ?? ""}</span>
          <span style={{ textAlign: "right" }}>{say("Change", "बदलाव")}</span>
        </div>
        {child.subjects.map((s, i) => {
          const h = now ? s.byExam.get(now.id) ?? null : null;
          const u = before ? s.byExam.get(before.id) ?? null : null;
          const d = h !== null && u !== null ? h - u : null;
          const tone = d === null ? ["var(--s2)", "var(--mut)"] : d <= -10 ? ["var(--bads)", "var(--bad)"] : d >= 5 ? ["var(--oks)", "var(--ok)"] : ["var(--s2)", "var(--mut)"];
          return (
            <div key={s.subject} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 50px 84px 62px", gap: 6, padding: "7px 0", alignItems: "center", fontSize: 13, borderTop: i ? "1px solid var(--bd)" : undefined }}>
              <span className="clip" style={{ fontWeight: 600 }}>{subjectName(s.subject)}</span>
              <span className="num" style={{ textAlign: "right", color: "var(--mut)" }}>{u === null ? "—" : `${u}%`}</span>
              <span className="num" style={{ textAlign: "right", fontWeight: 700, color: h !== null && h < 33 ? "var(--bad)" : "var(--fg)" }}>{h === null ? "—" : `${h}%`}</span>
              <span style={{ textAlign: "right" }}>
                <span className="pill num" style={{ background: tone[0], color: tone[1] }}>{d === null ? say("waiting", "बाकी") : d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0"}</span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
