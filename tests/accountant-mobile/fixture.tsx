import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import type { Language } from "@/platform/i18n/language";
import { Books, type BooksView } from "@/vx/screens/accounts/books";
import type { BooksData, AccountsHomeData } from "@/modules/finance-controls/vx/types";
import { AccountsHome } from "@/vx/screens/accounts/accounts-home";
import { ToastProvider } from "@/vx/ui/overlays";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

const params = new URLSearchParams(location.search);
const language: Language = params.get("language") === "hi" ? "hi" : params.get("language") === "both" ? "both" : "en";
const view = (["cheques", "upi", "refunds", "requests"] as const).find(v => v === params.get("view")) ?? "cheques";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const longName = "OPS Synthetic child with a long name and a very long class label";
const data: BooksData = {
  today: "2026-10-11", sessionLabel: "OPS-20261011-ACCOUNTANT", canWrite: true, canDecide: false,
  cheques: Array.from({ length: 12 }, (_, i) => ({ receiptId: id(i + 1), receiptNumber: `OPS-CHEQUE-${i + 1}`, paymentDate: "2026-10-10", amount: 12345, studentId: id(i + 20), studentName: longName, classLabel: "OPS Synthetic Class 10 — long bilingual section", chequeNo: String(123450 + i), bank: "OPS Synthetic Bank long branch", chequeDate: "2026-10-10", reference: null, status: i === 1 ? "deposited" : "to_deposit", statusAt: null, slipNo: null, bounceReason: null, reversed: false })),
  slips: [], upiReceiptsUnmatched: params.get("unmatched") === "0" ? 0 : params.get("unmatched") === "2" ? 2 : 1,
  upiLines: [{ id: id(80), txnAt: "2026-10-10T05:00:00Z", amount: 12345, payer: "OPS Synthetic payer", utr: "OPS123456789", state: "matched", receipt: { id: id(81), receiptNumber: "OPS-UPI-1", studentName: longName, classLabel: "OPS Synthetic Class", amount: 12345, paymentDate: "2026-10-10" }, suggestions: [] }],
  advances: [{ studentId: id(90), studentName: longName, fatherName: "OPS Synthetic guardian", classLabel: "OPS Synthetic Class", credit: 1000, refundable: 1000 }], feeRefunds: [],
  requests: [{ id: id(91), kind: "refund", title: "OPS Synthetic request", reason: "Synthetic refund request only; no transfer", amount: 100, studentId: id(90), studentName: longName, receiptId: null, requestedAt: "2026-10-10T05:00:00Z", requestedByName: "OPS Accountant", mine: true, status: "waiting", remindedAt: null, decidedAt: null, decidedByName: null, decisionNote: null, withdrawnAt: null, canRemind: true }],
};

const home: AccountsHomeData = {
  today: data.today, tomorrow: "2026-10-12", sessionLabel: data.sessionLabel,
  collected: { total: 300, count: 2, lastAt: "2026-10-11T10:00:00Z", modes: [{ mode: "cash", total: 100, count: 1 }, { mode: "upi", total: 200, count: 1 }], spark: { line: "0,58 100,6", area: "0,58 100,6 100,58", endY: 6 }, usual: null, vsUsual: null, reversedCount: 0 },
  closure: { status: "closed", closedAt: "2026-10-11T10:00:00Z", closedByName: "OPS Accountant" },
  queue: [], followUpsToday: { count: 0, next: null }, chequesToDeposit: { count: 0, total: 0 }, upiOpen: { count: 0, total: 0 }, requests: [], reminders: { paused: true, familiesPendingToday: 0, nextInstallment: null }, cashExpected: { total: 100, count: 1 }, tomorrowFollowUps: [], chequesForBank: [],
};
createRoot(document.getElementById("root")!).render(<LanguageProvider language={language}><ToastProvider>{params.get("screen") === "home" ? <AccountsHome data={home} view={params.get("evening") === "true" ? "evening" : "home"} greet="Good evening" staffName="OPS Accountant" canCollect canAccounts canManage={false} readOnly={params.has("readonly")} /> : <Books data={data} initialView={view as BooksView} initialSheet="" initialPick={[]} initialReceipt={null} staffName="OPS Accountant" readOnly={params.has("readonly")} />}</ToastProvider></LanguageProvider>);
