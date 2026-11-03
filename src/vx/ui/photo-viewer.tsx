"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

/*
 * A full-screen photo viewer (review P04): tap the portrait, see it large,
 * zoom with pinch, wheel, double-tap or the buttons, drag when zoomed, and
 * close with Close, Escape or the phone's Back. Focus returns to whatever
 * opened it. Save downloads through the same authorised address the page
 * already used — never a public link, never more than this one photo.
 */

const W = {
  close: p("Close photo", "फ़ोटो बंद करें"),
  zoomIn: p("Zoom in", "बड़ा करें"),
  zoomOut: p("Zoom out", "छोटा करें"),
  reset: p("Fit to screen", "पूरी फ़ोटो दिखाएँ"),
  save: p("Save photo", "फ़ोटो सहेजें"),
  saving: p("Saving…", "सहेजी जा रही है…"),
  saved: p("Photo saved", "फ़ोटो सहेजी गई"),
  saveFailed: p("Could not save the photo. Try again.", "फ़ोटो सहेजी नहीं जा सकी। फिर प्रयास करें।"),
  loading: p("Loading photo…", "फ़ोटो लोड हो रही है…"),
  failed: p("The photo could not be loaded.", "फ़ोटो लोड नहीं हो सकी।"),
  retry: p("Try again", "फिर कोशिश करें"),
};

const MIN = 1;
const MAX = 5;
const STEP = 1.5;
const MARK = "__vxPhoto";
const noSubscribe = () => () => {};

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

/** Zoom keeping the point under the finger (or the centre) still. */
export function zoomAt(view: View, nextScale: number, at: { x: number; y: number } = { x: 0, y: 0 }): View {
  const scale = Math.min(MAX, Math.max(MIN, nextScale));
  if (scale === MIN) return FIT;
  const k = scale / view.scale;
  return { scale, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k };
}

