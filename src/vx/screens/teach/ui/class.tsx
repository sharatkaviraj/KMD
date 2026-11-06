"use client";

import { PrivatePhoto } from "@/modules/collection/ui/private-photo";
import { ProfilePhotoControl } from "@/modules/collection/ui/profile-photo-editor";
import Link from "@/ui/link";
import { useState, type ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { dayMonth, initials } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";

import type { ClassData, MarksLink, StudentData, SubjectData } from "../data";
import { ATTENTION_RULES, genderSplit, periodPhases, phoneLinks, rosterBadges } from "../domain/teach";
import { closedTitle } from "../domain/today";
import { dShort, hm12, shortClass, andList } from "./fmt";
import { LangSeg, TchTop } from "./shared";
import { ChildSummary } from "@/vx/assist/summary-assist";

/*
 * Teacher · My class & subjects (design TchClass). The class teacher's class
 * on one page (who is in it, today's register, marks by subject, who needs
 * attention, today's timetable, birthdays), the roster, a child's page with
 * no money (RULES F), her subjects across classes, and one class-subject.
 * Views by `?view=roster|subjects`, `?student=`, `?subject=`.
 */

type View = "class" | "roster" | "subjects";
type Child = Extract<ClassData, { kind: "class" }>["children"][number];

const V = (x: string) => `var(--${x})`;
const TONES: [string, string][] = [[V("accs"), V("accfg")], [V("infos"), V("info")], [V("oks"), V("ok")], [V("warns"), V("warnfg")], [V("s3"), V("fg")]];
const LOOK = { bad: [V("bads"), V("bad")], warn: [V("warns"), V("warnfg")], ok: [V("oks"), V("ok")], info: [V("infos"), V("info")], mut: [V("s3"), V("mut")] } as const;
const tone = (seed: string | number) => TONES[(Number(seed) || String(seed).length) % 5];
const subjectIcon = (name: string): IconName => (/science|physics|chem|bio|evs/i.test(name) ? "flask" : "book");

/** The attendance ring around an avatar (green from 85%, amber from 75%, else red). */
function Ring({ pct, size = 56, children }: { pct: number | null; size?: number; children: ReactNode }) {
  const c = 157.08;
  const d = ((pct ?? 0) / 100) * c;
  const rc = pct === null ? V("bds") : pct < 75 ? V("bad") : pct < 85 ? V("warn") : V("ok");
  return (
    <span className="tc-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r="25" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: size > 60 ? 3 : 4 }} />
        <circle cx="28" cy="28" r="25" style={{ fill: "none", stroke: rc, strokeWidth: size > 60 ? 3 : 4, strokeLinecap: "round", strokeDasharray: `${d.toFixed(1)} ${c}`, ["--len" as string]: d.toFixed(1), animation: "xDraw .8s var(--ease) both" }} />
      </svg>
      {children}
    </span>
  );
}
const ringColor = (pct: number | null) => (pct === null ? V("mut") : pct < 75 ? V("bad") : pct < 85 ? V("warn") : V("ok"));

/** The bar a section heads with: title, its other language, an optional trailing piece. */
function Title({ t, trail, icon, iconTone }: { t: Pair; trail?: ReactNode; icon?: IconName; iconTone?: [string, string] }) {
  const { tx, sub } = useVx();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {icon ? <span className="tc-ic" style={{ background: iconTone?.[0] ?? V("s3"), color: iconTone?.[1] ?? V("mut") }}><Ic n={icon} /></span> : null}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(t)}</span>
        {sub(t) ? <span className="tc-hn">{sub(t)}</span> : null}
      </span>
      {trail}
    </div>
  );
}

function ClassHelp({ open, onClose, steps }: { open: boolean; onClose: () => void; steps: [IconName, Pair, Pair][] }) {
  const { tx, sub } = useVx();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(p("How this page works", "यह पेज कैसे काम करता है"))}
      sub={tx(p("3 quick steps", "3 आसान कदम"))}
      footer={<button type="button" className="tap btn pri tc-cbig" style={{ flex: 1 }} onClick={onClose}>{tx(p("Got it", "ठीक है"))}{sub(p("Got it", "ठीक है")) ? ` · ${sub(p("Got it", "ठीक है"))}` : ""}</button>}
    >
      <div className="tc-sb" style={{ gap: 12 }}>
        {steps.map(([icon, t, d], i) => (
          <div key={t.en} className="tc-in" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 16, background: "var(--s2)", animationDelay: `${i * 90}ms` }}>
            <span className="tc-ib" style={{ position: "relative", width: 64, height: 64, borderRadius: 20, background: TONES[i][0], color: TONES[i][1] }}>
              <Ic n={icon} size={30} />
              <span className="tc-av" style={{ position: "absolute", top: -6, left: -6, width: 24, height: 24, fontSize: 12, background: "var(--pri)", color: "var(--prifg)" }}>{i + 1}</span>
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(t)}</span>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(d)}</span>
            </span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/** The top bar every TchClass view shares: Back on a sub-view, the round EN | हि, "?". */
function ClassTop({ crumb, title, mTitle, mSub, back, speak, onHelp }: { crumb: string; title: string; mTitle: string; mSub: string; back?: string; speak?: string; onHelp: () => void }) {
  const { tx } = useVx();
  const backBtn = back ? (
    <Link href={back} className="tap btn ghost tc-x" aria-label={tx(p("Back", "पीछे"))} style={{ color: "var(--fg)" }}>
      <Ic n="chevLeft" size={24} />
    </Link>
  ) : null;
  const help = (
    <button type="button" className="tap btn ghost tc-x" aria-label={tx(p("Help for this screen", "इस स्क्रीन की मदद"))} onClick={onHelp} style={{ color: "var(--fg)" }}>
      <Ic n="help" size={22} />
    </button>
  );
  return (
    <TchTop
      dLead={backBtn}
      crumb={crumb}
      title={title}
      actions={
        <>
          {speak ? <Link href={speak} className="tap btn pri"><Ic n="mic" />{tx(p("Speak a note", "बोलकर नोट लिखें"))}</Link> : null}
          <LangSeg pill />
          {help}
        </>
      }
      mLead={backBtn ?? undefined}
      mBack={back ? undefined : "/teach/more"}
      mTitle={mTitle}
      mSub={mSub}
      mAction={
        <>
          <LangSeg pill />
          {help}
        </>
      }
    />
  );
}

/* ---------------------------------------------------------------- class */

