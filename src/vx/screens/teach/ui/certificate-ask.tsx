"use client";
import { useRef, useState } from "react";
import { askForCertificateAction } from "@/app/(app)/teach/certificates/actions";
import { conductGrades, type ConductGrade } from "@/modules/certificates/domain/conduct";
import { requestKinds, requestPurposeKinds, type RequestErrorCode, type RequestKind } from "@/modules/certificates/domain/request-view";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn, SuccessTick } from "@/vx/ui/primitives";
import { VoiceNote } from "@/vx/ui/voice";
import { CONDUCT_LABELS, KIND_HINTS, KIND_LABELS, PURPOSES } from "@/vx/screens/school-office/text";
import { R, requestError } from "@/vx/screens/school-office/request-text";
import type { KindOffer } from "./certificates";
import "@/vx/screens/school-office/cert.css";

const KIND_ICONS: Record<RequestKind, IconName> = { study: "book", character: "award", dob: "cake" };
type Draft = { kind: RequestKind; purpose: string; conduct: ConductGrade | null; note: string };
type Phase = { at: "form" } | { at: "working" } | { at: "done"; existing: boolean } | { at: "failed"; code: RequestErrorCode };
/** Waits for `work`, and for at least `ms`, so a short animation is seen to finish. */
async function atLeast<T>(ms: number, work: Promise<T>): Promise<T> {
  const [result] = await Promise.all([work, new Promise((resolve) => window.setTimeout(resolve, ms))]);
  return result;
}
const clean = (value: string, max: number) => value.replace(/[{}<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * "Ask for a certificate" (D-542): three big choices, the conduct for a
 * character certificate, an optional purpose and a note the teacher can type
 * or speak. Sending prepares nothing; the approver signs it.
 */
export function AskCertificateSheet({ open, onClose, onSent, studentId, studentName, sessionLabel, kinds }: {
  open: boolean; onClose: () => void; onSent: () => void; studentId: string; studentName: string; sessionLabel: string; kinds: KindOffer[];
}) {
  const { tx, language } = useVx();
  const toast = useToast();
  // Every switched-on document, or all three while the list could not be read: the database decides anyway.
  const offers: KindOffer[] = kinds.length ? kinds : requestKinds.map((kind) => ({ kind, language: "en", purpose: requestPurposeKinds.includes(kind) }));
  const [draft, setDraft] = useState<Draft>({ kind: offers[0]?.kind ?? "study", purpose: "", conduct: null, note: "" });
  const [phase, setPhase] = useState<Phase>({ at: "form" });
  const command = useRef<string | null>(null);
  const offer = offers.find((item) => item.kind === draft.kind) ?? offers[0];
  const docLanguage = offer?.language === "hi" ? "hi" : "en";
  const needsConduct = draft.kind === "character" && !draft.conduct;

  function update(next: Partial<Draft>) {
    command.current = null;
    setDraft((old) => ({ ...old, ...next }));
    if (phase.at === "failed") setPhase({ at: "form" });
  }
  function close() {
    onClose();
    window.setTimeout(() => { setPhase({ at: "form" }); command.current = null; setDraft({ kind: offers[0]?.kind ?? "study", purpose: "", conduct: null, note: "" }); }, 240);
  }

  async function send() {
    if (!offer || phase.at === "working" || needsConduct) return;
    command.current ??= crypto.randomUUID();
    setPhase({ at: "working" });
    const purpose = offer.purpose ? clean(draft.purpose, 80) : "";
    const note = clean(draft.note, 300);
    try {
      // Let the paper fly for a beat so "sent" reads as one motion.
      const result = await atLeast(700, askForCertificateAction({
        studentId, sessionLabel, kind: offer.kind, commandId: command.current,
        ...(purpose.length >= 2 ? { purpose } : {}), ...(offer.kind === "character" && draft.conduct ? { conduct: draft.conduct } : {}), ...(note ? { note } : {}),
      }));
      if (result.ok) {
        command.current = null;
        setPhase({ at: "done", existing: result.existing });
        toast.show({ text: tx(result.existing ? R.already : R.sent), tone: "ok", cue: "done" });
        onSent();
      } else setPhase({ at: "failed", code: result.code });
    } catch { setPhase({ at: "failed", code: "unavailable" }); }
  }

  const footer = phase.at === "form" ? <Btn variant="pri" big full icon="send" disabled={!offer || needsConduct} onClick={send}>{tx(R.send)}</Btn>
    : phase.at === "done" ? <Btn variant="pri" big full icon="check" onClick={close}>{tx(R.done)}</Btn>
    : phase.at === "failed" ? <div style={{ display: "flex", gap: 8, width: "100%" }}><Btn full icon="chevLeft" onClick={() => setPhase({ at: "form" })}>{tx(R.which)}</Btn>{phase.code === "unavailable" ? <Btn full variant="pri" icon="refresh" onClick={send}>{tx(R.retry)}</Btn> : null}</div>
    : undefined;

  return <Sheet open={open} onClose={close} title={tx(R.ask)} sub={studentName} icon="award" footer={footer} backCloses>
    {phase.at === "form" ? <div className="cert-stack">
      <div className="cert-q">
        <span>{tx(R.which)}</span>
        <div className="cert-kinds" role="group" aria-label={tx(R.which)}>
          {offers.map((item, index) => <button key={item.kind} type="button" className="cert-kind" aria-pressed={draft.kind === item.kind} style={{ animationDelay: `${index * 45}ms` }} onClick={() => update({ kind: item.kind })}>
            <span className="cert-kind-ic"><Ic n={KIND_ICONS[item.kind]} size={19} /></span>
            <span style={{ minWidth: 0 }}><strong>{tx(KIND_LABELS[item.kind])}</strong><small>{tx(KIND_HINTS[item.kind])}</small></span>
            {draft.kind === item.kind ? <span className="cert-kind-tick" aria-hidden="true"><Ic n="checkCircle" size={16} /></span> : null}
          </button>)}
        </div>
      </div>

      {draft.kind === "character" ? <div className="cert-q" key="conduct">
        <span>{tx(R.conduct)} *</span>
        <div className="cert-chips" role="group" aria-label={tx(R.conduct)}>{conductGrades.map((grade) => <button key={grade} type="button" className="cert-chip" aria-pressed={draft.conduct === grade} onClick={() => update({ conduct: grade })}>{tx(CONDUCT_LABELS[grade])}</button>)}</div>
      </div> : null}

      {offer?.purpose ? <label className="cert-q" key={`purpose-${offer.kind}`}>
        <span>{tx(R.purpose)}</span>
        <div className="cert-chips">{PURPOSES.map((pair) => { const value = pair[docLanguage]; return <button key={pair.en} type="button" className="cert-chip" aria-pressed={draft.purpose === value} onClick={() => update({ purpose: draft.purpose === value ? "" : value })}>{tx(pair)}</button>; })}</div>
        <input className="inp" value={draft.purpose} maxLength={80} placeholder={tx(R.purposeHint)} onChange={(e) => update({ purpose: e.target.value })} />
      </label> : null}

      <div className="cert-q">
        <span>{tx(R.note)}</span>
        <VoiceNote value={draft.note} onChange={(note) => update({ note: note.slice(0, 300) })} rows={2} placeholder={tx(R.notePlaceholder)} lang={language === "en" ? "en-IN" : "hi-IN"} />
      </div>
    </div> : null}

    {phase.at === "working" ? <div className="cert-stack" aria-live="polite">
      <div className="cert-fly" aria-hidden="true"><div className="cert-paper busy" style={{ width: 150 }}><div className="cp-title" /><div className="cp-line s" style={{ marginTop: 10 }} /><div className="cp-name" /><div className="cp-line" /><div className="cp-line" /></div></div>
      <p className="cert-busy-text">{tx(R.sending)}</p>
    </div> : null}

    {phase.at === "done" ? <div className="cert-done" aria-live="polite">
      <SuccessTick size={64} />
      <strong style={{ fontSize: 18 }}>{tx(phase.existing ? R.already : R.sent)}</strong>
      <p className="cert-note" style={{ margin: 0, textAlign: "left" }}>{tx(R.sentBody)}</p>
    </div> : null}

    {phase.at === "failed" ? <div role="alert" className="cert-blocker"><Ic n="alert" size={17} /><span>{tx(requestError(phase.code))}</span></div> : null}
  </Sheet>;
}
