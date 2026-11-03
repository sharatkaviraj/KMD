"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Image as ImageIcon, Plus, Upload, X } from "lucide-react";

import { m } from "@/messages";
import { documentMessages as dm } from "@/messages/setup";
import {
  MAX_DOCUMENT_BYTES,
  documentKindLabels,
  documentKinds,
  humanSize,
  type DocumentKind,
} from "@/modules/collection/domain/review";
import { primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Input, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

import { uploadToDrive, type UploadOutcome } from "./chunked-upload";
import { uploadToBucket } from "./bucket-upload";

const FAILURE_TEXT: Record<Extract<UploadOutcome, { ok: false }>["reason"], Localized> = {
  too_large: dm.docTooLarge,
  wrong_type: dm.docWrongType,
  not_allowed: dm.docNotAllowed,
  mismatch: dm.docMismatch,
  expired: dm.docExpired,
  storage_down: dm.docStorageDown,
  storage_refused: dm.docStorageRefused,
  storage_full: dm.docStorageFull,
  failed: dm.docFailed,
};

const ACCEPTED = "application/pdf,image/jpeg,image/png,image/webp";

/**
 * Upload one document about one child into the school's Shared Drive (D-333).
 *
 * Closed, it is one button. Open, it is three plain steps — which document,
 * which file, Save — and Save stays off until the first two are done, so a
 * document is never filed as "Other" by default. Sent in chunks through VPPS
 * One, with a progress bar, and a Retry that carries on from where it
 * stopped. The upload's id is minted when a file is chosen and kept until it
 * is saved or the file changes, so a second tap of Save — or a retry after
 * the phone lost signal — is the same document, never a copy.
 */
export function DriveDocumentForm({ studentId, mode = "gdrive" }: { studentId: string; mode?: "supabase" | "gdrive" }) {
  const language = useLanguage();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadId = useRef<string | null>(null);
  // A ref, not state: two taps inside one render both read busy=false.
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DocumentKind | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [result, setResult] = useState<UploadOutcome | null>(null);
  const [saved, setSaved] = useState(false);

  function reset() {
    uploadId.current = null;
    setKind(null);
    setFile(null);
    setNote("");
    setProgress(null);
    setResult(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function choose(chosen: File | null) {
    uploadId.current = null;
    setProgress(null);
    // Say so now rather than after the tap on Save.
    if (chosen && chosen.size > MAX_DOCUMENT_BYTES) {
      setResult({ ok: false, reason: "too_large", resumable: false });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setResult(null);
    setFile(chosen && chosen.size > 0 ? chosen : null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !kind || !file) return;

    inFlight.current = true;
    uploadId.current ??= crypto.randomUUID();
    setBusy(true);
    setResult(null);
    setProgress(0);

    let outcome: UploadOutcome;
    try {
      outcome = await (mode === "gdrive" ? uploadToDrive : uploadToBucket)(
        { documentId: uploadId.current, studentId, kind, note, file },
        {
          fetch: (url, init) => fetch(url, init),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          digest: (bytes) => crypto.subtle.digest("SHA-256", bytes),
          onProgress: (sent, total) => {
            setRetrying(false);
            setProgress(Math.floor((sent / total) * 100));
          },
          onRetry: () => setRetrying(true),
        },
      );
    } catch {
      // Reading the file failed (it was moved, or the phone ran out of memory).
      outcome = { ok: false, reason: "failed", resumable: true };
    } finally {
      inFlight.current = false;
    }

    setBusy(false);
    setRetrying(false);
    if (outcome.ok) {
      reset();
      setOpen(false);
      setSaved(true);
      router.refresh();
      return;
    }
    setResult(outcome);
    if (!outcome.resumable) uploadId.current = null;
  }

  if (!open) {
    return (
      <div className="space-y-3">
        {saved ? <Notice tone="success" text={dm.docSaved} language={language} /> : null}
        <Button
          type="button"
          fullWidth
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
        >
          <Plus aria-hidden />
          {primary(m.documentsAdd, language)}
        </Button>
      </div>
    );
  }

  const failed = result && !result.ok ? result : null;
  const ready = Boolean(kind && file);
  const FileIcon = file?.type.startsWith("image/") ? ImageIcon : FileText;

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-semibold text-foreground">{primary(m.documentsAdd, language)}</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            reset();
            setOpen(false);
          }}
          aria-label={primary(m.cancel, language)}
          className="focus-ring -mr-1 grid size-10 place-items-center rounded-full text-subtle-foreground hover:bg-surface-2 disabled:opacity-40"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>

      {failed ? <Notice tone="danger" text={FAILURE_TEXT[failed.reason]} language={language} /> : null}

      <fieldset disabled={busy} className="space-y-2">
        <legend className="mb-2 text-[14px] font-semibold text-foreground">{primary(dm.docStepKind, language)}</legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {documentKinds.map((option) => (
            <label key={option} className="cursor-pointer">
              <input
                type="radio"
                name="kind"
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
                className="peer sr-only"
              />
              <span className="flex min-h-12 items-center justify-center rounded-xl border border-border-strong bg-surface px-2 text-center text-[14px] font-medium text-foreground peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
                {primary(documentKindLabels[option], language)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <p className="text-[14px] font-semibold text-foreground" id="drive-doc-file-step">
          {primary(dm.docStepFile, language)}
        </p>
        <input
          ref={fileInput}
          id="drive-doc-file"
          type="file"
          accept={ACCEPTED}
          disabled={busy}
          aria-labelledby="drive-doc-file-step"
          onChange={(event) => choose(event.currentTarget.files?.[0] ?? null)}
          className="sr-only"
        />
        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-3">
            <FileIcon aria-hidden className="size-6 shrink-0 text-subtle-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-foreground">{file.name}</span>
              <span className="block text-[12px] text-subtle-foreground">{humanSize(file.size)}</span>
            </span>
            <label
              htmlFor="drive-doc-file"
              className="focus-ring shrink-0 cursor-pointer rounded-lg px-3 py-2 text-[14px] font-semibold text-accent hover:bg-surface"
            >
              {primary(dm.docChange, language)}
            </label>
          </div>
        ) : (
          <label
            htmlFor="drive-doc-file"
            className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border-strong bg-surface-2 px-4 py-5 text-center hover:bg-surface-3"
          >
            <Upload aria-hidden className="size-6 text-subtle-foreground" />
            <span className="text-[15px] font-semibold text-foreground">{primary(dm.docPickFile, language)}</span>
            <span className="text-[12px] text-subtle-foreground">{primary(m.documentsLimit, language)}</span>
          </label>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="drive-doc-note" className="block text-[14px] font-semibold text-foreground">
          {primary(dm.docNoteOptional, language)}
        </label>
        <Input
          id="drive-doc-note"
          name="note"
          maxLength={200}
          disabled={busy}
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
        />
      </div>

      {progress !== null && busy ? (
        <div role="status" aria-live="polite" className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-[12px] text-subtle-foreground">
            {retrying
              ? primary(dm.docRetrying, language)
              : progress === 0
                ? primary(dm.docChecking, language)
                : `${primary(dm.docSending, language)} ${progress}%`}
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <Button type="submit" fullWidth disabled={!ready} loading={busy} loadingText={primary(m.saving, language)}>
          {failed?.resumable ? primary(dm.docResume, language) : primary(dm.docSave, language)}
        </Button>
        <p className="text-center text-[12px] text-subtle-foreground">
          {ready || busy
            ? mode === "gdrive"
              ? primary(dm.docInDrive, language)
              : null
            : primary(dm.docNeedBoth, language)}
        </p>
      </div>
    </form>
  );
}
