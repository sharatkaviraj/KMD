"use client";

import Link from "@/vx/ui/link";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";

import { applyPromotionAction, buildPromotionListAction, markStudentAction, undoPromotionAction } from "@/app/(app)/student-tools/actions";
import { dateLabel } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Confirm, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar } from "@/vx/ui/page";
import { Btn, EmptyState } from "@/vx/ui/primitives";

import { ActionBar, PeopleStyles } from "@/vx/screens/admissions/ui";
import { planCounts, planPromotion, type PromoMark } from "@/vx/screens/student-tools/logic";

export type PromoteEntry = { id: string; studentId: string; name: string; sr: string; fromClassId: string | null; fromLabel: string; decision: string; newClassId: string | null };
export type PromoteProps = {
  source: string;
  target: string;
  run: { id: string; status: "preview" | "applied" | "rolled_back"; appliedAt: string | null; appliedCount: number; graduatedCount: number } | null;
  sourceClasses: { id: string; label: string }[];
  targetClasses: { id: string; label: string }[];
  entries: PromoteEntry[];
  marks: Record<string, PromoMark>;
  initialMap: Record<string, string>;
  stage: "promote" | "promote-review" | "promoted";
  /** Open these classes' student lists on first draw (the design opens the first). */
  initialOpen?: string[];
};

const mut12: CSSProperties = { fontSize: 12, color: "var(--mut)" };
const note: CSSProperties = { display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5 };

