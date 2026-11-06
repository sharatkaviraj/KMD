"use client";

import NextLink from "next/link";
import { forwardRef, useEffect, useRef, useState, type ComponentProps, type ComponentRef } from "react";

/*
 * The link every vx screen uses (D-439). Next prefetches every link that
 * scrolls into view, and on these screens that is a full server render each:
 * opening Calendar fetched 53 other calendar pages (one per day cell and
 * filter), Students 33 student pages, Academics 26. A phone on school wifi
 * spent its first ten seconds on pages nobody asked for, and the tap the
 * person did make queued behind them.
 *
 * So a screen link fetches nothing until someone shows they mean it: a finger
 * resting on it for a beat, a mouse resting on it, or keyboard focus. Then it
 * fetches the whole destination, so the tap that follows is instant. A touch
 * that turns into a scroll is cancelled before it costs a render. An explicit
 * `prefetch` still wins. The shell's own tabs keep Next's default. Since D-441 the
 * ported Fees screens and every other module use it too, which is why it
 * lives in `src/ui` rather than `src/vx`.
 */
const REST_MS = 90;

type Props = ComponentProps<typeof NextLink>;

const Link = forwardRef<ComponentRef<typeof NextLink>, Props>(function Link({ prefetch, ...props }, ref) {
  const [full, setFull] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const explicit = prefetch !== undefined && prefetch !== null;
  const now = () => { if (!explicit) setFull(true); };
  const soon = () => {
    if (explicit || full || timer.current) return;
    timer.current = setTimeout(now, REST_MS);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <NextLink
      ref={ref}
      {...props}
      prefetch={explicit ? prefetch : full}
      onTouchStart={(event) => { soon(); props.onTouchStart?.(event); }}
      onTouchMove={(event) => { cancel(); props.onTouchMove?.(event); }}
      onTouchEnd={(event) => { cancel(); props.onTouchEnd?.(event); }}
      onTouchCancel={(event) => { cancel(); props.onTouchCancel?.(event); }}
      onFocus={(event) => { now(); props.onFocus?.(event); }}
      onMouseEnter={(event) => { soon(); props.onMouseEnter?.(event); }}
      onMouseLeave={(event) => { cancel(); props.onMouseLeave?.(event); }}
    />
  );
});

export default Link;