export function TeachClass({ data, initialView }: { data: ClassData; initialView: View }) {
  const { tx, sub } = useVx();
  const [view, setViewState] = useState<View>(data.kind === "class" ? initialView : "subjects");
  const [q, setQ] = useState("");
  const [filt, setFilt] = useState<"all" | "attn" | "low" | "bday" | "notes">("all");
  const [help, setHelp] = useState(false);

  const setView = (next: View) => {
    setViewState(next);
    const url = new URL(window.location.href);
    if (next === "class") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url.toString());
  };

  const isClass = data.kind === "class";
  const classLabel = isClass ? data.classLabel : "";
  const n = isClass ? data.children.length : 0;

  /* ------------------------------------------------- the top segment */
  const topSeg = isClass && view !== "roster" ? (
    <div className="pad" style={{ padding: "18px 28px 0" }}>
      <div className="seg tc-sg" role="radiogroup" aria-label="View" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", maxWidth: 480 }}>
        <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 2)", transform: `translateX(${view === "subjects" ? "100%" : "0%"})` }} />
        {([["class", p(`My class · ${classLabel}`, "मेरी कक्षा")], ["subjects", p("My subjects", "मेरे विषय")]] as const).map(([v, t]) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} className={`tap${view === v ? " on" : ""}`} onClick={() => setView(v)}>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.15 }}>
              {tx(t)}
              {sub(t) ? <span className="tc-hn">{sub(t)}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  /* -------------------------------------------------- subjects view */
  const subjectsView = (
    <SubjectsView mySubjects={data.mySubjects} links={data.links} />
  );

  if (!isClass) {
    return (
      <VxPage label="My subjects" className="tc">
        <ClassTop crumb={tx(p("Teacher · my subjects", "अध्यापक · मेरे विषय"))} title={tx(p("My subjects", "मेरे विषय"))} mTitle={tx(p("My subjects", "मेरे विषय"))} mSub={subjectsLine(data.mySubjects)} onHelp={() => setHelp(true)} />
        <main>{subjectsView}</main>
        <ClassHelp open={help} onClose={() => setHelp(false)} steps={SUBJECT_HELP} />
      </VxPage>
    );
  }

  const needs = data.children.filter((c) => c.reasons.length > 0);
  // Only when every child has a gender recorded; a partial count read as fact (BUG-10).
  const split = genderSplit(data.children.map((c) => c.gender));
  const reg = data.todayRegister;
  const why = (c: Child) =>
    [
      c.reasons.includes("attendance") && c.attendancePct !== null ? { label: tx(p(`Attendance ${Math.round(c.attendancePct)}%`, `उपस्थिति ${Math.round(c.attendancePct)}%`)), t: LOOK.bad } : null,
      c.reasons.includes("marks") && c.lowestSubject ? { label: tx(p(`${c.lowestSubject.code} below 33%`, `${c.lowestSubject.code} 33% से कम`)), t: LOOK.bad } : null,
      c.openNotes ? { label: tx(p(`${c.openNotes} open ${c.openNotes === 1 ? "note" : "notes"}`, `${c.openNotes} खुले नोट`)), t: LOOK.warn } : null,
    ].filter((x): x is { label: string; t: readonly [string, string] } => x !== null);
  const kidHref = (id: string) => `/teach/class?student=${id}`;

  /* ---------------------------------------------------- class view */
  const subjAvg = data.subjects.filter((s) => s.average !== null);
  const classAvg = subjAvg.length ? Math.round(subjAvg.reduce((a, s) => a + (s.average ?? 0), 0) / subjAvg.length) : null;
  const tt = data.timetable;
  const phases = periodPhases(tt, data.nowMinutes);
  const ttRows: { key: string; no: string; time: string; subj: string; who: string; kind: "done" | "now" | "me" | "break" | "" }[] = [];
  tt.forEach((x, i) => {
    const prev = tt[i - 1];
    if (prev && prev.ends && x.starts && prev.ends < x.starts && x.number - prev.number === 1) {
      const gap = (Number(x.starts.slice(0, 2)) * 60 + Number(x.starts.slice(3))) - (Number(prev.ends.slice(0, 2)) * 60 + Number(prev.ends.slice(3)));
      ttRows.push({ key: `b${i}`, no: "", time: hm12(prev.ends), subj: tx(p("Break", "छुट्टी")), who: tx(p(`${gap} minutes`, `${gap} मिनट`)), kind: "break" });
    }
    ttRows.push({ key: `p${x.period}-${x.subjectName}`, no: `P${x.number}`, time: hm12(x.starts), subj: x.subjectName, who: x.mine ? tx(p("You", "आप")) : x.teacher, kind: phases[i] === "done" ? "done" : phases[i] === "now" ? "now" : x.mine ? "me" : "" });
  });
  const stack = data.children.slice(0, 7);

  const classView = (
    <div className="pad stack" style={{ padding: "16px 28px 40px", display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      <div className="tc-cc">
        <div className="card rise" style={{ order: 1, padding: 22, display: "flex", flexDirection: "column", gap: 14, background: "var(--pri)", color: "var(--prifg)", borderColor: "transparent" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", opacity: 0.82 }}>
            <Ic n="users" size={16} />
            {tx(p("My class", "मेरी कक्षा"))}{sub(p("My class", "मेरी कक्षा")) ? ` · ${sub(p("My class", "मेरी कक्षा"))}` : ""}
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
              <span className="serif" style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.05 }}>{tx(p(`${n} children`, `${n} बच्चे`))}</span>
              <span style={{ fontSize: 14, opacity: 0.86 }}>{[sub(p(`${n} children`, `${n} बच्चे`)), split ? tx(p(`${split.girls} girls · ${split.boys} boys`, `${split.girls} लड़कियाँ · ${split.boys} लड़के`)) : null, classLabel].filter(Boolean).join(" · ")}</span>
            </span>
            <button type="button" className="tap" onClick={() => setView("roster")} aria-label={tx(p(`See all ${n} children`, `सभी ${n} बच्चे देखें`))} style={{ display: "flex", alignItems: "center", border: 0, background: "transparent", padding: "0 0 0 10px", color: "inherit" }}>
              {stack.map((k, i) => (
                <span key={k.id} className="tc-av" style={{ width: 40, height: 40, fontSize: 12, marginLeft: -10, background: TONES[i % 5][0], color: TONES[i % 5][1], border: "2px solid var(--pri)", animation: `xPopIn .4s var(--spring) ${i * 50 + 120}ms both` }}>{initials(k.name)}</span>
              ))}
              {n > stack.length ? <span className="tc-av num" style={{ width: 40, height: 40, fontSize: 12, marginLeft: -10, background: "var(--prifg)", color: "var(--pri)", border: "2px solid var(--pri)" }}>+{n - stack.length}</span> : null}
            </button>
          </div>
          <span style={{ fontSize: 14, opacity: 0.9 }}>{data.isHeld ? tx(p("You are the class teacher. You see everything about these children — except fees, which stay with the office.", "आप कक्षा अध्यापक हैं। इन बच्चों की हर जानकारी आपके पास है — फ़ीस को छोड़कर, जो ऑफ़िस के पास रहती है।")) : tx(p("You can see this class’s children. Fees stay with the office.", "आप इस कक्षा के बच्चों को देख सकते हैं। फ़ीस ऑफ़िस के पास रहती है।"))}</span>
          <button type="button" className="tap btn tc-cbig" onClick={() => setView("roster")} style={{ alignSelf: "flex-start", background: "var(--prifg)", color: "var(--pri)" }}>
            <Ic n="users" />
            {tx(p(`See all ${n} children`, `सभी ${n} बच्चे देखें`))}
          </button>
        </div>

        <div className="card rise" style={{ order: 2, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, animationDelay: "60ms" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="tc-ic" style={{ background: "var(--s3)", color: "var(--mut)" }}><Ic n="calCheck" /></span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p("Today’s attendance", "आज की हाज़िरी"))}</span>
              <span className="tc-hn">{sub(p("Today’s attendance", "आज की हाज़िरी")) ? `${sub(p("Today’s attendance", "आज की हाज़िरी"))} · ` : ""}{dShort(data.today)}</span>
            </span>
            {reg ? (
              <span className="pill" style={{ height: 28, padding: "0 12px", fontSize: 12, background: "var(--oks)", color: "var(--ok)" }}><Ic n="check" size={13} />{tx(p("Saved", "सेव हुई"))}</span>
            ) : data.closed ? (
              <span className="pill" style={{ height: 28, padding: "0 12px", fontSize: 12, background: "var(--s3)", color: "var(--mut)" }}>{tx(p("School closed", "स्कूल बंद"))}</span>
            ) : (
              <span className="pill" style={{ height: 28, padding: "0 12px", fontSize: 12, background: "var(--s3)", color: "var(--mut)" }}><span style={{ width: 9, height: 9, borderRadius: 5, border: "2px dashed var(--mut)" }} />{tx(p("Not marked", "नहीं लगी"))}</span>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18 }}>
            <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 10 }}>
              {reg ? (
                <>
                  <span style={{ fontSize: 14 }}>{tx(p(`${reg.present} present · ${reg.absent} absent${reg.halfDay ? ` · ${reg.halfDay} half-day` : ""}`, `${reg.present} उपस्थित · ${reg.absent} अनुपस्थित${reg.halfDay ? ` · ${reg.halfDay} आधा दिन` : ""}`))}{reg.savedAt ? ` · ${tx(p(`saved at ${hm12(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(reg.savedAt)))}`, "सेव हुई"))}` : ""}</span>
                  <Link href={`/teach/attendance?class=${data.classId}&day=${data.today}`} className="tap btn sec tc-cbig mfull" style={{ alignSelf: "flex-start" }}><Ic n="eye" />{tx(p("See or change", "देखें या बदलें"))}</Link>
                </>
              ) : data.closed ? (
                // A holiday asks for no register (smoke 20 Oct: "Not marked · Mark attendance" on Dussehra).
                <span style={{ fontSize: 14 }}>{tx(closedTitle(data.closed))}. {tx(p("No attendance today.", "आज हाज़िरी नहीं लगेगी।"))}</span>
              ) : (
                <>
                  <span style={{ fontSize: 14 }}>{tx(p(`${classLabel} is not marked yet. Until you press Save attendance, the office sees “Not marked”.`, `${classLabel} की हाज़िरी अभी नहीं लगी। सेव दबाने तक ऑफ़िस को “नहीं लगी” दिखेगी।`))}</span>
                  {data.isHeld ? (
                    <Link href={`/teach/attendance?class=${data.classId}`} className="tap btn pri tc-cbig mfull" style={{ alignSelf: "flex-start" }}>
                      <Ic n="calCheck" />
                      {tx(p("Mark attendance", "हाज़िरी लगाएँ"))}{sub(p("Mark attendance", "हाज़िरी लगाएँ")) ? ` · ${sub(p("Mark attendance", "हाज़िरी लगाएँ"))}` : ""}
                    </Link>
                  ) : null}
                </>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, margin: "0 auto" }}>
              <span style={{ position: "relative", width: 96, height: 96 }}>
                <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="48" cy="48" r="40" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 10 }} />
                  <circle cx="48" cy="48" r="40" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 10, strokeLinecap: "round", strokeDasharray: `${((data.classAttendance ?? 0) / 100) * 251.3} 251.3`, ["--len" as string]: String(((data.classAttendance ?? 0) / 100) * 251.3), animation: "xDraw 1s var(--ease) both" }} />
                </svg>
                <span className="tc-ib num" style={{ position: "absolute", inset: 0, fontSize: 22, fontWeight: 700 }}>{data.classAttendance === null ? "—" : `${data.classAttendance}%`}</span>
              </span>
              <span className="tc-s">{tx(p("This session", "इस सत्र"))}</span>
            </div>
          </div>
        </div>

        <div className="card rise" style={{ order: 4, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, animationDelay: "120ms" }}>
          <Title t={p("Latest marks · average per subject", "नवीनतम अंक · विषय औसत")} trail={classAvg !== null ? <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}><span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{classAvg}%</span><span className="tc-s">{tx(p("class average", "कक्षा औसत"))}</span></span> : null} />
          {data.subjects.length === 0 ? <span className="tc-s">{tx(p("No marks entered yet.", "अभी अंक दर्ज नहीं।"))}</span> : null}
          {data.subjects.map((s, j) => {
            const full = s.marked >= n && n > 0;
            const pct = s.average ?? 0;
            return (
              <Link key={s.subjectId} href={`/teach/class?subject=${data.classId}.${s.subjectId}`} className="tc-in" style={{ display: "flex", flexDirection: "column", gap: 6, color: "inherit", animationDelay: `${j * 70}ms` }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="tc-el" style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{s.code} <span className="tc-s">· {s.paperLabel}</span></span>
                  <span className="tc-s num" style={{ color: full ? V("ok") : V("warnfg") }}>{full ? tx(p(`${n} of ${n} ✓`, `${n} में से ${n} ✓`)) : tx(p(`${s.marked} of ${n} entered`, `${n} में से ${s.marked}`))}</span>
                  <span className="num" style={{ width: 46, textAlign: "right", fontSize: 14, fontWeight: 700 }}>{s.average === null ? "—" : `${pct}%`}</span>
                </span>
                <span className="tc-cbar" style={{ height: 10 }}><span style={{ width: `${pct}%`, background: pct < 55 ? V("c3") : V("c1"), opacity: full ? 1 : 0.55, animationDelay: `${j * 70}ms` }} /></span>
              </Link>
            );
          })}
          <span className="tc-s">{tx(p("Every subject teacher fills their own marks.", "हर विषय अध्यापक अपने अंक खुद भरते हैं।"))}</span>
        </div>

        {ttRows.length ? (
          <div className="card rise" style={{ order: 5, padding: "16px 16px 10px", display: "flex", flexDirection: "column", gap: 4, animationDelay: "160ms" }}>
            <div style={{ padding: "0 4px 6px" }}>
              <Title t={p(`${classLabel} timetable today`, "आज की समय-सारणी")} trail={<span className="tc-s">{dShort(data.today)}</span>} />
            </div>
            {ttRows.map((r, i) => {
              const tg = r.kind === "done" ? [tx(p("Done", "हो गया")), V("s3"), V("mut")] : r.kind === "now" ? [tx(p("Now", "अभी")), V("acc"), V("onsolid")] : null; // Her own period already says "You" under the subject and is tinted; a second "You" pill read "You You" (6 Nov).
              return (
                <div key={r.key} className="tc-in" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", borderRadius: 12, background: r.kind === "now" ? V("accs") : r.kind === "break" ? "transparent" : r.kind === "me" ? V("warns") : V("s2"), border: r.kind === "now" ? "1px solid var(--acc)" : r.kind === "break" ? "1px dashed var(--bd)" : "1px solid transparent", opacity: r.kind === "done" ? 0.6 : 1, animationDelay: `${Math.min(i, 14) * 30}ms` }}>
                  <span className="num" style={{ flex: "none", width: 46, display: "flex", flexDirection: "column" }}><span style={{ fontSize: 13, fontWeight: 700 }}>{r.no}</span><span className="tc-s">{r.time}</span></span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}><span className="tc-el" style={{ fontSize: 14, fontWeight: 600 }}>{r.subj}</span><span className="tc-s tc-el">{r.who}</span></span>
                  {tg ? <span className="pill" style={{ background: tg[1], color: tg[2] }}>{tg[0]}</span> : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="tc-cc">
        <div className="card rise" style={{ order: 3, padding: "16px 14px 10px", display: "flex", flexDirection: "column", gap: 2, animationDelay: "90ms" }}>
          <div style={{ padding: "0 4px 8px" }}>
            <Title t={p("Children who need attention", "इन बच्चों पर ध्यान दें")} icon="alert" iconTone={[V("bads"), V("bad")]} trail={<span className="pill num" style={{ height: 26, minWidth: 26, justifyContent: "center", background: "var(--bads)", color: "var(--bad)", fontSize: 13 }}>{needs.length}</span>} />
          </div>
          {needs.length === 0 ? <span className="tc-s" style={{ padding: "6px" }}>{tx(p("Everyone is doing fine.", "सब ठीक चल रहे हैं।"))}</span> : null}
          {needs.map((c, i) => (
            <Link key={c.id} href={kidHref(c.id)} className="tap row tc-in" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 6px", borderRadius: 12, borderTop: i ? "1px solid var(--bd)" : 0, color: "var(--fg)", animationDelay: `${Math.min(i, 14) * 30}ms` }}>
              <span className="tc-av" style={{ width: 44, height: 44, fontSize: 13, background: tone(c.rollNo ?? i)[0], color: tone(c.rollNo ?? i)[1] }}>{c.photoUrl ? <PrivatePhoto src={c.photoUrl} alt="" loading="lazy" style={{width:"100%",height:"100%",borderRadius:"inherit",objectFit:"cover"}} /> : initials(c.name)}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{c.name} {c.rollNo ? <span className="tc-s num">· {tx(p(`Roll ${c.rollNo}`, `रोल ${c.rollNo}`))}</span> : null}</span>
                <span style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{why(c).map((w) => <span key={w.label} className="pill" style={{ background: w.t[0], color: w.t[1] }}>{w.label}</span>)}</span>
              </span>
              <Ic n="chevRight" style={{ color: "var(--sub)" }} />
            </Link>
          ))}
          <span className="tc-s" style={{ padding: "6px 6px 2px" }}>{tx(p(`The list builds itself: attendance below ${ATTENTION_RULES.attendanceBelow}% (once ${ATTENTION_RULES.minDays} days are marked), any subject below ${ATTENTION_RULES.marksBelow}%, or ${ATTENTION_RULES.openNotes}+ open notes.`, `सूची अपने आप बनती है: ${ATTENTION_RULES.attendanceBelow}% से कम हाज़िरी (${ATTENTION_RULES.minDays} दिन दर्ज होने के बाद), किसी विषय में ${ATTENTION_RULES.marksBelow}% से कम, या ${ATTENTION_RULES.openNotes}+ खुले नोट।`))}</span>
        </div>

        {data.birthdays.length ? (
          <div className="card rise" style={{ order: 6, padding: "14px 12px 8px", display: "flex", flexDirection: "column", gap: 2, animationDelay: "200ms" }}>
            <span style={{ padding: "0 6px 6px", fontSize: 16, fontWeight: 700 }}>{tx(p("Birthdays", "जन्मदिन"))} {sub(p("Birthdays", "जन्मदिन")) ? <span className="tc-hn">· {sub(p("Birthdays", "जन्मदिन"))}</span> : null}</span>
            {data.birthdays.map((b, i) => (
              <Link key={b.id} href={b.inDays === 0 ? "/teach?sheet=wish" : kidHref(b.id)} className="tap row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 6px", borderRadius: 12, color: "var(--fg)" }}>
                <span className="tc-av" style={{ width: 40, height: 40, background: b.inDays === 0 ? V("warns") : TONES[i % 5][0], color: b.inDays === 0 ? V("warnfg") : TONES[i % 5][1] }}><Ic n="cake" /></span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</span>
                  <span className="tc-s">{b.inDays === 0 ? tx(p(`Today · turns ${b.turning}`, `आज · ${b.turning} साल`)) : tx(p(`${dShort(addDaysIso(data.today, b.inDays))} · in ${b.inDays} ${b.inDays === 1 ? "day" : "days"}`, `${b.inDays} दिन में`))}{b.rollNo ? ` · ${tx(p(`Roll ${b.rollNo}`, `रोल ${b.rollNo}`))}` : ""}</span>
                </span>
                {b.inDays === 0 ? <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)", animation: "xPopIn .5s var(--spring) both" }}>{tx(p("Today", "आज"))}</span> : null}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );

  /* ---------------------------------------------------- roster view */
  const FILT: { key: typeof filt; t: Pair; icon: IconName; test: (c: Child) => boolean }[] = [
    { key: "all", t: p("All", "सभी"), icon: "users", test: () => true },
    { key: "attn", t: p("Needs attention", "ध्यान दें"), icon: "alert", test: (c) => c.reasons.length > 0 },
    { key: "low", t: p("Low attendance", "कम हाज़िरी"), icon: "calCheck", test: (c) => c.reasons.includes("attendance") },
    { key: "bday", t: p("Birthdays", "जन्मदिन"), icon: "cake", test: (c) => data.birthdays.some((b) => b.id === c.id) },
    { key: "notes", t: p("Has notes", "नोट हैं"), icon: "note", test: (c) => c.openNotes > 0 },
  ];
  const fdef = FILT.find((f) => f.key === filt) ?? FILT[0];
  const ql = q.trim().toLowerCase();
  const shown = data.children.filter((c) => fdef.test(c) && (!ql || c.name.toLowerCase().includes(ql) || (c.rollNo ?? "") === ql));
  const badges = (c: Child, center?: boolean) => (
    <span data-roster-badges style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: center ? "center" : undefined, minHeight: center ? 22 : undefined }}>
      {rosterBadges(c, data.today, dayMonth).map((b) => <span key={b.key} className="pill" style={{ background: LOOK[b.tone][0], color: b.tone === "mut" ? V("fg") : LOOK[b.tone][1] }}>{tx(b.text)}</span>)}
    </span>
  );
  const rosterView = (
    <div className="pad" style={{ padding: "18px 28px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <label className="tc-srch" style={{ maxWidth: 560 }}>
        <Ic n="search" />
        <span className="sr">{tx(p("Search my class", "मेरी कक्षा में खोजें"))}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(p("Name or roll number · नाम या रोल नंबर", "नाम या रोल नंबर · Name or roll number"))} />
      </label>
      <div className="hs" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {FILT.map((f) => (
          <button key={f.key} type="button" className={`tap chip${filt === f.key ? " on" : ""}`} aria-pressed={filt === f.key} onClick={() => setFilt(f.key)}>
            <Ic n={f.icon} size={15} />
            {tx(f.t)}
            <span className="num" style={{ opacity: 0.7 }}>{data.children.filter(f.test).length}</span>
          </button>
        ))}
      </div>
      <span className="tc-s">{shown.length === n ? tx(p(`All ${n} children · ring shows attendance this session`, `सभी ${n} बच्चे · घेरा इस सत्र की हाज़िरी दिखाता है`)) : tx(p(`${shown.length} of ${n} shown`, `${n} में से ${shown.length}`))}</span>
      <div className="only-d" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {shown.map((c, i) => (
          <Link key={c.id} href={kidHref(c.id)} className="tap card lift tc-in" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, alignItems: "center", textAlign: "center", color: "var(--fg)", animationDelay: `${Math.min(i, 14) * 30}ms` }}>
            <span style={{ alignSelf: "stretch", display: "flex", justifyContent: "space-between" }}>
              <span className="pill num" style={{ background: "var(--s2)", color: "var(--mut)" }}>{tx(p(`Roll ${c.rollNo ?? "—"}`, `रोल ${c.rollNo ?? "—"}`))}</span>
              <span className="num" style={{ fontSize: 12, fontWeight: 700, color: ringColor(c.attendancePct) }}>{c.attendancePct === null ? "—" : `${Math.round(c.attendancePct)}%`}</span>
            </span>
            <Ring pct={c.daysCounted < ATTENTION_RULES.minDays ? null : c.attendancePct}><span className="tc-av" style={{ background: tone(c.rollNo ?? i)[0], color: tone(c.rollNo ?? i)[1] }}>{c.photoUrl ? <PrivatePhoto src={c.photoUrl} alt="" loading="lazy" style={{width:"100%",height:"100%",borderRadius:"inherit",objectFit:"cover"}} /> : initials(c.name)}</span></Ring>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</span>
            {badges(c, true)}
          </Link>
        ))}
      </div>
      <div className="only-m card" style={{ overflow: "hidden" }}>
        {shown.map((c, i) => (
          <Link key={c.id} href={kidHref(c.id)} className="tap row tc-in" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 76, padding: "10px 14px", borderTop: i ? "1px solid var(--bd)" : 0, color: "var(--fg)", animationDelay: `${Math.min(i, 14) * 30}ms` }}>
            <span className="num tc-s" style={{ flex: "none", width: 22, textAlign: "center", fontWeight: 700 }}>{c.rollNo ?? ""}</span>
            <Ring pct={c.daysCounted < ATTENTION_RULES.minDays ? null : c.attendancePct}><span className="tc-av" style={{ background: tone(c.rollNo ?? i)[0], color: tone(c.rollNo ?? i)[1] }}>{c.photoUrl ? <PrivatePhoto src={c.photoUrl} alt="" loading="lazy" style={{width:"100%",height:"100%",borderRadius:"inherit",objectFit:"cover"}} /> : initials(c.name)}</span></Ring>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="tc-el" style={{ fontSize: 16, fontWeight: 600 }}>{c.name}</span>
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, color: ringColor(c.attendancePct) }}>{c.attendancePct === null ? "—" : `${Math.round(c.attendancePct)}%`}</span>
                {badges(c)}
              </span>
            </span>
            <Ic n="chevRight" style={{ color: "var(--sub)" }} />
          </Link>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="card tc-in" style={{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span className="tc-av" style={{ width: 64, height: 64, background: "var(--s2)", color: "var(--mut)" }}><Ic n="search" size={28} /></span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p(`No child matches “${q}”`, `“${q}” से कोई बच्चा नहीं मिला`))}</span>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Try another name or roll number.", "दूसरा नाम या रोल नंबर लिखें।"))}</span>
          <button type="button" className="tap btn pri tc-cbig" onClick={() => { setQ(""); setFilt("all"); }}>{tx(p(`Show all ${n} children`, `सभी ${n} बच्चे दिखाएँ`))}</button>
        </div>
      ) : null}
    </div>
  );

  const head =
    view === "roster"
      ? { crumb: tx(p("My class › Children", "मेरी कक्षा › बच्चे")), title: tx(p(`${classLabel} · all children`, `${classLabel} · सभी बच्चे`)), mTitle: tx(p(`Children · ${classLabel}`, `बच्चे · ${classLabel}`)), mSub: tx(p(`${shown.length} shown`, `${shown.length} दिखाए`)) }
      : view === "subjects"
        ? { crumb: tx(p("Teacher · my subjects", "अध्यापक · मेरे विषय")), title: tx(p("My subjects", "मेरे विषय")), mTitle: tx(p("My subjects", "मेरे विषय")), mSub: subjectsLine(data.mySubjects) }
        : { crumb: tx(p(`Teacher · session ${data.sessionLabel.replace("-", "–")}`, `अध्यापक · सत्र ${data.sessionLabel}`)), title: tx(p(`My class · ${classLabel}`, `मेरी कक्षा · ${classLabel}`)), mTitle: tx(p("My class", "मेरी कक्षा")), mSub: tx(p(`${classLabel} · ${n} children`, `${classLabel} · ${n} बच्चे`)) };

  return (
    <VxPage label="My class" className="tc">
      <ClassTop {...head} back={view === "roster" ? `/teach/class?class=${data.classId}` : undefined} onHelp={() => setHelp(true)} />
      <main>
        {topSeg}
        {view === "class" ? classView : view === "roster" ? rosterView : subjectsView}
      </main>
      <ClassHelp open={help} onClose={() => setHelp(false)} steps={view === "roster" ? ROSTER_HELP : view === "subjects" ? SUBJECT_HELP : CLASS_HELP} />
    </VxPage>
  );
}

/** "Science · Classes 6, 7, 8". */
function subjectsLine(list: { name: string; classLabel: string }[]): string {
  const names = [...new Set(list.map((s) => s.name))].join(", ");
  const classes = [...new Set(list.map((s) => shortClass(s.classLabel)))].join(", ");
  return classes ? `${names} · Classes ${classes}` : names;
}

function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const CLASS_HELP: [IconName, Pair, Pair][] = [
  ["users", p("Your whole class", "आपकी पूरी कक्षा"), p("Attendance, marks and who needs help — all of your class on one page.", "हाज़िरी, अंक और किसे मदद चाहिए — पूरी कक्षा एक पेज पर।")],
  ["alert", p("Who needs attention", "किस पर ध्यान दें"), p("The app picks children with low attendance, low marks or open notes. Tap a name.", "ऐप कम हाज़िरी, कम अंक या खुले नोट वाले बच्चे चुनता है। नाम दबाएँ।")],
  ["calCheck", p("Mark attendance", "हाज़िरी लगाएँ"), p("Tap the big blue button. Until you press Save, the office sees “Not marked”.", "बड़ा नीला बटन दबाएँ। सेव दबाने तक ऑफ़िस को “नहीं लगी” दिखती है।")],
];
const ROSTER_HELP: [IconName, Pair, Pair][] = [
  ["search", p("Find a child", "बच्चा खोजें"), p("Type a name or a roll number.", "नाम या रोल नंबर लिखें।")],
  ["filter", p("Use the chips", "चिप्स इस्तेमाल करें"), p("Show only children who need attention, have notes or a birthday.", "सिर्फ़ ध्यान वाले, नोट वाले या जन्मदिन वाले बच्चे दिखाएँ।")],
  ["chevRight", p("Tap a child", "बच्चे को दबाएँ"), p("See parents, attendance, marks and notes.", "माता-पिता, हाज़िरी, अंक और नोट देखें।")],
];
const SUBJECT_HELP: [IconName, Pair, Pair][] = [
  ["flask", p("Your classes", "आपकी कक्षाएँ"), p("Each card shows the marks entered and opens the class.", "हर कार्ड भरे गए अंक दिखाता है और कक्षा खोलता है।")],
  ["clipboard", p("Enter marks", "अंक भरें"), p("Tap “Marks”. Your Sampark link also works without logging in.", "“अंक” दबाएँ। आपका संपर्क लिंक बिना लॉगिन भी चलता है।")],
  ["arrowRight", p("Open a class", "कक्षा खोलें"), p("See the children and their marks, and send a note to the class teacher.", "बच्चे और उनके अंक देखें, और कक्षा अध्यापक को नोट भेजें।")],
];

/* ------------------------------------------------------------- subjects */

function SubjectsView({ mySubjects, links }: { mySubjects: ClassData["mySubjects"]; links: MarksLink[] }) {
  const { tx } = useVx();
  const toast = useToast();
  const names = [...new Set(mySubjects.map((s) => s.name))];
  const periods = mySubjects.reduce((a, s) => a + (s.periods || 0), 0);
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ text: tx(p("Link copied", "लिंक कॉपी हुआ")) });
    } catch {
      toast.show({ text: tx(p("Could not copy", "कॉपी नहीं हुआ")), tone: "bad" });
    }
  };
  if (mySubjects.length === 0) {
    return (
      <div className="pad" style={{ padding: "16px 28px 40px" }}>
        <div className="card" style={{ padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span className="tc-av" style={{ width: 64, height: 64, background: "var(--s2)", color: "var(--mut)" }}><Ic n="book" size={28} /></span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p("No subjects assigned yet", "अभी कोई विषय नहीं"))}</span>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("The office assigns subjects in the timetable.", "विषय ऑफ़िस समय-सारणी में देता है।"))}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="pad" style={{ padding: "16px 28px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
      <span style={{ fontSize: 14, color: "var(--mut)" }}>
        {names.map((nm) => tx(p(`${nm} for Classes ${andList(mySubjects.filter((s) => s.name === nm).map((s) => shortClass(s.classLabel)))}`, `${nm} — कक्षा ${andList(mySubjects.filter((s) => s.name === nm).map((s) => shortClass(s.classLabel)), "और")}`))).join(" · ")}
        {/* The planned load per class and subject, not timetable slots: a combined
            period counts once per class, so it is labelled apart from the
            "periods a week" More and the timetable count (B12). */}
        {periods ? ` · ${tx(p(`Planned: ${periods} class-periods a week`, `योजना: हफ़्ते में ${periods} कक्षा-पीरियड`))}` : ""}
      </span>
      <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
        {mySubjects.map((s, i) => {
          const link = links.find((l) => l.classLabel === s.classLabel && (l.subjectCode === s.code || l.subjectCode === s.name));
          const entered = link?.entered ?? 0;
          const total = link?.total ?? s.children;
          const st = !link
            ? [tx(p("No paper yet", "अभी कोई पेपर नहीं")), V("bds"), V("mut")]
            : link.submitted
              ? [tx(p("All entered · sent", "सब भरे · भेजे")), V("ok"), V("ok")]
              : entered
                ? [tx(p("In progress", "जारी")), V("acc"), V("warnfg")]
                : [tx(p("Not started", "शुरू नहीं")), V("bds"), V("bad")];
          return (
            <div key={`${s.classId}.${s.subjectId}`} className="card lift rise" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, animationDelay: `${Math.min(i, 14) * 30}ms` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="tc-ic" style={{ width: 48, height: 48, background: "var(--accs)", color: "var(--accfg)" }}><Ic n={subjectIcon(s.name)} size={24} /></span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{s.classLabel} {s.name}</span>
                  <span className="tc-s">{tx(p(`${s.children} children${s.held ? " · class teacher you" : ""}`, `${s.children} बच्चे${s.held ? " · कक्षा अध्यापक आप" : ""}`))}</span>
                </span>
                {s.held ? <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>{tx(p("My class", "मेरी कक्षा"))}</span> : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{link ? tx(p(`${link.exam} marks`, `${link.exam} अंक`)) : tx(p("Marks", "अंक"))}</span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{tx(p(`${entered} of ${total}`, `${total} में से ${entered}`))}</span>
                </span>
                <span className="tc-cbar"><span style={{ width: `${total ? Math.round((entered / total) * 100) : 0}%`, background: st[1] }} /></span>
                <span style={{ fontSize: 12, fontWeight: 600, color: st[2] }}>{st[0]}</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                <Link href={`/teach/class?subject=${s.classId}.${s.subjectId}`} className="tap btn pri tc-cbig" style={{ flex: 1.3, padding: "0 12px" }}>{tx(p("Open class", "कक्षा खोलें"))}<Ic n="arrowRight" /></Link>
                <Link href={link ? `/teach/marks?paper=${link.paperId}` : "/teach/marks"} className="tap btn sec tc-cbig" style={{ flex: 1, padding: "0 12px" }}><Ic n="clipboard" />{tx(p("Marks", "अंक"))}</Link>
              </div>
            </div>
          );
        })}
      </div>
      {links.length ? (
        <div className="card rise" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4, animationDelay: "160ms" }}>
          <div style={{ paddingBottom: 8 }}>
            <Title t={p("Your marks links (Sampark)", "आपके अंक लिंक (संपर्क)")} icon="link" iconTone={[V("infos"), V("info")]} />
          </div>
          {links.map((l) => (
            <div key={l.paperId} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "12px 0", borderTop: "1px solid var(--bd)" }}>
              <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{l.classLabel} · {l.subjectCode} · {l.exam}</span>
                <span className="num" style={{ fontSize: 12, fontWeight: 600, color: l.submitted ? V("ok") : l.entered ? V("warnfg") : V("bad") }}>{l.submitted ? tx(p(`${l.total} of ${l.total} · sent`, `${l.total} में से ${l.total} · भेजे`)) : l.entered ? tx(p(`${l.entered} of ${l.total} · in progress`, `${l.total} में से ${l.entered} · जारी`)) : tx(p(`0 of ${l.total} · not started`, `${l.total} में से 0 · शुरू नहीं`))}</span>
              </span>
              <a href={l.url ?? `/teach/marks?paper=${l.paperId}`} className="tap btn soft">{tx(p("Open", "खोलें"))}</a>
              {l.url ? (
                <>
                  <a href={`https://wa.me/?text=${encodeURIComponent(l.url)}`} target="_blank" rel="noreferrer" className="tap btn sec"><Ic n="message" />{tx(p("Share on WhatsApp", "व्हाट्सऐप पर भेजें"))}</a>
                  <button type="button" className="tap btn ghost" onClick={() => void copy(l.url ?? "")}><Ic n="copy" />{tx(p("Copy", "कॉपी"))}</button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- student */

type Tab = "about" | "attendance" | "marks" | "notes";

const TAG: Record<string, { t: Pair; icon: IconName; bg: string; fg: string }> = {
  studies: { t: p("Studies", "पढ़ाई"), icon: "book", bg: V("infos"), fg: V("info") },
  behaviour: { t: p("Behaviour", "व्यवहार"), icon: "smile", bg: V("accs"), fg: V("accfg") },
  health: { t: p("Health", "सेहत"), icon: "heart", bg: V("bads"), fg: V("bad") },
  family: { t: p("Family", "परिवार"), icon: "home", bg: V("warns"), fg: V("warnfg") },
  talent: { t: p("Talent", "प्रतिभा"), icon: "star", bg: V("oks"), fg: V("ok") },
  attendance: { t: p("Attendance", "हाज़िरी"), icon: "calCheck", bg: V("s3"), fg: V("fg") },
};
const STATUS: Record<string, { t: Pair; tone: keyof typeof LOOK }> = {
  open: { t: p("Open", "खुला"), tone: "warn" },
  working: { t: p("Working on it", "काम जारी"), tone: "info" },
  done: { t: p("Done", "पूरा"), tone: "ok" },
};

/** "98290 ••327": enough to tell numbers apart, not enough to copy. */
function masked(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "").slice(-10);
  if (d.length < 10) return "—";
  return `${d.slice(0, 5)} ••${d.slice(7)}`;
}

export function TeachStudent({ data, initialTab, back }: { data: StudentData; initialTab: Tab; back: string }) {
  const { tx, sub, language } = useVx();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [help, setHelp] = useState(false);
  const phone = phoneLinks(data.phone);
  const first = data.name.split(" ")[0];
  const pct = data.attendance.percent;
  // Same rule as the class list's "Low attendance" chip: a few marked days are
  // not a trend. One half day read as a red "Attendance 50%" while the chip
  // said 0 (6 Nov school day, teacher 14).
  const early = pct !== null && data.attendance.counted < ATTENTION_RULES.minDays;
  const ringPct = early ? null : pct;
  const low = data.marks.filter((m) => m.pct !== null && m.pct < 33);
  const openNotes = data.notes.filter((n) => n.status !== "done").length;
  const why = [
    pct !== null && !early && pct < ATTENTION_RULES.attendanceBelow ? { label: tx(p(`Attendance ${Math.round(pct)}%`, `उपस्थिति ${Math.round(pct)}%`)), t: LOOK.bad } : null,
    ...low.map((m) => ({ label: tx(p(`${m.code} below 33%`, `${m.code} 33% से कम`)), t: LOOK.bad })),
    openNotes ? { label: tx(p(`${openNotes} open ${openNotes === 1 ? "note" : "notes"}`, `${openNotes} खुले नोट`)), t: LOOK.warn } : null,
  ].filter((x): x is { label: string; t: readonly [string, string] } => x !== null);
  const parents = [
    data.fatherName ? { name: data.fatherName, rel: p("Father", "पिता") } : null,
    data.motherName ? { name: data.motherName, rel: p("Mother", "माता") } : null,
  ].filter((x): x is { name: string; rel: Pair } => x !== null);

  // The month grid for the attendance tab: the latest two months with a register.
  const months = [...new Set(data.attendance.days.map((d) => d.day.slice(0, 7)))].sort().slice(-2);
  const [month, setMonth] = useState<string>(months.at(-1) ?? new Date().toISOString().slice(0, 7));
  const dayStatus = new Map(data.attendance.days.map((d) => [d.day, d.status]));
  const [y, m] = month.split("-").map(Number);
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const SC: Record<string, [string, string, string, Pair]> = {
    P: [V("okm"), V("ok"), "1px solid transparent", p("Present", "उपस्थित")],
    A: [V("bad"), V("onsolid"), "1px solid transparent", p("Absent", "अनुपस्थित")],
    H: [V("warnm"), V("warnfg"), "1px solid transparent", p("Half-day", "आधा दिन")],
    S: [V("s3"), V("sub"), "1px solid transparent", p("Sunday", "रविवार")],
    N: ["transparent", V("mut"), "1.5px dashed var(--bds)", p("Not marked", "दर्ज नहीं")],
  };
  const cnt = { P: 0, A: 0, H: 0 };
  const cells = Array.from({ length: daysIn }, (_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, "0")}`;
    const st = dayStatus.get(day);
    const sun = new Date(Date.UTC(y, m - 1, i + 1)).getUTCDay() === 0;
    const k = st ? (st === "absent" ? "A" : st === "half_day" || st === "leave" ? "H" : "P") : sun ? "S" : "N";
    if (k === "P" || k === "A" || k === "H") cnt[k] += 1;
    return { d: i + 1, k, day };
  });
  const monthName = (mm: string) => new Intl.DateTimeFormat("en-GB", { month: "long" }).format(new Date(`${mm}-15T12:00:00Z`));

  const tabs: [Tab, Pair][] = [["about", p("About", "परिचय")], ["attendance", p("Attendance", "हाज़िरी")], ["marks", p("Marks", "अंक")], ["notes", p("Notes", "नोट्स")]];
  const tIdx = tabs.findIndex(([k]) => k === tab);

  return (
    <VxPage label="Student" className="tc">
      <ClassTop
        crumb={tx(p(`My class › ${data.name}`, `मेरी कक्षा › ${data.name}`))}
        title={data.name}
        mTitle={data.name}
        mSub={tx(p(`${data.classLabel}${data.rollNo ? ` · Roll ${data.rollNo}` : ""}`, `${data.classLabel}${data.rollNo ? ` · रोल ${data.rollNo}` : ""}`))}
        back={back}
        speak={`/teach/notes?sheet=add&student=${data.id}`}
        onHelp={() => setHelp(true)}
      />
      <main>
        <div className="pad stack" style={{ padding: "18px 28px 40px", display: "grid", gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
          <div className="tc-cc">
            <div className="card rise tc-hdr" style={{ order: 1, display: "flex", padding: 20, gap: 16 }}>
              <Ring pct={ringPct} size={96}>
                <span className="tc-av serif" style={{ top: 11, left: 11, width: 74, height: 74, fontSize: 26, background: tone(data.rollNo ?? 1)[0], color: tone(data.rollNo ?? 1)[1] }}>{data.photoUrl ? <PrivatePhoto src={data.photoUrl} alt="" style={{width:"100%",height:"100%",borderRadius:"inherit",objectFit:"cover"}} /> : initials(data.name)}</span>
              </Ring>
              <span className="tc-hdc" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="serif" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.15 }}>{data.name}</span>
                <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{[data.classLabel, data.rollNo ? tx(p(`Roll ${data.rollNo}`, `रोल ${data.rollNo}`)) : null, data.admissionNo].filter(Boolean).join(" · ")}</span>
                {why.length ? <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{why.map((w) => <span key={w.label} className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: w.t[0], color: w.t[1] }}>{w.label}</span>)}</span> : null}
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="num" style={{ fontSize: 26, fontWeight: 700, color: ringColor(ringPct) }}>{pct === null ? "—" : `${Math.round(pct)}%`}</span>
                  <span className="tc-s" style={{ textAlign: "left" }}>{tx(p("attendance", "हाज़िरी"))}<br />{early ? tx(p(`from ${data.attendance.counted} ${data.attendance.counted === 1 ? "day" : "days"} so far`, `अभी ${data.attendance.counted} दिन से`)) : tx(p("this session", "इस सत्र"))}</span>
                </span>
                {data.canEditPhoto ? <span><ProfilePhotoControl sheet credential={{ kind: "student", id: data.id }} language={language} /></span> : null}
              </span>
            </div>
            <div className="card" style={{ order: 2, padding: "14px 18px 12px", display: "flex", flexDirection: "column" }}>
              <span className="sech">{tx(p("Parents", "माता-पिता"))}{sub(p("Parents", "माता-पिता")) ? ` · ${sub(p("Parents", "माता-पिता"))}` : ""}</span>
              {parents.length === 0 ? <span className="tc-s" style={{ padding: "10px 0" }}>{tx(p("No parent’s name on record.", "माता-पिता का नाम दर्ज नहीं।"))}</span> : null}
              {parents.map((g, i) => (
                <div key={g.name} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 0", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="tc-av" style={{ width: 38, height: 38, fontSize: 12, background: "var(--s3)", color: "var(--fg)" }}>{initials(g.name)}</span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{g.name}</span>
                      <span className="tc-s num">{tx(g.rel)} · {masked(data.phone)}</span>
                    </span>
                  </span>
                  {phone ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <a href={phone.tel} className="tap btn sec tc-cbig" style={{ flex: 1, padding: "0 10px" }}><Ic n="phone" />{tx(p("Call", "फ़ोन"))}</a>
                      <a href={phone.wa} target="_blank" rel="noreferrer" className="tap btn tc-cbig" style={{ flex: 1, padding: "0 10px", background: "var(--oks)", color: "var(--ok)" }}><Ic n="message" />WhatsApp</a>
                    </div>
                  ) : null}
                </div>
              ))}
              <span className="tc-s">{tx(p("Numbers are partly hidden. The call goes from your own phone.", "नंबर आधे छिपे हैं। फ़ोन आपके अपने फ़ोन से जाता है।"))}</span>
            </div>
            <div className="tc-note" style={{ order: 9, background: "var(--s2)", color: "var(--mut)", fontSize: 13 }}>
              <Ic n="lock" style={{ marginTop: 1 }} />
              <span><b style={{ color: "var(--fg)" }}>{tx(p("Fee details are with the office.", "फ़ीस की जानकारी ऑफ़िस के पास है।"))}</b> {tx(p("If a parent asks about fees, please send them to the office desk.", "अगर माता-पिता फ़ीस पूछें, तो उन्हें ऑफ़िस भेजें।"))}</span>
            </div>
          </div>

          <div style={{ order: 3, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div className="seg tc-sg" role="radiogroup" aria-label="Tab" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
              <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 4)", transform: `translateX(${tIdx * 100}%)` }} />
              {tabs.map(([k, t]) => (
                <button key={k} type="button" role="radio" aria-checked={tab === k} className={`tap${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.15 }}>
                    {tx(t)}
                    {sub(t) ? <span className="tc-hn">{sub(t)}</span> : null}
                  </span>
                </button>
              ))}
            </div>

            {tab === "about" ? (
              <div className="card tc-in" style={{ padding: "6px 18px", display: "flex", flexDirection: "column" }}>
                {([
                  ["calendar", p("Date of birth", "जन्म तिथि"), data.dateOfBirth ? dateLong(data.dateOfBirth) : "—"],
                  ["hash", p("Admission number", "प्रवेश संख्या"), data.admissionNo ?? "—"],
                  ["user", p("Father", "पिता"), data.fatherName ?? "—"],
                  ["user", p("Mother", "माता"), data.motherName ?? "—"],
                ] as [IconName, Pair, string][]).map(([icon, k, v], i) => (
                  <div key={k.en} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                    <span className="tc-ic" style={{ width: 36, height: 36, borderRadius: 11, background: "var(--s2)", color: "var(--mut)" }}><Ic n={icon} /></span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span className="tc-s">{tx(k)}</span>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{v}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {tab === "attendance" ? (
              <div className="card tc-in" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{tx(p("Attendance by day", "दिन के हिसाब से हाज़िरी"))}</span>
                  {months.length > 1 ? (
                    <div className="seg" role="radiogroup" aria-label="Month" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", width: 210 }}>
                      <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 2)", transform: `translateX(${month === months[1] ? "100%" : "0%"})` }} />
                      {months.map((mm) => <button key={mm} type="button" role="radio" aria-checked={month === mm} className={`tap${month === mm ? " on" : ""}`} onClick={() => setMonth(mm)}>{monthName(mm)}</button>)}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
                  {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((w) => <span key={w} style={{ fontSize: 11, fontWeight: 700, color: "var(--mut)", textAlign: "center" }}>{w}</span>)}
                  {Array.from({ length: firstDow }, (_, i) => <span key={`b${i}`} />)}
                  {cells.map((c) => (
                    <span key={c.day} className="tc-ib num" title={`${c.d} ${monthName(month)} · ${tx(SC[c.k][3])}`} style={{ height: 42, borderRadius: 11, fontSize: 12, fontWeight: 600, background: SC[c.k][0], color: SC[c.k][1], border: SC[c.k][2], animation: `xPopIn .3s var(--ease) ${c.d * 12}ms both` }}>{c.d}</span>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
                  {(["P", "A", "H", "S", "N"] as const).map((k) => <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: SC[k][0], border: k === "N" ? SC.N[2] : 0 }} />{tx(SC[k][3])}</span>)}
                </div>
                <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p(`${monthName(month)}: ${cnt.P} present · ${cnt.A} absent · ${cnt.H} half-day`, `${monthName(month)}: ${cnt.P} उपस्थित · ${cnt.A} अनुपस्थित · ${cnt.H} आधा दिन`))}{cnt.P + cnt.A + cnt.H ? ` · ${Math.round((cnt.P / (cnt.P + cnt.A + cnt.H)) * 100)}%` : ""}</span>
                {data.attendance.days.length === 0 ? <span className="tc-s">{tx(p("No attendance yet.", "अभी हाज़िरी नहीं।"))}</span> : null}
              </div>
            ) : null}

            {tab === "marks" ? (
              <div className="card tc-in" style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, paddingBottom: 6 }}>
                  <span style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{tx(p("Latest paper in each subject", "हर विषय का नवीनतम पेपर"))}</span>
                </div>
                {data.marks.length === 0 ? <span className="tc-s" style={{ padding: "10px 0" }}>{tx(p("No marks yet.", "अभी अंक नहीं।"))}</span> : null}
                {data.marks.map((mk, j) => {
                  const lowMark = mk.pct !== null && mk.pct < 33;
                  return (
                    <div key={`${mk.code}-${mk.label}`} className="tc-in" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 0", borderTop: "1px solid var(--bd)", animationDelay: `${j * 60}ms` }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{mk.code}</span></span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="tc-s" style={{ flex: "none", width: 82 }}>{mk.label}</span>
                        <span className="tc-cbar" style={{ flex: 1 }}><span style={{ width: `${mk.pct ?? 0}%`, background: lowMark ? V("bad") : V("c1"), animationDelay: `${j * 60}ms` }} /></span>
                        <span className="num" style={{ flex: "none", width: 64, textAlign: "right", fontSize: 13, fontWeight: 700, color: lowMark ? V("bad") : V("fg") }}>{mk.absent ? tx(p("Absent", "अनुपस्थित")) : mk.value === null ? tx(p("Not yet", "अभी नहीं")) : `${mk.value}/${mk.max ?? "—"}`}</span>
                      </span>
                    </div>
                  );
                })}
                <span className="tc-s" style={{ paddingTop: 6 }}>{tx(p("Shown as a share of full marks. Red means below 33%.", "पूरे अंकों के हिस्से में। लाल मतलब 33% से कम।"))}</span>
              </div>
            ) : null}

            {tab === "notes" ? (
              <>
                <div className="card tc-in" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, alignItems: "center", textAlign: "center", background: "var(--accs)", borderColor: "transparent" }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--accfg)" }}>{tx(p(`Noticed something about ${first}?`, `${first} के बारे में कुछ देखा?`))}</span>
                  <Link href={`/teach/notes?sheet=add&student=${data.id}`} className="tap btn pri tc-cbig"><Ic n="mic" size={22} />{tx(p("Speak a note", "बोलकर लिखें"))}{sub(p("Speak a note", "बोलकर लिखें")) ? ` · ${sub(p("Speak a note", "बोलकर लिखें"))}` : ""}</Link>
                  <span className="tc-s">{tx(p("Speak in Hindi or English — the app writes it down.", "हिंदी या अंग्रेज़ी में बोलें — ऐप लिख देता है।"))}</span>
                </div>
                <ChildSummary
                  childName={data.name}
                  notes={data.notes}
                  facts={data.attendance.percent !== null ? [`Attendance this session: ${Math.round(data.attendance.percent)}%`] : []}
                />
                {data.notes.map((nt, i) => {
                  const lead = TAG[nt.tags[0] ?? "studies"] ?? TAG.studies;
                  const st = STATUS[nt.status] ?? STATUS.open;
                  return (
                    <Link key={nt.id} href={`/teach/notes?note=${nt.id}`} className="card tc-in" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, borderLeft: `4px solid ${lead.fg}`, color: "var(--fg)", animationDelay: `${Math.min(i, 14) * 30}ms` }}>
                      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                        {nt.tags.map((t) => TAG[t]).filter(Boolean).map((t) => <span key={t.t.en} className="pill" style={{ background: t.bg, color: t.fg }}><Ic n={t.icon} size={12} />{tx(t.t)}</span>)}
                        <span style={{ flex: 1 }} />
                        <span className="pill" style={{ background: LOOK[st.tone][0], color: LOOK[st.tone][1] }}>{tx(st.t)}</span>
                      </span>
                      <span style={{ fontSize: 15 }}>{nt.body}</span>
                      <span className="tc-s">{nt.writtenByName} · {dShort(nt.createdAt)}{nt.followUpOn ? ` · ${tx(p(`follow up ${dShort(nt.followUpOn)}`, `फ़ॉलो-अप ${dShort(nt.followUpOn)}`))}` : ""}</span>
                    </Link>
                  );
                })}
                {data.notes.length === 0 ? (
                  <div className="card tc-in" style={{ padding: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center" }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("No notes yet", "अभी कोई नोट नहीं"))}</span>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Notes from you and other teachers will show here.", "आपके और दूसरे शिक्षकों के नोट यहाँ दिखेंगे।"))}</span>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </main>
      <ClassHelp
        open={help}
        onClose={() => setHelp(false)}
        steps={[
          ["phone", p("Call or WhatsApp", "फ़ोन या व्हाट्सऐप"), p("The big buttons call the parent from your phone. Numbers stay partly hidden.", "बड़े बटन आपके फ़ोन से माता-पिता को फ़ोन करते हैं। नंबर आधे छिपे रहते हैं।")],
          ["grid", p("Use the tabs", "टैब इस्तेमाल करें"), p("About · Attendance · Marks · Notes.", "परिचय · हाज़िरी · अंक · नोट्स।")],
          ["mic", p("Speak a note", "बोलकर नोट लिखें"), p("Say what you noticed. The app writes it down for you.", "जो देखा वह बोलें। ऐप लिख देता है।")],
        ]}
      />
    </VxPage>
  );
}

function dateLong(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

/* -------------------------------------------------------------- subject */

export function TeachSubject({ data }: { data: SubjectData }) {
  const { tx, sub } = useVx();
  const [help, setHelp] = useState(false);
  const n = data.rows.length;
  const entered = data.rows.filter((r) => r.value !== null || r.absent || r.exempt).length;
  return (
    <VxPage label="Subject" className="tc">
      <ClassTop
        crumb={tx(p(`My subjects › ${data.classLabel}`, `मेरे विषय › ${data.classLabel}`))}
        title={`${data.classLabel} · ${data.subjectCode}`}
        mTitle={`${data.classLabel} · ${data.subjectCode}`}
        mSub={tx(p(`${n} children`, `${n} बच्चे`))}
        back={`/teach/class?class=${data.classId}&view=subjects`}
        onHelp={() => setHelp(true)}
      />
      <main>
        <div className="pad" style={{ padding: "18px 28px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card rise" style={{ padding: "18px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <span className="tc-ic" style={{ width: 56, height: 56, borderRadius: 18, background: "var(--accs)", color: "var(--accfg)" }}><Ic n={subjectIcon(data.subjectCode)} size={28} /></span>
            <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="serif" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>{data.classLabel} · {data.subjectCode}</span>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p(`${n} children${data.paper ? ` · ${data.paper.label} ${entered} of ${n} entered` : ""}`, `${n} बच्चे${data.paper ? ` · ${data.paper.label} ${n} में से ${entered}` : ""}`))}</span>
            </span>
            {data.average !== null ? <span className="pill num" style={{ height: 32, padding: "0 12px", fontSize: 12, background: "var(--s2)", color: "var(--mut)" }}>{tx(p(`Class average ${data.average}%`, `कक्षा औसत ${data.average}%`))}</span> : null}
          </div>
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
            <div className="tc-cc">
              <div className="card rise" style={{ order: 3, overflow: "hidden", animationDelay: "80ms" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--bd)" }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p(`Children · ${data.subjectCode} marks`, `बच्चे · ${data.subjectCode} के अंक`))}</span>
                    {sub(p(`Children · ${data.subjectCode} marks`, `बच्चे · ${data.subjectCode} के अंक`)) ? <span className="tc-hn">{sub(p(`Children · ${data.subjectCode} marks`, `बच्चे · ${data.subjectCode} के अंक`))}</span> : null}
                  </span>
                  {data.paper ? <span className="tc-s num">{tx(p(`${data.paper.label} · out of ${data.paper.maxMarks ?? "—"}`, `${data.paper.label} · ${data.paper.maxMarks ?? "—"} में से`))}</span> : null}
                </div>
                {!data.paper ? <span className="tc-s" style={{ display: "block", padding: "14px 16px" }}>{tx(p("No paper yet in this subject.", "इस विषय में अभी पेपर नहीं।"))}</span> : null}
                <div className="only-d tc-srow" style={{ minHeight: 38, background: "var(--s2)" }}>
                  <span className="sech">{tx(p("Roll", "रोल"))}</span>
                  <span className="sech">{tx(p("Child", "बच्चा"))}</span>
                  <span className="sech">{data.paper?.label ?? tx(p("Marks", "अंक"))}</span>
                  <span className="sech">%</span>
                </div>
                {data.rows.map((r, i) => {
                  const low = r.pct !== null && r.pct < 33;
                  const mark = r.absent ? tx(p("Absent", "अनुपस्थित")) : r.exempt ? tx(p("Exempt", "छूट")) : r.value === null ? tx(p("Not entered", "दर्ज नहीं")) : `${r.value}/${data.paper?.maxMarks ?? "—"}`;
                  return (
                    <Link key={r.id} href={`/teach/notes?sheet=add&student=${r.id}`} aria-label={tx(p(`Write a note about ${r.name}`, `${r.name} के बारे में नोट लिखें`))} className="tap row tc-srow tc-in" style={{ borderTop: "1px solid var(--bd)", color: "var(--fg)", animationDelay: `${Math.min(i, 14) * 30}ms` }}>
                      <span className="num" style={{ fontSize: 13, fontWeight: 700, color: "var(--mut)" }}>{r.rollNo ?? ""}</span>
                      <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <span className="tc-el" style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
                        <span className="tc-s num only-m">{mark}{r.pct !== null ? ` · ${r.pct}%` : ""}</span>
                      </span>
                      <span className="hide-m"><span className="pill num" style={{ background: r.value === null && !r.absent ? "transparent" : low ? V("bads") : V("s2"), color: r.value === null && !r.absent ? V("sub") : low ? V("bad") : V("fg") }}>{mark}</span></span>
                      <span className="num hide-m" style={{ fontSize: 13, color: low ? V("bad") : V("fg") }}>{r.pct === null ? "—" : `${r.pct}%`}</span>
                    </Link>
                  );
                })}
                <span className="tc-s" style={{ display: "block", padding: "10px 16px 14px" }}>{tx(p("Tap a child to write a note for the class teacher.", "कक्षा अध्यापक के लिए नोट लिखने को बच्चे को दबाएँ।"))}</span>
              </div>
            </div>
            <div className="tc-cc">
              <div className="card rise" style={{ order: 2, padding: 18, display: "flex", flexDirection: "column", gap: 10, animationDelay: "60ms" }}>
                <Title t={p("Note for the class teacher", "कक्षा अध्यापक के लिए नोट")} icon="note" iconTone={[V("warns"), V("warnfg")]} />
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p(`Your note goes straight to the class teacher of ${data.classLabel}. The coordinator can see it too. Parents do not see it.`, `आपका नोट सीधे ${data.classLabel} के कक्षा अध्यापक तक जाता है। समन्वयक भी देख सकते हैं। माता-पिता नहीं देखते।`))}</span>
                <Link href={`/teach/notes?sheet=add&class=${data.classId}`} className="tap btn pri tc-cbig"><Ic n="plus" />{tx(p("Write a note for the class teacher", "कक्षा अध्यापक को नोट लिखें"))}</Link>
                {data.paper ? <Link href={`/teach/marks?paper=${data.paper.id}`} className="tap btn soft tc-cbig"><Ic n="clipboard" />{tx(p("Enter marks", "अंक भरें"))}</Link> : null}
              </div>
            </div>
          </div>
        </div>
      </main>
      <ClassHelp
        open={help}
        onClose={() => setHelp(false)}
        steps={[
          ["users", p("Children and marks", "बच्चे और अंक"), p("Each child’s mark in the latest paper.", "नवीनतम पेपर में हर बच्चे के अंक।")],
          ["note", p("Tap a child", "बच्चे को दबाएँ"), p("Write a note for the class teacher about that child.", "उस बच्चे के बारे में कक्षा अध्यापक को नोट लिखें।")],
          ["clipboard", p("Enter marks", "अंक भरें"), p("Open the marks sheet for this paper.", "इस पेपर की अंक शीट खोलें।")],
        ]}
      />
    </VxPage>
  );
}
