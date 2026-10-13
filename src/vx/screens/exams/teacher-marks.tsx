"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";
import { initials } from "@/vx/format";
import { HelpSheet, LangSeg, TchTop, type HelpStep } from "@/vx/screens/teach/ui/shared";

import { remarkText, type RemarkSuggestion } from "./domain/messages";
import type { ActionResult } from "./save-types";

/*
 * Teacher · Marks (design TchMarks `pick` and `remarks`). The sheet itself —
 * list, number pad, check, sent — is the shared marks sheet.
 */

const V = (x: string) => `var(--${x})`;

function Mini({ rows }: { rows: { t: string; tone?: "row" | "soft" | "btn" | "ok"; r?: string; hl?: boolean }[] }) {
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
            {x.t ? <span className="tc-el" style={{ flex: center ? "0 1 auto" : 1 }}>{x.t}</span> : null}
            {x.r ? <span className="num" style={{ fontWeight: 700, padding: "1px 7px", borderRadius: 6, background: "var(--s3)", color: "var(--fg)" }}>{x.r}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

const PICK_HELP: HelpStep[] = [
  { title: p("Pick the class", "कक्षा चुनें"), body: p("Tap Continue on the class you want.", "जिस कक्षा के अंक भरने हैं उस पर “जारी रखें” दबाएँ।"), pic: <Mini rows={[{ t: "Class 7 Science", r: "12/27" }, { t: "Continue", tone: "btn", hl: true }, { t: "Class 8 Science", r: "0/28" }]} /> },
  { title: p("Type the mark", "अंक लिखें"), body: p("After two numbers it jumps to the next child by itself.", "दो अंक लिखते ही अगला बच्चा अपने आप आ जाता है।"), pic: <Mini rows={[{ t: "Lokesh", r: "38" }, { t: "Muskan", tone: "soft", r: "5_", hl: true }, { t: "Nidhi" }]} /> },
  { title: p("Check and send", "जाँचें और भेजें"), body: p("See the summary, then send it to the exam office.", "सारांश देखें, फिर परीक्षा विभाग को भेजें।"), pic: <Mini rows={[{ t: "Average", r: "56" }, { t: "Send", tone: "btn", hl: true }, { t: "", tone: "ok" }]} /> },
];

const REMARK_HELP: HelpStep[] = [
  { title: p("Pick a child", "बच्चा चुनें"), body: p("Tap a name in the list, or tap Next child.", "सूची में नाम दबाएँ, या “अगला बच्चा”।"), pic: <Mini rows={[{ t: "10 Ishaan", hl: true }, { t: "11 Jiya" }, { t: "12 Kabir" }]} /> },
  { title: p("Tap a suggestion", "सुझाव चुनें"), body: p("Suggestions come from marks and attendance.", "सुझाव अंकों और हाज़िरी से बनते हैं।"), pic: <Mini rows={[{ t: "Good progress…", tone: "soft", hl: true }, { t: "Sincere and…" }, { t: "Must come…" }]} /> },
  { title: p("Change the words", "शब्द बदलें"), body: p("Your remark saves as you go. Then Next child.", "टिप्पणी अपने आप सेव होती है। फिर अगला बच्चा।"), pic: <Mini rows={[{ t: "Next child", tone: "btn", hl: true }, { t: "", tone: "ok" }]} /> },
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
  submittedToName: string | null;
};

export type RemarksCard = { classId: string; classLabel: string; done: number; total: number; examLabel: { en: string; hi?: string } };

function MarksTop({ crumb, title, mSub, back, onHelp }: { crumb: string; title: string; mSub: string; back: string; onHelp: () => void }) {
  const { tx } = useVx();
  const help = (size: number) => (
    <button type="button" className="tap btn ghost" aria-label={tx(p("Help for this screen", "इस स्क्रीन की मदद"))} onClick={onHelp} style={{ width: size, height: size === 44 ? 44 : undefined, padding: 0, borderRadius: size === 44 ? 22 : undefined, color: "var(--fg)" }}>
      <Ic n="help" size={22} />
    </button>
  );
  return <TchTop crumb={crumb} title={title} actions={<><LangSeg />{help(42)}</>} mBack={back} mTitle={title} mSub={mSub} mAction={<><LangSeg />{help(44)}</>} />;
}

export function TeacherPick({
  cards,
  remarks,
  due,
  crumb,
}: {
  cards: PickCard[];
  remarks: RemarksCard[];
  due: { label: string; daysLeft: number | null; results: string | null } | null;
  crumb: string;
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
                  {due.results ? ` · ${tx(p(`results on ${due.results}`, `परिणाम ${due.results}`))}` : ""}
                </span>
              </span>
            </div>
          ) : null}
          {cards.length === 0 && remarks.length === 0 ? (
            <div className="card" style={{ padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
              <span className="tc-av" style={{ width: 64, height: 64, background: "var(--s2)", color: "var(--mut)" }}><Ic n="clipboard" size={28} /></span>
              <span className="tc-h2">{tx(p("Nothing to fill right now", "अभी भरने को कुछ नहीं"))}</span>
              <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p("When an exam is open for marks, your class-subjects appear here.", "जब कोई परीक्षा अंकों के लिए खुलेगी, आपकी कक्षा-विषय यहाँ दिखेंगे।"))}</span>
            </div>
          ) : null}
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            {cards.map((c, i) => {
              const k: [Pair, string, Pair, string, string, string] =
                c.status === "done"
                  ? [p("View", "देखें"), "sec", p("Done ✓", "पूरा ✓"), V("oks"), V("ok"), V("ok")]
                  : c.status === "in_progress"
                    ? [p("Continue", "जारी रखें"), "pri", p("In progress", "चल रहा है"), V("accs"), V("accfg"), V("acc")]
                    : [p("Start", "शुरू करें"), "sec", p("Not started", "शुरू नहीं"), V("s3"), V("mut"), V("acc")];
              const href = `/teach/marks?paper=${c.paperId}${c.status === "done" ? "&view=submitted" : ""}`;
              const title = p(`${c.classLabel} ${c.subjectCode}`, `${c.classLabel.replace(/^Class/, "कक्षा")} ${c.subjectCode}`);
              return (
                <div key={c.paperId} className="card tc-in" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, border: c.status === "in_progress" ? "2px solid var(--acc)" : "1px solid var(--bd)", animationDelay: `${Math.min(i, 14) * 30}ms` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="tc-ibx" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="clipboard" size={22} /></span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>{tx(c.examLabel)} · {tx(p(`out of ${c.maxMarks}`, `${c.maxMarks} में से`))}</span>
                      <span className="tc-h2">{tx(title)}</span>
                      {sub(title) ? <span className="tc-mi">{sub(title)}</span> : null}
                    </span>
                    <span className="pill" style={{ background: k[3], color: k[4] }}>{tx(k[2])}</span>
                  </div>
                  <div className="tc-mbar"><span style={{ width: `${c.total ? Math.round((c.entered / c.total) * 100) : 0}%`, background: k[5] }} /></div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <span className="tc-tb num" style={{ flex: 1, minWidth: 140, fontWeight: 600 }}>
                      {c.status === "done" ? tx(p(`All ${c.total} sent${c.submittedToName ? ` to ${c.submittedToName}` : ""}`, `सभी ${c.total} भेज दिए`)) : tx(p(`${c.entered} of ${c.total} entered`, `${c.total} में से ${c.entered} भरे`))}
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
                    <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>{tx(p("Class teacher", "कक्षा अध्यापिका"))}</span>
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
  percent: number | null;
  attendance: number | null;
  suggestions: RemarkSuggestion[];
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
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(kids.filter((c) => c.remark).map((c) => c.id)));
  const [filter, setFilter] = useState<"all" | "todo" | "done">("all");
  const [currentId, setCurrentId] = useState<string | null>(() => kids.find((c) => !c.remark)?.id ?? kids[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const [help, setHelp] = useState(false);
  const [pending, start] = useTransition();

  const done = savedIds.size;
  const n = kids.length;
  const list = kids.filter((c) => (filter === "all" ? true : filter === "done" ? savedIds.has(c.id) : !savedIds.has(c.id)));
  const mList = kids.filter((c) => (filter === "done" ? savedIds.has(c.id) : !savedIds.has(c.id) || c.id === currentId));
  const child = kids.find((c) => c.id === currentId) ?? null;
  const idx = child ? kids.findIndex((c) => c.id === child.id) : 0;
  const first = child ? child.name.split(" ")[0] : "";
  const text = child ? remarks[child.id] ?? "" : "";

  function commit(id: string, value: string, advance: boolean) {
    start(async () => {
      const r = await save({ studentId: id, term, remark: value }).catch(() => null);
      if (r?.ok) {
        setSavedIds((s) => new Set(s).add(id));
        if (advance) next(id);
      } else toast.show({ text: tx(r && !r.ok ? r.message : p("Not saved", "सहेजा नहीं गया")), tone: "bad" });
    });
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
                    <span className="tc-el tc-tb" style={{ flex: 1, fontWeight: 600 }}>{c.name}</span>
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
                      <span className="num" style={{ opacity: 0.7 }}>{c.roll ?? ""}</span>
                      {c.name.split(" ")[0]}
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
              {child ? (
                <>
                  <div className="card" style={{ padding: "16px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
                    <span className="tc-av serif tc-pop" style={{ width: 56, height: 56, fontSize: 20, background: TONES[idx % 4][0], color: TONES[idx % 4][1] }}>{initials(child.name)}</span>
                    <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
                      <span className="tc-h2">{child.name}</span>
                      <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p(`${classLabel} · Roll ${child.roll ?? "—"} · your class`, `${classLabel} · रोल ${child.roll ?? "—"}`))}</span>
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
                            setRemarks((r) => ({ ...r, [child.id]: value }));
                            commit(child.id, value, false);
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
                  {text || child.suggestions.length === 0 || editing ? (
                    <div className="card fadein" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span className="sech">{tx(p("On the report card", "रिपोर्ट कार्ड पर"))}</span>
                        {child.suggestions.length ? (
                          <button type="button" className="tap btn ghost" onClick={() => setEditing(!editing)} style={{ height: 36, color: "var(--acc)" }}><Ic n="edit" />{editing ? tx(p("Done editing", "संपादन पूरा")) : tx(p("Change words", "शब्द बदलें"))}</button>
                        ) : null}
                      </div>
                      {editing || child.suggestions.length === 0 ? (
                        <label className="field">
                          <span>{tx(p("Your words", "आपके शब्द"))}</span>
                          <textarea className="inp" value={text} maxLength={400} onChange={(e) => setRemarks((r) => ({ ...r, [child.id]: e.target.value }))} onBlur={() => { if (text.trim().length >= 2) commit(child.id, text.trim(), false); }} style={{ minHeight: 84 }} />
                        </label>
                      ) : null}
                      {text ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 12, background: "var(--s2)", borderLeft: "4px solid var(--acc)" }}>
                          <span className="tc-tb" style={{ fontWeight: 500 }}>{text}</span>
                          <span className="tc-ts" style={{ color: "var(--mut)" }}>{savedIds.has(child.id) ? tx(p("Saved", "सेव हुई")) : tx(p("Not saved yet", "अभी सेव नहीं"))}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <span className="tc-tb" style={{ color: "var(--mut)" }}>{tx(p("No children in this class", "इस कक्षा में कोई बच्चा नहीं"))}</span>
              )}
            </section>
          </div>
          {child ? (
            <div className="glass tc-sbar">
              <span style={{ flex: 1, minWidth: 170, display: "flex", flexDirection: "column" }}>
                <span className="tc-tb" style={{ fontWeight: 700 }}>{savedIds.has(child.id) ? `✓ ${tx(p("Saved as draft · just now", "ड्राफ़्ट सेव · अभी"))}` : tx(p(`Pick a remark for ${first}`, `${first} के लिए टिप्पणी चुनें`))}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Tap a suggestion, or change the words", "सुझाव चुनें या शब्द बदलें"))}</span>
              </span>
              <button
                type="button"
                className="tap btn pri tc-mbg tc-mw"
                disabled={pending}
                onClick={() => {
                  const value = text.trim();
                  if (value.length >= 2 && !savedIds.has(child.id)) commit(child.id, value, true);
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
