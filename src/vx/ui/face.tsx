"use client";

import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { useStudentPhoto } from "./student-photos";

const SEE = p("See {name}'s photo", "{name} की फ़ोटो देखें");

/** Fetched on the first press of any face, then kept: the zoom is not on any page until it is wanted. */
const loadZoom = () => import("./face-zoom");

/**
 * Open a child's photo large, growing out of `from` (`face-zoom.tsx`), and
 * start it early on the press (`warm`). For a screen that draws its own face.
 * The zoom's words and the large photo's address live in the zoom's own
 * chunk, so a list of faces carries none of it (the attendance page's budget).
 */
export function useFaceZoom() {
  const { language } = useVx();
  return {
    open: (from: HTMLElement, src: string, name: string, more: { sub?: string | null; saveable?: boolean } = {}) => {
      void loadZoom().then(({ openFaceZoom }) => openFaceZoom({ from, thumb: src, name, sub: more.sub ?? null, saveable: more.saveable, language }));
    },
    warm: (src: string) => {
      void loadZoom().then(({ warmFaceZoom }) => warmFaceZoom(src));
    },
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
  const { tx } = useVx();
  const src = useStudentPhoto(student, photo);
  const [seen, setSeen] = useState<{ src: string; ok: boolean } | null>(null);
  const face = useRef<HTMLSpanElement>(null);
  const failed = seen !== null && seen.src === src && !seen.ok;
  const loaded = seen !== null && seen.src === src && seen.ok;
  const show = src && !failed ? src : null;
  const settle = useCallback((ok: boolean) => {
    if (show) setSeen((prev) => (prev && prev.src === show && prev.ok === ok ? prev : { src: show, ok }));
  }, [show]);
  // A photo that finished before the page woke up fires no event: read it once.
  const check = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.currentSrc) settle(img.naturalWidth > 0);
  }, [settle]);

  const zoomer = useFaceZoom();
  const opens = Boolean(zoom && show && loaded);
  const open = (event: MouseEvent | KeyboardEvent) => {
    if (!opens || !show || !face.current) return;
    event.preventDefault();
    event.stopPropagation();
    zoomer.open(face.current, show, zoom ?? "", { sub: zoomSub, saveable });
  };
  // The press starts the sharper photo and the zoom's code, before the finger lifts.
  const warm = () => {
    if (opens && show) zoomer.warm(show);
  };

  const classes = className ? `${className} vx-face` : "vx-face";
  const img = show ? (
    // eslint-disable-next-line @next/next/no-img-element -- private photo link, no shared optimizer cache.
    <img ref={check} src={show} alt="" loading="lazy" decoding="async" draggable={false} data-on={loaded ? "" : undefined} onLoad={() => settle(true)} onError={() => settle(false)} />
  ) : null;
  if (!opens) {
    return <span ref={face} className={classes} style={style} aria-hidden="true">{children}{img}</span>;
  }
  // A span, not a button: faces sit inside links and buttons, and a button
  // inside a button is cut in two by the HTML parser.
  return (
    <span
      ref={face}
      role="button"
      tabIndex={0}
      aria-label={tx(SEE).replace("{name}", zoom ?? "")}
      className={`${classes} vx-face-open`}
      style={style}
      onPointerDown={warm}
      onClick={open}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") open(event); }}
    >
      {children}
      {img}
    </span>
  );
}