/** A filename the phone will keep: the child's name, no path characters. */
export function photoFileName(name: string): string {
  const safe = name.normalize("NFKC").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${safe || "student"} photo.jpg`;
}

export function PhotoViewer({ open, onClose, src, alt, name, saveable = true }: {
  open: boolean;
  onClose: () => void;
  src: string;
  alt: string;
  /** The child's name, for the saved file. */
  name: string;
  saveable?: boolean;
}) {
  const { tx } = useVx();
  const layer = useSyncExternalStore(noSubscribe, () => document.getElementById("vx-layer"), () => null);
  const [view, setView] = useState<View>(FIT);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const labelId = useId();
  const box = useRef<HTMLDivElement>(null);
  const restore = useRef<Element | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  // The latest onClose, read by effects without re-running them (tests/vx-ui-effect-deps.test.ts).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Each opening starts fitted, loading afresh, with nothing saved yet.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setView(FIT);
      setState("loading");
      setSave("idle");
    }
  }

  // Back closes the viewer, as it closes a sheet; closing another way pops our entry.
  const pushed = useRef(false);
  useEffect(() => {
    if (!open) return undefined;
    restore.current = document.activeElement;
    const id = Date.now();
    window.history.pushState({ ...(window.history.state ?? {}), [MARK]: id }, "");
    pushed.current = true;
    const onPop = (e: PopStateEvent) => {
      if ((e.state as Record<string, unknown> | null)?.[MARK] === id) return;
      pushed.current = false;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focus = window.setTimeout(() => box.current?.querySelector<HTMLElement>("button[data-close]")?.focus(), 30);
    return () => {
      window.clearTimeout(focus);
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = overflow;
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      }
      if (restore.current instanceof HTMLElement) restore.current.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      else if (e.key === "+" || e.key === "=") setView((v) => zoomAt(v, v.scale * STEP));
      else if (e.key === "-") setView((v) => zoomAt(v, v.scale / STEP));
      else if (e.key === "0") setView(FIT);
      else if (e.key === "Tab" && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || !layer) return null;

  const centreOf = (clientX: number, clientY: number) => {
    const rect = box.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 } : { x: 0, y: 0 };
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    } else if (e.pointerType !== "mouse") {
      // Double tap: zoom in where tapped, or back to fit.
      const now = Date.now();
      if (now - lastTap.current < 300) setView((v) => (v.scale > 1 ? FIT : zoomAt(v, 2.5, centreOf(e.clientX, e.clientY))));
      lastTap.current = now;
    }
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(e.pointerId);
    if (!before) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = centreOf((a.x + b.x) / 2, (a.y + b.y) / 2);
      const start = pinch.current;
      setView((v) => zoomAt(v, start.scale * (distance / start.distance), mid));
    } else if (pointers.current.size === 1) {
      setView((v) => (v.scale > 1 ? { ...v, x: v.x + e.clientX - before.x, y: v.y + e.clientY - before.y } : v));
    }
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const download = async () => {
    setSave("saving");
    try {
      // Same address, same session cookie or short-lived signature: no new access is created.
      const response = await fetch(src, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("photo_unavailable");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = photoFileName(name);
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setSave("saved");
    } catch {
      setSave("failed");
    }
  };

  const control = { width: 44, height: 44, borderRadius: 22, border: 0, background: "rgba(255,255,255,.14)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" } as const;

  return createPortal(
    <div ref={box} role="dialog" aria-modal="true" aria-labelledby={labelId} className="vx-photo" style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(8,12,20,.94)", display: "flex", flexDirection: "column", color: "#fff" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "max(10px, env(safe-area-inset-top)) 12px 10px" }}>
        <button type="button" data-close className="tap" aria-label={tx(W.close)} onClick={onClose} style={control}><Ic n="x" size={22} /></button>
        <span id={labelId} className="clip" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{alt}</span>
        {saveable && state === "ready" ? (
          <button type="button" className="tap" onClick={download} disabled={save === "saving"} aria-busy={save === "saving" || undefined} style={{ ...control, width: "auto", padding: "0 16px", gap: 8, fontWeight: 600 }}>
            <Ic n={save === "saved" ? "check" : "download"} size={18} />
            {tx(save === "saving" ? W.saving : save === "saved" ? W.saved : W.save)}
          </button>
        ) : null}
      </div>
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={(e) => setView((v) => (v.scale > 1 ? FIT : zoomAt(v, 2.5, centreOf(e.clientX, e.clientY))))}
        onWheel={(e) => { const at = centreOf(e.clientX, e.clientY); setView((v) => zoomAt(v, v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), at)); }}
        style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", touchAction: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: view.scale > 1 ? "grab" : "zoom-in" }}
      >
        {state !== "failed" ? (
          // A private, short-lived address: never through the image optimiser's cache.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={attempt}
            src={src}
            alt={alt}
            draggable={false}
            onLoad={() => setState("ready")}
            onError={() => setState("failed")}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", userSelect: "none", transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "center", opacity: state === "ready" ? 1 : 0 }}
          />
        ) : null}
        {state === "loading" ? <span role="status" style={{ position: "absolute", display: "inline-flex", alignItems: "center", gap: 8 }}><Ic n="refresh" className="spin" />{tx(W.loading)}</span> : null}
        {state === "failed" ? (
          <span role="alert" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            {tx(W.failed)}
            <button type="button" className="tap" onClick={() => { setState("loading"); setAttempt((n) => n + 1); }} style={{ ...control, width: "auto", padding: "0 18px" }}>{tx(W.retry)}</button>
          </span>
        ) : null}
      </div>
      <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "10px 12px max(14px, env(safe-area-inset-bottom))" }}>
        <button type="button" className="tap" aria-label={tx(W.zoomOut)} disabled={view.scale <= MIN || state !== "ready"} onClick={() => setView((v) => zoomAt(v, v.scale / STEP))} style={control}><Ic n="minus" size={20} /></button>
        <button type="button" className="tap" aria-label={tx(W.reset)} disabled={view.scale === MIN || state !== "ready"} onClick={() => setView(FIT)} style={{ ...control, width: "auto", padding: "0 16px" }}>{tx(W.reset)}</button>
        <button type="button" className="tap" aria-label={tx(W.zoomIn)} disabled={view.scale >= MAX || state !== "ready"} onClick={() => setView((v) => zoomAt(v, v.scale * STEP))} style={control}><Ic n="plus" size={20} /></button>
      </div>
      {save === "failed" ? <p role="alert" style={{ position: "absolute", left: 16, right: 16, bottom: 84, margin: 0, textAlign: "center", fontSize: 14, background: "rgba(180,40,40,.85)", padding: "8px 12px", borderRadius: 12 }}>{tx(W.saveFailed)}</p> : null}
      <span className="sr" aria-live="polite">{save === "saved" ? tx(W.saved) : ""}</span>
    </div>,
    layer,
  );
}
