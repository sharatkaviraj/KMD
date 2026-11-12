"use client";

import Link from "@/ui/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addEnquiryAction, closeEnquiryAction, moveEnquiryAction, undoMoveEnquiryAction } from "@/app/(app)/admissions/actions";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Field, Input, Select } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { TopBar, VxPage } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";

import { maskPhone, needsCallBack, type Stage, type VisitPart, type VisitWhen } from "@/vx/screens/admissions/logic";
import { Av, PeopleStyles } from "@/vx/screens/admissions/ui";

export type BoardCard = {
  id: string;
  stage: Stage;
  /** Empty when a family booked a visit on WhatsApp without giving the name. */
  name: string;
  classLabel: string;
  parent: string;
  phone: string | null;
  days: number;
  /** The school visit the family asked for (D-593): when it falls, the day in words, morning or afternoon. */
  visit?: { when: VisitWhen; day: Pair; part: VisitPart } | null;
  /** Booked by the family on WhatsApp with Veer Patta AI (D-592). */
  fromWhatsApp?: boolean;
};
export type AdmittedCard = { id: string; name: string; classLabel: string; parent: string; sr: string };
export type DocState = "ok" | "pending" | "na";
export type RecentRow = { id: string; name: string; classLabel: string; sr: string; date: string; isNew: boolean; docs: { birth: DocState; tc: DocState; photo: DocState } };
export type Kpis = {
  newCount: number;
  openEnquiries: number;
  waitingWeek: number;
  docsPending: number;
  seatsLeft: number | null;
  /** Admins get a link to set the number of seats per class. */
  seatsEditable: boolean;
  bands: { short: string; left: number; cap: number }[];
};

const COLS: { stage: Stage; label: Pair; short: Pair; dot: string }[] = [
  { stage: "enquiry", label: p("Enquiry", "पूछताछ"), short: p("Enquiry", "पूछताछ"), dot: "var(--c4)" },
  { stage: "visited", label: p("Visited", "मिलने आए"), short: p("Visited", "मिलने आए"), dot: "var(--c3)" },
  { stage: "form", label: p("Form given", "फ़ॉर्म दिया"), short: p("Form", "फ़ॉर्म"), dot: "var(--c2)" },
  { stage: "admitted", label: p("Admitted", "प्रवेश हुआ"), short: p("Admitted", "प्रवेश"), dot: "var(--ok)" },
];

const DOC_PILLS: { key: "birth" | "tc" | "photo"; label: Pair }[] = [
  { key: "birth", label: p("Birth", "जन्म") },
  { key: "tc", label: p("TC", "टीसी") },
  { key: "photo", label: p("Photo", "फ़ोटो") },
];

const DOC_LOOK: Record<DocState, { bg: string; fg: string; icon: IconName; suffix: Pair }> = {
  ok: { bg: "var(--oks)", fg: "var(--ok)", icon: "check", suffix: p(" ✓", " ✓") },
  pending: { bg: "var(--warns)", fg: "var(--warnfg)", icon: "alert", suffix: p(" · pending", " · बाकी") },
  na: { bg: "var(--s2)", fg: "var(--mut)", icon: "minus", suffix: p(" · n/a", " · ज़रूरी नहीं") },
};

const sub = { fontSize: 12, color: "var(--mut)" } as const;

const NAME_NOT_GIVEN = p("Name not given", "नाम नहीं बताया");

const PART: Record<VisitPart, Pair> = { morning: p("morning", "सुबह"), afternoon: p("afternoon", "दोपहर") };

/** The visit chip's words and colours: coming today or tomorrow stands out, a day gone by is a warning. */
function visitChip(visit: NonNullable<BoardCard["visit"]>, tx: (pair: Pair) => string): { text: string; title: string; bg: string; fg: string } {
  const part = tx(PART[visit.part]);
  const day = tx(visit.day);
  const title = `${tx(p("School visit", "स्कूल देखने आना"))}: ${day} · ${part}`;
  switch (visit.when) {
    case "today":
      return { text: `${tx(p("Visit today", "आज आएँगे"))} · ${part}`, title, bg: "var(--accs)", fg: "var(--accfg)" };
    case "tomorrow":
      return { text: `${tx(p("Visit tomorrow", "कल आएँगे"))} · ${part}`, title, bg: "var(--accs)", fg: "var(--accfg)" };
    case "passed":
      return { text: `${tx(p("Visit day passed", "आने का दिन निकल गया"))} · ${day}`, title, bg: "var(--warns)", fg: "var(--warnfg)" };
    default:
      return { text: `${tx(p("Visit", "आएँगे"))} ${day} · ${part}`, title, bg: "var(--s2)", fg: "var(--fg)" };
  }
}

