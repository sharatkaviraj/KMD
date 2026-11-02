"use client";

import { useId, useRef, useState } from "react";
import { documentMessages as dm } from "@/messages/setup";
import { documentKinds, documentKindLabels, humanSize, MAX_DOCUMENT_BYTES, type DocumentKind } from "@/modules/collection/domain/review";
import { uploadToDrive, type UploadOutcome } from "@/modules/collection/ui/chunked-upload";
import { uploadToBucket } from "@/modules/collection/ui/bucket-upload";
import { primary, type Localized } from "@/platform/i18n/language";
import { Bi, useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { Btn } from "@/vx/ui/primitives";

const D = {
  title: p("Add document", "दस्तावेज़ जोड़ें"),
  kind: p("Document type", "दस्तावेज़ का प्रकार"),
  file: p("File", "फ़ाइल"),
  choose: p("Choose file", "फ़ाइल चुनें"),
  change: p("Change file", "फ़ाइल बदलें"),
  limit: p("PDF, JPG, PNG or WebP · up to 10 MB", "PDF, JPG, PNG या WebP · अधिकतम 10 MB"),
  addNote: p("Add a note (optional)", "टिप्पणी जोड़ें (ज़रूरी नहीं)"),
  note: p("Note (optional)", "टिप्पणी (ज़रूरी नहीं)"),
  save: p("Save document", "दस्तावेज़ रखें"),
  retry: p("Retry upload", "फिर अपलोड करें"),
  saving: p("Saving…", "रख रहे हैं…"),
  cancel: p("Cancel", "रहने दें"),
};
const FAILURE: Record<Extract<UploadOutcome, { ok: false }>["reason"], Localized> = {
  too_large: dm.docTooLarge, wrong_type: dm.docWrongType, not_allowed: dm.docNotAllowed, mismatch: dm.docMismatch,
  expired: dm.docExpired, storage_down: dm.docStorageDown, storage_refused: dm.docStorageRefused,
  storage_full: dm.docStorageFull, failed: dm.docFailed,
};

/** Same validated transports as the collection screen, inside the profile's own kit. */
export function StudentDocumentUpload({ studentId, mode, onClose, onSaved }: {
  studentId: string; mode: "supabase" | "gdrive" | "unavailable"; onClose: () => void; onSaved: () => void;
}) {
  const { tx, language } = useVx();
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const requestId = useRef<string | null>(null);
  const [kind, setKind] = useState<DocumentKind | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [failure, setFailure] = useState<Extract<UploadOutcome, { ok: false }> | null>(null);
  const available = mode === "gdrive" || mode === "supabase";

  function changed() { requestId.current = null; setFailure(null); setProgress(0); }
  function choose(chosen: File | null) {
    // Dismissing the operating system picker retains the current selection.
    if (!chosen) return;
    changed();
    if (!chosen.size || chosen.size > MAX_DOCUMENT_BYTES) {
      setFile(null); setFailure({ ok: false, reason: "too_large", resumable: false });
      if (input.current) input.current.value = "";
    } else setFile(chosen);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !kind || !file || !available) return;
    inFlight.current = true;
    requestId.current ??= crypto.randomUUID();
    setBusy(true); setFailure(null); setProgress(0);
    let result: UploadOutcome;
    try {
      result = await (mode === "gdrive" ? uploadToDrive : uploadToBucket)(
        { documentId: requestId.current, studentId, kind, file, note },
        { fetch: (url, init) => fetch(url, init), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
          digest: bytes => crypto.subtle.digest("SHA-256", bytes),
          onProgress: (sent, total) => { setRetrying(false); setProgress(Math.floor(sent / total * 100)); },
          onRetry: () => setRetrying(true) },
      );
    } catch { result = { ok: false, reason: "failed", resumable: true }; }
    finally { inFlight.current = false; setBusy(false); setRetrying(false); }
    if (result.ok) onSaved();
    else { setFailure(result); if (!result.resumable) requestId.current = null; }
  }

  return <Sheet open title={tx(D.title)} sub={tx(D.limit)} icon="upload" onClose={onClose} dismissable={!busy}
    footer={<><Btn disabled={busy} onClick={onClose}>{tx(D.cancel)}</Btn>{available ? <Btn full variant="pri" type="submit" form={formId} disabled={busy || !kind || !file}>{tx(busy ? D.saving : failure?.resumable ? D.retry : D.save)}</Btn> : null}</>}>
    {!available ? <p className="sd-error" role="alert">{primary(dm.docStorageDown, language)}</p> : <form id={formId} onSubmit={save} className="sd-form">
      {failure ? <p className="sd-error" role="alert"><Bi {...FAILURE[failure.reason]} /></p> : null}
      <fieldset className="sd-kinds" disabled={busy}><legend><Bi {...D.kind} /></legend><div>{documentKinds.map(option => <label key={option}>
        <input type="radio" name={`${formId}-kind`} value={option} checked={kind === option} onChange={() => { changed(); setKind(option); }} />
        <span><Bi {...documentKindLabels[option]} />{kind === option ? <Ic n="check" size={15} /> : null}</span>
      </label>)}</div></fieldset>
      <div className="sd-field"><label htmlFor={`${formId}-file`}><Bi {...D.file} /></label>
        <input ref={input} id={`${formId}-file`} className="sd-file-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={event => choose(event.currentTarget.files?.[0] ?? null)} tabIndex={-1} />
        <div className={`sd-picker${file ? " has-file" : ""}`}><span className="sd-icon"><Ic n={file?.type.startsWith("image/") ? "image" : "upload"} size={22} /></span>
          {file ? <span className="sd-file"><strong className="sd-break">{file.name}</strong><span className="sd-muted">{humanSize(file.size)}</span></span> : <span className="sd-muted">{tx(D.limit)}</span>}
          <Btn disabled={busy} onClick={() => input.current?.click()}>{tx(file ? D.change : D.choose)}</Btn>
        </div>
      </div>
      <details className="sd-note"><summary><Bi {...D.addNote} block={false} /></summary><label className="sd-field"><span><Bi {...D.note} /></span><input className="inp" type="text" maxLength={200} disabled={busy} value={note} onChange={event => { changed(); setNote(event.currentTarget.value); }} /></label></details>
      {busy ? <div role="status" aria-live="polite" className="sd-progress"><progress max={100} value={progress} aria-label={tx(D.saving)} /><span className="sd-muted">{primary(retrying ? dm.docRetrying : progress === 0 ? dm.docChecking : dm.docSending, language)}{progress > 0 ? ` ${progress}%` : ""}</span></div> : null}
    </form>}
  </Sheet>;
}
