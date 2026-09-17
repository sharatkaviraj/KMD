import Link from "next/link";

import { m } from "@/messages";
import { requireStaff } from "@/platform/auth/current-staff";
import { overflowFor } from "@/platform/config/navigation";
import { primary, secondary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.navMore) };
}

/**
 * What did not fit on the bar.
 *
 * The bar holds five tabs, which is what a thumb can hit on a 360px phone. A
 * role that may open more than five screens gets this as its fifth, rather
 * than the sixth screen quietly disappearing — which is exactly what a plain
 * `slice(0, 5)` did the day `/substitutions` was added, and what a test now
 * refuses.
 */
export default async function MorePage() {
  const staff = await requireStaff("/more");
  const language = staff.language;
  const items = overflowFor(staff.role);

  return (
    <>
      <PageHeader title={m.navMore} language={language} />

      {items.length === 0 ? (
        <EmptyState title={m.openToYou} language={language} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => {
            const under = secondary(item.label, language);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="focus-ring flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground [&_svg]:size-5"
                  >
                    <item.icon />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold text-foreground">
                      {primary(item.label, language)}
                    </span>
                    {under ? (
                      <span className="block truncate text-[12px] text-subtle-foreground">
                        {under}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