/** Admissions, state `list`: the top bar, KPI tiles, the pipeline and recent admissions. */
export function AdmissionsListScreen(props: { sessionLabel: string; kpis: Kpis; cards: BoardCard[]; admitted: AdmittedCard[]; recent: RecentRow[]; classLabels: string[] }) {
  const { tx } = useVx();
  const { kpis } = props;
  return (
    <VxPage>
      <TopBar
        crumb={`${tx(p("Students", "विद्यार्थी"))} · ${tx(p("Session", "सत्र"))} ${props.sessionLabel}`}
        title={tx(p("Admissions", "दाख़िले"))}
        mSub={`${kpis.openEnquiries} ${tx(p("open enquiries", "खुली पूछताछ"))}${kpis.seatsLeft !== null ? ` · ${kpis.seatsLeft} ${tx(p("seats left", "खाली सीटें"))}` : ""}`}
        mBack="/menu"
        actions={<Btn variant="pri" icon="userPlus" href="/admissions/new">{tx(p("Add a student", "विद्यार्थी जोड़ें"))}</Btn>}
        mAction={<Btn variant="pri" icon="userPlus" href="/admissions/new" ariaLabel={tx(p("Add a student", "विद्यार्थी जोड़ें"))} style={{ height: 44 }}>{tx(p("Add", "जोड़ें"))}</Btn>}
      />
      <main>
        <section className="pad" style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <AdmissionsBoard {...props} />
        </section>
      </main>
    </VxPage>
  );
}

