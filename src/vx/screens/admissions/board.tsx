"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addEnquiryAction, closeEnquiryAction, moveEnquiryAction, undoMoveEnquiryAction } from "@/app/(app)/admissions/actions";
import { initials } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Field, Input, Seg, Select } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Avatar, Btn, Card, EmptyState, Pill, SecHead } from "@/vx/ui/primitives";

import { maskPhone, needsCallBack, type Stage } from "@/vx/screens/admissions/logic";
import { PeopleStyles } from "@/vx/screens/admissions/ui";

export type BoardCard = { id: string; stage: Stage; name: string; classLabel: string; parent: string; phone: string | null; days: number };
export type AdmittedCard = { id: string; name: string; classLabel: string; parent: string; sr: string };
export type RecentRow = { id: string; name: string; classLabel: string; sr: string; date: string; missing: string[] };
export type Kpis = {
  newCount: number;
  openEnquiries: number;
  waitingWeek: number;
  docsPending: number;
  seatsLeft: number | null;
  /** Admins get a link to set the number of seats per class. */
  seatsEditable: boolean;
  bands: { short: string; left: number }[];
};

const COLS: { stage: Stage; label: Pair; dot: string }[] = [
  { stage: "enquiry", label: p("Enquiry", "पूछताछ"), dot: "var(--sub)" },
  { stage: "visited", label: p("Visited", "मिलने आए"), dot: "var(--warn)" },
  { stage: "form", label: p("Form given", "फ़ॉर्म दिया"), dot: "var(--c2)" },
  { stage: "admitted", label: p("Admitted", "प्रवेश हुआ"), dot: "var(--ok)" },
];

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
      text: `${c.name} → ${tx(COLS.find((x) => x.stage === res.to)!.label)}`,
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
    toast.show({ text: `${c.name} · ${tx(p("closed", "बंद"))}` });
    startTransition(() => router.refresh());
  }

  const column = (stage: Stage) => {
    if (stage === "admitted") {
      return admitted.map((a) => (
        <Link key={a.id} href={`/admissions/${a.id}`} className="card tap lift" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Avatar text={initials(a.name)} seed={a.name} size={36} />
            <span style={{ minWidth: 0 }}>
              <strong className="clip" style={{ display: "block" }}>{a.name}</strong>
              <span className="clip" style={{ display: "block", fontSize: 12, color: "var(--mut)" }}>{a.classLabel} · {a.parent}</span>
            </span>
          </span>
          <Pill tone="ok" style={{ alignSelf: "flex-start" }}>SR {a.sr}</Pill>
        </Link>
      ));
    }
    return cards
      .filter((c) => stageOf(c) === stage)
      .map((c) => {
        const late = needsCallBack(stage, c.days);
        return (
          <Card key={c.id} style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }} className="fadein">
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Avatar text={initials(c.name)} seed={c.name} size={36} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong className="clip" style={{ display: "block" }}>{c.name}</strong>
                <span className="clip" style={{ display: "block", fontSize: 12, color: "var(--mut)" }}>{c.classLabel} · {c.parent}</span>
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Pill tone={late ? "warn" : "mut"}>
                {c.days} {c.days === 1 ? tx(p("day", "दिन")) : tx(p("days", "दिन"))}
                {late ? ` · ${tx(p("call back", "फ़ोन करें"))}` : ""}
              </Pill>
              {stage === "form" ? (
                <Btn variant="pri" href={`/admissions/new?enquiry=${c.id}`} icon="arrowRight" style={{ height: 36 }}>
                  {tx(p("Admit", "प्रवेश दें"))}
                </Btn>
              ) : (
                <Btn variant="soft" onClick={() => void move(c)} disabled={busy === c.id} style={{ height: 36 }}>
                  {tx(p("Move", "आगे"))} <Ic n="arrowRight" size={16} />
                </Btn>
              )}
            </span>
            {c.phone ? (
              <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--mut)" }}>
                <a href={`tel:${c.phone}`} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <Ic n="phone" size={13} /> {maskPhone(c.phone)}
                </a>
                <button type="button" className="tap" onClick={() => void close(c)} style={{ border: 0, background: "none", color: "var(--mut)", fontSize: 12, textDecoration: "underline" }}>
                  {tx(p("Not joining", "नहीं आएँगे"))}
                </button>
              </span>
            ) : null}
          </Card>
        );
      });
  };

  const counts = Object.fromEntries(COLS.map((c) => [c.stage, c.stage === "admitted" ? admitted.length : cards.filter((x) => stageOf(x) === c.stage).length])) as Record<Stage, number>;

  return (
    <>
      <PeopleStyles />
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
        <div className="card rise" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600 }}>{tx(p("New this session", "इस सत्र में नए"))}</span>
          <span className="num" style={{ fontSize: 28, fontWeight: 700 }}>{kpis.newCount}</span>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`Since 1 Apr · ${sessionLabel}`, `1 अप्रैल से · ${sessionLabel}`))}</span>
        </div>
        <div className="card rise" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, animationDelay: "60ms" }}>
          <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600 }}>{tx(p("Open enquiries", "खुली पूछताछ"))}</span>
          <span className="num" style={{ fontSize: 28, fontWeight: 700 }}>{kpis.openEnquiries}</span>
          <span style={{ fontSize: 12, color: kpis.waitingWeek ? "var(--warnfg)" : "var(--mut)" }}>
            {kpis.waitingWeek} {tx(p("waiting more than a week", "एक हफ़्ते से ज़्यादा से"))}
          </span>
        </div>
        <div className="card rise" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, animationDelay: "120ms" }}>
          <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600 }}>{tx(p("Documents pending", "दस्तावेज़ बाकी"))}</span>
          <span className="num" style={{ fontSize: 28, fontWeight: 700 }}>{kpis.docsPending}</span>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Birth certificates, TCs and photos", "जन्म प्रमाण पत्र, टीसी और फ़ोटो"))}</span>
        </div>
        <div className="card rise" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, animationDelay: "180ms" }}>
          <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600 }}>{tx(p("Seats left", "खाली सीटें"))}</span>
            <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{kpis.seatsLeft ?? "—"}</span>
          </span>
          <span style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, kpis.bands.length)},minmax(0,1fr))`, gap: 6 }}>
            {kpis.bands.map((b) => (
              <span key={b.short} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <span style={{ width: "100%", height: 22, borderRadius: 6, background: b.left > 3 ? "var(--acc)" : b.left > 0 ? "var(--warn)" : "var(--bad)", opacity: 0.85 }} />
                <span className="num" style={{ fontSize: 12, fontWeight: 700 }}>{b.left}</span>
                <span style={{ fontSize: 10, color: "var(--mut)" }}>{b.short}</span>
              </span>
            ))}
          </span>
          {kpis.seatsEditable ? (
            <Link href="/admissions/seats" style={{ fontSize: 12, fontWeight: 600, color: "var(--accfg)" }}>
              {kpis.seatsLeft === null ? tx(p("Set seats per class", "हर कक्षा की सीटें तय करें")) : tx(p("Edit seats", "सीटें बदलें"))}
            </Link>
          ) : null}
        </div>
      </div>

      <SecHead action={<span className="hide-m" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Press Move when a family reaches the next step", "परिवार अगले चरण पर पहुँचे तो आगे दबाएँ"))}</span>}>
        {tx(p("Enquiry to admission", "पूछताछ से प्रवेश तक"))}
      </SecHead>

      <div className="only-m">
        <Seg<Stage>
          label={tx(p("Stage", "चरण"))}
          value={mStage}
          onChange={setMStage}
          options={COLS.map((c) => ({ value: c.stage, label: `${tx(c.label)} · ${counts[c.stage]}` }))}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {column(mStage)}
          {counts[mStage] === 0 ? <EmptyState icon="users" title={tx(p("Nobody here right now", "अभी यहाँ कोई नहीं"))} /> : null}
        </div>
      </div>

      <div className="pp-cols only-d">
        {COLS.map((col) => (
          <section key={col.stage} style={{ background: "var(--s2)", border: "1px solid var(--bd)", borderRadius: 18, padding: 10, display: "flex", flexDirection: "column", gap: 10 }} aria-label={col.label.en}>
            <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px" }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: col.dot }} />
              <strong style={{ flex: 1 }}>{tx(col.label)}</strong>
              <span className="num pill" style={{ background: "var(--card)" }}>{counts[col.stage]}</span>
            </header>
            {column(col.stage)}
            {counts[col.stage] === 0 ? <span style={{ fontSize: 13, color: "var(--mut)", padding: "8px 6px" }}>{tx(p("Nobody here right now", "अभी यहाँ कोई नहीं"))}</span> : null}
          </section>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn variant="sec" icon="plus" onClick={() => setAdding(true)}>{tx(p("Add an enquiry", "पूछताछ जोड़ें"))}</Btn>
        <Btn variant="soft" icon="userPlus" href="/admissions/new">{tx(p("Add a student", "विद्यार्थी जोड़ें"))}</Btn>
      </div>

      <SecHead action={kpis.docsPending ? <Pill tone="warn">{kpis.docsPending} {tx(p("documents pending", "दस्तावेज़ बाकी"))}</Pill> : null}>
        {tx(p("Recently admitted", "हाल में प्रवेश"))}
      </SecHead>
      <Card pad={false} style={{ overflow: "hidden" }}>
        {recent.length === 0 ? (
          <EmptyState icon="userPlus" title={tx(p("No admissions yet this session", "इस सत्र में अभी कोई प्रवेश नहीं"))} action={<Btn variant="pri" href="/admissions/new" icon="userPlus">{tx(p("Add a student", "विद्यार्थी जोड़ें"))}</Btn>} />
        ) : (
          recent.map((r, i) => (
            <Link key={r.id} href={`/admissions/${r.id}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: i ? "1px solid var(--bd)" : 0, minHeight: 58 }}>
              <Avatar text={initials(r.name)} seed={r.name} size={36} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong className="clip" style={{ display: "block" }}>{r.name}</strong>
                <span className="clip" style={{ display: "block", fontSize: 12, color: "var(--mut)" }}>{r.classLabel} · SR {r.sr} · {r.date}</span>
              </span>
              <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {r.missing.length ? r.missing.map((d) => <Pill key={d} tone="warn">{d}</Pill>) : <Pill tone="ok" icon="check">{tx(p("All received", "सब मिल गया"))}</Pill>}
              </span>
              <Ic n="chevRight" size={16} style={{ color: "var(--sub)" }} />
            </Link>
          ))
        )}
      </Card>

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
      icon="userPlus"
      footer={
        <>
          <Btn variant="sec" onClick={onClose} style={{ flex: 1 }}>{tx(p("Cancel", "रद्द करें"))}</Btn>
          <Btn variant="pri" onClick={() => void save()} disabled={saving || !form.childName.trim()} style={{ flex: 1 }}>{tx(p("Save enquiry", "पूछताछ सहेजें"))}</Btn>
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
