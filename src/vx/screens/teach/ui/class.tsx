"use client";

import Link from "next/link";
import { useState } from "react";

import { Ic } from "@/vx/icons";
import { Bi, useVx } from "@/vx/i18n";
import { clock, dayMonth, initials, shortDay } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { SearchBox, Seg } from "@/vx/ui/controls";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, Btn, Card, EmptyState, Pill, Progress, Ring } from "@/vx/ui/primitives";

import type { ClassData, StudentData, SubjectData } from "../data";
import { phoneLinks, type AttentionReason, type Mark } from "../domain/teach";
import { Head } from "./shared";
import "./teach.css";

type View = "class" | "roster" | "subjects";

const REASON: Record<AttentionReason, Pair> = {
  attendance: p("Attendance below 75%", "उपस्थिति 75% से कम"),
  marks: p("Below 33% in a subject", "किसी विषय में 33% से कम"),
  notes: p("Open notes", "खुले नोट्स"),
};

const MARK_TEXT: Record<Mark, Pair> = {
  present: p("Present", "उपस्थित"),
  absent: p("Absent", "अनुपस्थित"),
  half_day: p("Half-day", "आधा दिन"),
  late: p("Late", "देर से"),
  leave: p("Half-day", "आधा दिन"),
};

function pctTone(v: number | null, low: number): "ok" | "warn" | "bad" | "mut" {
  if (v === null) return "mut";
  if (v < low) return "bad";
  if (v < low + 10) return "warn";
  return "ok";
}

function classHref(classId: string, extra = "") {
  return `/teach/class?class=${classId}${extra}`;
}

/* ---------------------------------------------------------------- class */

