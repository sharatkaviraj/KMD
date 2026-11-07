import { ReceiptDocument } from "@/modules/receipts/ui/receipt-document";
import type { ReceiptDetail } from "@/modules/receipts/domain/types";
import { createBilingualReceiptTranslator } from "@/platform/i18n/bilingual-receipt";

/**
 * The Fees receipt as Fees itself prints it, shown inside One (review F03):
 * the same A4 document, from the same component, on a phone, a desk and
 * paper (owner, 7 Nov 2026: "make the receipt look like this throughout the
 * app"). It lays itself out by its own width, so a phone or the receipts
 * desk's side panel gets two columns and a desk or a sheet of A4 gets four.
 *
 * The phone used to get a different, shorter counter slip here. It left out
 * what a parent asks the office about — what this receipt paid off, the
 * concession, which instalments are still due — so the phone now shows the
 * whole receipt, as Fees' receipt preview does.
 *
 * The logo, PAID stamp and authorised signature are the template's own
 * assets; nothing here draws a signature or changes a figure.
 */
export function BridgeReceiptPaper({ receipt, autoPrint = false }: { receipt: ReceiptDetail; autoPrint?: boolean }) {
  return <ReceiptDocument receipt={receipt} t={createBilingualReceiptTranslator()} autoPrint={autoPrint} />;
}
