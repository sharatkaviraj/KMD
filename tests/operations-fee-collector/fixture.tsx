import { useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { PaymentDeskClient } from "@/modules/payments/ui/payment-desk-mobile";
import { INITIAL_PAYMENT_ENTRY_ACTION_STATE, type PaymentEntryActionState } from "@/modules/payments/domain/types";
import { draftPageData } from "../payment-draft.fixture";
import { collectorSummary } from "./legacy-data";
import "../../src/app/globals.css";

// This ledger is a browser-local synthetic oracle. No database or messaging
// adapter is imported, and the runner aborts every external/non-GET request.
const ledgerKey = "ops-fee-20261011-ledger";
async function submit(_previous: PaymentEntryActionState, form: FormData): Promise<PaymentEntryActionState> {
  const requestId = String(form.get("clientRequestId"));
  const ledger = JSON.parse(localStorage.getItem(ledgerKey) ?? "[]") as Array<Record<string, string>>;
  const record = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
  if (!ledger.some(row => row.clientRequestId === requestId)) {
    ledger.push(record);
    localStorage.setItem(ledgerKey, JSON.stringify(ledger));
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  if (new URLSearchParams(location.search).get("uncertain") === "yes" && !sessionStorage.getItem("ops-fee-uncertain-delivered")) {
    sessionStorage.setItem("ops-fee-uncertain-delivered", "yes");
    return { ...INITIAL_PAYMENT_ENTRY_ACTION_STATE, status: "error", message: "Synthetic response interrupted after ledger commit", studentId: String(form.get("studentId")), clientRequestId: requestId };
  }
  return { ...INITIAL_PAYMENT_ENTRY_ACTION_STATE, status: "success", message: "Synthetic receipt saved", studentId: String(form.get("studentId")), clientRequestId: requestId, receiptId: `ops-fee-${ledger.length}`, receiptNumber: `OPS-FEE-${ledger.length}`, amountReceived: Number(form.get("amountReceived")), paymentDate: String(form.get("paymentDate")), paymentMode: String(form.get("paymentMode")) as "cash", receivedBy: String(form.get("receivedBy")), remainingBalance: 900 - Number(form.get("amountReceived")) };
}
function Fixture() {
  const [ownerId, setOwner] = useState("ops-fee-owner");
  const [sessionLabel, setSession] = useState("QA-2026");
  const studentId = new URLSearchParams(location.search).get("studentId") ?? "a";
  return <NextIntlClientProvider locale="en" messages={en}>
    <aside aria-label="Synthetic test controls">
      <button onClick={() => setOwner(value => value === "ops-fee-owner" ? "ops-fee-other" : "ops-fee-owner")}>Switch test owner</button>
      <button onClick={() => setSession(value => value === "QA-2026" ? "QA-2027" : "QA-2026")}>Switch test session</button>
    </aside>
    <main className="mobile-app-main"><PaymentDeskClient ownerId={ownerId}
      data={{ ...draftPageData, sessionLabel, initialStudentId: studentId, initialStudentSummary: collectorSummary(studentId).student,
        modeOptions: [{ value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }, { value: "bank_transfer", label: "Bank Transfer" }, { value: "cheque", label: "Cheque" }] }}
      canPost canViewDiagnostics={false} canWaiveLateFee={false} classOptions={[{ id: "qa-class", label: "QA class" }]}
      workflowGuard={null} initialState={INITIAL_PAYMENT_ENTRY_ACTION_STATE} defaultReceivedBy="Synthetic fee clerk"
      submitPaymentEntryAction={submit} repairPaymentDeskStudentDuesAction={async () => { throw new Error("Repair forbidden in synthetic fixture"); }} />
    </main>
  </NextIntlClientProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