function Chip({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) {
  return <span className="pill num" style={{ height: 30, padding: "0 12px", fontSize: 13, background: bg, color: fg }}>{children}</span>;
}

/** Student tools states `promote`, `promote-review` and `promoted`. */
export function PromoteFlow(props: PromoteProps) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [stage, setStage] = useState(props.run?.status === "applied" ? "promoted" : props.stage);
  const [map, setMap] = useState<Record<string, string>>(props.initialMap);
  const [marks, setMarks] = useState<Record<string, PromoMark>>(props.marks);
  const [open, setOpen] = useState<Set<string>>(new Set(props.initialOpen ?? []));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"apply" | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entries = props.entries;
  const plan = planPromotion(entries.map((e) => ({ id: e.id, studentId: e.studentId, fromClassId: e.fromClassId, decision: e.decision, newClassId: e.newClassId })), map, marks);
  const counts = planCounts(plan);
  const held = entries.filter((e) => marks[e.studentId] === "held");
  const leaving = entries.filter((e) => marks[e.studentId] === "leaving");
  const total = entries.length;
  const targetLabel = (id: string | undefined) => (!id ? null : id === "graduate" ? tx(p("Passes out", "उत्तीर्ण")) : (props.targetClasses.find((t) => t.id === id)?.label ?? null));

  const top = (
    <TopBar
      crumb={`${tx(p("Promote & import", "प्रमोशन व इम्पोर्ट"))} · ${tx(p("Year-end", "वर्ष-अंत"))}`}
      title={stage === "promote" ? tx(p(`Promote to ${props.target}`, `${props.target} में भेजें`)) : stage === "promote-review" ? tx(p("Check and promote", "जाँचें और भेजें")) : tx(p("Promotion done", "प्रमोशन हो गया"))}
      mSub={stage === "promoted" ? `${props.source} → ${props.target}` : `${tx(p("Step", "चरण"))} ${stage === "promote" ? 1 : 2} ${tx(p("of", "/"))} 2 · ${total} ${tx(p("students", "विद्यार्थी"))}`}
      mBack="/student-tools"
      actions={<Btn variant="ghost" icon="chevLeft" href="/student-tools">{tx(p("Back to tools", "टूल्स पर लौटें"))}</Btn>}
    />
  );

  if (!props.run || props.run.status === "rolled_back") {
    return (
      <>
        <PeopleStyles />
        {top}
        <main>
          <div className="pad" style={{ padding: "22px 28px 40px" }}>
            <div className="card">
              <EmptyState
                icon="grad"
                title={tx(p(`Move students from ${props.source} to ${props.target}`, `${props.source} से ${props.target} में भेजें`))}
                body={tx(p("First make the list. Nothing changes until you check it and press Promote.", "पहले सूची बनाएँ। जाँचकर 'भेजें' दबाने तक कुछ नहीं बदलेगा।"))}
                action={
                  <Btn
                    variant="pri"
                    icon="list"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const res = await buildPromotionListAction(props.source, props.target);
                      setBusy(false);
                      if (!res.ok) toast.show({ text: res.message, tone: "bad" });
                      else router.refresh();
                    }}
                  >
                    {busy ? tx(p("Making the list…", "सूची बन रही है…")) : tx(p("Make the promotion list", "प्रमोशन सूची बनाएँ"))}
                  </Btn>
                }
              />
            </div>
          </div>
        </main>
      </>
    );
  }
  const run = props.run;

  async function mark(e: PromoteEntry, kind: PromoMark | null) {
    const before = marks[e.studentId] ?? null;
    setMarks((m) => {
      const next = { ...m };
      if (kind) next[e.studentId] = kind;
      else delete next[e.studentId];
      return next;
    });
    const res = await markStudentAction({ runId: run.id, entryId: e.id, studentId: e.studentId, kind });
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad" });
      setMarks((m) => {
        const next = { ...m };
        if (before) next[e.studentId] = before;
        else delete next[e.studentId];
        return next;
      });
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    const res = await applyPromotionAction({ runId: run.id, classMap: map, marks });
    setBusy(false);
    setConfirm(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setStage("promoted");
    router.replace("/student-tools?view=promoted");
    router.refresh();
  }

  async function undo() {
    setBusy(true);
    const res = await undoPromotionAction(run.id);
    setBusy(false);
    setConfirm(null);
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    toast.show({ text: tx(p("Promotion undone. Everyone is back in last year's class.", "प्रमोशन वापस हुआ। सब पिछली कक्षा में लौटे।")), tone: "ok" });
    router.replace("/student-tools?view=promote");
    router.refresh();
  }

  const classRows = props.sourceClasses.map((c) => ({ ...c, kids: entries.filter((e) => e.fromClassId === c.id) })).filter((c) => c.kids.length > 0);
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const kpis: { label: Pair; value: number; sub: Pair; color: string }[] = [
    { label: p("Move up a class", "अगली कक्षा में"), value: counts.promote, sub: p("Into their next class", "अगली कक्षा में जाएँगे"), color: "var(--pri)" },
    { label: p("Passed out", "उत्तीर्ण"), value: counts.graduate, sub: p("Leave after the last class", "आख़िरी कक्षा के बाद"), color: "var(--c2)" },
    { label: p("Held back", "रुके"), value: held.length, sub: p("Stay in the same class", "उसी कक्षा में रहेंगे"), color: "var(--warn)" },
    { label: p("Leaving", "जा रहे"), value: leaving.length, sub: p("Leave the roll", "रोल से हटेंगे"), color: "var(--bad)" },
  ];

  return (
    <>
      <PeopleStyles />
      {top}
      <main>
        <div className="pp-page">
          {stage === "promoted" ? (
            <div className="pad" style={{ padding: "22px 28px 40px", animation: "xIn .4s var(--ease) both" }}>
              <div className="card" style={{ maxWidth: 620, margin: "0 auto", padding: "30px 26px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
                <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" style={{ animation: "xPopIn .5s var(--spring) both" }}>
                  <circle cx="48" cy="48" r="44" style={{ fill: "var(--oks)" }} />
                  <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: "276.5", strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
                  <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: "60", strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
                </svg>
                <span className="serif" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.25 }}>{tx(p(`${run.appliedCount} students moved to ${props.target}`, `${run.appliedCount} विद्यार्थी ${props.target} में पहुँचे`))}</span>
                <span style={{ fontSize: 14, color: "var(--mut)" }}>{run.appliedAt ? dateLabel(run.appliedAt) : null}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                  <span className="pill num" style={{ background: "var(--oks)", color: "var(--ok)" }}>{run.appliedCount} {tx(p("moved up", "आगे बढ़े"))}</span>
                  <span className="pill num" style={{ background: "var(--infos)", color: "var(--info)" }}>{run.graduatedCount} {tx(p("passed out", "उत्तीर्ण"))}</span>
                  <span className="pill num" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>{Object.keys(props.marks).length} {tx(p("held back or leaving", "रुके या गए"))}</span>
                </div>
                <div className="pp-g2" style={{ width: "100%", marginTop: 10, gap: 10 }}>
                  <Btn variant="pri" icon="users" href="/students" style={{ height: 48 }}>{tx(p("View students", "विद्यार्थी देखें"))}</Btn>
                  <Btn variant="sec" icon="undo" onClick={() => setConfirm("undo")} style={{ height: 48, color: "var(--bad)" }}>{tx(p("Undo promotion", "प्रमोशन वापस लें"))}</Btn>
                </div>
                <span style={mut12}>{tx(p("Undo puts every child back in last year's class. Payments are not touched.", "वापस लेने से सब पिछली कक्षा में लौटेंगे। भुगतान नहीं बदलते।"))}</span>
              </div>
            </div>
          ) : stage === "promote" ? (
            <>
              <div className="pad" style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ ...note, background: "var(--infos)", color: "var(--info)" }}>
                  <Ic n="info" style={{ marginTop: 2 }} />
                  <span>{tx(p("Prepare now — your ticks are kept, and nobody moves until you confirm on the next step.", "अभी तैयारी करें — आपके निशान रहेंगे, और अगले चरण में आपके हाँ कहने तक कोई आगे नहीं बढ़ेगा।"))}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Chip bg="var(--oks)" fg="var(--ok)">{counts.promote} {tx(p("move up", "आगे"))}</Chip>
                  <Chip bg="var(--warns)" fg="var(--warnfg)">{held.length} {tx(p("held back", "रुके"))}</Chip>
                  <Chip bg="var(--bads)" fg="var(--bad)">{leaving.length} {tx(p("leaving", "जा रहे"))}</Chip>
                  <Chip bg="var(--infos)" fg="var(--info)">{counts.graduate} {tx(p("passed out", "उत्तीर्ण"))}</Chip>
                  {counts.manual ? <Chip bg="var(--s3)" fg="var(--fg)">{counts.manual} {tx(p("need a class", "कक्षा बाकी"))}</Chip> : null}
                </div>
                <div className="card" style={{ overflow: "hidden" }}>
                  <div className="st-prow only-d" style={{ minHeight: 40, background: "var(--s2)" }}>
                    <span className="sech">{tx(p("Class now", "अभी की कक्षा"))}</span>
                    <span className="sech">{tx(p("Goes to", "कहाँ जाएगी"))}</span>
                    <span className="sech">{tx(p("Students", "विद्यार्थी"))}</span>
                    <span className="sech">{tx(p("Moving", "बढ़ेंगे"))}</span>
                    <span className="sech">{tx(p("Held back", "रुके"))}</span>
                    <span className="sech">{tx(p("Leaving", "जा रहे"))}</span>
                    <span />
                  </div>
                  {classRows.map((c, i) => {
                    const h = c.kids.filter((k) => marks[k.studentId] === "held").length;
                    const l = c.kids.filter((k) => marks[k.studentId] === "leaving").length;
                    const moving = c.kids.length - h - l;
                    const isOpen = open.has(c.id);
                    const to = targetLabel(map[c.id]);
                    return (
                      <div key={c.id} style={{ borderTop: "1px solid var(--bd)", animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 26}ms both` }}>
                        <div className="st-prow row" style={{ cursor: "pointer" }} onClick={() => toggle(c.id)}>
                          <button type="button" className="tap" aria-expanded={isOpen} onClick={(ev) => { ev.stopPropagation(); toggle(c.id); }} style={{ border: 0, background: "transparent", padding: 0, textAlign: "left", color: "var(--fg)", fontSize: 14, fontWeight: 700 }}>{c.label}</button>
                          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, minWidth: 0 }} onClick={(ev) => ev.stopPropagation()}>
                            <Ic n="arrowRight" size={15} style={{ color: "var(--mut)" }} />
                            <select
                              aria-label={tx(p(`Next class for ${c.label}`, `${c.label} की अगली कक्षा`))}
                              value={map[c.id] ?? ""}
                              onChange={(ev) => setMap((m) => ({ ...m, [c.id]: ev.target.value }))}
                              title={tx(p("Change where this class goes", "यह कक्षा कहाँ जाएगी, बदलें"))}
                              style={{ minWidth: 0, maxWidth: "100%", border: 0, background: "transparent", color: to ? "var(--fg)" : "var(--bad)", fontSize: 14, fontWeight: to ? 400 : 600, padding: 0, cursor: "pointer", appearance: "none", textOverflow: "ellipsis" }}
                            >
                              <option value="">{tx(p("Pick a class", "कक्षा चुनें"))}</option>
                              {props.targetClasses.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                              <option value="graduate">{tx(p("Passes out (leaves school)", "उत्तीर्ण (विद्यालय छोड़ेंगे)"))}</option>
                            </select>
                          </span>
                          <span className="num st-d" style={{ fontSize: 13 }}>{c.kids.length}</span>
                          <span className="num st-d" style={{ fontSize: 13, fontWeight: 700, color: "var(--ok)" }}>{moving}</span>
                          <span className="num st-d" style={{ fontSize: 13, fontWeight: 700, color: h ? "var(--warn)" : "var(--sub)" }}>{h || "—"}</span>
                          <span className="num st-d" style={{ fontSize: 13, fontWeight: 700, color: l ? "var(--bad)" : "var(--sub)" }}>{l || "—"}</span>
                          <span className="num st-m" style={mut12}>{moving}/{c.kids.length}</span>
                          <Ic n="chevDown" style={{ color: "var(--sub)", transform: `rotate(${isOpen ? 180 : 0}deg)`, transition: "transform .3s var(--spring)" }} />
                        </div>
                        {isOpen ? (
                          <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "6px 16px 16px", background: "var(--s2)" }}>
                            <span style={mut12}>{tx(p(`Ticked students move to ${to ?? "the next class"}. Untick anyone held back or leaving.`, `निशान वाले ${to ?? "अगली कक्षा"} में जाएँगे। जो रुकेंगे या जा रहे हैं उनका निशान हटाएँ।`))}</span>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 8 }}>
                              {c.kids.map((k, j) => {
                                const m = marks[k.studentId];
                                const ticked = !m;
                                return (
                                  <div key={k.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "9px 10px", borderRadius: 14, border: `1px solid ${ticked ? "var(--bd)" : "var(--bad)"}`, background: "var(--card)", animation: `xIn .3s var(--ease) ${Math.min(j, 14) * 20}ms both` }}>
                                    <button type="button" role="checkbox" aria-checked={ticked} className="tap" onClick={() => mark(k, ticked ? "held" : null)} style={{ display: "flex", alignItems: "center", gap: 8, border: 0, background: "transparent", padding: 0, color: "var(--fg)", textAlign: "left", width: "100%" }}>
                                      <span aria-hidden="true" style={{ flex: "none", width: 22, height: 22, borderRadius: 7, border: `2px solid ${ticked ? "var(--acc)" : "var(--bds)"}`, background: ticked ? "var(--acc)" : "transparent", color: "var(--onsolid)", display: "flex", alignItems: "center", justifyContent: "center", transition: "background-color .2s ease, border-color .2s ease" }}>
                                        {ticked ? <Ic n="check" size={14} stroke={3} style={{ animation: "xPopIn .3s var(--spring) both" }} /> : null}
                                      </span>
                                      <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                                        <span className="clip" style={{ fontSize: 13, fontWeight: 600 }}>{k.name}</span>
                                        {!ticked ? <span className="clip" style={mut12}>SR {k.sr}</span> : null}
                                      </span>
                                    </button>
                                    {!ticked ? (
                                      <div className="fadein" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                        <button type="button" aria-pressed={m === "held"} className={`tap chip${m === "held" ? " on" : ""}`} style={{ height: 30, padding: "0 10px", fontSize: 12 }} onClick={() => mark(k, "held")}>{tx(p("Held back", "रुकेगा"))}</button>
                                        <button type="button" aria-pressed={m === "leaving"} className={`tap chip${m === "leaving" ? " on" : ""}`} style={{ height: 30, padding: "0 10px", fontSize: 12 }} onClick={() => mark(k, "leaving")}>{tx(p("Leaving", "जा रहा"))}</button>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              <ActionBar hint={counts.manual > 0 ? tx(p(`${counts.manual} students are in classes with no next class picked`, `${counts.manual} विद्यार्थियों की अगली कक्षा नहीं चुनी`)) : tx(p("Tap a class to untick anyone who is held back or leaving.", "जो रुकेंगे या जा रहे हैं उनका निशान हटाने के लिए कक्षा दबाएँ।"))} hintTone={counts.manual > 0 ? "bad" : "mut"}>
                <Btn variant="pri" onClick={() => { setStage("promote-review"); window.scrollTo({ top: 0 }); }} style={{ minWidth: 190 }}>
                  {tx(p("Next: check and confirm", "आगे: जाँचें और हाँ कहें"))}
                  <Ic n="arrowRight" />
                </Btn>
              </ActionBar>
            </>
          ) : (
            <>
              <div className="pad" style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
                  {kpis.map((k, i) => (
                    <div key={k.label.en} className="card rise" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 2, animationDelay: `${i * 30}ms` }}>
                      <span style={{ ...mut12, fontWeight: 600 }}>{tx(k.label)}</span>
                      <span className="num" style={{ fontSize: 26, fontWeight: 700, color: k.color }}>{k.value}</span>
                      <span style={mut12}>{tx(k.sub)}</span>
                    </div>
                  ))}
                </div>
                {counts.manual > 0 ? (
                  <Banner tone="warn" action={<Btn variant="sec" onClick={() => setStage("promote")}>{tx(p("Pick classes", "कक्षा चुनें"))}</Btn>}>
                    {tx(p(`${counts.manual} children have no next class and will stay where they are.`, `${counts.manual} बच्चों की अगली कक्षा नहीं चुनी — वे वहीं रहेंगे।`))}
                  </Banner>
                ) : null}
                {error ? <Banner tone="bad">{error}</Banner> : null}
                <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p(`Where all ${total} go`, `सभी ${total} कहाँ जाएँगे`))}</span>
                    <span style={mut12}>{props.source} → {props.target}</span>
                  </div>
                  <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "var(--s3)" }}>
                    {kpis.map((k, i) => (
                      <span key={k.label.en} style={{ height: 14, width: `${total ? (k.value / total) * 100 : 0}%`, background: k.color, transformOrigin: "left", animation: `xGrowX .8s var(--ease) ${i * 30}ms both` }} />
                    ))}
                  </div>
                  <div className="pp-g2" style={{ gap: 18 }}>
                    {[
                      { title: p("Held back", "रुके"), rows: held.map((e) => ({ id: e.id, name: e.name, sub: tx(p(`Stays in ${e.fromLabel}`, `${e.fromLabel} में रहेंगे`)) })) },
                      { title: p("Leaving", "जा रहे"), rows: leaving.map((e) => ({ id: e.id, name: e.name, sub: e.fromLabel })) },
                    ].map((g) => (
                      <div key={g.title.en} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span className="sech">{tx(g.title)} · {g.rows.length}</span>
                        {g.rows.length === 0 ? <span style={mut12}>{tx(p("Nobody", "कोई नहीं"))}</span> : null}
                        {g.rows.map((x) => (
                          <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 7, borderTop: "1px solid var(--bd)" }}>
                            <span className="clip" style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{x.name}</span>
                            <span style={mut12}>{x.sub}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ ...note, background: "var(--warns)", color: "var(--warnfg)" }}>
                  <Ic n="rupee" style={{ marginTop: 2 }} />
                  <span>
                    <b>{tx(p("Pending fees stay with the student.", "बकाया फीस विद्यार्थी के साथ रहती है।"))}</b>{" "}
                    {tx(p("Nothing is waived or moved. A child who still owes fees cannot pass out — the list stops and names them; collect first, or mark them held back.", "कुछ माफ़ या आगे नहीं होता। जिनकी फीस बाकी है वे उत्तीर्ण नहीं होंगे — सूची रुककर नाम बताएगी; पहले फीस लें या उन्हें रोकें।"))}
                  </span>
                </div>
                <Link href="/fee-setup" className="tap" style={{ ...note, justifyContent: "space-between", alignItems: "center", background: "var(--s2)", color: "var(--fg)" }}>
                  {tx(p(`${props.target} fee plans and installments come from Fee setup`, `${props.target} की फीस योजना और किस्तें फीस सेटअप से आती हैं`))}
                  <Ic n="arrowRight" />
                </Link>
              </div>
              <ActionBar hint={tx(p("You can undo the promotion afterwards.", "प्रमोशन बाद में वापस ले सकते हैं।"))}>
                <Btn variant="sec" onClick={() => setStage("promote")}>{tx(p("Back", "पीछे"))}</Btn>
                <Btn variant="pri" icon="grad" disabled={busy || counts.promote + counts.graduate === 0} onClick={() => setConfirm("apply")} style={{ minWidth: 200 }}>
                  {tx(p(`Promote ${counts.promote + counts.graduate} students`, `${counts.promote + counts.graduate} विद्यार्थी आगे भेजें`))}
                </Btn>
              </ActionBar>
            </>
          )}
        </div>
      </main>

      <Confirm
        open={confirm === "apply"}
        onClose={() => setConfirm(null)}
        onConfirm={apply}
        busy={busy}
        icon="grad"
        title={tx(p(`Move students to ${props.target}?`, `विद्यार्थियों को ${props.target} में भेजें?`))}
        body={tx(p(`${counts.promote} move up, ${counts.graduate} pass out, ${counts.skip + counts.manual} stay. Fees for the new session are prepared after this.`, `${counts.promote} आगे, ${counts.graduate} उत्तीर्ण, ${counts.skip + counts.manual} वहीं। इसके बाद नए सत्र की फीस बनेगी।`))}
        confirmLabel={tx(p("Promote", "आगे भेजें"))}
      />
      <Confirm
        open={confirm === "undo"}
        onClose={() => setConfirm(null)}
        onConfirm={undo}
        busy={busy}
        danger
        icon="undo"
        title={tx(p("Undo the promotion?", "प्रमोशन वापस लें?"))}
        body={tx(p("Every child goes back to last year's class. Payments are not touched.", "हर बच्चा पिछली कक्षा में लौटेगा। भुगतान नहीं बदलेंगे।"))}
        confirmLabel={tx(p("Undo promotion", "प्रमोशन वापस लें"))}
      />
    </>
  );
}
