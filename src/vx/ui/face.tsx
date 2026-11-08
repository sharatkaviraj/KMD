"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import type { Language } from "@/platform/i18n/language";

import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { useStudentPhoto } from "./student-photos";

const SEE = p("See {name}'s photo", "{name} की फ़ोटो देखें");

/** Fetched on the first press of any face, then kept: the zoom is not on any page until it is wanted. */
const loadZoom = () => import("./face-zoom");

function zoomFace(from: HTMLElement, src: string, name: string, language: Language, sub?: string | null, saveable?: boolean) {
  void loadZoom().then(({ openFaceZoom }) => openFaceZoom({ from, thumb: src, name, sub, saveable, language }));
}

function warmFace(src: string) {
  void loadZoom().then(({ warmFaceZoom }) => warmFaceZoom(src));
}

/**
 * Open a child's photo large, growing out of `from` (`face-zoom.tsx`), and
 * start it early on the press (`warm`). For a screen that draws its own face.
 * The zoom's words and the large photo's address live in the zoom's own
 * chunk, so a list of faces carries none of it (the attendance page's budget).
 */
export function useFaceZoom() {
  const { language } = useVx();
  return {
    open: (from: HTMLElement, src: string, name: string, more: { sub?: string | null; saveable?: boolean } = {}) => zoomFace(from, src, name, language, more.sub, more.saveable),
    warm: warmFace,
  };
}

/**
 * A round face: the child's photo when there is one, over whatever the caller
 * draws otherwise (initials, a roll number, an icon). The circle's size,
 * colour and shape stay the caller's own class and style, so every screen
 * keeps its look.
 *
 * The initials show until the photo has loaded, and the photo fades in over
 * them. A photo that fails (a link that expired, a phone that went offline, a
 * photo since removed) leaves the initials, never a broken picture (smoke
 * 7 Nov 2026).
 *
 * With `zoom` (the child's name), a face whose photo has loaded opens it on a
 * tap, growing out of the circle (`face-zoom.tsx`, owner 8 Nov 2026). The tap
 * is the face's own: it never also opens the row, link or button around it.
 * A face with no photo stays part of its row; an empty circle is not worth a tap.
 *
 * `student` lets the face find the child's photo itself when the screen did
 * not load it (`student-photos.ts`); a `photo` the screen passes wins, and
 * `photo={null}` means "no photo" without asking.
 */
export function Face({ photo, student, className, style, children, zoom, zoomSub, saveable }: {
  photo?: string | null;
  student?: string | null;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** The child's name: makes a loaded photo open large on a tap. */
  zoom?: string | null;
  /** A second line in the open photo (the class). */
  zoomSub?: string | null;
  /** Offer "Save photo" in the open photo. */
  saveable?: boolean;
}) {
  const { tx, language } = useVx();
  const src = useStudentPhoto(student, photo);
  // The photo that loaded, or failed: the initials stay under anything else.
  const [seen, setSeen] = useState<[string, boolean] | null>(null);
  const face = useRef<HTMLSpanElement>(null);
  const show = src && !(seen?.[0] === src && !seen[1]) ? src : null;
  const loaded = show !== null && seen?.[0] === show;
  const settle = (ok: boolean) => {
    if (show && !(seen?.[0] === show && seen[1] === ok)) setSeen([show, ok]);
  };
  const opens = Boolean(zoom && loaded);
  const open = (event: MouseEvent | KeyboardEvent) => {
    if (!opens || !face.current) return;
    event.preventDefault();
    event.stopPropagation();
    zoomFace(face.current, show!, zoom!, language, zoomSub, saveable);
  };
  const img = show ? (
    // eslint-disable-next-line @next/next/no-img-element -- private photo link, no shared optimizer cache.
    <img
      // A photo that finished before the page woke up fires no event: read it once.
      ref={(el) => { if (el?.complete && el.currentSrc) settle(el.naturalWidth > 0); }}
      src={show} alt="" loading="lazy" decoding="async" draggable={false} data-on={loaded ? "" : undefined} onLoad={() => settle(true)} onError={() => settle(false)}
    />
  ) : null;
  // A span, not a button: faces sit inside links and buttons, and a button
  // inside a button is cut in two by the HTML parser.
  return (
    <span
      ref={face}
      className={`${className ? `${className} ` : ""}vx-face${opens ? " vx-face-open" : ""}`}
      style={style}
      {...(opens
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": tx(SEE).replace("{name}", zoom!),
            // The press starts the sharper photo and the zoom's code, before the finger lifts.
            onPointerDown: () => warmFace(show!),
            onClick: open,
            onKeyDown: (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") open(event); },
          }
        : { "aria-hidden": true })}
    >
      {children}
      {img}
    </span>
  );
}
