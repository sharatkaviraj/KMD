import * as React from "react";
import Link from "next/link";
import { LogOut, SlidersHorizontal } from "lucide-react";

import { logoutAction } from "@/app/login/actions";
import { m } from "@/messages";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { roleLabel } from "@/platform/auth/permissions";
import { homeFor, navigationFor, sidebarFor } from "@/platform/config/navigation";
import {
  flat,
  primary,
  secondary,
  type Language,
  type Localized,
} from "@/platform/i18n/language";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { getSchoolName } from "@/platform/env";
import { cn } from "@/platform/utils";
import { BottomNav, SideNav } from "@/ui/shell/bottom-nav";
import { EnvironmentBadge } from "@/ui/environment-badge";

/**
 * The frame every signed-in screen sits in: ink top bar, role-filtered
 * navigation, and a content column that reserves the fixed bottom bar.
 *
 * A Server Component, so it can read the staff profile itself rather than
 * having every page thread it through. The nav bars are client components
 * (they need the pathname); their icons are rendered here and passed down,
 * because a component reference is not serialisable across that boundary —
 * and the reader's language goes into context for the same reason.
 */
export function AppShell({
  staff,
  children,
}: {
  staff: CurrentStaff;
  children: React.ReactNode;
}) {
  const language = staff.language;
  const home = homeFor(staff.role);
  const items = navigationFor(staff.role);

  /**
   * The bar and the sidebar do not show the same thing.
   *
   * The phone's bar holds five, so four screens plus More. A 1440px window has
   * room for everything the role may open, and putting four of them behind a
   * hub built for a thumb is the phone's constraint leaking onto a desk
   * (PLAN §3). So the sidebar gets the whole list, grouped.
   */
  const groups = sidebarFor(staff.role);

  const icons = Object.fromEntries(
    [...items, ...groups.flatMap((group) => group.items)].map((item) => [
      item.href,
      <item.icon key={item.href} />,
    ]),
  );

  const serializable = items.map((item) => ({
    href: item.href,
    label: item.label,
  }));
  const serializableGroups = groups.map((group) => ({
    title: group.title,
    items: group.items.map((item) => ({ href: item.href, label: item.label })),
  }));

  return (
    <LanguageProvider language={language}>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-40 border-b border-nav-border bg-nav text-nav-foreground">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
            {/* `h-full`, not just the text's height: this is the way home from
                every screen, and at 33px it was the smallest target in the app. */}
            {/* This role's own Home, not everybody's. A teacher tapping the
                school's name wants her day (PLAN §3), and `/dashboard` for her
                is a card with her own email address on it. */}
            <Link
              href={home}
              className="focus-ring flex h-full min-w-0 flex-col justify-center rounded-lg focus-visible:ring-offset-nav"
            >
              <p className="truncate text-[15px] font-semibold leading-tight">
                VPPS One
              </p>
              <p className="truncate text-[11px] leading-tight text-nav-muted">
                {getSchoolName()}
              </p>
            </Link>

            <div className="ml-auto flex items-center gap-2">
              <EnvironmentBadge language={language} />
              {/* Your own settings, beside sign-out because both are about the
                  person rather than the school. In the top bar rather than on
                  the thumb bar or in More: a teacher bar is already full, so
                  More is not a tab she has, and the language is the one
                  setting somebody may need precisely because they cannot read
                  the screen they are on. */}
              <Link
                href="/preferences"
                aria-label={flat(m.preferencesTitle, language)}
                className={cn(
                  "focus-ring flex size-11 items-center justify-center rounded-xl",
                  "text-nav-muted transition-colors hover:bg-white/10 hover:text-nav-foreground",
                  "focus-visible:ring-offset-nav",
                )}
              >
                <SlidersHorizontal className="size-[18px]" aria-hidden />
              </Link>
              {/* A sign-out that is a form, not a link: signing out is a state
                  change, and a GET that mutates is a GET a prefetch can fire. */}
              <form action={logoutAction}>
                <button
                  type="submit"
                  aria-label={flat(m.signOut, language)}
                  className={cn(
                    // size-11 = 44px, the minimum comfortable target.
                    "focus-ring flex size-11 items-center justify-center rounded-xl",
                    "text-nav-muted transition-colors hover:bg-white/10 hover:text-nav-foreground",
                    "focus-visible:ring-offset-nav",
                  )}
                >
                  <LogOut className="size-[18px]" aria-hidden />
                </button>
              </form>
            </div>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-5xl flex-1">
          <SideNav groups={serializableGroups} icons={icons} />
          <main className="pb-bottom-nav min-w-0 flex-1 px-4 py-5 md:pb-10">
            {children}
          </main>
        </div>

        <BottomNav items={serializable} icons={icons} />
      </div>
    </LanguageProvider>
  );
}

/**
 * The title block at the top of a screen, in the reader's language.
 */
export function PageHeader({
  title,
  description,
  language,
  action,
  back,
}: {
  title: Localized;
  description?: Localized;
  language: Language;
  action?: React.ReactNode;
  back?: { href: string; label: Localized };
}) {
  const titleUnder = secondary(title, language);
  const descriptionUnder = description ? secondary(description, language) : null;

  return (
    <div className="mb-5">
      {back ? (
        // 44px tall, with the text still at 13px. It was a 20px inline link —
        // the smallest target in the app, on the screen a teacher opens most,
        // and the one she reaches for with a thumb while holding a register.
        // The negative margin keeps the extra height from pushing the title
        // down, so nothing below it moved.
        <Link
          href={back.href}
          className="focus-ring -ml-2 mb-0.5 inline-flex min-h-11 items-center rounded-lg px-2 text-[13px] font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        >
          ← {primary(back.label, language)}
        </Link>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            {primary(title, language)}
          </h1>
          {titleUnder ? (
            <p className="text-[13px] text-subtle-foreground">{titleUnder}</p>
          ) : null}
          {description ? (
            <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
              {primary(description, language)}
              {descriptionUnder ? (
                <span className="ml-1.5 opacity-80">{descriptionUnder}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

/** Who is signed in. */
export function StaffChip({ staff }: { staff: CurrentStaff }) {
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[15px] font-bold text-accent-soft-foreground"
      >
        {staff.shortName.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-foreground">
          {staff.displayName}
        </p>
        <p className="truncate text-[13px] text-muted-foreground">
          {flat(roleLabel(staff.role), staff.language)}
        </p>
      </div>
    </div>
  );
}
