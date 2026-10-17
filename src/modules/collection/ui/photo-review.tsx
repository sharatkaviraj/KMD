"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewPhotoAction } from "@/app/(app)/collection/photos/profile-actions";
import { photoMessages as words } from "@/messages/setup";
import { primary, type Language } from "@/platform/i18n/language";
import { PhotoImage } from "./profile-photo-editor";
export function PhotoReview({ proposalId, name, url, currentUrl, language }: { proposalId: string; name: string; url: string; currentUrl: string | null; language: Language }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const router = useRouter();
  const decide = async (accept: boolean) => {
    setBusy(true);
    try { const result = await reviewPhotoAction(proposalId, accept); if (result.ok) router.refresh(); else setMessage(primary(result.reason === "unknown" ? words.unknown : words.refused, language)); }
    catch { setMessage(primary(words.unknown, language)); }
    finally { setBusy(false); }
  };
  return <article className="space-y-3 rounded-xl border border-border bg-surface p-4"><p className="font-semibold">{name}</p><div className="flex flex-wrap gap-3">{currentUrl ? <PhotoImage src={currentUrl} alt={primary(words.title, language)} /> : null}<div><p className="text-sm">{primary(words.pending, language)}</p><PhotoImage src={url} alt={primary(words.pending, language)} /></div></div><div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-lg bg-accent px-3 text-white" disabled={busy} onClick={() => void decide(true)}>{primary(words.approve, language)}</button><button type="button" className="min-h-11 rounded-lg border px-3" disabled={busy} onClick={() => void decide(false)}>{primary(words.reject, language)}</button></div>{message ? <p role="status">{message}</p> : null}</article>;
}
