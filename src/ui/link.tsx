"use client";

import NextLink from "next/link";
import { forwardRef, useCallback, useEffect, useRef, useState, type ComponentProps, type ComponentRef } from "react";

import { LinkPendingReporter } from "@/ui/shell/nav-link";

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
 *
 * And a tapped link answers at once (D-514): while its page is on the way it
 * dims a little and the progress bar runs, then "Opening…" shows if the page
 * is slow, the same as the shell's own tabs.
 */
const REST_MS = 90;

type Props = ComponentProps<typeof NextLink>;

const Link = forwardRef<ComponentRef<typeof NextLink>, Props>(function Link({ prefetch, children, ...props }, ref) {
  const [full, setFull] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLAnchorElement | null>(null);
  const setAnchor = useCallback((node: HTMLAnchorElement | null) => {
    anchor.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);
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
      ref={setAnchor}
      {...props}
      prefetch={explicit ? prefetch : full}
      onTouchStart={(event) => { soon(); props.onTouchStart?.(event); }}
      onTouchMove={(event) => { cancel(); props.onTouchMove?.(event); }}
      onTouchEnd={(event) => { cancel(); props.onTouchEnd?.(event); }}
      onTouchCancel={(event) => { cancel(); props.onTouchCancel?.(event); }}
      onFocus={(event) => { now(); props.onFocus?.(event); }}
      onMouseEnter={(event) => { soon(); props.onMouseEnter?.(event); }}
      onMouseLeave={(event) => { cancel(); props.onMouseLeave?.(event); }}
    >
      {children}
      <LinkPendingReporter anchor={anchor} />
    </NextLink>
  );
});

export default Link;
