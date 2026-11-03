import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { ToastProvider } from "@/vx/ui/overlays";
import { NavTrail } from "@/vx/ui/back-link";
import { KeyboardOffsetProvider } from "@/ui/system/keyboard-offset-provider";
import { VxBottomBar } from "@/vx/shell/bottom-bar";
import { bottomFor } from "@/vx/nav";
import { ReceiptsDesk } from "@/vx/screens/receipts/desk";
import type { DeskProps, SelectedReceipt } from "@/vx/screens/receipts/types";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

const receipt: SelectedReceipt = {
  id: "synthetic-receipt", receiptNumber: "SYNTHETIC-R1", studentFullName: "TEST Receipt Pupil", admissionNo: "TEST-9101", classLabel: "Class 6", fatherName: "TEST Parent", fatherPhone: null,
  paymentDate: "2026-11-02", createdAt: "2026-11-02T16:00:00Z", paymentMode: "cash", referenceNumber: null, totalAmount: 1, reversedAmount: 0, isReversed: false, receivedBy: "TEST Collector", sessionLabel: "TEST-2026-27",
  heads: [{ label: "Tuition", amount: 1 }], share: { status: "not_sent", at: null }, history: [{ at: "2026-11-02T16:00:00Z", kind: "posted" }], pendingRequest: null,
};
const props: DeskProps = {
  today: "2026-11-02", anchor: "2026-11-02", span: "today", from: "2026-11-02", to: "2026-11-02", view: "list", sessionLabel: "TEST-2026-27",
  rows: Array.from({ length: 20 }, (_, i) => ({ id: `synthetic-${i}`, receiptNumber: i ? `SYNTHETIC-R${i + 1}` : receipt.receiptNumber, paymentDate: receipt.paymentDate, createdAt: receipt.createdAt, paymentMode: "cash", totalAmount: 1, isReversed: false, receivedBy: "TEST Collector", studentFullName: "TEST Receipt Pupil", admissionNo: "TEST-9101", classLabel: "Class 6" })),
  truncated: false, lastDate: null, closeEvent: null, lastReopen: null, selected: null, sheet: null,
  initial: { mode: "", staff: "", query: "" }, perms: { collect: true, accounts: false, reverse: false, reopen: false, print: true, dayBook: false },
};
const subscribe = (fn: () => void) => { window.addEventListener("popstate", fn); return () => window.removeEventListener("popstate", fn); };
const badges = Promise.resolve({});
const language = new URLSearchParams(location.search).get("lang") === "hi" ? "hi" : "en";
function Fixture() {
  const path = useSyncExternalStore(subscribe, () => location.pathname);
  return <LanguageProvider language={language}><ToastProvider><NavTrail /><KeyboardOffsetProvider />
    <div className="vxt vx-shell"><div className="vx-content"><main id="vx-main" className="vx-main vx-reset"><ReceiptsDesk {...props} selected={path.startsWith("/receipts/") ? receipt : null} /></main></div>
      <VxBottomBar tabs={bottomFor("accountant", () => true)} badges={badges} />
    </div><div id="vx-layer" className="vxt vx-layer" />
  </ToastProvider></LanguageProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
