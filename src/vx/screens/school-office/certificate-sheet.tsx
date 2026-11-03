"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { generateCertificateAction } from "@/app/(app)/school-office/actions";
import type { CertificateBlocker, CertificateExtra, CertificateExtras, CertificateKind } from "@/modules/certificates/domain/certificate";
import { conductGrades } from "@/modules/certificates/domain/certificate";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn, SuccessTick } from "@/vx/ui/primitives";
import { downloadCertificate, printCertificate, shareCertificate } from "./artifact";
import { CONDUCT_LABELS, EXTRA_LABELS, FIELD_LABELS, KIND_HINTS, KIND_LABELS, LEAVING_REASONS, O, PURPOSES } from "./text";
import "./cert.css";

export type KindInfo = { kind: CertificateKind; titleEn: string; titleHi: string; language: "en" | "hi" | "both"; required: CertificateExtra[]; offered: CertificateExtra[]; purpose: boolean };
const KIND_ICONS: Record<CertificateKind, IconName> = { study: "book", character: "award", dob: "cake", tc: "door" };

let kindsCache: KindInfo[] | null = null;
async function loadKinds(): Promise<KindInfo[]> {
  if (kindsCache) return kindsCache;
  const response = await fetch("/school-office/certificates/kinds", { cache: "no-store" });
  if (!response.ok) throw new Error("unavailable");
  kindsCache = (await response.json()).kinds as KindInfo[];
  return kindsCache;
}

type Draft = { kind: CertificateKind; purpose: string; extras: CertificateExtras };
type Phase = { at: "form" } | { at: "working" } | { at: "done"; issueId: string; serial: string; existing: boolean } | { at: "blocked"; blockers: CertificateBlocker[] } | { at: "failed" };
const draftKey = (studentId: string) => `vx-cert-draft:${studentId}`;
function readDraft(studentId: string): Draft | null {
  try { const raw = sessionStorage.getItem(draftKey(studentId)); return raw ? JSON.parse(raw) as Draft : null; } catch { return null; }
}
function writeDraft(studentId: string, draft: Draft | null) {
  try { if (draft) sessionStorage.setItem(draftKey(studentId), JSON.stringify(draft)); else sessionStorage.removeItem(draftKey(studentId)); } catch { /* per-device convenience only */ }
}

