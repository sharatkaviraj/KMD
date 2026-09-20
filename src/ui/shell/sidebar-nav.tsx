"use client";

import { useCallback, useRef } from "react";
import { NavLink } from "@/ui/shell/nav-link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { type LucideIcon } from "lucide-react";

import { NavCount, type NavCounts } from "@/ui/shell/nav-count";
import { useIdlePrefetch } from "@/ui/hooks/use-idle-prefetch";

import {
  getGroupedProtectedNavigation,
  getProtectedNavigationItem,
  getVisibleProtectedNavigation,
  type ProtectedNavigationItem,
} from "@/modules/fees/config/navigation";
import { type StaffRole } from "@/modules/fees/platform/roles";
import { navIconFor } from "@/platform/config/navigation";
import { appendCurrentSessionParam } from "@/platform/navigation/session-href";
import { cn } from "@/platform/utils";

/**
 * A group of links the shell hands in, already resolved.
 *
 * The fee app derived its sidebar from a role inside this component, because
 * it had one navigation map. This app has two — its own (six roles, grouped
 * Today's work / Records / Setup, labels as Hindi/English pairs) and the fee
 * app's — and the sidebar shows both. Neither could be derived here without
 * this component knowing about both vocabularies and the reader's language, so
 * the shell resolves them and passes the answer.
 *
 * `label` is already in the reader's language. `i18nKey` is deliberately
 * absent: these have been translated by the time they arrive.
 *
 * **There is no `icon`, and that is the point.** A `LucideIcon` is a
 * forwardRef object; neither it nor an element built from one survives the
 * trip from a Server Component to a Client Component in a production build.
 * Both were tried here and both rendered the error boundary in prod while
 * working perfectly in dev. This component calls `navIconFor(href)` instead —
 * a client import of a pure module, which is an ordinary import with no
 * boundary to cross.
 */
export type SidebarNavGroup = {
  key: string;
  label: string;
  items: {
    href: string;
    label: string;
  }[];
};

type SidebarNavProps = {
  staffRole: StaffRole;
  /**
   * Render these instead of deriving from `staffRole`. The role-derived path
   * is kept for the tablet topbar grid, which is still fee-only.
   */
  groups?: readonly SidebarNavGroup[];
  /** "sidebar" = full sidebar list. "topbar" = compact horizontal grid (md viewports). */
  mode?: "sidebar" | "topbar";
  /**
   * "ink" renders on the dark --nav sidebar surface (Ledger Calm 2.0);
   * "light" keeps the paper styling used by the tablet topbar grid.
   */
  tone?: "light" | "ink";
  /** Count pills keyed by nav href (e.g. payments today, defaulter count). */
  counts?: NavCounts;
  /**
   * The same counts, still in flight. The workspace shell passes this so the
   * nav can paint before its numbers exist — see components/admin/nav-count.tsx.
   */
  countsPromise?: Promise<NavCounts>;
  className?: string;
};

// These three are the office's daily flow, so they get warmed without waiting
// for intent. Every other nav item is prefetched only on hover/focus so we
// don't blast the server with N speculative requests on every page load — see
// useHoverPrefetch below.
//
// They are warmed on idle rather than during render. `prefetch={true}` on a
// `force-dynamic` route makes Link fetch the fully rendered page, so these
// three were three complete server renders — auth, fee policy, shell pulse,
// page data — fired while the page the staffer was looking at was still
// waiting on the same database. Handing them to useIdlePrefetch keeps a warm
// cache (router.prefetch renders only as far as loading.tsx) and stops it
// competing with the visible page.
const EAGER_PREFETCH_HREFS = [
  "/fees/payments",
  "/fees/dashboard",
  "/fees/students",
] as const;

const eagerPrefetchHrefs = new Set<string>(EAGER_PREFETCH_HREFS);

/**
 * Idempotent hover-prefetch hook. On the first onMouseEnter / onFocus / onTouchStart
 * for a given href, calls router.prefetch() and remembers it so subsequent
 * hovers are free. Combines with the eagerly-prefetched set above so the most
 * common destinations stay warm regardless of intent.
 */
function useHoverPrefetch() {
  const router = useRouter();
  const warmed = useRef<Set<string>>(new Set());
  return useCallback(
    (href: string) => {
      if (warmed.current.has(href)) return;
      warmed.current.add(href);
      router.prefetch(href);
    },
    [router],
  );
}

