import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { Books } from "@/vx/screens/accounts/books";
import type { BooksData, ChequeRow } from "@/modules/finance-controls/vx/types";
import { VxBottomBar } from "@/vx/shell/bottom-bar";
import { bottomFor } from "@/vx/nav";
import { ToastProvider } from "@/vx/ui/overlays";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

const params = new URLSearchParams(location.search);
// Independent literal oracle; deliberately different payment and cheque dates.
const receiptNotes = "Cheque: OPS Synthetic Bank, dated 2026-04-01; subject to clearing. OPS-IMP05 synthetic receipt memo";
const cheque: ChequeRow & { receiptNotes: string } = {
  receiptId: "00000000-0000-4000-8000-000000000501", receiptNumber: "OPS-IMP05-0001", paymentDate: "2026-04-03", amount: 333,
  studentId: "00000000-0000-4000-8000-000000000502", studentName: "OPS Synthetic Cheque Child", classLabel: "OPS Synthetic Class",
  chequeNo: null, bank: null, chequeDate: null, reference: "004518", receiptNotes,
  status: "to_deposit", statusAt: null, slipNo: null, bounceReason: null, reversed: false,
};
if (params.has("canonical")) Object.assign(cheque, { bank: "OPS Reviewed Canonical Bank", chequeDate: "2026-03-31" });
if (params.has("legacy")) cheque.receiptNotes = "Legacy memo; bank supplied in person";
if (params.has("ambiguous")) cheque.receiptNotes = "Cheque: OPS Bank, dated 2026-03-31; subject to clearing. Cheque: Another Bank, dated 2026-04-01; subject to clearing.";
const data: BooksData = { today: "2026-10-11", sessionLabel: "OPS-IMP05", canWrite: true, canDecide: false, cheques: [cheque], slips: [], upiLines: [], upiReceiptsUnmatched: 0, advances: [], feeRefunds: [], requests: [] };
createRoot(document.getElementById("root")!).render(<LanguageProvider language="en"><ToastProvider><Books data={data} initialView="cheques" initialSheet="" initialPick={[]} initialReceipt={null} staffName="OPS Accountant" readOnly={params.has("readonly")} /><VxBottomBar tabs={bottomFor("accountant", () => true)} badges={Promise.resolve({})} /></ToastProvider></LanguageProvider>);
