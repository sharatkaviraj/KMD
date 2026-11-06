"use client";

import Link from "@/ui/link";
import { useRef, useState, useTransition } from "react";

import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";
import { initials } from "@/vx/format";
import { DeskHelp, HelpIcon, HelpSheet, LangSeg, TchTop, type HelpStep } from "@/vx/screens/teach/ui/shared";

import { subjectPair } from "./domain/groups";
import { remarkText, type RemarkSuggestion } from "./domain/messages";
import { pickState, resultsLine } from "./domain/pick";
import type { ActionResult } from "./save-types";
import { AiRemarkCard, AiRemarksBar, useAiRemarks } from "@/vx/assist/remarks-assist";

/*
 * Teacher · Marks (design TchMarks `pick` and `remarks`). The sheet itself —
 * list, number pad, check, sent — is the shared marks sheet.
 */

const V = (x: string) => `var(--${x})`;

function Mini({ rows }: { rows: { t: string | Pair; tone?: "row" | "soft" | "btn" | "ok"; r?: string; hl?: boolean }[] }) {
  const { tx } = useVx();
  const K = { row: [24, "card", "fg"], soft: [24, "accs", "accfg"], btn: [30, "pri", "prifg"], ok: [44, "oks", "ok"] } as const;
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((x, i) => {
        const k = x.tone ?? "row";
        const [h, bg, fg] = K[k];
        const center = k === "btn" || k === "ok";
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, height: h, padding: "0 9px", borderRadius: 8, background: V(bg), color: V(fg), border: x.hl ? "2px solid var(--acc)" : k === "row" ? "1px solid var(--bd)" : "1px solid transparent", justifyContent: center ? "center" : "flex-start", fontSize: 11, fontWeight: k === "row" ? 600 : 700, animation: x.hl ? "xPulse 1.8s ease infinite" : "none" }}>
            {k === "ok" ? <Ic n="check" size={22} stroke={2.6} /> : null}
            {x.t ? <span className="tc-el" style={{ flex: center ? "0 1 auto" : 1 }}>{typeof x.t === "string" ? x.t : tx(x.t)}</span> : null}
            {x.r ? <span className="num" style={{ fontWeight: 700, padding: "1px 7px", borderRadius: 6, background: "var(--s3)", color: "var(--fg)" }}>{x.r}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

const PICK_HELP: HelpStep[] = [
  { title: p("Pick the class", "कक्षा चुनें"), body: p("Tap Continue on the class you want.", "जिस कक्षा के अंक भरने हैं उस पर “जारी रखें” दबाएँ।"), pic: <Mini rows={[{ t: p("Class 7 Science", "कक्षा 7 विज्ञान"), r: "12/27" }, { t: p("Continue", "जारी रखें"), tone: "btn", hl: true }, { t: p("Class 8 Science", "कक्षा 8 विज्ञान"), r: "0/28" }]} /> },
  { title: p("Type the mark", "अंक लिखें"), body: p("In the list, two numbers move you to the next child. On the number pad, tap Next child.", "सूची में दो अंक लिखते ही अगला बच्चा आता है। नंबर पैड पर “अगला बच्चा” दबाएँ।"), pic: <Mini rows={[{ t: p("Lokesh", "लोकेश"), r: "38" }, { t: p("Muskan", "मुस्कान"), tone: "soft", r: "5_", hl: true }, { t: p("Nidhi", "निधि") }]} /> },
  { title: p("Check and send", "जाँचें और भेजें"), body: p("See the summary, then send it to the exam office.", "सारांश देखें, फिर परीक्षा विभाग को भेजें।"), pic: <Mini rows={[{ t: p("Average", "औसत"), r: "56" }, { t: p("Send marks", "अंक भेजें"), tone: "btn", hl: true }, { t: "", tone: "ok" }]} /> },
];

const REMARK_HELP: HelpStep[] = [
  { title: p("Pick a child", "बच्चा चुनें"), body: p("Tap a name in the list, or tap Next child.", "सूची में नाम दबाएँ, या “अगला बच्चा”।"), pic: <Mini rows={[{ t: p("10 Ishaan", "10 ईशान"), hl: true }, { t: p("11 Jiya", "11 जिया") }, { t: p("12 Kabir", "12 कबीर") }]} /> },
  { title: p("Tap a suggestion", "सुझाव चुनें"), body: p("Suggestions come from marks and attendance.", "सुझाव अंकों और हाज़िरी से बनते हैं।"), pic: <Mini rows={[{ t: p("Good progress…", "अच्छी प्रगति…"), tone: "soft", hl: true }, { t: p("Sincere and…", "मेहनती और…") }, { t: p("Must come…", "नियमित आए…") }]} /> },
  { title: p("Change the words", "शब्द बदलें"), body: p("Tap Save, or Next child — both save the remark.", "“सहेजें” या “अगला बच्चा” दबाएँ — दोनों से टिप्पणी सहेज जाती है।"), pic: <Mini rows={[{ t: p("Next child", "अगला बच्चा"), tone: "btn", hl: true }, { t: "", tone: "ok" }]} /> },
];

/* ------------------------------------------------------------- pick */

export type PickCard = {
  paperId: string;
  examLabel: { en: string; hi?: string };
  classLabel: string;
  subjectCode: string;
  maxMarks: number;
  entered: number;
  total: number;
  status: "done" | "in_progress" | "not_started" | "empty";
  /** Saved marks the paper cannot hold, which must be fixed before it can count. */
  invalid?: number;
  submittedToName: string | null;
  /** Sent to the exam office, even with blanks: the sheet is read-only now. */
  sent?: boolean;
  /** The exam's marks due date, and whether this unfinished paper is past it. */
  dueOn?: string | null;
  dueLabel?: string | null;
  late?: boolean;
  classSort?: number;
  examId?: string;
};

export type RemarksCard = { classId: string; classLabel: string; done: number; total: number; examLabel: { en: string; hi?: string } };

function MarksTop({ crumb, title, mSub, back, onHelp }: { crumb: string; title: string; mSub: string; back: string; onHelp: () => void }) {
  const { tx } = useVx();
  const label = tx(p("Help", "मदद"));
  return <TchTop crumb={crumb} title={title} actions={<><LangSeg /><DeskHelp onClick={onHelp} label={label} /></>} mBack={back} mTitle={title} mSub={mSub} mAction={<><LangSeg /><HelpIcon onClick={onHelp} label={label} /></>} />;
}

export function TeacherPick({
  cards,
  remarks,
  due,
  crumb,
  noSubjects = false,
}: {
  cards: PickCard[];
  remarks: RemarksCard[];
  due: { label: string; daysLeft: number | null; results: string | null; resultsPast?: boolean } | null;
  crumb: string;
  /** Exams are open, but no paper is hers: she has no subjects yet. */
  noSubjects?: boolean;
}) {
  const { tx, sub } = useVx();
  const [help, setHelp] = useState(false);
  const exam = cards[0]?.examLabel ?? remarks[0]?.examLabel ?? null;

  return (
    <VxPage className="tc">
      <MarksTop crumb={crumb} title={tx(p("Enter marks", "अंक भरें"))} mSub={[exam ? tx(exam) : null, due ? tx(p(`by ${due.label}`, `${due.label} तक`)) : null].filter(Boolean).join(" · ")} back="/teach/more" onHelp={() => setHelp(true)} />
      <main>
        <div className="tc-scr" style={{ maxWidth: 1040 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="tc-h1">{tx(p("What do you want to fill?", "आज क्या भरना है?"))}</span>
            <span className="tc-tb" style={{ color: "var(--mut)" }}>{tx(p("Tap a card. Everything saves by itself.", "कोई कार्ड दबाएँ। सब अपने आप सेव होता है।"))}</span>
          </div>
          {due ? (
            <div className="tc-note" style={{ background: "var(--warns)", color: "var(--warnfg)", alignItems: "center" }}>
              <span className="tc-ibx" style={{ width: 40, height: 40, background: "var(--card)", color: "var(--warn)" }}><Ic n="calendar" /></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="tc-tb" style={{ fontWeight: 700 }}>{tx(p(`Enter by ${due.label}`, `${due.label} तक भरें`))}</span>
                <span className="tc-ts">
                  {due.daysLeft === null ? "" : due.daysLeft >= 0 ? tx(p(`${due.daysLeft} days left`, `${due.daysLeft} दिन बाकी`)) : tx(p(`${-due.daysLeft} days late`, `${-due.daysLeft} दिन देर`))}
                  {due.results ? ` · ${tx(resultsLine(due.results, Boolean(due.resultsPast)))}` : ""}
                </span>
              </span>
            </div>
          ) : null}
          {cards.length > 0 && cards.every((c) => pickState(c).tone === "ok") && remarks.every((r) => r.done >= r.total) ? (
            // Everything is sent: say so, so an empty "to do" is not a puzzle.
            <div className="tc-note" style={{ background: "var(--oks)", color: "var(--ok)", alignItems: "center" }}>
              <Ic n="checkCircle" />
              <span className="tc-tb" style={{ fontWeight: 600 }}>{tx(p("All your papers are sent. Nothing is waiting for you here.", "आपके सभी पेपर भेजे जा चुके हैं। यहाँ आपके लिए कुछ बाकी नहीं।"))}</span>
            </div>
          ) : null}
          {cards.length === 0 && remarks.length === 0 ? (
            <div className="card" style={{ padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
              <span className="tc-av" style={{ width: 64, height: 64, background: "var(--s2)", color: "var(--mut)" }}><Ic n="clipboard" size={28} /></span>
              <span className="tc-h2">{tx(p("Nothing to fill right now", "अभी भरने को कुछ नहीं"))}</span>
              <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(noSubjects ? p("No subjects are in your name yet, so there are no marks to enter. The office adds you to the timetable.", "आपके नाम पर अभी कोई विषय नहीं, इसलिए भरने को अंक नहीं हैं। ऑफ़िस आपको समय-सारणी में जोड़ेगा।") : p("When an exam is open for marks, your class-subjects appear here.", "जब कोई परीक्षा अंकों के लिए खुलेगी, आपकी कक्षा-विषय यहाँ दिखेंगे।"))}</span>
            </div>
          ) : null}
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            {cards.map((c, i) => {
              // A green Done only when every child is sent; otherwise it names what is missing (group 12).
              const st = pickState(c);
              const k: [Pair, string, Pair, string, string, string] =
                st.tone === "ok"
                  ? [st.action, "sec", st.pill, V("oks"), V("ok"), V("ok")]
                  : st.tone === "warn"
                    ? [st.action, "sec", st.pill, V("warns"), V("warnfg"), V("warn")]
                    : st.tone === "acc"
                      ? [st.action, "pri", st.pill, V("accs"), V("accfg"), V("acc")]
                      : [st.action, "sec", st.pill, V("s3"), V("mut"), V("acc")];
              const href = `/teach/marks?paper=${c.paperId}${c.status === "done" ? "&view=submitted" : ""}`;
              const subject = subjectPair(c.subjectCode);
              const title = p(`${c.classLabel} ${subject.en}`, `${c.classLabel.replace(/^Class\b/, "कक्षा")} ${subject.hi ?? subject.en}`);
              return (
                <div key={c.paperId} className="card tc-in" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, border: c.late ? "2px solid var(--bad)" : c.status === "in_progress" ? "2px solid var(--acc)" : "1px solid var(--bd)", animationDelay: `${Math.min(i, 14) * 30}ms` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="tc-ibx" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="clipboard" size={22} /></span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>{tx(c.examLabel)} · {tx(p(`out of ${c.maxMarks}`, `पूर्णांक ${c.maxMarks}`))}</span>
                      <span className="tc-h2">{tx(title)}</span>
                      {sub(title) ? <span className="tc-mi">{sub(title)}</span> : null}
                    </span>
                    <span className="pill" style={{ background: c.late ? "var(--bads)" : k[3], color: c.late ? "var(--bad)" : k[4] }}>{c.late ? tx(p("Late", "देर")) : tx(k[2])}</span>
                  </div>
                  {c.late && c.dueLabel ? <span className="tc-ts" style={{ marginTop: -6, fontWeight: 700, color: "var(--bad)" }}>{tx(p(`Was due ${c.dueLabel}`, `${c.dueLabel} तक भरना था`))}</span> : null}
                  <div className="tc-mbar"><span style={{ width: `${c.total ? Math.round((c.entered / c.total) * 100) : 0}%`, background: k[5] }} /></div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <span className="tc-tb num" style={{ flex: 1, minWidth: 140, fontWeight: 600 }}>
                      {tx(st.line)}
                    </span>
                    <Link href={href} className={`tap btn ${k[1]} tc-mbg tc-mw`}>{tx(k[0])}<Ic n="arrowRight" /></Link>
                  </div>
                </div>
              );
            })}
            {remarks.map((r, i) => {
              const title = p(`${r.classLabel} remarks`, `${r.classLabel.replace(/^Class/, "कक्षा")} टिप्पणियाँ`);
              return (
                <div key={r.classId} className="card tc-in" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, animationDelay: `${Math.min(cards.length + i, 14) * 30}ms` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="tc-ibx" style={{ background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="edit" size={22} /></span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>{tx(p("Report cards · your class", "रिपोर्ट कार्ड · आपकी कक्षा"))}</span>
                      <span className="tc-h2">{tx(title)}</span>
                      {sub(title) ? <span className="tc-mi">{sub(title)}</span> : null}
                    </span>
                    <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>{tx(p("Class teacher", "कक्षा अध्यापक"))}</span>
                  </div>
                  <div className="tc-mbar"><span style={{ width: `${r.total ? Math.round((r.done / r.total) * 100) : 0}%`, background: "var(--ok)" }} /></div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <span className="tc-tb num" style={{ flex: 1, minWidth: 140, fontWeight: 600 }}>{tx(p(`${r.done} of ${r.total} done`, `${r.total} में से ${r.done} पूरी`))}</span>
                    <Link href={`/teach/marks?view=remarks&class=${r.classId}`} className="tap btn sec tc-mbg tc-mw">{r.done ? tx(p("Continue", "जारी रखें")) : tx(p("Start", "शुरू करें"))}<Ic n="arrowRight" /></Link>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="card" style={{ padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, background: "var(--s2)" }}>
            <span className="tc-ibx" style={{ width: 40, height: 40, background: "var(--accs)", color: "var(--accfg)" }}><Ic n="link" /></span>
            <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column" }}>
              <span className="tc-tb" style={{ fontWeight: 600 }}>{tx(p("You can also use your Sampark link", "आप संपर्क लिंक से भी भर सकते हैं"))}</span>
              <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p("The marks land in the same place — use whichever is easier.", "अंक एक ही जगह पहुँचते हैं — जो आसान लगे वही चुनें।"))}</span>
            </span>
            <Link href="/teach/more?view=links" className="tap btn sec tc-mw">{tx(p("My marks links", "मेरे लिंक"))}</Link>
          </div>
        </div>
      </main>
      <HelpSheet open={help} onClose={() => setHelp(false)} title={p("How to enter marks", "अंक कैसे भरें")} sub={p("3 easy steps", "3 आसान कदम")} steps={PICK_HELP} />
    </VxPage>
  );
}

/* ---------------------------------------------------------- remarks */

export type RemarkChild = {
  id: string;
  name: string;
  roll: string | null;
  remark: string | null;
  /** SR number and father, only when another child in the class has the same name. */
  hint?: Pair | null;
  /** Short tag for a chip ("SR 0465"), only for a same-named child. */
  tag?: string | null;
  percent: number | null;
  attendance: number | null;
  suggestions: RemarkSuggestion[];
  /** Strongest and weakest subject this term, in English, for the AI remark. */
  strongest?: string | null;
  weakest?: string | null;
};

const TONES: [string, string][] = [[V("accs"), V("accfg")], [V("infos"), V("info")], [V("oks"), V("ok")], [V("warns"), V("warnfg")]];

export function TeacherRemarks({
  classLabel,
  term,
  examLabel,
  kids,
  save,
  crumb,
}: {
  classLabel: string;
  term: string;
  examLabel: { en: string; hi?: string };
  kids: RemarkChild[];
  save: (input: { studentId: string; term: string; remark: string }) => Promise<ActionResult>;
  crumb: string;
}) {
  const { tx, sub } = useVx();
  const toast = useToast();
  const [remarks, setRemarks] = useState<Record<string, string>>(() => Object.fromEntries(kids.map((c) => [c.id, c.remark ?? ""])));
  // What the school has for each child: a tapped suggestion or typed words are
  // a draft on this device until they are saved (B06).
  const [savedText, setSavedText] = useState<Record<string, string>>(() => Object.fromEntries(kids.filter((c) => c.remark).map((c) => [c.id, c.remark as string])));
  const [savingId, setSavingId] = useState<string | null>(null);
  const sending = useRef<Record<string, string>>({});
  const savedIds = new Set(Object.keys(savedText).filter((id) => savedText[id]));
  const [filter, setFilter] = useState<"all" | "todo" | "done">("all");
  const [currentId, setCurrentId] = useState<string | null>(() => kids.find((c) => !c.remark)?.id ?? kids[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const [help, setHelp] = useState(false);
  const [pending, start] = useTransition();
  const ai = useAiRemarks({ exam: examLabel.en, classLabel });

  const done = savedIds.size;
  const n = kids.length;
  const list = kids.filter((c) => (filter === "all" ? true : filter === "done" ? savedIds.has(c.id) : !savedIds.has(c.id)));
  const mList = kids.filter((c) => (filter === "done" ? savedIds.has(c.id) : !savedIds.has(c.id) || c.id === currentId));
  const child = kids.find((c) => c.id === currentId) ?? null;
  const idx = child ? kids.findIndex((c) => c.id === child.id) : 0;
  const first = child ? child.name : "";
  const text = child ? remarks[child.id] ?? "" : "";
  const savedNow = child ? savedText[child.id] ?? "" : "";
  const dirty = Boolean(child) && text.trim() !== savedNow;
  // Plain words: "Draft on this device" meant nothing to most teachers (smoke 20 Oct).
  const draftLine = !child
    ? null
    : savingId === child.id
      ? tx(p("Saving…", "सहेज रहे हैं…"))
      : dirty && text.trim()
        ? tx(p("Not saved yet — tap Save", "अभी सहेजा नहीं — “सहेजें” दबाएँ"))
        : savedNow
          ? `✓ ${tx(p("Saved", "सहेजा"))}`
          : null;

  /** Save a remark when it differs from what is saved; the same words again only move on. */
  function commit(id: string, value: string, advance: boolean) {
    if (value === (savedText[id] ?? "")) {
      if (advance) next(id);
      return;
    }
    // The same words already on their way (a blur, then Save) are sent once.
    if (sending.current[id] === value) return;
    sending.current[id] = value;
    setSavingId(id);
    start(async () => {
      const r = await save({ studentId: id, term, remark: value }).catch(() => null);
      delete sending.current[id];
      setSavingId(null);
      if (r?.ok) {
        setSavedText((s) => ({ ...s, [id]: value }));
        setRemarks((m) => ({ ...m, [id]: value }));
        ai.saved(id, value);
        if (advance) next(id);
        else setEditing(false);
      } else toast.show({ text: tx(r && !r.ok ? r.message : p("Not saved – retry", "सहेजा नहीं – फिर कोशिश करें")), tone: "bad" });
    });
  }

  /** Put the words back as they were saved; nothing is sent. */
  function removeDraft(id: string) {
    setRemarks((m) => ({ ...m, [id]: savedText[id] ?? "" }));
    setEditing(false);
  }

  function next(fromId: string) {
    const i = kids.findIndex((c) => c.id === fromId);
    const after = [...kids.slice(i + 1), ...kids.slice(0, i)].find((c) => !savedIds.has(c.id) && c.id !== fromId);
    if (!after && savedIds.size >= n) toast.show({ text: tx(p(`All ${n} remarks are done ✓`, `सभी ${n} टिप्पणियाँ पूरी ✓`)) });
    setCurrentId(after?.id ?? kids[Math.min(n - 1, i + 1)]?.id ?? null);
    setEditing(false);
  }

  const progress = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div className="tc-mbar" style={{ flex: 1 }}><span style={{ width: `${n ? Math.round((done / n) * 100) : 0}%`, background: "var(--ok)" }} /></div>
      <span className="num tc-ts" style={{ fontWeight: 700 }}>{tx(p(`${done} of ${n} done`, `${done} / ${n} पूरी`))}</span>
    </div>
  );
  const seg = (opts: ["all" | "todo" | "done", string][]) => {
    const i = Math.max(0, opts.findIndex(([v]) => v === filter));
    return (
      <div className="seg" role="radiogroup" aria-label={tx(p("Show", "दिखाएँ"))} style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0, 1fr))` }}>
        <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${opts.length})`, transform: `translateX(${i * 100}%)` }} />
        {opts.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={filter === v} className={`tap${filter === v ? " on" : ""}`} onClick={() => setFilter(v)}>{l}</button>)}
      </div>
    );
  };
  const facts = child
    ? [
        child.percent !== null ? { t: `${tx(examLabel)} ${Math.round(child.percent)}%`, bg: child.percent < 60 ? V("warns") : V("s3"), fg: child.percent < 60 ? V("warnfg") : V("fg") } : null,
        child.attendance !== null ? { t: tx(p(`Attendance ${child.attendance}%`, `हाज़िरी ${child.attendance}%`)), bg: child.attendance < 75 ? V("bads") : V("oks"), fg: child.attendance < 75 ? V("bad") : V("ok") } : null,
      ].filter((x): x is { t: string; bg: string; fg: string } => x !== null)
    : [];

  return (
    <VxPage className="tc">
      <MarksTop crumb={crumb} title={tx(p("Report card remarks", "रिपोर्ट कार्ड टिप्पणी"))} mSub={`${classLabel} · ${tx(p(`${done} of ${n} done`, `${done}/${n} पूरी`))}`} back="/teach/marks" onHelp={() => setHelp(true)} />
      <main>
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
          <div className="stack" style={{ flex: 1, display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", alignItems: "start" }}>
            <aside className="hide-m" style={{ position: "sticky", top: 64, height: "calc(100dvh - 64px)", overflowY: "auto", borderRight: "1px solid var(--bd)", padding: "18px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {progress}
              {seg([["all", tx(p("Everyone", "सभी"))], ["todo", tx(p("To do", "बाकी"))], ["done", tx(p("Done", "पूरी"))]])}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {list.map((c) => (
                  <button key={c.id} type="button" className="tap row" aria-current={c.id === currentId} onClick={() => { setCurrentId(c.id); setEditing(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 48, padding: "6px 10px", border: 0, borderRadius: 12, background: c.id === currentId ? V("accs") : "transparent", color: "var(--fg)", textAlign: "left" }}>
                    <span className="num" style={{ width: 20, fontSize: 12, color: "var(--mut)" }}>{c.roll ?? ""}</span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span className="tc-el tc-tb" style={{ fontWeight: 600 }}>{c.name}</span>
                      {c.hint ? <span className="tc-el" style={{ fontSize: 11, color: "var(--mut)" }}>{tx(c.hint)}</span> : null}
                    </span>
                    <span className="tc-av" style={{ width: 22, height: 22, background: savedIds.has(c.id) ? V("ok") : V("s3"), color: "var(--onsolid)" }}>{savedIds.has(c.id) ? <Ic n="check" size={13} stroke={3} /> : null}</span>
                  </button>
                ))}
                {list.length === 0 ? <span className="tc-ts" style={{ color: "var(--mut)", padding: "12px 6px" }}>{filter === "done" ? tx(p("None done yet.", "अभी कोई पूरी नहीं।")) : tx(p("All done — well done!", "सब पूरी — शाबाश!"))}</span> : null}
              </div>
            </aside>
            <section className="tc-scr" style={{ maxWidth: 860 }}>
              <div className="only-m" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {progress}
                {seg([["todo", `${tx(p("To do", "बाकी"))} · ${n - done}`], ["done", `${tx(p("Done", "पूरी"))} · ${done}`]])}
                <div className="hs" style={{ display: "flex", gap: 6 }}>
                  {mList.map((c) => (
                    <button key={c.id} type="button" className={`tap chip${c.id === currentId ? " on" : ""}`} aria-pressed={c.id === currentId} onClick={() => { setCurrentId(c.id); setEditing(false); }}>
                      {c.roll ? <span className="num" style={{ opacity: 0.7 }}>{c.roll}</span> : null}
                      {/* The whole name, and the SR number for a same-named child: three chips reading "Aditya" could not be told apart. */}
                      {c.name}
                      {c.tag ? <span className="num" style={{ opacity: 0.7, fontSize: 11 }}>{c.tag}</span> : null}
                      {savedIds.has(c.id) ? <Ic n="check" size={14} stroke={3} /> : null}
                    </button>
                  ))}
                </div>
              </div>
              {done === n && n > 0 ? (
                <div className="tc-note fadein" style={{ background: "var(--oks)", color: "var(--ok)", alignItems: "center" }}>
                  <Ic n="checkCircle" className="tc-pop" />
                  <span className="tc-tb" style={{ fontWeight: 600 }}>{tx(p(`All ${n} remarks are ready. They print on the report cards.`, `सभी ${n} टिप्पणियाँ तैयार। ये रिपोर्ट कार्ड पर छपेंगी।`))}</span>
                </div>
              ) : null}
              <AiRemarksBar ai={ai} missing={kids.filter((c) => !savedIds.has(c.id))} />
              {child ? (
                <>
                  <div className="card" style={{ padding: "16px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
                    <span className="tc-av serif tc-pop" style={{ width: 56, height: 56, fontSize: 20, background: TONES[idx % 4][0], color: TONES[idx % 4][1] }}>{initials(child.name)}</span>
                    <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
                      <span className="tc-h2">{child.name}</span>
                      <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(child.roll ? p(`${classLabel} · Roll ${child.roll} · your class`, `${classLabel} · रोल ${child.roll} · आपकी कक्षा`) : p(`${classLabel} · your class`, `${classLabel} · आपकी कक्षा`))}</span>
                      {child.hint ? <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(child.hint)}</span> : null}
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {facts.map((f) => <span key={f.t} className="pill" style={{ height: 28, padding: "0 10px", fontSize: 12, background: f.bg, color: f.fg }}>{f.t}</span>)}
                    </div>
                  </div>
                  <span className="sech">{tx(p("Suggested remarks · tap one", "सुझाई गई टिप्पणियाँ · एक चुनें"))}</span>
                  {child.suggestions.length === 0 ? (
                    <div className="tc-note" style={{ background: "var(--infos)", color: "var(--info)" }}>
                      <Ic n="info" style={{ marginTop: 2 }} />
                      <span>{tx(p("No marks or attendance yet to suggest from. Write your own below.", "सुझाव के लिए अभी अंक या हाज़िरी नहीं है। नीचे खुद लिखें।"))}</span>
                    </div>
                  ) : null}
                  <div role="radiogroup" aria-label={tx(p("Suggested remarks", "सुझाई टिप्पणियाँ"))} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <AiRemarkCard ai={ai} child={child} current={text} onPick={(value) => { setRemarks((r) => ({ ...r, [child.id]: value })); setEditing(true); }} />
                    {child.suggestions.map((s, i) => {
                      const value = remarkText(s.text);
                      const on = text === value;
                      return (
                        <button
                          key={`${child.id}-${i}`}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          className="tap card tc-in"
                          onClick={() => {
                            // A preview to read and change, not a save: it is kept as a draft until Save or Next.
                            setRemarks((r) => ({ ...r, [child.id]: value }));
                            setEditing(true);
                          }}
                          style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "14px 16px", textAlign: "left", color: "var(--fg)", border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? V("accs") : V("card"), animationDelay: `${i * 30}ms` }}
                        >
                          <span className="tc-ib" style={{ width: 26, height: 26, borderRadius: 13, border: `2px solid ${on ? V("acc") : V("bds")}`, background: on ? V("acc") : "transparent", color: "var(--onsolid)", transition: "background-color .25s ease" }}>{on ? <Ic n="check" size={15} stroke={3} className="tc-pop" /> : null}</span>
                          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                            <span className="tc-tb" style={{ fontWeight: 600 }}>{tx(s.text)}</span>
                            {sub(s.text) ? <span className="tc-ts" style={{ color: "var(--mut)" }}>{sub(s.text)}</span> : null}
                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--acc)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                              {s.source === "marks" ? tx(p("From marks", "अंकों से")) : s.source === "attendance" ? tx(p("From attendance", "हाज़िरी से")) : tx(p("From subjects", "विषयों से"))} · {s.basis}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {/* Always here, so a teacher can write her own words even when suggestions exist (B06). */}
                  <div className="card fadein" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <span className="sech">{tx(p("On the report card", "रिपोर्ट कार्ड पर"))}</span>
                      {child.suggestions.length && text && !editing ? (
                        <button type="button" className="tap btn ghost" onClick={() => setEditing(true)} style={{ height: 36, color: "var(--acc)" }}><Ic n="edit" />{tx(p("Change words", "शब्द बदलें"))}</button>
                      ) : null}
                    </div>
                    {!text || editing || child.suggestions.length === 0 ? (
                      <label className="field">
                        <span>{tx(p("Write my own", "खुद लिखें"))}</span>
                        <textarea className="inp" value={text} maxLength={400} onChange={(e) => setRemarks((r) => ({ ...r, [child.id]: e.target.value }))} onBlur={() => { if (text.trim().length >= 2) commit(child.id, text.trim(), false); }} style={{ minHeight: 84 }} />
                      </label>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 12, background: "var(--s2)", borderLeft: "4px solid var(--acc)" }}>
                        <span className="tc-tb" style={{ fontWeight: 500 }}>{text}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                      <span className="tc-ts" role="status" aria-live="polite" style={{ flex: 1, minWidth: 120, color: dirty ? "var(--warnfg)" : "var(--mut)" }}>{draftLine}</span>
                      {/* Pressing it must not blur the box first, because a blur saves. */}
                      {dirty ? (
                        <button type="button" className="tap btn ghost" disabled={pending} onMouseDown={(e) => e.preventDefault()} onClick={() => removeDraft(child.id)} style={{ height: 36 }}>{tx(p("Undo change", "बदलाव हटाएँ"))}</button>
                      ) : null}
                      {dirty && text.trim().length >= 2 ? (
                        <button type="button" className="tap btn sec" disabled={pending} onMouseDown={(e) => e.preventDefault()} onClick={() => commit(child.id, text.trim(), false)} style={{ height: 36 }}><Ic n="check" />{tx(p("Save", "सहेजें"))}</button>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <span className="tc-tb" style={{ color: "var(--mut)" }}>{tx(p("No children in this class", "इस कक्षा में कोई बच्चा नहीं"))}</span>
              )}
            </section>
          </div>
          {child ? (
            <div className="glass tc-sbar">
              <span style={{ flex: 1, minWidth: 170, display: "flex", flexDirection: "column" }}>
                <span className="tc-tb" style={{ fontWeight: 700 }}>{draftLine ?? tx(p(`Pick a remark for ${first}`, `${first} के लिए टिप्पणी चुनें`))}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{dirty ? tx(p("Next child saves it", "अगला बच्चा दबाने पर सहेजा जाएगा")) : tx(p("Tap a suggestion, or write your own", "सुझाव चुनें या खुद लिखें"))}</span>
              </span>
              <button
                type="button"
                className="tap btn pri tc-mbg tc-mw"
                disabled={pending}
                onClick={() => {
                  // Saves whenever the words differ from what is saved, a changed remark included (B06).
                  const value = text.trim();
                  if (value.length >= 2 && value !== savedNow) commit(child.id, value, true);
                  else next(child.id);
                }}
              >
                {tx(p("Next child", "अगला बच्चा"))}
                <Ic n="arrowRight" />
              </button>
            </div>
          ) : null}
        </div>
      </main>
      <HelpSheet open={help} onClose={() => setHelp(false)} title={p("How to write remarks", "टिप्पणी कैसे लिखें")} sub={p("3 easy steps", "3 आसान कदम")} steps={REMARK_HELP} />
    </VxPage>
  );
}
