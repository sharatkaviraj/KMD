"use client";

import { useEffect, useId, useRef, type ComponentProps, type ReactNode, type RefObject } from "react";
import Link, { useLinkStatus } from "next/link";

/** Broadcast whenever a Link starts or stops navigating. */
export const NAV_EVENT = "vpps-nav";

export type NavPendingDetail = { pending: boolean };

// Links may mount during a streamed navigation, and two links may briefly be
// pending at once. An idle link must not cancel another link's feedback.
const pendingLinks = new Set<string>();

/**
 * Reports whether THIS link's navigation is still in flight.
 *
 * `useLinkStatus` may only be called from a descendant of the `<Link>` it
 * describes, which is why this is a separate component rather than a hook call
 * in NavLink itself.
 */
function LinkPending({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  const marker = useRef<HTMLSpanElement>(null);

  // The tapped link itself answers, not only the bar at the top: it carries
  // `data-nav-pending` while its page is on the way, and the stylesheet dims it
  // after a short delay so an instant navigation never flickers. Set on the
  // `<a>` through a hidden marker so no wrapper changes the link's layout.
  useEffect(() => {
    const link = marker.current?.closest("a");
    if (!link) return;
    link.toggleAttribute("data-nav-pending", pending);
    return () => link.removeAttribute("data-nav-pending");
  }, [pending]);
  useBroadcastPending(pending);

  return <>{children}<span ref={marker} hidden /></>;
}

/** Tells the progress bar (and the "Opening…" note) while `pending` is true. */
function useBroadcastPending(pending: boolean) {
  const id = useId();
  useEffect(() => {
    const notify = () => window.dispatchEvent(
      new CustomEvent<NavPendingDetail>(NAV_EVENT, { detail: { pending: pendingLinks.size > 0 } }),
    );
    if (pending) {
      pendingLinks.add(id);
      notify();
    }

    // A link unmounting mid-navigation (the nav collapsing on a phone) must not
    // leave the progress bar stuck on.
    return () => {
      if (pendingLinks.delete(id)) notify();
    };
  }, [pending, id]);
}

/**
 * The same answer for every screen link (`@/ui/link`), with no element of its
 * own: it marks the `<a>` through the link's ref, so a list row's layout and
 * its `:last-child` rules stay exactly as they were. Must be rendered inside
 * the `<Link>` it reports on, as `useLinkStatus` requires (owner's smoke,
 * 7 Nov 2026: a tapped row gave no sign for up to three seconds).
 */
export function LinkPendingReporter({ anchor }: { anchor: RefObject<HTMLAnchorElement | null> }) {
  const { pending } = useLinkStatus();
  useEffect(() => {
    const link = anchor.current;
    if (!link) return;
    link.toggleAttribute("data-nav-pending", pending);
    return () => link.removeAttribute("data-nav-pending");
  }, [pending, anchor]);
  useBroadcastPending(pending);
  return null;
}

/**
 * A `<Link>` that tells the app it is loading.
 *
 * The progress bar used to key off `usePathname()`, which only changes AFTER
 * the navigation commits — so a slow route showed nothing at all while it
 * loaded, then flashed a bar once the page was already on screen. Exactly
 * backwards.
 *
 * The window CustomEvent transport is the same one `toast.tsx` already uses,
 * so the progress bar stays decoupled from the link tree with no new
 * state-management dependency.
 *
 * Worth applying only to the main navigation surfaces: each instance costs a
 * client component, and the fallback in RouteProgress still covers everything
 * else.
 */
type NavLinkProps = ComponentProps<typeof Link> & {
  /**
   * Fetch the full page -- data included -- on hover or touchstart, not only
   * its loading skeleton. Needs `experimental.dynamicOnHover` in
   * next.config.ts. The App Router's Link accepts it at runtime; it is only
   * missing from the `next/link` export's types.
   */
  unstable_dynamicOnHover?: boolean;
};

export function NavLink({ children, ...props }: NavLinkProps) {
  return (
    <Link {...props}>
      <LinkPending>{children}</LinkPending>
    </Link>
  );
}
