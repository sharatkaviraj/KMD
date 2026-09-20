import { MobileDesktopOnlyNotice } from "@/ui/mobile/mobile-kit";
import Link from "next/link";

import { PageHeader } from "@/ui/shell/page-header";
import { OfficeNotice } from "@/ui/office/office-ui";
import { BulkPaymentWorkflow } from "@/modules/payments/ui/bulk/bulk-payment-workflow";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { requireStaffPermission } from "@/modules/fees/platform/session";

type BulkPaymentsPageProps = {
  searchParams?: Promise<{ session?: string; batch?: string }>;
};

export default async function BulkPaymentsPage({ searchParams }: BulkPaymentsPageProps) {
  await requireStaffPermission("payments:bulk", { onDenied: "redirect" });
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const viewSession = await resolveViewSession({
    searchParamSession: resolvedSearchParams?.session,
    cookieSession: await getViewSessionCookie(),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Payment Desk"
        title="Bulk payment upload"
        description={`Upload an Excel/CSV of collected payments and post them all against ${viewSession.sessionLabel}. Every row goes through the same checks as the Payment Desk.`}
        actions={
          <Link
            className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
            href="/fees/payments"
          >
            Back to Payment Desk
          </Link>
        }
      />
      <MobileDesktopOnlyNotice
        title="Bulk payment upload"
        reason="Posting many payments at once means checking a spreadsheet row by row against the desk rules. Use a computer for this — collecting a single payment works well here."
      />

      <OfficeNotice tone="warning">
        Admin-only. Rows post real receipts — review the validation results carefully, and
        rehearse with TEST- students on a TEST session before a first live run.
      </OfficeNotice>
      <BulkPaymentWorkflow
        sessionLabel={viewSession.sessionLabel}
        initialBatchId={resolvedSearchParams?.batch}
      />
    </div>
  );
}
