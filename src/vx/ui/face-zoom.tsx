"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot, type Root } from "react-dom/client";

import { fullPhotoHref } from "@/modules/collection/domain/photo-href";
import type { Language } from "@/platform/i18n/language";
import { cue } from "@/ui/feedback/cue";
import { lead, p } from "@/vx/text";

/*
 * Tap a child's face and the photo grows out of the circle, the way a profile
 * photo opens in WhatsApp (owner, 8 Nov 2026). It is fast because nothing new
 * is fetched to start: the small photo the list already shows is drawn at
 * once, and the sharper one fades in over it when it arrives. Close, a tap
 * outside, a swipe down, Escape or the phone's Back shrinks it back into the
 * circle it came from.
 *
 * Loaded only when somebody first presses a face (`face.tsx`), so no screen
 * carries it until then. It is its own little React root, not a portal: the
 * face that opened it may scroll away or re-render without closing it.
 */

const W = {
  close: p("Close", "बंद करें"),
  save: p("Save photo", "फ़ोटो सहेजें"),
  saved: p("Photo saved", "फ़ोटो सहेजी गई"),
  saveFailed: p("Could not save the photo. Try again.", "फ़ोटो सहेजी नहीं जा सकी। फिर प्रयास करें।"),
};

export type FaceZoomOptions = {
  /** The face that was tapped: the photo grows from here and shrinks back to it. */
  from: HTMLElement;
  /** The photo already on screen; the sharper one (`fullPhotoHref`) fades in over it. */
  thumb: string;
  name: string;
  sub?: string | null;
  /** The reader's language, for Close and Save. */
  language: Language;
  /** Offer "Save photo" (the child's profile). */
  saveable?: boolean;
};

const MARK = "__vxFaceZoom";
const OPEN_MS = 260;
const CLOSE_MS = 210;
const EASE = "cubic-bezier(.2,.8,.2,1)";

let current: { root: Root; host: HTMLElement; close: () => void } | null = null;

export function openFaceZoom(options: FaceZoomOptions) {
  if (current) current.close();
  const host = document.createElement("div");
  host.className = "vxt";
  document.body.append(host);
  const root = createRoot(host);
  const entry = {
    root,
    host,
    close: () => {
      if (current === entry) current = null;
      // Unmount after this task: React must not unmount a root during its own render.
      window.setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    },
  };
  current = entry;
  root.render(<FaceZoom {...options} onGone={entry.close} />);
}

/** Start the sharper photo early, on the press itself. */
export function warmFaceZoom(thumb: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = fullPhotoHref(thumb);
}

type Box = { left: number; top: number; width: number; height: number };

/** Room under the open photo for the child's name and class. */
const CAPTION = 64;

/** Where the photo sits open: as big as fits, centred with its caption, never stretched. */
function openBox(aspect: number): Box {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let width = Math.min(vw - 24, 560);
  let height = width * aspect;
  const room = vh - 72 - CAPTION - 12;
  if (height > room) {
    height = room;
    width = height / aspect;
  }
  return { left: (vw - width) / 2, top: Math.max(72, (vh - height - CAPTION) / 2), width, height };
}

/**
 * The transform and clip that make the open photo sit exactly over the round
 * face: the face shows the photo's centre square, cropped to a circle.
 */
function overFace(face: DOMRect, box: Box): { transform: string; clipPath: string } {
  const side = Math.min(box.width, box.height);
  const insetX = (box.width - side) / 2;
  const insetY = (box.height - side) / 2;
  const scale = Math.min(face.width, face.height) / side;
  const tx = face.left - box.left - insetX * scale;
  const ty = face.top - box.top - insetY * scale;
  return { transform: `translate(${tx}px, ${ty}px) scale(${scale})`, clipPath: `inset(${insetY}px ${insetX}px round ${side / 2}px)` };
}

const OPEN_CLIP = "inset(0px 0px round 14px)";

