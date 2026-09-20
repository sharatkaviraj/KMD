import * as React from "react";
import Link from "next/link";

import { roleLabel } from "@/platform/auth/permissions";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import {
  flat,
  primary,
  secondary,
  type Language,
  type Localized,
} from "@/platform/i18n/language";

/*
 * The two pieces that outlived `AppShell`.
 *
 * They used to live beside it in `src/ui/shell/app-shell.tsx`. That file is
 * gone — the shell is School Fees' `DashboardShell` now — but these are not
 * shell chrome and never were: `PageHeader` is the title block 44 screens
 * open with, and `StaffChip` is who is signed in.
 *
 * They are here rather than in `src/ui/shell/` for one reason: the fee kit
 * has a `PageHeader` too, at `@/ui/shell/page-header`, and it takes a
 * `ReactNode` title where this one takes a `Localized` pair and the reader's
 * language. Two components with one name in one folder is how a screen ends
 * up importing the one that renders "[object Object]".
 */
/**
 * The title block at the top of a screen, in the reader's language.
 *
 * `eyebrow` is the small line above the title — the day, or what part of the
 * school this screen belongs to. DESIGN-SYSTEM §2 asks for a bigger title on a
 * desk than on a phone (32 / 27 px there; 30 / 24 here, because this app's
 * titles are often bilingual pairs and a 32px Hindi heading with English under
 * it pushes the first task off a short laptop screen).
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  language,
  action,
  back,
}: {
  eyebrow?: Localized;
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
              {/* One language: this is a date or a section name, and two of
                  them stacked above the title is noise above the point. */}
              {primary(eyebrow, language)}
            </p>
          ) : null}
          <h1 className="text-[24px] font-semibold tracking-tight text-foreground md:text-[30px]">
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
