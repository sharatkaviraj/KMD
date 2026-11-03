"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { NavLink } from "@/ui/shell/nav-link";

/*
 * A link that starts fetching the whole destination — data included — the
 * moment someone shows they mean to open it: keyboard focus, or a finger or
 * mouse resting on it for a beat. A touch that becomes a scroll is cancelled
 * before it starts a full server render for the card it happened to land on.
 *
 * Next's own `unstable_dynamicOnHover` does the same on the first hover, which
 * on a desktop list means a server render for every row the pointer crosses on
 * its way somewhere else. The short rest here is the difference.
 */
const REST_MS = 90;

export function IntentLink({ feedback = false, ...props }: Omit<ComponentProps<typeof Link>, "prefetch"> & { feedback?: boolean }) {
  const Component = feedback ? NavLink : Link;
  const [full, setFull] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
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
    <Component
      {...props}
      prefetch={full ? true : null}
      onTouchStart={(event) => {
        soon();
        props.onTouchStart?.(event);
      }}
      onTouchMove={(event) => { cancel(); props.onTouchMove?.(event); }}
      onTouchEnd={(event) => { cancel(); props.onTouchEnd?.(event); }}
      onTouchCancel={(event) => { cancel(); props.onTouchCancel?.(event); }}
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
