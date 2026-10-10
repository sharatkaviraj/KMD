"use client";

import Link from "next/link";
import { useRef, useState, type ComponentProps } from "react";

/*
 * A link that starts fetching the whole destination — data included — the
 * moment someone shows they mean to open it: a finger landing on it, a
 * keyboard focus, or a mouse resting on it for a beat. By the time the click
 * fires, most of the page has already been rendered on the server.
 *
 * Next's own `unstable_dynamicOnHover` does the same on the first hover, which
 * on a desktop list means a server render for every row the pointer crosses on
 * its way somewhere else. The short rest here is the difference.
 */
const REST_MS = 90;

export function IntentLink(props: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [full, setFull] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = () => setFull(true);
  const soon = () => {
    if (full || timer.current) return;
    timer.current = setTimeout(now, REST_MS);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <Link
      {...props}
      prefetch={full ? true : null}
      onTouchStart={(event) => {
        now();
        props.onTouchStart?.(event);
      }}
      onFocus={(event) => {
        now();
        props.onFocus?.(event);
      }}
      onMouseEnter={(event) => {
        soon();
        props.onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        cancel();
        props.onMouseLeave?.(event);
      }}
    />
  );
}
