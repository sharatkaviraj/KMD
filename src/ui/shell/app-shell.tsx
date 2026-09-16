import * as React from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/login/actions";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { roleLabels, roleLabelsEn } from "@/platform/auth/permissions";
import { navigationFor } from "@/platform/config/navigation";
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
 * because a component reference is not serialisable across that boundary.
 */
export function AppShell({
  staff,
  children,
}: {
  staff: CurrentStaff;
  children: React.ReactNode;
}) {
  const items = navigationFor(staff.role);
  const icons = Object.fromEntries(
    items.map((item) => [item.href, <item.icon key={item.href} />]),
  );
  const serializable = items.map((item) => ({
    href: item.href,
    label: item.label,
    labelEn: item.labelEn,
  }));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-nav-border bg-nav text-nav-foreground">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          {/* `h-full`, not just the text's height: this is the way home from
              every screen, and at 33px it was the smallest target in the app. */}
          <Link
            href="/dashboard"
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
            <EnvironmentBadge />
            {/* A sign-out that is a form, not a link: signing out is a state
                change, and a GET that mutates is a GET a prefetch can fire. */}
            <form action={logoutAction}>
              <button
                type="submit"
                aria-label="साइन आउट · Sign out"
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
        <SideNav items={serializable} icons={icons} />
        <main className="pb-bottom-nav min-w-0 flex-1 px-4 py-5 md:pb-10">
          {children}
        </main>
      </div>

      <BottomNav items={serializable} icons={icons} />
    </div>
  );
}

/**
 * The title block at the top of a screen. Hindi first with English beside it,
 * the same shape as every label in the app.
 */
export function PageHeader({
  title,
  titleEn,
  description,
  action,
  back,
}: {
  title: React.ReactNode;
  titleEn?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-5">
      {back ? (
        <Link
          href={back.href}
          className="focus-ring mb-2 inline-block rounded text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          ← {back.label}
        </Link>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {titleEn ? (
            <p className="text-[13px] text-subtle-foreground">{titleEn}</p>
          ) : null}
          {description ? (
            <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

/** Who is signed in, for the dashboard and the More hub. */
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
          {roleLabels[staff.role]}
          <span className="ml-1.5 opacity-70">{roleLabelsEn[staff.role]}</span>
        </p>
      </div>
    </div>
  );
}
