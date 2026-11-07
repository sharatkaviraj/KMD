"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { flat, type Language } from "@/platform/i18n/language";
import { cue } from "@/ui/feedback/cue";
import { Ic } from "@/vx/icons";
import type { PhotoProgress } from "./teacher-photo-copy";

const W = {
  refresh: { en: "Refresh roster now", hi: "सूची अभी अपडेट करें" },
  working: { en: "Refreshing…", hi: "अपडेट हो रही है…" },
  done: { en: "Roster is up to date with Fees.", hi: "सूची Fees के साथ अपडेट है।" },
  wait: { en: "Refreshed a few minutes ago. Try again in {n} min.", hi: "कुछ मिनट पहले अपडेट हुई। {n} मिनट बाद फिर कोशिश करें।" },
  busy: { en: "A refresh is already running. Check again in a minute.", hi: "अपडेट पहले से चल रहा है। एक मिनट बाद देखें।" },
  failed: { en: "Fees could not be reached. The nightly copy will try again.", hi: "Fees से जुड़ नहीं सके। रात की कॉपी फिर कोशिश करेगी।" },
  photosStopped: { en: "Photos could not be copied now.", hi: "अभी फ़ोटो कॉपी नहीं हो सके।" },
};

/**
 * Admin only, by hand, at most once in ten minutes: never a schedule (D-457).
 * After the roster, the same tap copies the Fees photos One does not hold yet,
 * so teachers see their children's faces (D-511). That runs in batches with a
 * bar and a count, whether or not the roster itself had changes.
 */
export function RefreshRosterButton({ language }: { language: Language }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoProgress | null>(null);
  const say = (pair: { en: string; hi: string }, values: Record<string, number> = {}) =>
    Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), flat(pair, language));

  const run = () => start(async () => {
    setNote(null);
    setPhotos(null);
    let roster: string;
    let reload = false;
    try {
      const response = await fetch("/api/fees-bridge/roster/refresh", { method: "POST", cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string; waitMinutes?: number; busy?: boolean };
      if (body.ok && body.busy) roster = say(W.busy);
      else if (body.ok) { roster = say(W.done); reload = true; }
      else if (body.code === "cooldown") roster = say(W.wait, { n: body.waitMinutes ?? 10 });
      else roster = say(W.failed);
    } catch {
      roster = say(W.failed);
    }
    setNote(roster);
    // The copy is fetched only now, so no other screen carries its code.
    const photoNote = await import("./teacher-photo-copy")
      .then(({ copyTeacherPhotos }) => copyTeacherPhotos(language, setPhotos))
      .catch(() => say(W.photosStopped));
    setNote([roster, photoNote].filter(Boolean).join(" "));
    cue("done");
    // Fresh roster on the page without a reload, so the result above stays to be read.
    if (reload) router.refresh();
  });
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <button type="button" className="tap vx-lnk" onClick={run} disabled={pending} aria-busy={pending || undefined}
        style={{ font: "inherit", fontWeight: 700, background: "none", border: 0, padding: "4px 0", cursor: pending ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: "var(--acc)" }}>
        <Ic n="refresh" size={14} className={pending ? "spin" : undefined} />
        {flat(pending ? W.working : W.refresh, language)}
      </button>
      {photos ? (
        <span role="status" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, width: "100%" }}>
          {photos.text}
          <span className="vx-roster-progress" aria-hidden="true"><i style={{ width: `${Math.round((photos.done / Math.max(1, photos.of)) * 100)}%` }} /></span>
        </span>
      ) : null}
      {note ? <span role="status" style={{ fontSize: 12 }}>{note}</span> : null}
    </span>
  );
}
