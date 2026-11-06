import * as React from "react";

import * as m from "@/messages/pairs";
import { roleLabel } from "@/platform/auth/permissions";
import { ClassicTopBar } from "@/vx/ui/classic-top-bar";
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
 * It is the design's top bar now (`ClassicTopBar`, UI-73): on a desk the
 * eyebrow is the crumb over a serif title with the action on the right; on a
 * phone it is a 58px bar with Back and the title, the other-language title
 * under it. The description stays in the page, under the bar, because a bar
 * that grows with a paragraph is not a bar.
 *
 * `eyebrow` is one language: it is a date or a section name, and two of them
 * stacked above the title is noise above the point.
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
  const crumb = eyebrow ? primary(eyebrow, language) : null;

  return (
    <>
      <ClassicTopBar
        crumb={crumb}
        title={primary(title, language)}
        titleUnder={titleUnder}
        sub={titleUnder ? null : crumb}
        actions={action}
        back={back ? { href: back.href, label: primary(back.label, language) } : undefined}
        backLabel={flat(m.back, language)}
      />
      {description ? (
        <p className="vx-cdesc">
          {primary(description, language)}
          {descriptionUnder ? <span className="ml-1.5">{descriptionUnder}</span> : null}
        </p>
      ) : null}
    </>
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
