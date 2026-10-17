"use client";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { openPhotoEditorAction, saveProfilePhotoAction } from "@/app/(app)/collection/photos/profile-actions";
import { photoMessages as words } from "@/messages/setup";
import { primary, type Language } from "@/platform/i18n/language";
import { Sheet } from "@/vx/ui/overlays";
import { lead } from "@/vx/text";
import { Btn } from "@/vx/ui/primitives";
import { loadDraft, saveDraft, removeDraft } from "@/platform/drafts/store";
import { readDraft } from "@/platform/drafts/policy";
import { PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, PHOTO_TYPES } from "../domain/photo-placement";
import type { PhotoCredential, PhotoEditorContext, PhotoSaveResult } from "../domain/profile-photo";

/** School Fees 600px/0.78 JPEG algorithm, with an enforced 200KiB cap. */
export async function compressPhoto(file: File): Promise<string> {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error("wrong_type");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) { bitmap.close(); throw new Error("wrong_type"); }
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  for (const quality of [0.78, 0.68, 0.58, 0.48, 0.4]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("wrong_type");
    if (blob.size <= PHOTO_MAX_BYTES) return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
    });
  }
  throw new Error("too_large");
}

type PhotoDraft = { data: string; source: "camera" | "file"; commandId: string | null; expectedCurrent: string | null; expectedProposal: string | null };
function isPhotoDraft(raw: unknown): raw is PhotoDraft {
  if (!raw || typeof raw !== "object") return false;
  const d = raw as PhotoDraft;
  return typeof d.data === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(d.data) && d.data.length <= 280000
    && (d.source === "file" || d.source === "camera") && (d.commandId === null || /^[a-f0-9-]{36}$/i.test(d.commandId))
    && (d.expectedCurrent === null || /^[a-f0-9-]{36}$/i.test(d.expectedCurrent)) && (d.expectedProposal === null || /^[a-f0-9-]{36}$/i.test(d.expectedProposal));
}
export function photoFile(data: string) { const binary = atob(data.split(",")[1]); return new File([Uint8Array.from(binary, c => c.charCodeAt(0))], "portrait.jpg", { type: "image/jpeg" }); }
function failureText(reason: string) { return reason === "unknown" ? words.unknown : reason === "too_large" ? words.tooLarge : reason === "wrong_type" ? words.invalid : reason === "storage" ? words.storage : words.refused; }

/** Inside a vx screen a "both" reader sees English first, as the screen around it does; elsewhere Hindi leads. */
function sayer(language: Language, vx: boolean) {
  return (pair: { hi: string; en: string }) => (vx ? lead(pair, language) : primary(pair, language));
}

export function PhotoEditor({ context, language, save, onClose, vx = false }: { context: PhotoEditorContext; language: Language; save: (form: FormData) => Promise<PhotoSaveResult>; onClose: () => void; vx?: boolean }) {
  const say = sayer(language, vx);
  const key =`vpps:photo:${context.scope}:${context.studentId ?? "self"}`;
  const [draft, setDraft] = useState<PhotoDraft | null>(null);
  const [recovered, setRecovered] = useState<PhotoDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    loadDraft(key).then(raw => { if (!cancelled) { setRecovered(readDraft(raw, isPhotoDraft)?.value ?? null); setReady(true); } }).catch(() => { if (!cancelled) setReason("storage"); });
    return () => { cancelled = true; };
  }, [key]);
  const persist = (value: PhotoDraft) => saveDraft(key, { version: 1, baseline: "photo", value, updatedAt: Date.now() });
  const choose = async (file: File | undefined, source: "camera" | "file") => {
    if (!file || busy || !ready || recovered || draft?.commandId) return;
    setBusy(true); setReason("");
    try {
      const next: PhotoDraft = { data: await compressPhoto(file), source, commandId: null, expectedCurrent: context.currentId, expectedProposal: context.proposalId };
      setDraft(next); try { await persist(next); } catch { setReason("storage"); }
    } catch (e) { setReason(e instanceof Error && e.message === "too_large" ? "too_large" : "wrong_type"); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!draft || sending.current || !ready || recovered || (context.decided && !draft.commandId)) return;
    sending.current = true; setBusy(true); setReason("");
    const command = { ...draft, commandId: draft.commandId ?? crypto.randomUUID() };
    setDraft(command);
    try { await persist(command); } catch { setDraft(draft); setReason("storage"); setBusy(false); sending.current = false; return; }
    const form = new FormData(); form.set("photo", photoFile(command.data)); form.set("commandId", command.commandId);
    form.set("scope", context.scope); form.set("studentId", context.studentId ?? ""); form.set("source", command.source);
    form.set("expectedCurrent", command.expectedCurrent ?? ""); form.set("expectedProposal", command.expectedProposal ?? "");
    let result: PhotoSaveResult;
    try { result = await save(form); if (!result || typeof result.ok !== "boolean") result = { ok: false, reason: "unknown" }; }
    catch { result = { ok: false, reason: "unknown" }; }
    if (result.ok) {
      try { await removeDraft(key); onClose(); } catch { setReason("storage"); }
    } else {
      setReason(result.reason);
      if (result.reason !== "unknown") { const editable = { ...command, commandId: null }; setDraft(editable); try { await persist(editable); } catch { setReason("storage"); } }
    }
    setBusy(false); sending.current = false;
  };
  const cancel = async () => { if (busy || draft?.commandId || recovered?.commandId) return; try { await removeDraft(key); setDraft(null); onClose(); } catch { setReason("storage"); } };
  const locked = busy || !ready || Boolean(recovered) || Boolean(draft?.commandId) || context.decided;
  return <section className={vx ? "space-y-3" : "space-y-3 rounded-2xl border border-border bg-surface p-3"} aria-label={say(words.title)} data-photo-editor>
    {context.proposal ? <p className="text-sm text-muted-foreground">{say(words.proposal)}</p> : null}
    {context.decided ? <p role="status">{say(words.decided)}</p> : null}
    {context.proposalUrl ? <div><p className="text-sm">{say(words.pending)}</p><PhotoImage src={context.proposalUrl} alt={say(words.pending)} /></div> : null}
    {recovered ? <button type="button" className="min-h-11 text-accent" onClick={() => { setDraft(recovered); setReason(recovered.commandId ? "unknown" : ""); setRecovered(null); }}>{say(words.restore)}</button> : null}
    {draft ? <div data-photo-preview><p className="text-sm">{say(words.preview)}</p><PhotoImage src={draft.data} alt={say(words.preview)} /></div> : context.currentUrl ? <PhotoImage src={context.currentUrl} alt={say(words.title)} /> : null}
    <div className="rounded-xl border border-dashed border-border p-3" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!locked) void choose(e.dataTransfer.files[0], "file"); }}>
      <input ref={input} aria-label={say(words.choose)} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={locked} onChange={e => { void choose(e.target.files?.[0], "file"); e.target.value = ""; }} />
      <input ref={camera} aria-label={say(words.camera)} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" disabled={locked} onChange={e => { void choose(e.target.files?.[0], "camera"); e.target.value = ""; }} />
      <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-lg border px-3" disabled={locked} onClick={() => input.current?.click()}>{say(words.choose)}</button><button type="button" className="min-h-11 rounded-lg border px-3" disabled={locked} onClick={() => camera.current?.click()}>{say(words.camera)}</button></div>
    </div>
    {reason ? <p role="status" className="text-sm text-destructive">{say(failureText(reason))}</p> : null}
    <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-xl bg-accent px-4 text-white disabled:opacity-50" disabled={busy || !draft || !ready || Boolean(recovered) || (context.decided && !draft.commandId)} onClick={() => void send()}>{say(draft?.commandId ? words.retry : words.save)}</button><button type="button" className="min-h-11 rounded-xl border px-4 disabled:opacity-50" disabled={busy || Boolean(draft?.commandId) || Boolean(recovered?.commandId)} onClick={() => void cancel()}>{say(words.cancel)}</button></div>
  </section>;
}

