"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from "react";

/*
 * Back that behaves like Back.
 *
 * Every phone top bar's back arrow was a plain link to its parent list
 * (`/students`). That is a *new* navigation: the list's filters, its page and
 * its scroll position were gone, and once the router cache had expired the
 * list was fetched and drawn again from nothing — exactly "it reloads when I
 * go back". When the screen we came from *is* that list, the arrow now takes
 * the browser's own Back instead, which restores the cached list where it was
 * left. Opened from a bookmark, a search result or another section, there is
 * nothing to go back to and it stays the link it always was.
 */

const CURRENT = "vx:trail:current";
const PREVIOUS = "vx:trail:previous";

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Mounted once in the shell: remembers the screen before this one, per tab
 * (sessionStorage), so a reload of the child page does not invent a list
 * behind it that the browser's history does not have.
 */
export function NavTrail() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const current = window.sessionStorage.getItem(CURRENT);
      if (current === pathname) return;
      if (current) window.sessionStorage.setItem(PREVIOUS, current);
      else window.sessionStorage.removeItem(PREVIOUS);
      window.sessionStorage.setItem(CURRENT, pathname);
    } catch {
      // Storage blocked: Back stays a plain link, which is what it was.
    }
  }, [pathname]);
  return null;
}

function pathOf(href: string): string {
  const cut = href.search(/[?#]/);
  return cut === -1 ? href : href.slice(0, cut);
}

export function BackLink({ href, className, style, children, label = "Back" }: { href: string; className?: string; style?: CSSProperties; children: ReactNode; label?: string }) {
  const router = useRouter();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const previous = read(PREVIOUS);
    if (previous && previous === pathOf(href) && window.history.length > 1) {
      event.preventDefault();
      router.back();
    }
  };
  return (
    <Link href={href} onClick={onClick} className={className} aria-label={label} style={style}>
      {children}
    </Link>
  );
}

const NO_PREVIOUS = () => null;
const NO_SUBSCRIPTION = () => () => {};

/**
 * Back for a screen that does not know its parent: an older screen opened from
 * inside a redesigned module, whose title block is now the design's phone top
 * bar. It goes back to the screen this tab came from, and draws nothing when
 * there is none (a bookmark, a fresh tab), so it never offers a Back that
 * leads somewhere unexpected.
 *
 * Read at render rather than in an effect: before `NavTrail` has run for this
 * page, `CURRENT` still names the screen we came from; after, `PREVIOUS` does.
 * Either way the answer is the same, which is what lets the snapshot be stable.
 */
export function TrailBack({ className, style, children, label = "Back" }: { className?: string; style?: CSSProperties; children: ReactNode; label?: string }) {
  const pathname = usePathname();
  const previous = useSyncExternalStore(
    NO_SUBSCRIPTION,
    () => {
      const current = read(CURRENT);
      return current && current !== pathname ? current : read(PREVIOUS);
    },
    NO_PREVIOUS,
  );
  if (!previous || previous === pathname) return null;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    if (window.history.length > 1) {
      event.preventDefault();
      window.history.back();
    }
  };
  return (
    <Link href={previous} onClick={onClick} className={className} aria-label={label} style={style}>
      {children}
    </Link>
  );
}
