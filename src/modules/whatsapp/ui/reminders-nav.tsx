import { Suspense } from "react";
import { CalendarClock, History, Megaphone, Send, Users, Wrench, type LucideIcon } from "lucide-react";

import { cn } from "@/platform/utils";
import { NavLink } from "@/ui/shell/nav-link";
import { FixTabCount } from "@/modules/whatsapp/ui/fix-tab-count";

/**
 * The tabs across the Reminders section.
 *
 * A SERVER component of links, so it costs the send screen's client bundle
 * nothing — that route sits under a gzip ceiling that only ratchets down. Links
 * rather than client tabs for the same reason the Dashboard boards are links:
 * every screen stays linkable and the back button stays honest.
 *
 * Fast on purpose. Each tab is the shell's `NavLink` (already in the shared
 * bundle) with `unstable_dynamicOnHover`: the destination starts rendering on
 * touchstart or hover, the ~100ms before the click fires, and the top progress
 * bar starts the moment the tap lands. Pages already seen come back instantly
 * from the router cache (`staleTimes.dynamic`, next.config.ts). `tap` gives the
 * press itself. Short labels with an icon each, so the first four fit a phone's width
 * without the row having to be scrolled to find one.
 */

export type RemindersTab = "send" | "fix" | "families" | "ladder" | "notices" | "campaigns";

const TABS: ReadonlyArray<{
  value: RemindersTab;
  label: string;
  title: string;
  href: string;
  icon: LucideIcon;
}> = [
  { value: "send", label: "Send", title: "Send fee reminders", href: "/fees/reminders", icon: Send },
  // Second, so its count is on screen without scrolling the row on a phone.
  {
    value: "fix",
    label: "Fix",
    title: "Families a reminder did not reach: why, and what to do",
    href: "/fees/reminders/fix",
    icon: Wrench,
  },
  {
    value: "families",
    label: "Families",
    title: "How hard each family is chased",
    href: "/fees/reminders/families",
    icon: Users,
  },
  {
    value: "ladder",
    label: "Plan",
    title: "The reminder plan for each installment",
    href: "/fees/reminders/ladder",
    icon: CalendarClock,
  },
  {
    value: "notices",
    label: "Notices",
    title: "School notices: absence, exams, PTM, closures",
    href: "/fees/reminders/notices",
    icon: Megaphone,
  },
  {
    value: "campaigns",
    label: "History",
    title: "Saved campaigns and every run so far",
    href: "/fees/reminders/campaigns",
    icon: History,
  },
];

export function RemindersNav({ active }: { active: RemindersTab }) {
  return (
    <nav aria-label="Reminders" className="-mx-1 print:hidden">
      <ul className="no-scrollbar flex snap-x gap-1 overflow-x-auto px-1 pb-0.5 md:gap-1.5">
        {TABS.map((tab) => {
          const current = tab.value === active;
          const Icon = tab.icon;
          return (
            <li key={tab.value} className="shrink-0 snap-start">
              <NavLink
                href={tab.href}
                unstable_dynamicOnHover
                title={tab.title}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "tap focus-ring inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-bold md:h-9 md:px-4",
                  current
                    ? "border-accent bg-accent text-accent-foreground shadow-sm"
                    : "border-border bg-card text-foreground hover:border-border-strong hover:bg-surface-2",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {tab.label}
                {/* Streams in on its own, so no Reminders page waits for it. */}
                {tab.value === "fix" ? (
                  <Suspense fallback={null}>
                    <FixTabCount onAccent={current} />
                  </Suspense>
                ) : null}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