export function PhotoImage({ src, alt }: { src: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- private signed/local previews must not enter an image cache.
  return <img src={src} alt={alt} className="h-40 w-32 rounded-xl object-cover" />;
}

type ControlProps = {
  credential: PhotoCredential; studentId?: string; language: Language;
  /** Signed-in screens: the editor opens in a sheet over the page instead of pushing it down. */
  sheet?: boolean;
  /** `null`: no link of its own; the caller opens it through `ref` (a ring badge, a menu row). */
  trigger?: null;
  ref?: Ref<PhotoControlHandle>;
};
export type PhotoControlHandle = { open: () => void };
export function ProfilePhotoControl(props: ControlProps) {
  const { credential, studentId } = props;
  const identity = JSON.stringify([credential.kind, "id" in credential ? credential.id : null, "token" in credential ? credential.token : null, studentId]);
  return <ScopedPhotoControl key={identity} {...props} />;
}

function ScopedPhotoControl({ credential, studentId, language, sheet = false, trigger, ref }: ControlProps) {
  const router = useRouter();
  const say = sayer(language, sheet);
  const [opened, setOpened] = useState<{ credential: PhotoCredential; context: PhotoEditorContext } | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);
  const open = async () => {
    const current = ++request.current;
    setBusy(true); setFailed(false); setShown(true);
    try {
      const result = await openPhotoEditorAction(credential, studentId);
      if (request.current !== current) return;
      if (result.ok) setOpened(result); else setFailed(true);
    } catch { if (request.current === current) setFailed(true); }
    finally { if (request.current === current) setBusy(false); }
  };
  useImperativeHandle(ref, () => ({ open: () => void open() }));
  // Closing keeps an unsent draft on the device; the editor offers it back next time.
  const close = () => { request.current += 1; setShown(false); setOpened(null); setBusy(false); router.refresh(); };
  const editor = opened ? <PhotoEditor key={opened.context.scope} context={opened.context} language={language} save={form => saveProfilePhotoAction(opened.credential, form)} onClose={close} vx={sheet} /> : null;
  const refused = failed ? <p role="status" className="text-sm text-destructive">{say(words.refused)}</p> : null;
  if (sheet) return <>
    {trigger === null ? null : <Btn variant="ghost" icon="camera" disabled={busy} onClick={() => void open()}>{say(words.edit)}</Btn>}
    <Sheet open={shown} onClose={close} title={say(words.title)} icon="camera">
      {editor ?? refused ?? <p aria-live="polite" style={{ margin: 0, color: "var(--mut)" }}>…</p>}
    </Sheet>
  </>;
  return <div data-row-stop>
    {editor ?? <button type="button" className="min-h-11 rounded-lg px-2 text-sm font-medium text-accent" disabled={busy} onClick={() => void open()}>{say(words.edit)}</button>}
    {refused}
  </div>;
}