export function CertificateSheet({ open, onClose, studentId, studentName, sessionLabel, editHref, initialKind }: {
  open: boolean; onClose: () => void; studentId: string; studentName: string; sessionLabel: string; editHref?: string; initialKind?: CertificateKind;
}) {
  const { tx, language } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [kinds, setKinds] = useState<KindInfo[] | null>(kindsCache);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => ({ kind: initialKind ?? "study", purpose: "", extras: {} }));
  const [phase, setPhase] = useState<Phase>({ at: "form" });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const command = useRef<string | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (!restored.current) {
      restored.current = true;
      const saved = readDraft(studentId);
      if (saved) setDraft(initialKind ? { ...saved, kind: initialKind } : saved);
    }
    let live = true;
    loadKinds().then((list) => { if (live) { setKinds(list); setLoadFailed(false); } }).catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [open, studentId, initialKind]);

  const info = kinds?.find((k) => k.kind === draft.kind) ?? kinds?.[0];
  const docLanguage = info?.language === "hi" ? "hi" : "en";
  const missingExtras = (info?.required ?? []).filter((key) => !draft.extras[key]?.trim());

  function update(next: Partial<Draft>) {
    command.current = null;
    setDraft((old) => { const value = { ...old, ...next, extras: { ...old.extras, ...(next.extras ?? {}) } }; writeDraft(studentId, value); return value; });
    if (phase.at !== "form" && phase.at !== "working") setPhase({ at: "form" });
  }
  function close() {
    onClose();
    window.setTimeout(() => { setPhase({ at: "form" }); command.current = null; }, 220);
  }

  async function prepare() {
    if (!info || phase.at === "working" || missingExtras.length) return;
    command.current ??= crypto.randomUUID();
    setPhase({ at: "working" });
    const extras = Object.fromEntries(info.offered.filter((key) => draft.extras[key]?.trim()).map((key) => [key, draft.extras[key]!.trim()]));
    const started = Date.now();
    try {
      const result = await generateCertificateAction({ studentId, sessionLabel, commandId: command.current, kind: info.kind, ...(info.purpose && draft.purpose.trim().length >= 2 ? { purpose: draft.purpose.trim() } : {}), ...(Object.keys(extras).length ? { extras } : {}) });
      // Let the paper settle for a beat so the change of state reads as one motion.
      await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, 450 - (Date.now() - started))));
      if (result.ok) {
        command.current = null;
        writeDraft(studentId, null);
        setPhase({ at: "done", issueId: result.issueId, serial: result.serial ?? "", existing: result.existing });
        router.refresh();
      } else if (result.code === "blocked" && result.blockers?.length) setPhase({ at: "blocked", blockers: result.blockers });
      else setPhase({ at: "failed" });
    } catch { setPhase({ at: "failed" }); }
  }

  async function act(name: "print" | "download" | "share") {
    if (phase.at !== "done" || busyAction) return;
    setBusyAction(name);
    try {
      if (name === "print") { if (!(await printCertificate(phase.issueId))) toast.show({ text: tx(O.unavailable) }); }
      else if (name === "download") { if (!(await downloadCertificate(phase.issueId))) toast.show({ text: tx(O.unavailable) }); }
      else if ((await shareCertificate(phase.issueId, phase.serial)) === "failed") toast.show({ text: tx(O.unavailable) });
    } finally { setBusyAction(null); }
  }

  const label = (pair: Pair) => tx(pair);
  const blockerText = (b: CertificateBlocker) => b.field === "status" ? O.notLeft : b.field === "identity" ? O.identity : b.field === "source" ? O.source : b.field === "template" ? O.templateMissing
    : b.field in EXTRA_LABELS ? EXTRA_LABELS[b.field as CertificateExtra] : FIELD_LABELS[b.field as keyof typeof FIELD_LABELS] ?? O.details;
  const fieldBlockers = phase.at === "blocked" && phase.blockers.some((b) => b.field in FIELD_LABELS);

  const footer = phase.at === "form" ? <Btn variant="pri" big full icon="fileText" disabled={!info || missingExtras.length > 0} onClick={prepare}>{tx(O.make)}</Btn>
    : phase.at === "done" ? <div style={{ display: "flex", gap: 8, width: "100%" }}><Btn full onClick={() => setPhase({ at: "form" })}>{tx(O.another)}</Btn><Btn full variant="pri" onClick={close}>{tx(O.done)}</Btn></div>
    : phase.at === "blocked" || phase.at === "failed" ? <div style={{ display: "flex", gap: 8, width: "100%" }}><Btn full icon="chevLeft" onClick={() => setPhase({ at: "form" })}>{tx(O.chooseKind)}</Btn>{phase.at === "failed" ? <Btn full variant="pri" icon="refresh" onClick={prepare}>{tx(O.retry)}</Btn> : null}</div>
    : undefined;

  return <Sheet open={open} onClose={close} title={tx(O.certificate)} sub={studentName} icon="award" footer={footer} backCloses>
    {phase.at === "form" ? <div className="cert-stack">
      {loadFailed ? <div role="alert" className="cert-note">{tx(O.loadFailed)}</div> : null}
      <div className="cert-q" style={{ animationDelay: "0ms" }}>
        <span>{tx(O.chooseKind)}</span>
        <div className="cert-kinds" role="group" aria-label={tx(O.chooseKind)}>
          {(kinds ?? []).map((k, index) => <button key={k.kind} type="button" className="cert-kind" aria-pressed={info?.kind === k.kind} style={{ animationDelay: `${index * 45}ms` }} onClick={() => update({ kind: k.kind })}>
            <span className="cert-kind-ic"><Ic n={KIND_ICONS[k.kind]} size={19} /></span>
            <span style={{ minWidth: 0 }}><strong>{label(KIND_LABELS[k.kind])}</strong><small>{label(KIND_HINTS[k.kind])}</small></span>
            {info?.kind === k.kind ? <span className="cert-kind-tick" aria-hidden="true"><Ic n="checkCircle" size={16} /></span> : null}
          </button>)}
          {!kinds && !loadFailed ? [0, 1, 2, 3].map((i) => <div key={i} className="cert-kind" style={{ opacity: .5 }} aria-hidden="true"><span className="cert-kind-ic" /><span style={{ flex: 1 }}><span className="skel" style={{ display: "block", height: 12, width: "60%", borderRadius: 6, background: "var(--s3)" }} /></span></div>) : null}
        </div>
      </div>

      {info?.purpose ? <label className="cert-q" key={`purpose-${info.kind}`}>
        <span>{tx(O.purpose)}</span>
        <div className="cert-chips">{PURPOSES.map((pair) => { const value = pair[docLanguage]; return <button key={pair.en} type="button" className="cert-chip" aria-pressed={draft.purpose === value} onClick={() => update({ purpose: draft.purpose === value ? "" : value })}>{tx(pair)}</button>; })}</div>
        <input className="inp" value={draft.purpose} maxLength={80} placeholder={tx(O.purposeHint)} onChange={(e) => update({ purpose: e.target.value })} />
      </label> : null}

      {info?.offered.includes("reasonForLeaving") ? <label className="cert-q" key={`reason-${info.kind}`}>
        <span>{tx(EXTRA_LABELS.reasonForLeaving)}{info.required.includes("reasonForLeaving") ? " *" : ""}</span>
        <div className="cert-chips">{LEAVING_REASONS.map((pair) => { const value = info.language === "both" ? `${pair.en} / ${pair.hi}` : pair[docLanguage]; return <button key={pair.en} type="button" className="cert-chip" aria-pressed={draft.extras.reasonForLeaving === value} onClick={() => update({ extras: { reasonForLeaving: value } })}>{tx(pair)}</button>; })}</div>
        <input className="inp" value={draft.extras.reasonForLeaving ?? ""} maxLength={200} onChange={(e) => update({ extras: { reasonForLeaving: e.target.value } })} />
      </label> : null}

      {info?.offered.includes("conduct") ? <div className="cert-q" key={`conduct-${info.kind}`}>
        <span>{tx(EXTRA_LABELS.conduct)}{info.required.includes("conduct") ? " *" : ""}</span>
        <div className="cert-chips" role="group" aria-label={tx(EXTRA_LABELS.conduct)}>{conductGrades.map((grade) => <button key={grade} type="button" className="cert-chip" aria-pressed={draft.extras.conduct === grade} onClick={() => update({ extras: { conduct: grade } })}>{tx(CONDUCT_LABELS[grade])}</button>)}</div>
      </div> : null}

      {(["lastResult", "remarks"] as const).filter((key) => info?.offered.includes(key)).map((key) => <label key={`${key}-${info!.kind}`} className="cert-q">
        <span>{tx(EXTRA_LABELS[key])}</span>
        <input className="inp" value={draft.extras[key] ?? ""} maxLength={200} onChange={(e) => update({ extras: { [key]: e.target.value } })} />
      </label>)}

      {info?.kind === "tc" ? <div className="cert-note">{tx(p("The TC uses the leaving date already recorded for this student. One TC per session; a reprint keeps its number.", "टीसी में विद्यार्थी की दर्ज छोड़ने की तिथि ही आएगी। हर सत्र में एक टीसी; दोबारा प्रिंट पर वही संख्या रहेगी।"))}</div> : null}
    </div> : null}

    {phase.at === "working" ? <div className="cert-stack" aria-live="polite">
      <Paper busy kindTitle={info ? (language === "hi" ? info.titleHi : info.titleEn) : ""} name={studentName} />
      <p className="cert-busy-text">{tx(O.preparing)}</p>
    </div> : null}

    {phase.at === "done" ? <div className="cert-done" aria-live="polite">
      <SuccessTick size={58} />
      <strong style={{ fontSize: 17 }}>{tx(O.ready)}</strong>
      <div className="cert-serial">{phase.serial}</div>
      {phase.existing ? <div className="cert-note">{tx(O.reprintFound)}</div> : null}
      <div className="cert-actions">
        <Btn variant="pri" icon="printer" disabled={!!busyAction} onClick={() => act("print")}>{tx(O.print)}</Btn>
        <Btn icon="download" disabled={!!busyAction} onClick={() => act("download")}>{tx(O.download)}</Btn>
        <Btn icon="send" disabled={!!busyAction} onClick={() => act("share")}>{tx(O.share)}</Btn>
      </div>
      <Btn icon="history" href={`/school-office/certificates/${phase.issueId}`} style={{ width: "100%" }}>{tx(O.openIssue)}</Btn>
      <Paper kindTitle={info ? (language === "hi" ? info.titleHi : info.titleEn) : ""} name={studentName} serial={phase.serial} />
    </div> : null}

    {phase.at === "blocked" ? <div className="cert-stack" aria-live="polite">
      <strong>{tx(O.details)}</strong>
      <div className="cert-blockers">{phase.blockers.map((b, index) => <div key={`${b.field}:${b.reason}`} className="cert-blocker" style={{ animationDelay: `${index * 50}ms` }}><Ic n="alert" size={17} /><span>{tx(blockerText(b))}</span></div>)}</div>
      {fieldBlockers ? editHref ? <Btn variant="pri" icon="edit" href={editHref}>{tx(O.addDetail)}</Btn> : <div className="cert-note">{tx(O.askOffice)}</div> : null}
      {fieldBlockers && editHref ? <div className="cert-note">{tx(p("Your choices here are kept. Come back to this student and tap Certificate to continue.", "आपकी चुनी जानकारी सुरक्षित है। विद्यार्थी पर लौटकर प्रमाण पत्र दबाएँ।"))}</div> : null}
    </div> : null}

    {phase.at === "failed" ? <div role="alert" className="cert-blocker"><Ic n="alert" size={17} /><span>{tx(O.unavailable)}</span></div> : null}
  </Sheet>;
}

/** A small drawing of the document, so the person sees what they are about to hand over. */
function Paper({ busy = false, kindTitle, name, serial }: { busy?: boolean; kindTitle: string; name: string; serial?: string }) {
  const { tx } = useVx();
  return <div className={`cert-paper${busy ? " busy" : ""}`} aria-hidden="true">
    <div className="cp-school" style={{ width: "58%", height: 7, borderRadius: 3, background: "#0B2545", opacity: .85 }} /><div className="cp-rule" />
    <div className="cp-title">{busy ? "" : kindTitle}</div>
    <div className="cp-line s" style={{ marginTop: 10 }} />
    <div className="cp-name">{busy ? "" : name}</div>
    <div className="cp-line" /><div className="cp-line" /><div className="cp-line s" />
    {!busy ? <div className="cp-stamp" /> : null}
    <div className="cp-foot"><div className="cp-qr" /><div className="cp-sign">{tx(p("Principal", "प्रधानाचार्य"))}</div></div>
    {serial ? <div className="cp-serial">{serial}</div> : null}
  </div>;
}
