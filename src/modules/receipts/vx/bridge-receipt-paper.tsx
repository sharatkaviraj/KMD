import { MobilePrintedReceipt } from "@/modules/payments/ui/mobile-printed-receipt";
import { ReceiptDocument } from "@/modules/receipts/ui/receipt-document";
import type { ReceiptDetail } from "@/modules/receipts/domain/types";
import { createBilingualReceiptTranslator } from "@/platform/i18n/bilingual-receipt";

/**
 * The Fees receipt as Fees itself prints it, shown inside One (review F03):
 * the paper slip on a phone, the A4 document on a desk and on paper — the
 * same two renders, from the same components, as the Fees receipt page. The
 * logo, PAID stamp and authorised signature are the template's own assets;
 * nothing here draws a signature or changes a figure.
 */
export function BridgeReceiptPaper({ receipt }: { receipt: ReceiptDetail }) {
  return (
    <>
      <div className="md:hidden print:hidden">
        <MobilePrintedReceipt
          receiptNumber={receipt.receiptNumber}
          studentFullName={receipt.studentFullName}
          fatherName={receipt.fatherName}
          admissionNo={receipt.admissionNo}
          classLabel={receipt.classLabel}
          amountReceived={receipt.totalAmount}
          paymentDate={receipt.paymentDate}
          paymentModeLabel={receipt.paymentMode}
          receivedBy={receipt.receivedBy ?? receipt.createdByName ?? ""}
          remainingBalance={receipt.outstandingAfterReceipt}
          isVoided={receipt.isVoided}
        />
      </div>
      <div className="hidden md:block print:block">
        <ReceiptDocument receipt={receipt} t={createBilingualReceiptTranslator()} />
      </div>
    </>
  );
}
