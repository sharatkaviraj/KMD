"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";
import { Seg, Textarea } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, avatarColor, Btn, Card, EmptyState, IconTile, Pill, Progress } from "@/vx/ui/primitives";
import { initials } from "@/vx/format";

import { remarkText, type RemarkSuggestion } from "./domain/messages";
import type { ActionResult } from "./save-types";

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

export function TeacherPick({
  cards,
  remarks,
  due,
  links,
  makeLink,
  crumb,
}: {
  cards: PickCard[];
  remarks: RemarksCard[];
  due: { label: string; daysLeft: number | null; results: string | null } | null;
  links: { examId: string; examLabel: { en: string; hi?: string }; url: string | null }[];
  makeLink: (examId: string) => Promise<ActionResult>;
  crumb: string;
}) {
  const { tx, sub } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [pending, start] = useTransition();
  const firstOpen = cards.findIndex((c) => c.status === "in_progress");

  const help = (
    <HelpButton
      title={tx(p("Marks", "अंक"))}
      steps={[
        { icon: "clipboard", title: tx(p("Tap a card", "कार्ड दबाएँ")), body: tx(p("Each card is one class and subject of yours.", "हर कार्ड आपकी एक कक्षा और विषय है।")) },
        { icon: "keyboard", title: tx(p("Type the marks", "अंक लिखें")), body: tx(p("Everything saves by itself as you type.", "लिखते ही सब अपने आप सहेजा जाता है।")) },
        { icon: "send", title: tx(p("Check and send", "जाँचें और भेजें")), body: tx(p("When every child has a mark, send it to the exam office.", "हर बच्चे के अंक भरने पर परीक्षा विभाग को भेजें।")) },
      ]}
    />
  );

  return (
    <VxPage>
      <TopBar crumb={crumb} title={tx(p("Enter marks", "अंक भरें"))} mTitle={tx(p("Marks", "अंक"))} mSub={crumb} actions={help} mAction={help} />
      <main>
        <section className="pad" style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 }}>
          <div>
            <h2 className="serif" style={{ margin: 0, fontSize: 28 }}>{tx(p("What do you want to fill?", "क्या भरना है?"))}</h2>
            <span style={{ color: "var(--mut)" }}>{tx(p("Tap a card. Everything saves by itself.", "कार्ड दबाएँ। सब अपने आप सहेजा जाता है।"))}</span>
          </div>
          {due ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 16, background: "var(--warns)", color: "var(--warnfg)" }}>
              <IconTile icon="calendar" tone="warn" size={36} />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <strong>{tx(p("Enter by", "अंतिम तिथि"))} {due.label}</strong>
                <span style={{ fontSize: 13 }}>
                  {due.daysLeft === null ? "" : due.daysLeft >= 0 ? `${due.daysLeft} ${tx(p("days left", "दिन बाकी"))}` : `${-due.daysLeft} ${tx(p("days late", "दिन देर"))}`}
                  {due.results ? ` · ${tx(p("results on", "परिणाम"))} ${due.results}` : ""}
                </span>
              </span>
            </div>
          ) : null}
          {cards.length === 0 && remarks.length === 0 ? (
            <Card>
              <EmptyState icon="clipboard" title={tx(p("Nothing to fill right now", "अभी भरने को कुछ नहीं"))} body={tx(p("When an exam is open for marks, your class-subjects appear here.", "जब कोई परीक्षा अंकों के लिए खुलेगी, आपकी कक्षा-विषय यहाँ दिखेंगे।"))} />
            </Card>
          ) : null}
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
            {cards.map((c, i) => {
              const tone = c.status === "done" ? "ok" : c.status === "in_progress" ? "info" : "mut";
              const label = c.status === "done" ? tx(p("Done", "पूरा")) : c.status === "in_progress" ? tx(p("In progress", "जारी")) : tx(p("Not started", "शुरू नहीं"));
              const href = `/teach/marks?paper=${c.paperId}${c.status === "done" ? "&view=submitted" : ""}`;
              return (
                <Card key={c.paperId} className="rise lift" style={{ display: "flex", flexDirection: "column", gap: 10, borderColor: i === firstOpen ? "var(--pri)" : undefined, borderWidth: i === firstOpen ? 2 : undefined }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <IconTile icon="clipboard" tone="info" size={40} />
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(c.examLabel)} · {tx(p("out of", "पूर्णांक"))} {c.maxMarks}</span>
                      <strong style={{ fontSize: 18 }}>{c.classLabel} {c.subjectCode}</strong>
                      {sub(p(`${c.classLabel} ${c.subjectCode}`, `${c.classLabel.replace("Class", "कक्षा")} ${c.subjectCode}`)) ? (
                        <span style={{ fontSize: 12, color: "var(--mut)" }}>{c.classLabel.replace("Class", "कक्षा")} {c.subjectCode}</span>
                      ) : null}
                    </span>
                    <Pill tone={tone} icon={c.status === "done" ? "check" : undefined}>{label}</Pill>
                  </div>
                  <Progress value={c.entered} max={Math.max(1, c.total)} tone={c.status === "done" ? "var(--ok)" : "var(--pri)"} />
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ flex: 1, fontSize: 14 }}>
                      {c.status === "done"
                        ? `${tx(p("All", "सभी"))} ${c.total} ${tx(p("sent", "भेजे"))}${c.submittedToName ? ` ${tx(p("to", "को"))} ${c.submittedToName}` : ""}`
                        : tx(p(`${c.entered} of ${c.total} entered`, `${c.total} में से ${c.entered} भरे`))}
                    </span>
                    <Btn variant={c.status === "in_progress" ? "pri" : "sec"} href={href}>
                      {c.status === "done" ? tx(p("View", "देखें")) : c.status === "in_progress" ? tx(p("Continue", "जारी रखें")) : tx(p("Start", "शुरू करें"))}
                      <Ic n="arrowRight" size={16} />
                    </Btn>
                  </div>
                </Card>
              );
            })}
            {remarks.map((r) => (
              <Card key={r.classId} className="rise lift" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <IconTile icon="edit" tone="warn" size={40} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Report cards · your class", "प्रगति पत्र · आपकी कक्षा"))}</span>
                    <strong style={{ fontSize: 18 }}>{r.classLabel} {tx(p("remarks", "टिप्पणियाँ"))}</strong>
                  </span>
                  <Pill tone="warn">{tx(p("Class teacher", "कक्षा अध्यापक"))}</Pill>
                </div>
                <Progress value={r.done} max={Math.max(1, r.total)} tone="var(--ok)" />
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1 }}>{tx(p(`${r.done} of ${r.total} done`, `${r.total} में से ${r.done} पूरी`))}</span>
                  <Btn variant="sec" href={`/teach/marks?view=remarks&class=${r.classId}`}>
                    {r.done ? tx(p("Continue", "जारी रखें")) : tx(p("Start", "शुरू करें"))} <Ic n="arrowRight" size={16} />
                  </Btn>
                </div>
              </Card>
            ))}
          </div>
          <Card style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--s2)" }}>
            <IconTile icon="link" tone="acc" size={38} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <strong>{tx(p("You can also use your marks link", "आप अपना अंक लिंक भी इस्तेमाल कर सकते हैं"))}</strong>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("The marks land in the same place — use whichever is easier.", "अंक एक ही जगह पहुँचते हैं — जो आसान हो वही इस्तेमाल करें।"))}</span>
            </span>
            <Btn variant="sec" onClick={() => setSheet(true)}>{tx(p("My marks links", "मेरे अंक लिंक"))}</Btn>
          </Card>
        </section>
      </main>
      <Sheet open={sheet} onClose={() => setSheet(false)} title={tx(p("My marks links", "मेरे अंक लिंक"))} sub={tx(p("Opens without logging in. Keep it to yourself.", "बिना लॉगिन खुलता है। इसे अपने पास रखें।"))} icon="link">
        {links.length === 0 ? <span style={{ color: "var(--mut)" }}>{tx(p("No exam is open for marks.", "कोई परीक्षा अंकों के लिए खुली नहीं है।"))}</span> : null}
        {links.map((l) => (
          <div key={l.examId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <strong>{tx(l.examLabel)}</strong>
              <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{l.url ?? tx(p("No link yet", "अभी कोई लिंक नहीं"))}</span>
            </span>
            {l.url ? (
              <Btn
                variant="soft"
                icon="copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(l.url!).then(() => toast.show({ text: tx(p("Link copied", "लिंक कॉपी हुआ")) }));
                }}
              >
                {tx(p("Copy", "कॉपी"))}
              </Btn>
            ) : (
              <Btn
                variant="pri"
                icon="link"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await makeLink(l.examId).catch(() => null);
                    if (r?.ok) {
                      toast.show({ text: tx(p("Link made", "लिंक बना")) });
                      router.refresh();
                    } else toast.show({ text: tx(r && !r.ok ? r.message : p("Could not make the link", "लिंक नहीं बना")), tone: "bad" });
                  })
                }
              >
                {tx(p("Make my link", "मेरा लिंक बनाएँ"))}
              </Btn>
            )}
          </div>
        ))}
      </Sheet>
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
  const { tx } = useVx();
  const toast = useToast();
  const [remarks, setRemarks] = useState<Record<string, string>>(() => Object.fromEntries(kids.map((c) => [c.id, c.remark ?? ""])));
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(kids.filter((c) => c.remark).map((c) => c.id)));
  const [filter, setFilter] = useState<"all" | "todo" | "done">("all");
  const [currentId, setCurrentId] = useState<string | null>(() => kids.find((c) => !c.remark)?.id ?? kids[0]?.id ?? null);
  const [pending, start] = useTransition();

  const done = savedIds.size;
  const list = kids.filter((c) => (filter === "all" ? true : filter === "done" ? savedIds.has(c.id) : !savedIds.has(c.id)));
  const child = kids.find((c) => c.id === currentId) ?? null;
  const first = child ? child.name.split(" ")[0] : "";

  function commit(id: string, text: string, advance: boolean) {
    start(async () => {
      const r = await save({ studentId: id, term, remark: text }).catch(() => null);
      if (r?.ok) {
        setSavedIds((s) => new Set(s).add(id));
        if (advance) next(id);
      } else toast.show({ text: tx(r && !r.ok ? r.message : p("Not saved", "सहेजा नहीं गया")), tone: "bad" });
    });
  }

  function next(fromId: string) {
    const i = kids.findIndex((c) => c.id === fromId);
    const after = [...kids.slice(i + 1), ...kids.slice(0, i)].find((c) => !savedIds.has(c.id) && c.id !== fromId);
    setCurrentId(after?.id ?? kids[Math.min(kids.length - 1, i + 1)]?.id ?? null);
  }

  const help = (
    <HelpButton
      title={tx(p("Report card remarks", "प्रगति पत्र टिप्पणी"))}
      steps={[
        { icon: "users", title: tx(p("Pick a child", "बच्चा चुनें")), body: tx(p("Children without a remark are in To do.", "जिनकी टिप्पणी बाकी है वे 'बाकी' में हैं।")) },
        { icon: "star", title: tx(p("Tap a suggestion", "सुझाव चुनें")), body: tx(p("Suggestions come from marks and attendance. You can change the words.", "सुझाव अंक और उपस्थिति से बनते हैं। शब्द बदल सकते हैं।")) },
        { icon: "arrowRight", title: tx(p("Next child", "अगला बच्चा")), body: tx(p("It saves and moves on.", "सहेजकर आगे बढ़ता है।")) },
      ]}
    />
  );

  const roster = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1 }}><Progress value={done} max={Math.max(1, kids.length)} tone="var(--ok)" /></span>
        <strong className="num" style={{ fontSize: 14 }}>{tx(p(`${done} of ${kids.length} done`, `${kids.length} में से ${done} पूरी`))}</strong>
      </div>
      <Seg
        value={filter}
        onChange={setFilter}
        label={tx(p("Show", "दिखाएँ"))}
        options={[
          { value: "all", label: tx(p("Everyone", "सभी")) },
          { value: "todo", label: `${tx(p("To do", "बाकी"))} · ${kids.length - done}` },
          { value: "done", label: `${tx(p("Done", "पूरी"))} · ${done}` },
        ]}
      />
    </div>
  );

  return (
    <VxPage>
      <TopBar crumb={crumb} title={tx(p("Report card remarks", "प्रगति पत्र टिप्पणी"))} mTitle={tx(p("Report card remarks", "प्रगति पत्र टिप्पणी"))} mSub={`${classLabel} · ${tx(p(`${done} of ${kids.length} done`, `${kids.length} में से ${done} पूरी`))}`} mBack="/teach/marks" actions={help} mAction={help} />
      <main>
        <div className="stack" style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr)", minHeight: "calc(100dvh - 64px)" }}>
          <aside className="only-d" style={{ borderRight: "1px solid var(--bd)", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10, background: "var(--card)" }}>
            {roster}
            <div style={{ display: "flex", flexDirection: "column" }}>
              {list.map((c) => (
                <button key={c.id} type="button" className={`tap row${c.id === currentId ? " sel" : ""}`} onClick={() => setCurrentId(c.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px", border: 0, background: c.id === currentId ? "var(--accs)" : "transparent", borderRadius: 12, textAlign: "left", color: "var(--fg)" }}>
                  <span className="num" style={{ width: 26, color: "var(--mut)" }}>{c.roll ?? "—"}</span>
                  <strong className="clip" style={{ flex: 1 }}>{c.name}</strong>
                  {savedIds.has(c.id) ? <Ic n="checkCircle" size={22} style={{ color: "var(--ok)" }} /> : <span style={{ width: 22, height: 22, borderRadius: 11, background: "var(--s3)" }} />}
                </button>
              ))}
            </div>
          </aside>
          <section className="pad" style={{ padding: "22px 28px 120px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div className="only-m" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {roster}
              <div className="hs" style={{ display: "flex", gap: 8 }}>
                {list.map((c) => (
                  <button key={c.id} type="button" className={`tap chip${c.id === currentId ? " on" : ""}`} onClick={() => setCurrentId(c.id)}>
                    {c.roll ?? ""} {c.name.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>
            {child ? (
              <>
                <Card style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <Avatar text={initials(child.name)} bg={avatarColor(child.name)} size={54} />
                  <span style={{ flex: 1, minWidth: 160, display: "flex", flexDirection: "column" }}>
                    <strong style={{ fontSize: 20 }}>{child.name}</strong>
                    <span style={{ color: "var(--mut)", fontSize: 13 }}>{classLabel} · {tx(p("Roll", "रोल"))} {child.roll ?? "—"} · {tx(p("your class", "आपकी कक्षा"))}</span>
                  </span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {child.percent !== null ? <Pill tone="mut">{tx(examLabel)} {Math.round(child.percent)}%</Pill> : null}
                    {child.attendance !== null ? <Pill tone="ok">{tx(p("Attendance", "उपस्थिति"))} {child.attendance}%</Pill> : null}
                  </span>
                </Card>
                <h2 className="sech">{tx(p("Suggested remarks · tap one", "सुझाई टिप्पणियाँ · एक चुनें"))}</h2>
                {child.suggestions.length === 0 ? <Banner tone="info">{tx(p("No marks or attendance yet to suggest from. Write your own below.", "सुझाव के लिए अभी अंक या उपस्थिति नहीं है। नीचे खुद लिखें।"))}</Banner> : null}
                {child.suggestions.map((s, i) => {
                  const text = remarkText(s.text);
                  const on = remarks[child.id] === text;
                  return (
                    <button
                      key={`${child.id}-${i}`}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className="tap card lift"
                      onClick={() => {
                        setRemarks((r) => ({ ...r, [child.id]: text }));
                        commit(child.id, text, false);
                      }}
                      style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 18px", textAlign: "left", borderColor: on ? "var(--pri)" : undefined, borderWidth: on ? 2 : undefined, color: "var(--fg)" }}
                    >
                      <span style={{ flex: "none", width: 24, height: 24, borderRadius: 12, border: `2px solid ${on ? "var(--pri)" : "var(--bd)"}`, background: on ? "var(--pri)" : "transparent", marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--prifg)" }}>
                        {on ? <Ic n="check" size={14} stroke={3} /> : null}
                      </span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <strong style={{ fontSize: 16 }}>{s.text.en}</strong>
                        {s.text.hi ? <span lang="hi" style={{ color: "var(--mut)", fontSize: 14 }}>{s.text.hi}</span> : null}
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--accfg)" }}>
                          {s.source === "marks" ? tx(p("From marks", "अंकों से")) : s.source === "attendance" ? tx(p("From attendance", "उपस्थिति से")) : tx(p("From subjects", "विषयों से"))} · {s.basis}
                        </span>
                      </span>
                    </button>
                  );
                })}
                <Card>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <strong>{tx(p("Or change the words", "या शब्द बदलें"))}</strong>
                    <Textarea rows={3} maxLength={400} value={remarks[child.id] ?? ""} onChange={(e) => setRemarks((r) => ({ ...r, [child.id]: e.target.value }))} />
                  </label>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Btn variant="soft" icon="check" disabled={pending || (remarks[child.id] ?? "").trim().length < 2} onClick={() => commit(child.id, remarks[child.id] ?? "", false)}>
                      {tx(p("Save", "सहेजें"))}
                    </Btn>
                    {savedIds.has(child.id) ? <span style={{ alignSelf: "center", color: "var(--ok)", fontWeight: 600 }}>✓ {tx(p("Saved", "सहेजा"))}</span> : null}
                  </div>
                </Card>
              </>
            ) : (
              <EmptyState icon="users" title={tx(p("No children in this class", "इस कक्षा में कोई बच्चा नहीं"))} />
            )}
          </section>
        </div>
        {child ? (
          <div className="glass" style={{ position: "sticky", bottom: 0, zIndex: 10, borderTop: "1px solid var(--bd)", padding: "12px 28px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <strong>{savedIds.has(child.id) ? `${tx(p("Remark saved for", "टिप्पणी सहेजी"))} ${first}` : `${tx(p("Pick a remark for", "टिप्पणी चुनें"))} ${first}`}</strong>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Tap a suggestion, or change the words", "सुझाव चुनें, या शब्द बदलें"))}</span>
            </span>
            <Btn
              variant="pri"
              big
              disabled={pending}
              onClick={() => {
                const text = (remarks[child.id] ?? "").trim();
                if (text.length >= 2 && !savedIds.has(child.id)) commit(child.id, text, true);
                else next(child.id);
              }}
            >
              {tx(p("Next child", "अगला बच्चा"))} <Ic n="arrowRight" size={18} />
            </Btn>
          </div>
        ) : null}
      </main>
    </VxPage>
  );
}
