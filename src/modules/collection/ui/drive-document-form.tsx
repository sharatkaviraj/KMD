"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { m } from "@/messages";
import { documentMessages as dm } from "@/messages/setup";
import { documentKindLabels, documentKinds, type DocumentKind } from "@/modules/collection/domain/review";
import { primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Input, Notice, Select } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

import { uploadToDrive, type UploadOutcome } from "./chunked-upload";

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

/**
 * Upload one document about one child into the school's Shared Drive (D-333).
 *
 * The same fields as the bucket form, sent differently: in chunks through
 * VPPS One, with a progress line, and a Retry that carries on from where it
 * stopped. The upload's id is minted when a file is chosen and kept until it
 * is saved or the file changes, so a second tap of Save — or a retry after
 * the phone lost signal — is the same document, never a copy.
 */
export function DriveDocumentForm({ studentId }: { studentId: string }) {
  const language = useLanguage();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const uploadId = useRef<string | null>(null);
  // A ref, not state: two taps inside one render both read busy=false.
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [result, setResult] = useState<UploadOutcome | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return;

    inFlight.current = true;
    uploadId.current ??= crypto.randomUUID();
    setBusy(true);
    setResult(null);
    setProgress(0);

    let outcome: UploadOutcome;
    try {
      outcome = await uploadToDrive(
        {
          documentId: uploadId.current,
          studentId,
          kind: (data.get("kind") ?? "other").toString() as DocumentKind,
          note: (data.get("note") ?? "").toString(),
          file,
        },
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
    setResult(outcome);
    if (outcome.ok || !outcome.resumable) uploadId.current = null;
    if (outcome.ok) {
      form.current?.reset();
      setProgress(null);
      router.refresh();
    }
  }

  return (
    <form ref={form} onSubmit={submit} className="space-y-3">
      {result && !result.ok ? (
        <Notice tone="danger" text={FAILURE_TEXT[result.reason]} language={language} />
      ) : null}
      {result?.ok ? <Notice tone="success" text={dm.docSaved} language={language} /> : null}

      <Field label={m.documentsKind} htmlFor="drive-doc-kind" language={language}>
        <Select id="drive-doc-kind" name="kind" defaultValue="other" disabled={busy}>
          {documentKinds.map((kind) => (
            <option key={kind} value={kind}>
              {primary(documentKindLabels[kind], language)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={m.documentsFile} htmlFor="drive-doc-file" language={language}>
        <input
          id="drive-doc-file"
          name="file"
          type="file"
          required
          disabled={busy}
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={() => {
            uploadId.current = null;
            setResult(null);
            setProgress(null);
          }}
          className="focus-ring w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-[13px] file:font-semibold"
        />
      </Field>

      <Field label={m.documentsNote} htmlFor="drive-doc-note" language={language}>
        <Input id="drive-doc-note" name="note" maxLength={200} disabled={busy} />
      </Field>

      <p className="text-[12px] text-subtle-foreground">
        {primary(m.documentsLimit, language)} {primary(dm.docInDrive, language)}
      </p>

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

      <Button type="submit" variant="outline" fullWidth loading={busy} loadingText={primary(m.saving, language)}>
        {result && !result.ok && result.resumable ? primary(dm.docResume, language) : primary(m.documentsAdd, language)}
      </Button>
    </form>
  );
}