function onScreen(rect: DOMRect) {
  return rect.width > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function photoFileName(name: string) {
  const safe = name.normalize("NFKC").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${safe || "student"} photo.jpg`;
}

/** An animation, where the browser has them; none is fine, the photo just appears. */
function play(el: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  return el && typeof el.animate === "function" ? el.animate(frames, options) : null;
}

/** The face hides while its photo is open, so the photo looks lifted out of the list. */
function lift(face: HTMLElement, hidden: boolean) {
  face.style.visibility = hidden ? "hidden" : "";
}

function aspectOf(face: HTMLElement) {
  const image = face instanceof HTMLImageElement ? face : face.querySelector("img");
  return image && image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : 4 / 3;
}

function FaceZoom({ from, thumb, name, sub, language, saveable, onGone }: FaceZoomOptions & { onGone: () => void }) {
  const full = fullPhotoHref(thumb);
  const say = (pair: { en: string; hi?: string }) => lead(pair, language);
  const photo = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const chrome = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [sharp, setSharp] = useState(false);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [box] = useState<Box>(() => openBox(aspectOf(from)));
  const closing = useRef(false);
  const gone = useRef(false);
  const still = useRef(false);
  const drag = useRef<{ id: number; y: number; dy: number } | null>(null);
  const pushed = useRef(false);

  const finish = () => {
    if (gone.current) return;
    gone.current = true;
    lift(from, false);
    onGone();
  };

  // Close: shrink back into the face, or fade if the face has gone off screen.
  const close = (fromTransform?: string) => {
    if (closing.current) return;
    closing.current = true;
    const el = photo.current;
    const shade = back.current;
    const quick = still.current;
    const face = from.isConnected ? from.getBoundingClientRect() : null;
    const start = { transform: fromTransform ?? "translate(0px, 0px) scale(1)", clipPath: OPEN_CLIP };
    for (const part of [chrome.current, caption.current]) play(part, [{ opacity: 1 }, { opacity: 0 }], { duration: quick ? 1 : 120, fill: "forwards" });
    play(shade, [{ opacity: shade?.style.opacity || 1 }, { opacity: 0 }], { duration: quick ? 1 : CLOSE_MS, fill: "forwards", easing: "ease-out" });
    const end = face && onScreen(face) && !quick ? overFace(face, box) : null;
    const run = end
      ? play(el, [start, end], { duration: CLOSE_MS, easing: EASE, fill: "forwards" })
      : play(el, [{ ...start, opacity: 1 }, { ...start, transform: `${start.transform} scale(0.92)`, opacity: 0 }], { duration: quick ? 1 : 160, easing: "ease-in", fill: "forwards" });
    if (!run) return finish();
    run.onfinish = finish;
    // An animation that never ends (a hidden tab) still closes.
    window.setTimeout(finish, CLOSE_MS + 400);
  };
  // The latest close, for the listeners below (tests/vx-ui-effect-deps.test.ts).
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useLayoutEffect(() => {
    still.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const el = photo.current;
    if (!el) return;
    const face = from.getBoundingClientRect();
    lift(from, true);
    if (still.current || !onScreen(face)) {
      play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
    } else {
      play(el, [overFace(face, box), { transform: "translate(0px, 0px) scale(1)", clipPath: OPEN_CLIP }], { duration: OPEN_MS, easing: EASE });
    }
    play(back.current, [{ opacity: 0 }, { opacity: 1 }], { duration: still.current ? 120 : 220, easing: "ease-out" });
    for (const part of [chrome.current, caption.current]) play(part, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: still.current ? 0 : 140, easing: "ease-out", fill: "backwards" });
    cue("tap");
  }, [from, box]);

  // Back closes it, as it closes a sheet; closing another way pops our entry.
  useEffect(() => {
    const id = Date.now();
    window.history.pushState({ ...(window.history.state ?? {}), [MARK]: id }, "");
    pushed.current = true;
    const onPop = (event: PopStateEvent) => {
      if ((event.state as Record<string, unknown> | null)?.[MARK] === id) return;
      pushed.current = false;
      closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      else if (event.key === "Tab") {
        const items = [...(chrome.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
        if (items.length < 2) { event.preventDefault(); items[0]?.focus(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const restore = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("popstate", onPop);
    document.addEventListener("keydown", onKey);
    const focus = window.setTimeout(() => closeButton.current?.focus({ preventScroll: true }), 40);
    return () => {
      window.clearTimeout(focus);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      }
      const target = from.closest<HTMLElement>("[tabindex],button,a") ?? (restore instanceof HTMLElement ? restore : null);
      target?.focus({ preventScroll: true });
    };
  }, [from]);

  // Swipe down to close, as in WhatsApp; a short pull springs back.
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (closing.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { id: event.pointerId, y: event.clientY, dy: 0 };
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    d.dy = event.clientY - d.y;
    const el = photo.current;
    if (el) el.style.transform = `translate(0px, ${d.dy}px) scale(${1 - Math.min(Math.abs(d.dy), 300) / 1500})`;
    if (back.current) back.current.style.opacity = String(Math.max(0.25, 1 - Math.abs(d.dy) / 420));
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    const el = photo.current;
    if (Math.abs(d.dy) > 90) {
      const at = el?.style.transform || undefined;
      if (el) el.style.transform = "";
      close(at);
      return;
    }
    if (el && d.dy !== 0) {
      const at = el.style.transform;
      el.style.transform = "";
      play(el, [{ transform: at }, { transform: "translate(0px, 0px) scale(1)" }], { duration: 180, easing: EASE });
    }
    if (back.current) back.current.style.opacity = "";
  };

  const download = async () => {
    setSave("saving");
    try {
      const response = await fetch(full, { credentials: "same-origin" });
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
      cue("success");
    } catch {
      setSave("failed");
    }
  };

  const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", userSelect: "none", pointerEvents: "none" };
  const control: CSSProperties = { minHeight: 48, borderRadius: 24, border: 0, background: "rgba(255,255,255,.16)", color: "#fff", display: "inline-flex", alignItems: "center", gap: 8, padding: "0 18px", font: "inherit", fontSize: 16, fontWeight: 700, cursor: "pointer" };

  return (
    <div role="dialog" aria-modal="true" aria-label={name} className="vx-face-zoom" style={{ position: "fixed", inset: 0, zIndex: 90 }}>
      <div ref={back} onClick={() => close()} style={{ position: "absolute", inset: 0, background: "rgba(8,12,20,.93)" }} />
      <div ref={chrome} style={{ position: "absolute", left: 0, right: 0, top: 0, display: "flex", alignItems: "center", gap: 12, padding: "max(12px, env(safe-area-inset-top)) 14px 12px", color: "#fff" }}>
        <button ref={closeButton} type="button" className="tap" onClick={() => close()} style={control}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          {say(W.close)}
        </button>
        <span style={{ flex: 1 }} />
        {saveable ? (
          <button type="button" className="tap" onClick={download} disabled={save === "saving"} aria-busy={save === "saving" || undefined} style={control}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{save === "saved" ? <path d="M5 12l5 5 9-10" /> : <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14" />}</svg>
            {save === "saved" ? say(W.saved) : say(W.save)}
          </button>
        ) : null}
      </div>
      <div
        ref={photo}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, transformOrigin: "0 0", clipPath: OPEN_CLIP, overflow: "hidden", background: "#1b2230", touchAction: "none", willChange: "transform", cursor: "grab" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- private photo link, never the shared image optimiser */}
        <img src={thumb} alt="" draggable={false} style={fill} />
        {/* eslint-disable-next-line @next/next/no-img-element -- private photo link, never the shared image optimiser */}
        <img src={full} alt={name} draggable={false} onLoad={() => setSharp(true)} style={{ ...fill, opacity: sharp ? 1 : 0, transition: "opacity .18s ease-out" }} />
      </div>
      {/* The name under the photo, as large as the phone allows: the top bar keeps its two big buttons. */}
      <div ref={caption} style={{ position: "absolute", left: 16, right: 16, top: box.top + box.height + 10, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", color: "#fff", pointerEvents: "none" }}>
        <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.25, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {sub ? <span style={{ fontSize: 14, opacity: 0.78, marginTop: 2 }}>{sub}</span> : null}
      </div>
      {save === "failed" ? (
        <p role="alert" style={{ position: "absolute", left: 16, right: 16, bottom: "max(16px, env(safe-area-inset-bottom))", margin: 0, textAlign: "center", fontSize: 15, color: "#fff", background: "rgba(180,40,40,.9)", padding: "10px 14px", borderRadius: 12 }}>{say(W.saveFailed)}</p>
      ) : null}
    </div>
  );
}
