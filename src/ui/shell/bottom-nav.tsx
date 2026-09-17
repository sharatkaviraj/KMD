"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { m } from "@/messages";
import type { Localized } from "@/platform/i18n/language";
import { useText } from "@/platform/i18n/use-language";
import { activeNavHref, type NavItem } from "@/platform/config/navigation";
import { cn } from "@/platform/utils";

/**
 * What crosses the server/client boundary: the label pair and the href. The
 * icon is a component (not serialisable) and is rendered by the shell, and
 * `ready` has already been applied by `navigationFor()`.
 *
 * The label stays a pair rather than a resolved string, because the bar reads
 * the reader's language from context and renders it there.
 */
type SerializableNavItem = Pick<NavItem, "href" | "label">;

export function BottomNav({
  items,
  icons,
}: {
  items: SerializableNavItem[];
  /** Rendered icons, passed from the server — a component is not serialisable. */
  icons: Record<string, React.ReactNode>;
}) {
  const pathname = usePathname();
  const { lead, flat } = useText();
  const active = activeNavHref(pathname, items);

  /**
   * The tab the thumb just tapped, remembered with the path it was tapped
   * from. Ported from the fee app: the highlight used to follow `usePathname`,
   * which only moves once the navigation commits — so on a slow connection the
   * bar sat on the old tab for the whole wait and the tap read as ignored.
   * Deriving it from the path it was tapped *from* means it clears itself when
   * the route changes, with no effect and no extra render.
   */
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);
  const pending = tapped && tapped.from === pathname ? tapped.href : null;

  // A navigation that never lands — aborted, or bounced by a guard — must not
  // leave the highlight on a tab nobody reached.
  useEffect(() => {
    if (!tapped) return;
    const timer = setTimeout(() => setTapped(null), 5000);
    return () => clearTimeout(timer);
  }, [tapped]);

  // A bar with one tab is a bar that tells you nothing: it cannot show where
  // else you could go, which is the only reason it exists. Below two tabs the
  // page simply scrolls, and the top bar is still the way home.
  if (items.length < 2) return null;

  return (
    <nav
      aria-label={flat(m.mainNavigation)}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur",
        "safe-bottom px-1 pt-1.5",
        "md:hidden",
      )}
      style={{ minHeight: "var(--mobile-bottom-nav-height)" }}
    >
      <ul
        className="mx-auto grid max-w-2xl gap-0.5"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const isActive = pending ? pending === item.href : active === item.href;

          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                onClick={() => setTapped({ href: item.href, from: pathname })}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "focus-ring flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1",
                  "transition-colors",
                  isActive
                    ? "bg-accent-soft text-accent-soft-foreground"
                    : "text-muted-foreground hover:bg-surface-2",
                )}
              >
                <span aria-hidden className="[&_svg]:size-5">
                  {icons[item.href]}
                </span>
                {/* One language only, whatever the reader chose: a tab is
                    ~70px wide and two lines of text do not fit in it. */}
                <span className="w-full truncate text-center text-[11px] font-semibold leading-tight">
                  {lead(item.label)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}


/**
 * The sidebar, from `md` up: everything the role may open, in groups.
 *
 * Not the same list as the bar. The bar shows four screens and a More hub
 * because that is what a thumb can hit on a 360px phone; a 1440px window has
 * room for all of them, and hiding four behind a hub built for a phone is the
 * phone's constraint following somebody to their desk (PLAN §3).
 *
 * So there is no More entry here — nothing is hidden, and a hub listing what
 * did not fit would be an empty page.
 */
export function SideNav({
  groups,
  icons,
}: {
  groups: { title: Localized; items: SerializableNavItem[] }[];
  icons: Record<string, React.ReactNode>;
}) {
  const pathname = usePathname();
  const { lead, under, flat } = useText();
  const everything = groups.flatMap((group) => group.items);
  const active = activeNavHref(pathname, everything);

  if (everything.length < 2) return null;

  return (
    <nav
      aria-label={flat(m.mainNavigation)}
      className="hidden w-56 shrink-0 border-r border-border bg-surface md:block"
    >
      <div className="sticky top-14 space-y-5 p-3">
        {groups.map((group) => (
          <section key={flat(group.title)} aria-labelledby={groupId(group.title)}>
            {/* A named heading rather than a bare divider: the groups are the
                point, and a screen reader that cannot tell them apart is back
                to one undifferentiated list. */}
            <h2
              id={groupId(group.title)}
              className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground"
            >
              {lead(group.title)}
            </h2>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const isActive = active === item.href;
                const secondLine = under(item.label);

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors",
                        isActive
                          ? "bg-accent-soft text-accent-soft-foreground"
                          : "text-muted-foreground hover:bg-surface-2",
                      )}
                    >
                      <span aria-hidden className="[&_svg]:size-5">
                        {icons[item.href]}
                      </span>
                      <span className="truncate">
                        {lead(item.label)}
                        {secondLine ? (
                          <span className="ml-2 text-[12px] font-normal opacity-70">
                            {secondLine}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}

/** A stable id per group, so the heading can name its own landmark. */
function groupId(title: Localized): string {
  return `nav-group-${title.en.toLowerCase().replace(/[^a-z]+/g, "-")}`;
}
