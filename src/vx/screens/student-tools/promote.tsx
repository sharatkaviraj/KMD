"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { applyPromotionAction, buildPromotionListAction, markStudentAction, undoPromotionAction } from "@/app/(app)/student-tools/actions";
import { dateLabel } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { SearchBox, Select, WizardSteps } from "@/vx/ui/controls";
import { Confirm, useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Btn, Card, CardHead, EmptyState, Pill, SecHead, Stat, SuccessTick } from "@/vx/ui/primitives";

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
};

const STEPS = [p("Classes", "कक्षाएँ"), p("Check", "जाँचें"), p("Done", "हो गया")];

/** Student tools states `promote`, `promote-review` and `promoted`. */
export function PromoteFlow(props: PromoteProps) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [stage, setStage] = useState(props.run?.status === "applied" ? "promoted" : props.stage);
  const [map, setMap] = useState<Record<string, string>>(props.initialMap);
  const [marks, setMarks] = useState<Record<string, PromoMark>>(props.marks);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"apply" | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entries = props.entries;
  const plan = planPromotion(entries.map((e) => ({ id: e.id, studentId: e.studentId, fromClassId: e.fromClassId, decision: e.decision, newClassId: e.newClassId })), map, marks);
  const counts = planCounts(plan);
  const byClass = new Map<string, number>();
  for (const e of entries) if (e.fromClassId) byClass.set(e.fromClassId, (byClass.get(e.fromClassId) ?? 0) + 1);
  const needsClass = props.sourceClasses.filter((c) => (byClass.get(c.id) ?? 0) > 0 && !map[c.id]);
  const targetLabel = (id: string) => (id === "graduate" ? tx(p("Leaves school (passed out)", "विद्यालय से उत्तीर्ण")) : (props.targetClasses.find((t) => t.id === id)?.label ?? "—"));

  if (!props.run || props.run.status === "rolled_back") {
    return (
      <Card>
        <EmptyState
          icon="grad"
          title={tx(p(`Move students from ${props.source} to ${props.target}`, `${props.source} से ${props.target} में भेजें`))}
          body={tx(p("First make the list. Nothing changes until you check it and press Move up.", "पहले सूची बनाएँ। जाँचकर 'आगे बढ़ाएँ' दबाने तक कुछ नहीं बदलेगा।"))}
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
      </Card>
    );
  }

  async function mark(e: PromoteEntry, kind: PromoMark | null) {
    const before = marks[e.studentId] ?? null;
    setMarks((m) => {
      const next = { ...m };
      if (kind) next[e.studentId] = kind;
      else delete next[e.studentId];
      return next;
    });
    const res = await markStudentAction({ runId: props.run!.id, entryId: e.id, studentId: e.studentId, kind });
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
    const res = await applyPromotionAction({ runId: props.run!.id, classMap: map, marks });
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
    const res = await undoPromotionAction(props.run!.id);
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

  const stepIndex = stage === "promote" ? 0 : stage === "promote-review" ? 1 : 2;
  const marked = entries.filter((e) => marks[e.studentId]);
  const found = q.trim().length >= 2 ? entries.filter((e) => e.name.toLowerCase().includes(q.trim().toLowerCase()) || e.sr.includes(q.trim())).slice(0, 8) : [];

  return (
    <div className="pp-wrap" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeopleStyles />
      <WizardSteps steps={STEPS.map((s) => tx(s))} current={stepIndex} />

      {stage === "promoted" ? (
        <>
          <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: 24 }}>
            <SuccessTick />
            <h2 className="serif" style={{ margin: 0 }}>{tx(p(`Students moved to ${props.target}`, `विद्यार्थी ${props.target} में पहुँचे`))}</h2>
            <span style={{ color: "var(--mut)", fontSize: 13 }}>{props.run.appliedAt ? dateLabel(props.run.appliedAt) : null}</span>
          </Card>
          <Card style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
            <Stat label={tx(p("Moved up", "आगे बढ़े"))} value={props.run.appliedCount} />
            <Stat label={tx(p("Passed out", "उत्तीर्ण"))} value={props.run.graduatedCount} />
            <Stat label={tx(p("Held back or leaving", "रुके या जा रहे"))} value={Object.keys(props.marks).length} />
          </Card>
          <Banner tone="info" action={<Btn variant="sec" icon="undo" onClick={() => setConfirm("undo")}>{tx(p("Undo promotion", "प्रमोशन वापस लें"))}</Btn>}>
            {tx(p("Made a mistake? Undo puts every child back in last year's class.", "ग़लती हुई? वापस लेने से सब पिछली कक्षा में लौटेंगे।"))}
          </Banner>
          <Btn variant="ghost" icon="arrowRight" href="/student-tools">{tx(p("Back to Student tools", "स्टूडेंट टूल्स पर लौटें"))}</Btn>
        </>
      ) : stage === "promote" ? (
        <>
          <Card>
            <CardHead title={tx(p("Where each class goes", "हर कक्षा कहाँ जाएगी"))} sub={tx(p(`${props.source} → ${props.target}`, `${props.source} → ${props.target}`))} />
            {props.sourceClasses
              .filter((c) => (byClass.get(c.id) ?? 0) > 0)
              .map((c) => (
                <div key={c.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1.3fr)", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <strong className="clip">{c.label}</strong>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`${byClass.get(c.id) ?? 0} students`, `${byClass.get(c.id) ?? 0} विद्यार्थी`))}</span>
                  </span>
                  <span aria-hidden style={{ color: "var(--mut)" }}>→</span>
                  <Select value={map[c.id] ?? ""} invalid={!map[c.id]} aria-label={tx(p(`Next class for ${c.label}`, `${c.label} की अगली कक्षा`))} onChange={(e) => setMap((m) => ({ ...m, [c.id]: e.target.value }))}>
                    <option value="">{tx(p("Choose a class", "कक्षा चुनें"))}</option>
                    {props.targetClasses.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    <option value="graduate">{tx(p("Leaves school (passed out)", "विद्यालय से उत्तीर्ण"))}</option>
                  </Select>
                </div>
              ))}
          </Card>

          <Card>
            <CardHead title={tx(p("Held back or leaving", "रुकेंगे या जा रहे हैं"))} sub={tx(p("These children are not moved", "ये बच्चे आगे नहीं बढ़ेंगे"))} />
            <SearchBox value={q} onChange={setQ} placeholder={tx(p("Find a child by name or SR", "नाम या SR से खोजें"))} />
            {found.map((e) => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--bd)", flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 140 }}>{e.name} <span style={{ color: "var(--mut)", fontSize: 12 }}>· {e.fromLabel} · SR {e.sr}</span></span>
                <Btn variant={marks[e.studentId] === "held" ? "pri" : "sec"} onClick={() => mark(e, marks[e.studentId] === "held" ? null : "held")}>{tx(p("Held back", "रुकेगा"))}</Btn>
                <Btn variant={marks[e.studentId] === "leaving" ? "pri" : "sec"} onClick={() => mark(e, marks[e.studentId] === "leaving" ? null : "leaving")}>{tx(p("Leaving", "जा रहा"))}</Btn>
              </div>
            ))}
            {marked.length > 0 ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {marked.map((e) => (
                  <button key={e.id} type="button" className="tap" onClick={() => mark(e, null)} aria-label={tx(p(`Remove mark for ${e.name}`, `${e.name} का निशान हटाएँ`))} style={{ border: 0, background: "none", padding: 0 }}>
                    <Pill tone={marks[e.studentId] === "held" ? "warn" : "bad"} icon="x">{e.name} · {marks[e.studentId] === "held" ? tx(p("held", "रुका")) : tx(p("leaving", "जा रहा"))}</Pill>
                  </button>
                ))}
              </div>
            ) : null}
          </Card>

          <ActionBar hint={needsClass.length > 0 ? tx(p(`${needsClass.length} class${needsClass.length === 1 ? "" : "es"} still need a next class`, `${needsClass.length} कक्षाओं की अगली कक्षा चुननी बाकी`)) : tx(p("All classes have a next class", "सब कक्षाओं की अगली कक्षा तय"))}>
            <Btn variant="ghost" href="/student-tools">{tx(p("Cancel", "रद्द करें"))}</Btn>
            <Btn variant="pri" icon="arrowRight" onClick={() => { setStage("promote-review"); window.scrollTo({ top: 0 }); }}>{tx(p("Check the list", "सूची जाँचें"))}</Btn>
          </ActionBar>
        </>
      ) : (
        <>
          <Card style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12 }}>
            <Stat label={tx(p("Move up", "आगे बढ़ेंगे"))} value={counts.promote} tone="var(--ok)" />
            <Stat label={tx(p("Pass out", "उत्तीर्ण"))} value={counts.graduate} />
            <Stat label={tx(p("Held back / leaving", "रुके / जा रहे"))} value={counts.skip} />
            <Stat label={tx(p("Need a class", "कक्षा बाकी"))} value={counts.manual} tone={counts.manual > 0 ? "var(--warn)" : undefined} />
          </Card>
          {counts.manual > 0 ? (
            <Banner tone="warn" action={<Btn variant="sec" onClick={() => setStage("promote")}>{tx(p("Pick classes", "कक्षा चुनें"))}</Btn>}>
              {tx(p(`${counts.manual} children have no next class and will stay where they are.`, `${counts.manual} बच्चों की अगली कक्षा नहीं चुनी — वे वहीं रहेंगे।`))}
            </Banner>
          ) : null}
          {error ? <Banner tone="bad">{error}</Banner> : null}
          <SecHead>{tx(p("Class by class", "कक्षावार"))}</SecHead>
          <Card>
            {props.sourceClasses
              .filter((c) => (byClass.get(c.id) ?? 0) > 0)
              .map((c) => (
                <div key={c.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid var(--bd)", alignItems: "center" }}>
                  <span style={{ flex: 1 }}>{c.label}</span>
                  <span style={{ color: "var(--mut)" }}>→</span>
                  <span style={{ flex: 1, fontWeight: 600, color: map[c.id] ? undefined : "var(--warn)" }}>{map[c.id] ? targetLabel(map[c.id]) : tx(p("Stays (no class picked)", "वहीं (कक्षा नहीं चुनी)"))}</span>
                  <Pill tone="mut">{byClass.get(c.id) ?? 0}</Pill>
                </div>
              ))}
          </Card>
          <Banner tone="info">{tx(p("A child who still owes fees cannot pass out. The list stops and names them — collect first, or mark them held back.", "जिनकी फीस बाकी है वे उत्तीर्ण नहीं होंगे — सूची रुककर नाम बताएगी।"))}</Banner>
          <ActionBar hint={tx(p("You can undo this afterwards", "बाद में वापस ले सकते हैं"))}>
            <Btn variant="ghost" onClick={() => setStage("promote")}>{tx(p("Back", "पीछे"))}</Btn>
            <Btn variant="pri" icon="grad" disabled={busy || counts.promote + counts.graduate === 0} onClick={() => setConfirm("apply")}>{tx(p(`Move ${counts.promote + counts.graduate} students up`, `${counts.promote + counts.graduate} विद्यार्थी आगे बढ़ाएँ`))}</Btn>
          </ActionBar>
        </>
      )}

      <Confirm
        open={confirm === "apply"}
        onClose={() => setConfirm(null)}
        onConfirm={apply}
        busy={busy}
        icon="grad"
        title={tx(p(`Move students to ${props.target}?`, `विद्यार्थियों को ${props.target} में भेजें?`))}
        body={tx(p(`${counts.promote} move up, ${counts.graduate} pass out, ${counts.skip + counts.manual} stay. Fees for the new session are prepared after this.`, `${counts.promote} आगे, ${counts.graduate} उत्तीर्ण, ${counts.skip + counts.manual} वहीं। इसके बाद नए सत्र की फीस बनेगी।`))}
        confirmLabel={tx(p("Move up", "आगे बढ़ाएँ"))}
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
    </div>
  );
}
