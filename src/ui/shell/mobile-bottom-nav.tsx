"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavCount, type NavCounts } from "@/ui/shell/nav-count";
import { NAV_EVENT, NavLink, type NavPendingDetail } from "@/ui/shell/nav-link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { type LucideIcon } from "lucide-react";
import { ChevronRight, Ellipsis, LayoutGrid } from "lucide-react";

import { type StaffRole } from "@/modules/fees/platform/roles";
import {
  getMobileBottomNavigation,
  getMobileMoreGroups,
  isMobileTakeoverRoute,
} from "@/modules/fees/config/navigation";
import { Sheet } from "@/ui/primitives/sheet";
import type { MobileMoreGroup } from "@/platform/config/mobile-navigation";
import { activeNavHref, navIconFor } from "@/platform/config/navigation";
import { appendCurrentSessionParam } from "@/platform/navigation/session-href";
import { cn } from "@/platform/utils";

/**
 * Two letters for the avatar. Staff sign in with an email, not a name, so the
 * local part is all we have — "raj@vpps.co.in" becomes "RA", and a dotted or
 * underscored address ("sunita.verma@…") becomes "SV".
 */
function initialsFromEmail(email: string) {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

/**
 * One tab, already resolved into the reader's language by the shell.
 *
 * No `icon`, for the same reason as `SidebarNavGroup`: neither a
 * `LucideIcon` nor an element built from one survives the trip from a
 * Server Component to a Client Component in a production build. The bar
 * calls `navIconFor(href)` itself.
 */
export type MobileNavItem = {
  href: string;
  label: string;
};

type MobileBottomNavProps = {
  staffRole: StaffRole;
  /**
   * The tabs, when the shell has both navigations to choose from. Without
   * it the bar derives the fee app's own four, which is right only when
   * the fee screens are the whole app.
   */
  items?: readonly MobileNavItem[];
  /**
   * Live counts rendered as badges on the bar. Keyed by href so a role that
   * cannot see a module simply never receives its badge.
   */
  counts?: NavCounts;
  /**
   * The same counts, still in flight. The workspace shell passes this so the
   * bar can paint before its numbers exist — see components/admin/nav-count.tsx.
   */
  countsPromise?: Promise<NavCounts>;
  /** Signed-in account, shown on the More hub's footer row. */
  staffEmail?: string;
  staffRoleLabel?: string;
  moreGroups?: readonly MobileMoreGroup[];
};

export function MobileBottomNav({
  staffRole,
  items: injectedItems,
  counts,
  countsPromise,
  staffEmail,
  staffRoleLabel,
  moreGroups: injectedMoreGroups,
}: MobileBottomNavProps) {
  const navRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [overflowOpen, setOverflowOpen] = useState(false);
  // The tab the thumb just tapped, remembered together with the pathname it
  // was tapped from. The highlight used to follow usePathname(), which only
  // changes once the navigation commits -- so on a slow network the bar sat on
  // the old tab for the whole wait, and the tap read as ignored. Deriving
  // "pending" from the pathname it was tapped from means it clears itself the
  // moment the route changes, with no effect and no extra render.
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);
  const pendingHref = tapped && tapped.from === pathname ? tapped.href : null;
  const t = useTranslations("Navigation");
  const tMobile = useTranslations("MobileApp");
  const tRoles = useTranslations("Roles");
  const translateLabel = (item: { label: string; i18nKey?: string }) =>
    item.i18nKey ? t(item.i18nKey) : item.label;
  // Four, then More. The fee app fixes the fifth slot as an overflow hub
  // and this app's own bar does the same (MAX_TABS = 5), so the shapes
  // agree and only the source of the four differs.
  const primaryItems = (injectedItems ?? getMobileBottomNavigation(staffRole))
    .filter((item) => item.href !== "/more")
    .slice(0, 4);
  const moreGroups = useMemo(
    () => injectedMoreGroups ?? getMobileMoreGroups(staffRole),
    [injectedMoreGroups, staffRole],
  );
  const primaryHrefs = useMemo(
    () => new Set(primaryItems.map((item) => item.href)),
    [primaryItems],
  );
  const currentHref = activeNavHref(pathname, [
    { href: "/preferences" },
    ...primaryItems,
    ...moreGroups.flatMap((group) => group.items),
  ]);
  const overflowIsActive = currentHref !== null && !primaryHrefs.has(currentHref);
  // Counts belonging to rows that now live behind More, summed onto the More
  // button. Rows already in the bar are skipped so a count is never shown twice.
  const selectOverflowCount = useCallback(
    (resolved: NavCounts) => {
      let total = 0;
      for (const group of moreGroups) {
        for (const item of group.items) {
          if (primaryHrefs.has(item.href)) continue;
          total += resolved[item.href] ?? 0;
        }
      }
      return total > 0 ? total : undefined;
    },
    [moreGroups, primaryHrefs],
  );
  // Takeover screens replace the screen entirely (mobile v2): the tab bar
  // would cost 68px where height matters most, and a tab bar on a student
  // detail page says "you are on a tab", which it is not. MobileTakeoverBar
  // supplies the way back.
  const isTakeover = isMobileTakeoverRoute(pathname);

  const items = [
    ...primaryItems,
    {
      href: "#more",
      label: t("more"),
      icon: Ellipsis,
      isOverflow: true,
    },
  ];

  // A navigation that ends without the pathname changing (aborted, or thrown
  // back by a guard) must not leave the highlight on a tab we never reached.
  // NavLink broadcasts every pending change on this event.
  useEffect(() => {
    function handleNav(event: Event) {
      const detail = (event as CustomEvent<NavPendingDetail>).detail;
      if (detail && !detail.pending) {
        setTapped(null);
      }
    }
    window.addEventListener(NAV_EVENT, handleNav);
    return () => window.removeEventListener(NAV_EVENT, handleNav);
  }, []);

  // A phone menu must release its modal lock when the viewport becomes a
  // tablet. Hiding only the sheet panel would leave an invisible focus trap.
  useEffect(() => {
    if (!overflowOpen) return;
    const tablet = window.matchMedia("(min-width: 768px)");
    const closeOnTablet = () => {
      if (tablet.matches) setOverflowOpen(false);
    };
    closeOnTablet();
    tablet.addEventListener("change", closeOnTablet);
    return () => tablet.removeEventListener("change", closeOnTablet);
  }, [overflowOpen]);

  // Wrapped labels and enlarged text can make the bar taller than its normal
  // 68px footprint. Measure the real bar so the final task and fixed actions
  // keep their clearance; its own minimum height stays independent of this
  // variable, allowing the measurement to shrink after a viewport/font change.
  const navHidden = isTakeover && !overflowOpen;
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || navHidden || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const previousOffset = root.style.getPropertyValue("--mobile-bottom-nav-offset");
    const previousPriority = root.style.getPropertyPriority("--mobile-bottom-nav-offset");
    const restoreOffset = () => {
      if (previousOffset) root.style.setProperty("--mobile-bottom-nav-offset", previousOffset, previousPriority);
      else root.style.removeProperty("--mobile-bottom-nav-offset");
    };
    const updateHeight = () => {
      if (!nav.getClientRects().length) {
        restoreOffset();
        return;
      }
      // The measured border box already includes the safe area. Publish the
      // offset directly, without feeding it back into the nav's own sizing.
      const height = Math.ceil(nav.getBoundingClientRect().height);
      if (height > 0) root.style.setProperty("--mobile-bottom-nav-offset", `${height}px`);
      else restoreOffset();
    };
    const observer = new ResizeObserver(updateHeight);
    observer.observe(nav);
    updateHeight();
    return () => {
      observer.disconnect();
      restoreOffset();
    };
  }, [navHidden]);

  // Hooks must run unconditionally, so this early return sits below them.
  // The More overlay is still allowed to render over a takeover — it is a
  // deliberate jump away, not the tab bar.
  if (isTakeover && !overflowOpen) return null;

  return (
    <>
      <Sheet
        open={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        title={t("more")}
        description={t("moreDescription")}
        closeLabel={t("closeMore")}
        historyDismiss={false}
        className="h-[100dvh] max-h-[100dvh] rounded-none print:hidden"
      >
        <div className="space-y-5 py-3">
          {moreGroups.map((group) => (
            <section key={group.key}>
              <h2 className="px-1 pb-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {group.i18nKey && tMobile.has(group.i18nKey) ? tMobile(group.i18nKey) : group.label}
              </h2>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {group.items.map((item, index) => {
                  const Icon = navIconFor(item.href) ??
                    ("icon" in item ? item.icon as LucideIcon : LayoutGrid);
                  const active = currentHref === item.href;
                  const href = appendCurrentSessionParam(item.href, searchParams);

                  return (
                    <NavLink
                      key={item.href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOverflowOpen(false)}
                      className={cn(
                        "focus-ring flex min-h-14 items-center gap-3 px-3 py-2.5 text-left transition-colors",
                        index > 0 && "border-t border-border/60",
                        active && "bg-accent-soft",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted-foreground",
                          active && "tone-accent",
                        )}
                      >
                        <Icon className="size-[18px]" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold leading-5 text-foreground">
                          {item.i18nKey && tMobile.has(item.i18nKey)
                            ? tMobile(item.i18nKey)
                            : item.label}
                        </span>
                        <span className="block text-xs leading-5 text-muted-foreground">
                          {item.i18nKey && tMobile.has(`${item.i18nKey}Desc`)
                            ? tMobile(`${item.i18nKey}Desc`)
                            : item.description}
                        </span>
                      </span>
                    </NavLink>
                  );
                })}
              </div>
            </section>
          ))}

          {/* Account row and build line close the hub, as in the design.
              The phone app has no top bar, so this is the only place the
              signed-in identity appears outside Settings itself. */}
          {staffEmail ? (
            <NavLink
              href={appendCurrentSessionParam("/preferences", searchParams)}
              aria-current={pathname === "/preferences" ? "page" : undefined}
              onClick={() => setOverflowOpen(false)}
              className="focus-ring flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors active:bg-surface-2"
            >
              <span className="inline-grid size-10 shrink-0 place-items-center rounded-full bg-nav text-[11.5px] font-extrabold text-nav-foreground">
                {initialsFromEmail(staffEmail)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-bold leading-5 text-foreground [overflow-wrap:anywhere]">
                  {staffEmail}
                </span>
                <span className="block text-xs font-semibold text-muted-foreground">
                  {staffRoleLabel ?? tRoles(staffRole)} · {t("preferences")}
                </span>
              </span>
              <ChevronRight
                className="size-[18px] shrink-0 text-subtle-foreground"
                aria-hidden="true"
              />
            </NavLink>
          ) : null}

          <p className="pb-2 text-center text-xs font-semibold text-muted-foreground">
            {tMobile("buildLine")}
          </p>
        </div>
      </Sheet>

      <nav
        ref={navRef}
        aria-label={t("primaryNavLabel")}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur",
          "min-h-[4.25rem] px-2 mobile-safe-bottom-padding",
          "print:hidden md:hidden landscape:min-h-12",
        )}
      >
        <div
          className="mx-auto grid max-w-7xl gap-1 py-1.5 landscape:py-0.5"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map((item) => {
            // The fee app's own tabs carry their icon; an injected one is
            // looked up here, on the client.
            const Icon =
              "icon" in item ? (item.icon as LucideIcon) : navIconFor(item.href);
            const isOverflow = "isOverflow" in item && item.isOverflow;
            // `isHere` is where the router actually is (and what aria-current
            // reports); `active` is what the bar paints, which moves to the
            // tapped tab straight away while the navigation is in flight.
            const isHere = isOverflow
              ? overflowOpen || overflowIsActive
              : currentHref === item.href;
            const active = pendingHref
              ? !isOverflow && pendingHref === item.href
              : isHere;
            const href = isOverflow
              ? undefined
              : appendCurrentSessionParam(item.href, searchParams);
            // Collect is THE action of this app — it stays a filled saffron
            // pill in every state so the thumb always knows where money goes.
            const isCollect = !isOverflow && item.href === "/fees/payments";
            // More carries the sum of its own rows' counts. Without this,
            // moving Defaulters off the bar and into More would silently drop
            // the overdue count from the phone entirely — the number is the
            // reason anyone opens that screen.
            const selectBadge = isOverflow
              ? selectOverflowCount
              : (resolved: NavCounts) => resolved[item.href];
            const content = (
              <>
                <span
                  className={cn(
                    "relative flex h-8 w-10 max-w-full landscape:h-6 shrink-0 items-center justify-center rounded-xl transition-[transform,background-color,color] duration-200 ease-out motion-reduce:transition-none motion-safe:group-active:scale-95",
                    isCollect
                      ? "rounded-full bg-accent text-accent-foreground shadow-sm"
                      : active
                        ? "bg-accent/10 text-accent motion-safe:-translate-y-0.5"
                        : "text-muted-foreground",
                  )}
                >
                  {Icon ? <Icon className="size-5" aria-hidden="true" /> : null}
                  <NavCount
                    counts={counts}
                    countsPromise={countsPromise}
                    select={selectBadge}
                  >
                    {(badge) => (
                      /* Sized by content, not a fixed min-width: this school
                         runs 400+ defaulters, so the badge is "99+" far more
                         often than a two-digit count, and a fixed box clipped
                         the "+". box-content keeps the padding outside the
                         height so the pill stays circular for single digits. */
                      <span className="absolute -right-2 -top-1 box-content inline-flex h-[17px] min-w-[9px] items-center justify-center rounded-full bg-destructive-soft px-1.5 text-[9.5px] font-extrabold tabular-nums text-destructive-soft-foreground">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </NavCount>
                </span>
                <span
                  className={cn(
                    "mt-0.5 block w-full min-w-0 whitespace-normal text-center text-[0.6875rem] font-medium leading-[1.4] [overflow-wrap:anywhere] transition-colors duration-200 motion-reduce:transition-none",
                    isCollect || active ? "text-accent" : "text-muted-foreground",
                    isCollect && "font-semibold",
                  )}
                >
                  {isOverflow
                    ? item.label
                    : translateLabel(item as { label: string; i18nKey?: string })}
                </span>
              </>
            );

            if (isOverflow) {
              return (
                <button
                  key="mobile-more"
                  type="button"
                  aria-label={t("openMore")}
                  aria-expanded={overflowOpen}
                  aria-haspopup="dialog"
                  className="focus-ring group relative flex min-h-14 w-full min-w-0 flex-col items-center justify-start rounded-lg px-1 py-1 text-center transition-colors duration-200 active:bg-surface-2 motion-reduce:transition-none landscape:min-h-11"
                  onClick={() => setOverflowOpen(true)}
                >
                  {content}
                </button>
              );
            }

            return (
              <NavLink
                key={item.href}
                href={href ?? item.href}
                aria-current={isHere ? "page" : undefined}
                /* Full prefetch on touchstart, not just the skeleton: see
                   experimental.dynamicOnHover in next.config.ts. */
                unstable_dynamicOnHover
                className="focus-ring group relative flex min-h-14 w-full min-w-0 flex-col items-center justify-start rounded-lg px-1 py-1 text-center transition-colors duration-200 active:bg-surface-2 motion-reduce:transition-none landscape:min-h-11"
                onClick={(event) => {
                  // A modified click opens a new tab; nothing moves here.
                  if (!isHere && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                    setTapped({ href: item.href, from: pathname });
                  }
                }}
              >
                {content}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </>
  );
}
