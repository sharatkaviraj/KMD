"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";

/**
 * A round face: the child's photo when there is one, over whatever the caller
 * draws otherwise (initials, a roll number, an icon). The circle's size,
 * colour and shape stay the caller's own class and style, so every screen
 * keeps its look.
 *
 * The initials show until the photo has loaded, and the photo fades in over
 * them. A photo that fails (a signed link that expired after five minutes, a
 * phone that went offline, a photo since removed) leaves the initials, never a
 * broken picture (smoke 7 Nov 2026).
 */
export function Face({ photo, className, style, children }: { photo?: string | null; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const [seen, setSeen] = useState<{ src: string; ok: boolean } | null>(null);
  const failed = seen !== null && seen.src === photo && !seen.ok;
  const loaded = seen !== null && seen.src === photo && seen.ok;
  const show = photo && !failed ? photo : null;
  const settle = useCallback((ok: boolean) => {
    if (show) setSeen((prev) => (prev && prev.src === show && prev.ok === ok ? prev : { src: show, ok }));
  }, [show]);
  // A photo that finished before the page woke up fires no event: read it once.
  const check = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.currentSrc) settle(img.naturalWidth > 0);
  }, [settle]);
  return (
    <span className={className ? `${className} vx-face` : "vx-face"} style={style} aria-hidden="true">
      {children}
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived authorized URL, no shared optimizer cache.
        <img ref={check} src={show} alt="" loading="lazy" decoding="async" draggable={false} data-on={loaded ? "" : undefined} onLoad={() => settle(true)} onError={() => settle(false)} />
      ) : null}
    </span>
  );
}
