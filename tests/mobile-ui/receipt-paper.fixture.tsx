import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { ToastProvider } from "@/vx/ui/overlays";
import { ReceiptDocument } from "@/modules/receipts/ui/receipt-document";
import { createBilingualReceiptTranslator } from "@/platform/i18n/bilingual-receipt";
import { ReceiptsDesk } from "@/vx/screens/receipts/desk";
import { CanonicalReceipt } from "@/vx/screens/receipts/canonical-receipt";
import type { DeskProps, SelectedReceipt } from "@/vx/screens/receipts/types";
import type { BridgeReceiptDetail } from "@/platform/fees-bridge/student-read-contracts";
import { heavyReceipt, ordinaryReceipt } from "../fixtures/receipt-detail";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

/*
 * The receipt as One shows it (owner, 7 Nov 2026), on synthetic data:
 *   ?view=source  — a Fees receipt read in place (/receipts/[no]?receiptId=…)
 *   ?view=desk    — the receipts desk with the receipt in its side panel
 *   &heavy=1      — the longest receipt the office could post
 */
const params = new URLSearchParams(location.search);
const detail = params.get("heavy") === "1" ? heavyReceipt : ordinaryReceipt;
const paper = <ReceiptDocument receipt={detail} t={createBilingualReceiptTranslator()} />;

const selected: SelectedReceipt = {
  id: detail.id, receiptNumber: detail.receiptNumber, studentFullName: detail.studentFullName, admissionNo: detail.admissionNo, classLabel: detail.classLabel,
  fatherName: detail.fatherName, fatherPhone: detail.fatherPhone, paymentDate: detail.paymentDate, createdAt: detail.createdAt, paymentMode: detail.paymentMode,
  referenceNumber: null, totalAmount: detail.totalAmount, reversedAmount: 0, isReversed: false, receivedBy: detail.receivedBy, sessionLabel: detail.sessionLabel,
  heads: detail.breakdown.map((b) => ({ label: b.installmentLabel, amount: b.amount })), share: { status: "not_sent", at: null },
  history: [{ at: detail.createdAt, kind: "posted" }], pendingRequest: null,
};
const desk: DeskProps = {
  today: detail.paymentDate, anchor: detail.paymentDate, span: "today", from: detail.paymentDate, to: detail.paymentDate, view: "list", sessionLabel: detail.sessionLabel,
  rows: Array.from({ length: 12 }, (_, i) => ({ id: `synthetic-${i}`, receiptNumber: i ? `SVP20991231-${String(i + 1).padStart(4, "0")}` : detail.receiptNumber, paymentDate: detail.paymentDate, createdAt: detail.createdAt, paymentMode: "cash", totalAmount: 1000, isReversed: false, receivedBy: "QA Office", studentFullName: "QA Child", admissionNo: "TEST-9101", classLabel: "Class 6" })),
  truncated: false, lastDate: null, closeEvent: null, lastReopen: null, selected, sheet: null,
  initial: { mode: "", staff: "", query: "" }, perms: { collect: true, accounts: true, reverse: true, reopen: false, print: true, dayBook: false },
};
const source = { receiptId: detail.id, studentId: detail.studentId, sessionLabel: "2026-27", detail: { ...detail, sessionLabel: "2026-27" } } as unknown as BridgeReceiptDetail;

function Fixture() {
  return <LanguageProvider language="en"><ToastProvider>
    <div className="vxt vx-shell"><div className="vx-content"><main id="vx-main" className="vx-main vx-reset">
      {params.get("view") === "desk"
        ? <ReceiptsDesk {...desk} paper={paper} />
        : <CanonicalReceipt receipt={source} language="en" canPrint />}
    </main></div></div><div id="vx-layer" className="vxt vx-layer" />
  </ToastProvider></LanguageProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
