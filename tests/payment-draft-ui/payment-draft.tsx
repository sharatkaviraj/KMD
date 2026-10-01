import { useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { PaymentDeskClient } from "@/modules/payments/ui/payment-desk-mobile";
import { draftPageData, draftSummary } from "../payment-draft.fixture";
import "../../src/app/globals.css";

function Fixture() {
  const [ownerId, setOwner] = useState("qa-owner");
  const [sessionLabel, setSession] = useState("QA-2026");
  const studentId = new URLSearchParams(location.search).get("studentId") ?? "a";
  return <NextIntlClientProvider locale="en" messages={en}>
    <aside aria-label="Synthetic test controls">
      <button onClick={() => setOwner(value => value === "qa-owner" ? "qa-other" : "qa-owner")}>Switch test owner</button>
      <button onClick={() => setSession(value => value === "QA-2026" ? "QA-2027" : "QA-2026")}>Switch test session</button>
    </aside>
    <main className="mobile-app-main"><PaymentDeskClient ownerId={ownerId}
      data={{ ...draftPageData, sessionLabel, initialStudentId: studentId, initialStudentSummary: draftSummary(studentId).student }}
      canPost={false} canViewDiagnostics={false} canWaiveLateFee={false} classOptions={[{ id: "qa-class", label: "QA class" }]}
      workflowGuard={null} initialState={{ status: "idle", message: null, receiptId: null, receiptNumber: null, studentId: null }} defaultReceivedBy="QA clerk"
      submitPaymentEntryAction={async () => { throw new Error("Posting forbidden in draft fixture"); }}
      repairPaymentDeskStudentDuesAction={async () => { throw new Error("Repair forbidden in draft fixture"); }} />
    </main>
  </NextIntlClientProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