export function TeachClass({ data, initialView }: { data: ClassData; initialView: View }) {
  const { tx } = useVx();
  const [view, setViewState] = useState<View>(data.kind === "class" ? initialView : "subjects");
  const [q, setQ] = useState("");

  const setView = (next: View) => {
    setViewState(next);
    const url = new URL(window.location.href);
    if (next === "class") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url.toString());
  };

  const mySubjects = data.mySubjects.length ? (
    <Card>
      <Head t={p("My subjects", "मेरे विषय")} icon="book" />
      <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {data.mySubjects.map((s) => (
          <li key={`${s.classId}.${s.subjectId}`}>
            <Link href={`/teach/class?subject=${s.classId}.${s.subjectId}`} className="tap t-tlCard" style={{ color: "var(--fg)" }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, flex: "none" }}>{s.code.slice(0, 3)}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <strong className="clip">{s.name}</strong>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{s.classLabel}{s.periods ? ` · ${tx(p(`${s.periods} periods a week`, `हफ़्ते में ${s.periods} पीरियड`))}` : ""}</span>
              </span>
              <Ic n="chevRight" size={20} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  ) : null;

  if (data.kind === "subjects-only") {
    return (
      <VxPage label="My class">
        <TopBar crumb={tx(p("Teaching", "शिक्षण"))} title={<Bi en="My subjects" hi="मेरे विषय" block={false} />} mTitle={tx(p("My subjects", "मेरे विषय"))} mBack="/teach" />
        <Section>
          <Card>
            <EmptyState icon="users" title={<Bi en="You are not a class teacher" hi="आप कक्षा अध्यापक नहीं हैं" />} body={tx(p("Your subjects are below. Tap one to see the latest marks.", "आपके विषय नीचे हैं। नवीनतम अंक देखने के लिए टैप करें।"))} />
          </Card>
          {mySubjects ?? <Card><EmptyState icon="book" title={tx(p("No subjects assigned yet", "अभी कोई विषय नहीं"))} body={tx(p("The office assigns subjects in the timetable.", "विषय ऑफ़िस समय-सारणी में देता है।"))} /></Card>}
        </Section>
      </VxPage>
    );
  }

  const needs = data.children.filter((c) => c.reasons.length > 0);
  const filtered = data.children.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.rollNo ?? "").includes(q));
  const reg = data.todayRegister;

  return (
    <VxPage label="My class">
      <TopBar
        crumb={tx(p("Teaching", "शिक्षण"))}
        title={<Bi en={`Class ${data.classLabel}`} hi={`कक्षा ${data.classLabel}`} block={false} />}
        mTitle={tx(p(`Class ${data.classLabel}`, `कक्षा ${data.classLabel}`))}
        mSub={tx(p(`${data.children.length} children`, `${data.children.length} बच्चे`))}
        mBack="/teach"
        actions={data.heldClasses.length > 1 ? (
          <span style={{ display: "flex", gap: 6 }}>
            {data.heldClasses.map((c) => (
              <Btn key={c.classId} href={classHref(c.classId)} variant={c.classId === data.classId ? "pri" : "sec"}>{c.classLabel}</Btn>
            ))}
          </span>
        ) : undefined}
      />
      <Section>
        <Seg<View>
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "class", label: tx(p("Overview", "सारांश")) },
            { value: "roster", label: tx(p("Children", "बच्चे")) },
            { value: "subjects", label: tx(p("Subjects", "विषय")) },
          ]}
        />

        {view === "class" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
              <div className="t-count">
                <span style={{ fontSize: 13, color: "var(--mut)" }}><Bi en="Today's attendance" hi="आज की हाज़िरी" /></span>
                {reg ? (
                  <>
                    <b className="num">{reg.present}/{reg.total}</b>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p(`${reg.absent} absent`, `${reg.absent} अनुपस्थित`))}{reg.savedAt ? ` · ${clock(reg.savedAt)}` : ""}</span>
                  </>
                ) : (
                  <>
                    <b style={{ fontSize: 20 }}>{tx(p("Not marked yet", "अभी दर्ज नहीं"))}</b>
                    {data.isHeld ? <Btn variant="pri" icon="calCheck" href={`/teach/attendance?class=${data.classId}`} style={{ marginTop: 6 }}>{tx(p("Mark now", "अभी लगाएँ"))}</Btn> : null}
                  </>
                )}
              </div>
              <div className="t-count" style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <Ring value={data.classAttendance ?? 0} size={64} stroke={8}>
                  <span className="num" style={{ fontWeight: 800, fontSize: 14 }}>{data.classAttendance === null ? "—" : `${data.classAttendance}%`}</span>
                </Ring>
                <span><Bi en="Attendance this session" hi="इस सत्र की उपस्थिति" /></span>
              </div>
              <div className="t-count">
                <span style={{ fontSize: 13, color: "var(--mut)" }}><Bi en="Need you" hi="ध्यान चाहिए" /></span>
                <b className="num">{needs.length}</b>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("children", "बच्चे"))}</span>
              </div>
            </div>

            <Card>
              <Head t={p("Children who need you", "जिन बच्चों को आपकी ज़रूरत है")} icon="flag" />
              {needs.length === 0 ? (
                <EmptyState icon="smile" title={tx(p("Everyone is doing fine", "सब ठीक चल रहे हैं"))} body={tx(p("No one is below 75% attendance or 33% marks.", "कोई भी 75% उपस्थिति या 33% अंक से नीचे नहीं।"))} />
              ) : (
                <div className="t-kids" style={{ marginTop: 12 }}>
                  {needs.map((c) => (
                    <Link key={c.id} href={`/teach/class?student=${c.id}`} className="tap t-kid">
                      <Avatar text={initials(c.name)} seed={c.id} size={40} />
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                        <strong className="clip">{c.name}</strong>
                        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {c.reasons.map((r) => (
                            <Pill key={r} tone={r === "notes" ? "info" : "bad"}>{tx(REASON[r])}</Pill>
                          ))}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            {data.birthdays.length ? (
              <Card>
                <Head t={p("Birthdays this week", "इस हफ़्ते जन्मदिन")} icon="cake" />
                <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {data.birthdays.map((b) => (
                    <li key={b.id}>
                      <Link href={`/teach?sheet=wish`} className="tap btn sec">
                        <Ic n="cake" size={16} /> {b.name} · {b.inDays === 0 ? tx(p("today", "आज")) : tx(p(`in ${b.inDays} days`, `${b.inDays} दिन में`))}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            {mySubjects}
          </>
        ) : null}

        {view === "roster" ? (
          <Card>
            <SearchBox value={q} onChange={setQ} placeholder={tx(p("Search by name or roll no.", "नाम या रोल नंबर से खोजें"))} />
            <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {filtered.map((c) => (
                <li key={c.id}>
                  <Link href={`/teach/class?student=${c.id}`} className="tap t-kid">
                    <span className="t-roll num">{c.rollNo ?? ""}</span>
                    <Avatar text={initials(c.name)} seed={c.id} size={40} />
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <strong className="clip">{c.name}</strong>
                      <span style={{ fontSize: 13, color: "var(--mut)" }}>
                        {c.lowestSubject ? tx(p(`Lowest: ${c.lowestSubject.code} ${c.lowestSubject.pct}%`, `सबसे कम: ${c.lowestSubject.code} ${c.lowestSubject.pct}%`)) : tx(p("No marks yet", "अभी अंक नहीं"))}
                        {c.openNotes ? ` · ${tx(p(`${c.openNotes} notes`, `${c.openNotes} नोट्स`))}` : ""}
                      </span>
                    </span>
                    <Pill tone={pctTone(c.attendancePct, 75)}>{c.attendancePct === null ? "—" : `${c.attendancePct}%`}</Pill>
                  </Link>
                </li>
              ))}
              {filtered.length === 0 ? <EmptyState icon="search" title={tx(p("No child matches", "कोई बच्चा नहीं मिला"))} /> : null}
            </ul>
          </Card>
        ) : null}

        {view === "subjects" ? (
          <>
            <Card>
              <Head t={p("Latest paper in each subject", "हर विषय की नवीनतम परीक्षा")} icon="chart" />
              {data.subjects.length === 0 ? (
                <EmptyState icon="book" title={tx(p("No marks entered yet", "अभी अंक दर्ज नहीं"))} />
              ) : (
                <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.subjects.map((s) => (
                    <li key={s.subjectId}>
                      <Link href={`/teach/class?subject=${data.classId}.${s.subjectId}`} className="tap t-tlCard" style={{ color: "var(--fg)", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <strong>{s.code}</strong>
                          <span style={{ fontSize: 13, color: "var(--mut)" }}>{s.paperLabel} · {tx(p(`${s.marked} marked`, `${s.marked} के अंक`))}</span>
                        </span>
                        <Progress value={s.average ?? 0} max={100} tone={s.average !== null && s.average < 33 ? "var(--bad)" : "var(--acc)"} label={s.average === null ? "—" : `${s.average}%`} />
                        {s.below33 ? <Pill tone="bad" style={{ alignSelf: "flex-start" }}>{tx(p(`${s.below33} below 33%`, `${s.below33} 33% से नीचे`))}</Pill> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {mySubjects}
          </>
        ) : null}
      </Section>
    </VxPage>
  );
}

/* -------------------------------------------------------------- student */

type Tab = "about" | "attendance" | "marks" | "notes";

export function TeachStudent({ data, initialTab, back }: { data: StudentData; initialTab: Tab; back: string }) {
  const { tx } = useVx();
  const [tab, setTab] = useState<Tab>(initialTab);
  const phone = phoneLinks(data.phone);
  const recent = [...data.attendance.days].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 30);
  const absences = data.attendance.days.filter((d) => d.status === "absent").length;

  return (
    <VxPage label="Student">
      <TopBar crumb={tx(p(`Class ${data.classLabel}`, `कक्षा ${data.classLabel}`))} title={data.name} mBack={back} mSub={tx(p(`Class ${data.classLabel}`, `कक्षा ${data.classLabel}`))} />
      <Section>
        <Card>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Avatar text={initials(data.name)} seed={data.id} size={64} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <strong style={{ fontSize: 20 }}>{data.name}</strong>
              <div style={{ color: "var(--mut)", fontSize: 14 }}>
                {tx(p(`Class ${data.classLabel}`, `कक्षा ${data.classLabel}`))}
                {data.rollNo ? ` · ${tx(p(`Roll ${data.rollNo}`, `रोल ${data.rollNo}`))}` : ""}
                {data.admissionNo ? ` · ${data.admissionNo}` : ""}
              </div>
            </div>
            {phone ? (
              <span style={{ display: "flex", gap: 8 }}>
                <Btn variant="sec" big icon="phone" href={phone.tel}>{tx(p("Call", "कॉल"))}</Btn>
                <Btn variant="sec" big icon="message" href={phone.wa} target="_blank">WhatsApp</Btn>
              </span>
            ) : null}
          </div>
        </Card>
        <Seg<Tab>
          label="Tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: "about", label: tx(p("About", "जानकारी")) },
            { value: "attendance", label: tx(p("Attendance", "हाज़िरी")) },
            { value: "marks", label: tx(p("Marks", "अंक")) },
            { value: "notes", label: tx(p("Notes", "नोट्स")) },
          ]}
        />

        {tab === "about" ? (
          <Card>
            <dl style={{ display: "grid", gridTemplateColumns: "minmax(120px,auto) 1fr", gap: "10px 16px", margin: 0 }}>
              <dt style={{ color: "var(--mut)" }}><Bi en="Father" hi="पिता" /></dt><dd style={{ margin: 0 }}>{data.fatherName ?? "—"}</dd>
              <dt style={{ color: "var(--mut)" }}><Bi en="Mother" hi="माता" /></dt><dd style={{ margin: 0 }}>{data.motherName ?? "—"}</dd>
              <dt style={{ color: "var(--mut)" }}><Bi en="Phone" hi="फ़ोन" /></dt><dd style={{ margin: 0 }} className="num">{data.phone ?? "—"}</dd>
              <dt style={{ color: "var(--mut)" }}><Bi en="Birthday" hi="जन्मदिन" /></dt><dd style={{ margin: 0 }}>{data.dateOfBirth ? dayMonth(data.dateOfBirth) : "—"}</dd>
            </dl>
            <p style={{ margin: "16px 0 0", fontSize: 13, color: "var(--mut)", display: "flex", gap: 6, alignItems: "center" }}>
              <Ic n="lock" size={14} /> {tx(p("Fee details are with the office.", "फ़ीस की जानकारी ऑफ़िस के पास है।"))}
            </p>
          </Card>
        ) : null}

        {tab === "attendance" ? (
          <Card>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <Ring value={data.attendance.percent ?? 0} size={72}>
                <span className="num" style={{ fontWeight: 800 }}>{data.attendance.percent === null ? "—" : `${data.attendance.percent}%`}</span>
              </Ring>
              <span>
                <strong>{tx(p(`${data.attendance.present} of ${data.attendance.counted} days`, `${data.attendance.counted} में से ${data.attendance.present} दिन`))}</strong>
                <div style={{ color: "var(--mut)", fontSize: 13 }}>{tx(p(`${absences} absences this session`, `इस सत्र में ${absences} अनुपस्थिति`))}</div>
              </span>
            </div>
            <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {recent.map((d) => (
                <li key={d.day} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--bd)" }}>
                  <span>{shortDay(d.day)}</span>
                  <Pill tone={d.status === "absent" ? "bad" : d.status === "present" || d.status === "late" ? "ok" : "warn"}>{tx(MARK_TEXT[d.status] ?? p(d.status, d.status))}</Pill>
                </li>
              ))}
              {recent.length === 0 ? <EmptyState icon="calendar" title={tx(p("No attendance yet", "अभी हाज़िरी नहीं"))} /> : null}
            </ul>
          </Card>
        ) : null}

        {tab === "marks" ? (
          <Card>
            {data.marks.length === 0 ? (
              <EmptyState icon="book" title={tx(p("No marks yet", "अभी अंक नहीं"))} />
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {data.marks.map((m) => (
                  <li key={`${m.code}-${m.label}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ display: "flex", justifyContent: "space-between" }}>
                      <strong>{m.code}</strong>
                      <span className="num" style={{ color: "var(--mut)" }}>{m.absent ? tx(p("Absent", "अनुपस्थित")) : m.value === null ? "—" : `${m.value}/${m.max ?? "—"}`} · {m.label}</span>
                    </span>
                    <Progress value={m.pct ?? 0} max={100} tone={m.pct !== null && m.pct < 33 ? "var(--bad)" : "var(--acc)"} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {tab === "notes" ? (
          <Card>
            <Head t={p("Notes about this child", "इस बच्चे के नोट्स")} icon="note" action={<Btn variant="pri" icon="plus" href={`/teach/notes?sheet=add&student=${data.id}`}>{tx(p("Add note", "नोट जोड़ें"))}</Btn>} />
            {data.notes.length === 0 ? (
              <EmptyState icon="note" title={tx(p("No notes yet", "अभी कोई नोट नहीं"))} />
            ) : (
              <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {data.notes.map((n) => (
                  <li key={n.id}>
                    <Link href={`/teach/notes?note=${n.id}`} className="tap n-card">
                      <span style={{ fontSize: 13, color: "var(--mut)" }}>{n.writtenByName} · {shortDay(n.createdAt)}</span>
                      <span>{n.body}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </Section>
    </VxPage>
  );
}

/* -------------------------------------------------------------- subject */

export function TeachSubject({ data }: { data: SubjectData }) {
  const { tx } = useVx();
  const sorted = [...data.rows].sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
  return (
    <VxPage label="Subject">
      <TopBar
        crumb={tx(p(`Class ${data.classLabel}`, `कक्षा ${data.classLabel}`))}
        title={`${data.subjectCode} · ${data.classLabel}`}
        mBack={`/teach/class?class=${data.classId}&view=subjects`}
        actions={data.paper ? <Btn variant="pri" icon="edit" href={`/teach/marks?paper=${data.paper.id}`}>{tx(p("Enter marks", "अंक भरें"))}</Btn> : undefined}
      />
      <Section>
        {!data.paper ? (
          <Card><EmptyState icon="book" title={tx(p("No paper yet in this subject", "इस विषय में अभी परीक्षा नहीं"))} /></Card>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
              <div className="t-count">
                <span style={{ fontSize: 13, color: "var(--mut)" }}><Bi en="Class average" hi="कक्षा औसत" /></span>
                <b className="num">{data.average === null ? "—" : `${data.average}%`}</b>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{data.paper.label} · {tx(p(`out of ${data.paper.maxMarks ?? "—"}`, `${data.paper.maxMarks ?? "—"} में से`))}</span>
              </div>
              <div className="t-count">
                <span style={{ fontSize: 13, color: "var(--mut)" }}><Bi en="Below 33%" hi="33% से कम" /></span>
                <b className="num" style={{ color: "var(--bad)" }}>{data.rows.filter((r) => r.pct !== null && r.pct < 33).length}</b>
              </div>
              <div className="t-count">
                <span style={{ fontSize: 13, color: "var(--mut)" }}><Bi en="Not entered" hi="दर्ज नहीं" /></span>
                <b className="num">{data.rows.filter((r) => r.value === null && !r.absent && !r.exempt).length}</b>
              </div>
            </div>
            <Card>
              <Head t={p("Lowest first", "सबसे कम पहले")} icon="list" />
              <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {sorted.map((r) => (
                  <li key={r.id}>
                    <Link href={`/teach/class?student=${r.id}&tab=marks`} className="tap t-kid">
                      <span className="t-roll num">{r.rollNo ?? ""}</span>
                      <strong className="clip" style={{ flex: 1 }}>{r.name}</strong>
                      <span className="num" style={{ color: "var(--mut)" }}>{r.absent ? tx(p("Absent", "अनुपस्थित")) : r.exempt ? tx(p("Exempt", "छूट")) : r.value === null ? "—" : r.value}</span>
                      <Pill tone={pctTone(r.pct, 33)}>{r.pct === null ? "—" : `${r.pct}%`}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </Section>
    </VxPage>
  );
}