export function AdmissionsBoard({
  sessionLabel,
  kpis,
  cards,
  admitted,
  recent,
  classLabels,
}: {
  sessionLabel: string;
  kpis: Kpis;
  cards: BoardCard[];
  admitted: AdmittedCard[];
  recent: RecentRow[];
  classLabels: string[];
}) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [moved, setMoved] = useState<Record<string, Stage>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [mStage, setMStage] = useState<Stage>("enquiry");
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();

  const stageOf = (c: BoardCard) => moved[c.id] ?? c.stage;
  const nameOf = (c: BoardCard) => c.name || tx(NAME_NOT_GIVEN);

  async function move(c: BoardCard) {
    const from = stageOf(c);
    setBusy(c.id);
    const res = await moveEnquiryAction(c.id, from);
    setBusy(null);
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    setMoved((m) => ({ ...m, [c.id]: res.to }));
    toast.show({
      text: `${nameOf(c)} ${tx(p("moved to", "आगे बढ़े:"))} ${tx(COLS.find((x) => x.stage === res.to)!.label)}`,
      undo: async () => {
        const back = await undoMoveEnquiryAction(c.id, from);
        if (back.ok) setMoved((m) => ({ ...m, [c.id]: from }));
        startTransition(() => router.refresh());
      },
    });
    startTransition(() => router.refresh());
  }

  async function close(c: BoardCard) {
    const res = await closeEnquiryAction(c.id);
    if (!res.ok) return toast.show({ text: res.message, tone: "bad" });
    toast.show({ text: `${nameOf(c)} · ${tx(p("closed, not joining", "बंद, नहीं आएँगे"))}` });
    startTransition(() => router.refresh());
  }

  const daysText = (days: number) => `${days} ${days === 1 ? tx(p("day", "दिन")) : tx(p("days", "दिन"))}`;

  const column = (stage: Stage) => {
    if (stage === "admitted") {
      return admitted.map((a, i) => (
        <Link key={a.id} href={`/admissions/${a.id}`} className="card tap" style={{ padding: "11px 12px", display: "flex", flexDirection: "column", gap: 9, borderRadius: 14, color: "var(--fg)", animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 30}ms both` }}>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Av name={a.name} />
            <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</span>
              <span className="clip" style={sub}>{a.classLabel} · {a.parent}</span>
            </span>
          </span>
          <span style={{ display: "flex" }}>
            <span className="pill" style={{ background: "var(--oks)", color: "var(--ok)" }}>SR {a.sr}</span>
          </span>
        </Link>
      ));
    }
    return cards
      .filter((c) => stageOf(c) === stage)
      .map((c, i) => {
        const isMoved = moved[c.id] !== undefined;
        const late = !isMoved && needsCallBack(stage, c.days);
        const pill = isMoved ? tx(p("Moved today", "आज आगे बढ़े")) : `${daysText(c.days)}${late ? ` · ${tx(p("call back", "फ़ोन करें"))}` : ""}`;
        const pillStyle = { background: late ? "var(--warns)" : "var(--s2)", color: late ? "var(--warnfg)" : "var(--mut)" };
        return (
          <div key={c.id} className="card" style={{ padding: "11px 12px", display: "flex", flexDirection: "column", gap: 9, borderRadius: 14, animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 30}ms both` }}>
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Av name={c.name} />
              <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                {c.name ? (
                  <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                ) : (
                  <span className="clip" style={{ fontSize: 14, fontWeight: 600, fontStyle: "italic", color: "var(--mut)" }}>{tx(NAME_NOT_GIVEN)}</span>
                )}
                <span className="clip" style={sub}>{c.classLabel} · {c.parent}</span>
              </span>
              <button type="button" className="tap btn ghost" onClick={() => void close(c)} aria-label={`${nameOf(c)}: ${tx(p("not joining", "नहीं आएँगे"))}`} title={tx(p("Not joining · close the enquiry", "नहीं आएँगे · पूछताछ बंद करें"))} style={{ width: 30, height: 30, padding: 0, color: "var(--sub)" }}>
                <Ic n="x" size={15} />
              </button>
            </span>
            {c.visit || c.fromWhatsApp ? (
              <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                {c.visit
                  ? (() => {
                      const chip = visitChip(c.visit, tx);
                      return (
                        <span className="pill" title={chip.title} style={{ background: chip.bg, color: chip.fg, fontWeight: 600 }}>
                          <Ic n="calendar" size={12} />
                          {chip.text}
                        </span>
                      );
                    })()
                  : null}
                {c.fromWhatsApp ? (
                  <span className="pill" title={tx(p("Booked by the family on WhatsApp with Veer Patta AI. Their words are in Messages.", "परिवार ने WhatsApp पर Veer Patta AI से बुक किया। उनकी बात Messages में है।"))} style={{ background: "var(--s2)", color: "var(--mut)" }}>
                    <Ic n="message" size={12} />
                    WhatsApp
                  </span>
                ) : null}
              </span>
            ) : null}
            {/* In a narrow column "9 days · call back" and the button take two lines rather than the button
                hanging out of the card (desk check at 1000px, 7 Nov). */}
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              {late && c.phone ? (
                <a href={`tel:${c.phone}`} className="pill" style={pillStyle} title={maskPhone(c.phone)}>
                  {pill}
                </a>
              ) : (
                <span className="pill" style={pillStyle}>{pill}</span>
              )}
              {stage === "form" ? (
                <Btn variant="pri" href={`/admissions/new?enquiry=${c.id}`} style={{ height: 34, padding: "0 12px", fontSize: 12, marginLeft: "auto" }}>
                  {tx(p("Admit", "प्रवेश दें"))}
                  <Ic n="arrowRight" size={15} />
                </Btn>
              ) : (
                <Btn variant="soft" onClick={() => void move(c)} disabled={busy === c.id} style={{ height: 34, padding: "0 12px", fontSize: 12, marginLeft: "auto" }}>
                  {tx(p("Move", "आगे"))}
                  <Ic n="arrowRight" size={15} />
                </Btn>
              )}
            </span>
          </div>
        );
      });
  };

  const counts = Object.fromEntries(COLS.map((c) => [c.stage, c.stage === "admitted" ? admitted.length : cards.filter((x) => stageOf(x) === c.stage).length])) as Record<Stage, number>;
  const mIdx = COLS.findIndex((c) => c.stage === mStage);

  const tiles: { label: Pair; value: number; sub: string }[] = [
    { label: p("New this session", "इस सत्र में नए"), value: kpis.newCount, sub: tx(p("Since 1 Apr", "1 अप्रैल से")) },
    { label: p("Open enquiries", "खुली पूछताछ"), value: kpis.openEnquiries, sub: `${kpis.waitingWeek} ${tx(p("waiting more than a week", "एक हफ़्ते से ज़्यादा से"))}` },
    { label: p("Documents pending", "दस्तावेज़ बाकी"), value: kpis.docsPending, sub: tx(p("Birth certificates, TCs and photos", "जन्म प्रमाण पत्र, टीसी और फ़ोटो")) },
  ];

  const seatsBody = (
    <>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ ...sub, fontWeight: 600 }}>{tx(p("Seats left", "खाली सीटें"))}</span>
        <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{kpis.seatsLeft ?? "—"}</span>
      </span>
      {kpis.bands.length ? (
        <span style={{ display: "grid", gridTemplateColumns: `repeat(${kpis.bands.length},minmax(0,1fr))`, gap: 6 }}>
          {kpis.bands.map((b, k) => {
            const fill = b.cap > 0 ? (b.cap - b.left) / b.cap : 0;
            return (
              <span key={b.short} title={`${b.short} · ${b.cap - b.left} / ${b.cap} · ${b.left}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ display: "flex", alignItems: "flex-end", width: "100%", height: 30, borderRadius: 6, background: "var(--s3)", overflow: "hidden" }}>
                  <span style={{ width: "100%", height: `${Math.round(fill * 100)}%`, background: fill > 0.9 ? "var(--warn)" : "var(--c2)", transformOrigin: "bottom", animation: `xGrowY .7s var(--ease) ${k * 70 + 200}ms both` }} />
                </span>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.1 }}>{b.left}</span>
                <span style={{ fontSize: 10, lineHeight: 1.1, color: "var(--mut)" }}>{b.short}</span>
              </span>
            );
          })}
        </span>
      ) : (
        <span style={sub}>{kpis.seatsEditable ? tx(p("Set seats per class", "हर कक्षा की सीटें तय करें")) : tx(p("No seat limits set", "सीटें तय नहीं"))}</span>
      )}
    </>
  );
  const seatStyle = { padding: "14px 16px 12px", display: "flex", flexDirection: "column", gap: 6, animationDelay: "96ms", color: "var(--fg)" } as const;

  const missing = recent.reduce((n, r) => n + DOC_PILLS.filter((d) => r.docs[d.key] === "pending").length, 0);

  return (
    <>
      <PeopleStyles />
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
        {tiles.map((k, i) => (
          <div key={k.label.en} className="card rise" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 2, animationDelay: `${i * 30}ms` }}>
            <span style={{ ...sub, fontWeight: 600 }}>{tx(k.label)}</span>
            <span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{k.value}</span>
            <span style={sub}>{k.sub}</span>
          </div>
        ))}
        {kpis.seatsEditable ? (
          <Link href="/admissions/seats" className="card rise tap lift" aria-label={tx(p("Seats left · edit seats per class", "खाली सीटें · सीटें बदलें"))} style={seatStyle}>
            {seatsBody}
          </Link>
        ) : (
          <div className="card rise" style={seatStyle}>{seatsBody}</div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span className="sech">{tx(p("Enquiry to admission", "पूछताछ से प्रवेश तक"))}</span>
          <span className="hide-m" style={sub}>{tx(p("Press Move when a family reaches the next step", "परिवार अगले चरण पर पहुँचे तो आगे दबाएँ"))}</span>
        </div>
        <div className="seg only-m" role="radiogroup" aria-label={tx(p("Stage", "चरण"))} style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
          <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 4)", transform: `translateX(${mIdx * 100}%)` }} />
          {COLS.map((c) => (
            <button key={c.stage} type="button" role="radio" aria-checked={mStage === c.stage} className={`tap${mStage === c.stage ? " on" : ""}`} onClick={() => setMStage(c.stage)} style={{ fontSize: 12, height: 38 }}>
              {tx(c.short)} · {counts[c.stage]}
            </button>
          ))}
        </div>
        <div className="pp-cols">
          {COLS.map((col) => (
            <section key={col.stage} className={`pp-pcol${mStage === col.stage ? "" : " pp-off"}`} aria-label={tx(col.label)}>
              <header className="only-d" style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px" }}>
                <span style={{ width: 9, height: 9, borderRadius: 5, background: col.dot }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{tx(col.label)}</span>
                <span className="pill num" style={{ background: "var(--card)", color: "var(--mut)" }}>{counts[col.stage]}</span>
              </header>
              {column(col.stage)}
              {counts[col.stage] === 0 ? <span style={{ ...sub, textAlign: "center", padding: "22px 8px" }}>{tx(p("Nobody here right now", "अभी यहाँ कोई नहीं"))}</span> : null}
              {col.stage === "enquiry" ? (
                <button type="button" className="tap" onClick={() => setAdding(true)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, borderRadius: 14, border: "1.5px dashed var(--bds)", background: "transparent", color: "var(--acc)", fontSize: 13, fontWeight: 600 }}>
                  <Ic n="plus" size={16} />
                  {tx(p("Add an enquiry", "पूछताछ जोड़ें"))}
                </button>
              ) : null}
            </section>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span className="sech">{tx(p("Recently admitted", "हाल में प्रवेश"))}</span>
          {missing ? <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>{missing} {tx(p("documents pending", "दस्तावेज़ बाकी"))}</span> : null}
        </div>
        <div className="card" style={{ overflow: "hidden" }}>
          {recent.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "32px 20px", textAlign: "center" }}>
              <strong>{tx(p("No admissions yet this session", "इस सत्र में अभी कोई प्रवेश नहीं"))}</strong>
              <Btn variant="pri" href="/admissions/new" icon="userPlus">{tx(p("Add a student", "विद्यार्थी जोड़ें"))}</Btn>
            </div>
          ) : (
            recent.map((r, i) => (
              <Link key={r.id} href={`/admissions/${r.id}`} className="tap row pp-rrow" style={{ borderTop: i ? "1px solid var(--bd)" : 0, color: "var(--fg)", animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 30}ms both` }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Av name={r.name} />
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
                      {r.isNew ? <span className="pill" style={{ background: "var(--accs)", color: "var(--accfg)" }}>{tx(p("New", "नया"))}</span> : null}
                    </span>
                    <span className="num" style={sub}>
                      {r.classLabel}
                      <span className="only-m"> · SR {r.sr} · {r.date}</span>
                    </span>
                  </span>
                </span>
                {/* One line, cut with "…" if it must be: in 64px a TEST number ran down four lines (desk check, 7 Nov). */}
                <span className="num only-d clip" title={`SR ${r.sr}`} style={{ fontSize: 13, fontWeight: 600 }}>SR {r.sr}</span>
                <span className="num only-d" style={{ fontSize: 13 }}>{r.date}</span>
                {DOC_PILLS.map((d) => {
                  const look = DOC_LOOK[r.docs[d.key]];
                  return (
                    <span key={d.key}>
                      <span className="pill" style={{ background: look.bg, color: look.fg }}>
                        <Ic n={look.icon} size={12} />
                        {tx(d.label)}
                        {tx(look.suffix)}
                      </span>
                    </span>
                  );
                })}
                <Ic n="chevRight" className="only-d" style={{ color: "var(--sub)" }} />
              </Link>
            ))
          )}
        </div>
      </div>

      <EnquirySheet open={adding} onClose={() => setAdding(false)} sessionLabel={sessionLabel} classLabels={classLabels} onSaved={() => startTransition(() => router.refresh())} />
    </>
  );
}

