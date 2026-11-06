"use client";

import { useState, useTransition } from "react";

import { flat, type Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";

const W = {
  refresh: { en: "Refresh roster now", hi: "सूची अभी अपडेट करें" },
  working: { en: "Refreshing…", hi: "अपडेट हो रही है…" },
  done: { en: "Roster is up to date with Fees.", hi: "सूची Fees के साथ अपडेट है।" },
  wait: { en: "Refreshed a few minutes ago. Try again in {n} min.", hi: "कुछ मिनट पहले अपडेट हुई। {n} मिनट बाद फिर कोशिश करें।" },
  busy: { en: "A refresh is already running. Check again in a minute.", hi: "अपडेट पहले से चल रहा है। एक मिनट बाद देखें।" },
  failed: { en: "Fees could not be reached. The nightly copy will try again.", hi: "Fees से जुड़ नहीं सके। रात की कॉपी फिर कोशिश करेगी।" },
};

/** Admin only, by hand, at most once in ten minutes: never a schedule (D-457). */
export function RefreshRosterButton({ language }: { language: Language }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const run = () => start(async () => {
    setNote(null);
    try {
      const response = await fetch("/api/fees-bridge/roster/refresh", { method: "POST", cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string; waitMinutes?: number; busy?: boolean };
      if (body.ok && body.busy) setNote(flat(W.busy, language));
      else if (body.ok) { setNote(flat(W.done, language)); window.location.reload(); }
      else if (body.code === "cooldown") setNote(flat(W.wait, language).replaceAll("{n}", String(body.waitMinutes ?? 10)));
      else setNote(flat(W.failed, language));
    } catch {
      setNote(flat(W.failed, language));
    }
  });
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <button type="button" className="tap vx-lnk" onClick={run} disabled={pending} aria-busy={pending || undefined}
        style={{ font: "inherit", fontWeight: 700, background: "none", border: 0, padding: "4px 0", cursor: pending ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: "var(--acc)" }}>
        <Ic n="refresh" size={14} className={pending ? "spin" : undefined} />
        {flat(pending ? W.working : W.refresh, language)}
      </button>
      {note ? <span role="status" style={{ fontSize: 12 }}>{note}</span> : null}
    </span>
  );
}
