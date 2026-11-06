import Link from "@/ui/link";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";

import { requirePermission } from "@/platform/auth/current-staff";
import { getActiveSessionLabel } from "@/modules/fees/platform/session-context/active";
import { buttonClasses } from "@/ui/primitives/button";
import { Notice } from "@/ui/primitives/notice";

export const runtime = "nodejs";

/**
 * One door into the fee area, and one check that it is set up.
 *
 * **The permission.** Every screen under here came from School Fees and
 * carries its own guard — `requireStaffPermission("payments:write")` on the
 * Payment Desk, `"fees:write"` on Fee Setup. Those still run, and they are the
 * finer-grained ones: they know that reversing a receipt is a different act
 * from adjusting a ledger.
 *
 * What they do not do is answer *this* app's question. They speak the fee
 * app's five-role vocabulary, reached through `feeRoleFor()`, so a teacher or
 * an academic coordinator resolves to the fee app's `view_only` — which can
 * read a dashboard. Without this layout, a teacher who typed `/fees/dashboard`
 * would get the fee desk. Structural rather than repeated on 48 pages, for the
 * same reason the signed-in screens live under `(app)` at all.
 *
 * **The session.** Nearly every fee screen is scoped to an academic session,
 * and the fee app gets that from `app_settings.active_session_label` or the
 * active `fee_policy_configs` row. On a database where neither exists the
 * label resolves to `""` and the first screen to validate it throws — which is
 * what `schoolfees-dev` does today: it carries the fee *schema* (67 tables,
 * every RPC, all three materialized views) and none of the fee *data*.
 *
 * A crash is the wrong answer to "this has not been set up". It reads as a
 * broken application rather than an unconfigured one, and it is the same
 * mistake as rendering ₹0 for a figure that is merely unavailable. So the gap
 * is named here, once, instead of being hit forty-eight different ways.
 */
export default async function FeesLayout({ children }: LayoutProps<"/fees">) {
  await requirePermission("fees:view", "/fees");

  const activeSession = await getActiveSessionLabel().catch(() => "");

  if (!activeSession.trim()) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <Notice
          tone="warning"
          title="The fee desk has no academic session"
        >
          This database carries the fee tables but no fee configuration — no
          active session, no fee policy, no installments. Every fee screen is
          scoped to a session, so none of them can open until one exists.
          <span className="mt-3 block">
            <Link
              href="/fees/fee-setup"
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              Open Fee Setup
            </Link>
          </span>
        </Notice>
      </div>
    );
  }

  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Kolkata">{children}</NextIntlClientProvider>;
}