export function SidebarNav({
  staffRole,
  groups: injectedGroups,
  mode = "sidebar",
  tone = "light",
  counts,
  countsPromise,
  className,
}: SidebarNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /*
   * Which link is the current one.
   *
   * `getProtectedNavigationItem` only knows the fee routes, so on
   * `/teach` or `/students` it returns null and nothing highlighted —
   * the sidebar looked broken on every screen this app owns. Injected
   * groups resolve it by longest matching prefix instead, which is what
   * `activeNavHref()` does for this app's own bar and what makes
   * `/fees/students/123` light up Students rather than nothing.
   */
  const activeItem = getProtectedNavigationItem(pathname);
  const injectedActiveHref = injectedGroups
    ?.flatMap((group) => group.items.map((item) => item.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((left, right) => right.length - left.length)[0];
  const isTopbar = mode === "topbar";
  const isInk = tone === "ink" && !isTopbar;
  const t = useTranslations("Navigation");
  const warmRoute = useHoverPrefetch();
  // The daily three, warmed once the browser is idle instead of during render.
  useIdlePrefetch(EAGER_PREFETCH_HREFS);
  const translateLabel = (item: { label: string; i18nKey?: string }) =>
    item.i18nKey ? t(item.i18nKey) : item.label;

  // Both shapes: the fee app's full item, and the injected one, which has no
  // icon of its own.
  const renderItem = (item: {
    href: string;
    label: string;
    icon?: LucideIcon;
    i18nKey?: string;
  }) => {
    const active = injectedGroups
      ? injectedActiveHref === item.href
      : activeItem?.href === item.href;
    // The fee app's own items carry their icon; the injected ones are looked
    // up here, on the client, because a component reference cannot be sent.
    const Icon = "icon" in item ? item.icon : navIconFor(item.href);
    const iconTone = isInk
      ? active
        ? "text-accent"
        : "text-nav-muted group-hover:text-nav-foreground"
      : active
        ? "text-accent"
        : "text-muted-foreground group-hover:text-foreground";
    const href = appendCurrentSessionParam(item.href, searchParams);

    const isEager = eagerPrefetchHrefs.has(item.href);
    const onWarm = isEager || active ? undefined : () => warmRoute(item.href);

    if (isTopbar) {
      return (
        <NavLink
          key={item.href}
          href={href}
          prefetch={false}
          onMouseEnter={onWarm}
          onFocus={onWarm}
          onTouchStart={onWarm}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[11px] font-medium leading-4 transition-colors duration-150",
            active
              ? "border-border-strong bg-surface-2 text-foreground"
              : "border-border bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground",
          )}
        >
          {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
          <span className="truncate">{translateLabel(item)}</span>
        </NavLink>
      );
    }

    return (
      <NavLink
        key={item.href}
        href={href}
        prefetch={false}
        onMouseEnter={onWarm}
        onFocus={onWarm}
        onTouchStart={onWarm}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-sm font-medium transition-colors duration-150",
          isInk ? "focus-ring-ink" : "focus-ring",
          isInk
            ? active
              ? "bg-nav-hover text-nav-foreground"
              : "text-nav-muted hover:bg-nav-hover/70 hover:text-nav-foreground"
            : active
              ? "bg-surface-2 text-foreground"
              : "text-muted-foreground hover:bg-surface-2/70 hover:text-foreground",
        )}
      >
        {/* Active rule */}
        {active ? (
          <span
            aria-hidden="true"
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-accent"
          />
        ) : null}
        {Icon ? (
          <Icon className={cn("size-4 shrink-0", iconTone)} aria-hidden="true" />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{translateLabel(item)}</span>
        <NavCount
          counts={counts}
          countsPromise={countsPromise}
          select={(resolved) => resolved[item.href]}
        >
          {(count) => (
            <span
              className={cn(
                "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none",
                isInk
                  ? "bg-nav-surface text-nav-muted group-hover:text-nav-foreground"
                  : "bg-surface-2 text-muted-foreground",
                active && isInk && "bg-nav text-nav-foreground",
              )}
            >
              {count > 999 ? "999+" : count}
            </span>
          )}
        </NavCount>
      </NavLink>
    );
  };

  if (isTopbar) {
    const navigationItems = getVisibleProtectedNavigation(staffRole);
    return (
      <nav
        className={cn("grid grid-cols-2 gap-1.5 sm:grid-cols-4", className)}
        aria-label={t("workspaceNavLabel")}
      >
        {navigationItems.map(renderItem)}
      </nav>
    );
  }

  // Sidebar mode: grouped sections. Injected when the shell has both
  // navigations to show; derived from the role when it does not.
  const groups =
    injectedGroups ??
    getGroupedProtectedNavigation(staffRole).map((group) => ({
      key: group.key,
      label: t(group.i18nKey),
      items: group.items,
    }));

  return (
    <nav
      className={cn("flex flex-col gap-4", className)}
      aria-label={t("workspaceNavLabel")}
    >
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-0.5">
          <p
            className={cn(
              "px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
              isInk ? "text-nav-muted/70" : "text-subtle-foreground",
            )}
          >
            {group.label}
          </p>
          {group.items.map(renderItem)}
        </div>
      ))}
    </nav>
  );
}