function EnquirySheet({ open, onClose, sessionLabel, classLabels, onSaved }: { open: boolean; onClose: () => void; sessionLabel: string; classLabels: string[]; onSaved: () => void }) {
  const { tx } = useVx();
  const toast = useToast();
  const [form, setForm] = useState({ childName: "", classLabel: "", parentName: "", phone: "" });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await addEnquiryAction({ sessionLabel, ...form });
    setSaving(false);
    if (!res.ok) return setErr(res.message);
    toast.show({ text: res.message });
    setForm({ childName: "", classLabel: "", parentName: "", phone: "" });
    setErr(null);
    onClose();
    onSaved();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(p("New enquiry", "नई पूछताछ"))}
      sub={tx(p("A family asking about a seat. Nothing is created in fees yet.", "सीट के बारे में पूछताछ। अभी फीस में कुछ नहीं बनता।"))}
      footer={
        <>
          <Btn variant="sec" onClick={onClose} style={{ flex: 1 }}>{tx(p("Cancel", "रद्द करें"))}</Btn>
          <Btn variant="pri" onClick={() => void save()} disabled={saving || !form.childName.trim()} style={{ flex: 1.4 }}>{tx(p("Save enquiry", "पूछताछ सहेजें"))}</Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label={tx(p("Child's name", "बच्चे का नाम"))} error={err}>
          <Input value={form.childName} onChange={(e) => setForm({ ...form, childName: e.target.value })} autoFocus />
        </Field>
        <Field label={tx(p("Class wanted", "कक्षा"))}>
          <Select value={form.classLabel} onChange={(e) => setForm({ ...form, classLabel: e.target.value })}>
            <option value="">{tx(p("Pick a class", "कक्षा चुनें"))}</option>
            {classLabels.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label={tx(p("Parent's name", "अभिभावक का नाम"))}>
          <Input value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })} />
        </Field>
        <Field label={tx(p("Phone", "फ़ोन"))}>
          <Input value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
      </div>
    </Sheet>
  );
}
