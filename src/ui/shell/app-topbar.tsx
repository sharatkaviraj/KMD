"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, KeyRound, UserRound } from "lucide-react";

import { roleLabels, type StaffRole } from "@/modules/fees/platform/roles";
import { getProtectedRouteMeta } from "@/modules/fees/config/navigation";
import { appendCurrentSessionParam } from "@/platform/navigation/session-href";
import { SignOutSubmit } from "@/ui/auth/sign-out-submit";
import { logoutAction } from "@/app/login/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/primitives/dropdown-menu";
import { ThemeToggle } from "@/ui/primitives/theme-toggle";
import { CommandTrigger } from "@/ui/command/command-trigger";

import { SidebarNav, type SidebarNavGroup } from "./sidebar-nav";
import { StatusBadge } from "./status-badge";

type AppTopBarProps = {
  staffEmail: string;
  staffRole: StaffRole;
  sidebarGroups?: readonly SidebarNavGroup[];
  staffRoleLabel?: string;
  /** Current hour in school time (IST), resolved on the server. */
  schoolHour: number;
  sessionPill?: ReactNode;
  /**
   * Locale switcher trigger (Globe icon + dropdown). Rendered only when the
   * LOCALE_SWITCHER_ENABLED env flag is on — the parent shell decides.
   */
  localeSwitcher?: ReactNode;
};

function initialsOf(email: string) {
  const cleaned = email.split("@")[0] ?? email;
  const parts = cleaned.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function firstNameOf(email: string) {
  const cleaned = email.split("@")[0] ?? email;
  const first = cleaned.split(/[._-]+/).filter(Boolean)[0] ?? cleaned;
  if (!first) return "";
  return first[0].toUpperCase() + first.slice(1);
}

function greetingForHour(hour: number) {
  if (hour < 12) return "goodMorning";
  if (hour < 17) return "goodAfternoon";
  return "goodEvening";
}

export function AppTopBar({
  staffEmail,
  staffRole,
  sidebarGroups,
  staffRoleLabel,
  schoolHour,
  sessionPill,
  localeSwitcher,
}: AppTopBarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeMeta = getProtectedRouteMeta(pathname);
  const passwordHref = appendCurrentSessionParam("/fees/password", searchParams);
  const t = useTranslations("Navigation");
  const tRoles = useTranslations("Roles");
  const roleLabel = staffRoleLabel ?? (tRoles.has(staffRole) ? tRoles(staffRole) : roleLabels[staffRole]);
  // On the dashboard the route label gives no information the page itself
  // doesn't — greet the person instead (Ledger Calm 2.0). The hour comes from
  // the server in school time, so the greeting is correct on first paint
  // instead of flashing "Welcome," and swapping after hydration.
  const isDashboard = pathname.startsWith("/fees/dashboard");
  const nativeLabel = sidebarGroups?.flatMap((group) => group.items).filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.label;
  const headline = isDashboard
    ? t(greetingForHour(schoolHour), { name: firstNameOf(staffEmail) })
    : nativeLabel ?? routeMeta.label;

  return (
    <header className="z-20 hidden border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 print:hidden md:sticky md:top-0 md:flex md:flex-col">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <h1 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
            {headline}
          </h1>
          <CommandTrigger />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {sessionPill}
          <div className="hidden sm:block">
            <StatusBadge label={roleLabel} tone="neutral" iconless />
          </div>
          {localeSwitcher}
          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 focus-ring"
              aria-label={t("accountMenu")}
            >
              <span className="grid size-7 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold uppercase text-foreground">
                {initialsOf(staffEmail)}
              </span>
              <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="flex items-center gap-2 py-2">
                <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {staffEmail}
                  </p>
                  <p className="text-xs font-normal text-muted-foreground">
                    {roleLabel}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={passwordHref} className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
                  {t("changePassword")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <form action={logoutAction}>
                <DropdownMenuItem asChild>
                  <SignOutSubmit className="flex w-full items-center gap-2 text-destructive focus:text-destructive">
                    {t("signOut")}
                  </SignOutSubmit>
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tablet (md) compact nav — sidebar hidden, bottom-nav also hidden here. */}
      <div className="hidden border-t border-border bg-background/60 px-4 py-2 sm:px-6 md:block lg:hidden">
        <SidebarNav staffRole={staffRole} groups={sidebarGroups} mode="topbar" />
      </div>
    </header>
  );
}
