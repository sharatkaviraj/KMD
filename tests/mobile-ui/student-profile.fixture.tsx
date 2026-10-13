import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { Student360, Student360Backdrop, type Student360Props } from "@/vx/screens/admin/student360";
import { StudentsScreen, type StudentsProps } from "@/vx/screens/admin/students";
import { NavTrail } from "@/vx/ui/back-link";
import { VxPage } from "@/vx/ui/page";
import { ToastProvider } from "@/vx/ui/overlays";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

const params = new URLSearchParams(location.search);
const language = params.get("locale") === "hi" ? "hi" : params.get("locale") === "hi-en" ? "both" : "en";
const state = params.get("state");
const schoolOnly = params.get("role") === "teacher";
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");
const id = "00000000-0000-4000-8000-000000000001";
const returnTo = "/students?q=Test&class=qa&view=school&page=2";
const portrait = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect fill="#cee8ec" width="96" height="96"/><circle fill="#90bcc6" cx="48" cy="35" r="17"/><path fill="#3d7284" d="M14 96c0-28 14-42 34-42s34 14 34 42"/></svg>');
const p: Student360Props = {
  id, returnTo, name: "Aarav Test", classLabel: "Class 7 · A", sr: "TEST-071", rollNo: "12", status: "active",
  photoUrl: schoolOnly || state === "no-photo" ? null : state === "failed-photo" ? "/synthetic-missing-photo.png" : portrait,
  father: "Synthetic Father", mother: "Synthetic Mother", phone: "9999999999", address: "Synthetic locality", dob: null, joined: null, route: "Route A",
  tab: "overview", tabs: schoolOnly ? ["overview", "attendance", "marks", "notes", "info"] : ["overview", "fees", "attendance", "marks", "family", "documents", "notes", "history", "info"],
  money: schoolOnly ? null : { pendingToday: 2400, notDueYet: 6000, lateFee: 100, paid: 9600, total: 18000, percent: 53 },
  installments: schoolOnly ? null : [{ id: "synthetic-dues", label: "October", dueDate: "2026-10-01", state: "overdue", status: "partial", pending: 2400, settled: 3600, paid: 3600, receiptedHere: 3600, adjusted: 0, base: 6000, lateFee: 100, lateFeeWaived: 0, lateFeePending: 100, carry: false }],
  feeSummary: schoolOnly ? null : { outstanding: 8400, overdue: 2400, lateFeePending: 100, lateFeeWaived: 0, paidThisSession: 9000, discountClosed: 600, sessionFee: 18000, creditBalance: 0, installmentsPaid: 1, installmentsTotal: 3, installmentsPending: 2, nextDue: { label: "November", amount: 6000, dueDate: "2026-11-01" } },
  feeBreakup: schoolOnly ? null : { rows: [{ id: "tuition", label: "Tuition", amount: 18600, kind: "charge" }, { id: "discount", label: "Synthetic sibling concession", amount: -600, kind: "discount" }], annualTotal: 18000, discountTotal: 600, discountLabels: ["Sibling concession"], tuitionOverride: null, transportOverride: null },
  feeSession: schoolOnly ? null : "2026-27", receipts: [], family: schoolOnly ? null : [{ id: "00000000-0000-4000-8000-000000000002", name: "Synthetic Sibling", sr: "TEST-072", classLabel: "Class 5", self: false }],
  attendance: { percent: 90, counted: 20, counts: { present: 17, absent: 2, half_day: 0, late: 1, leave: 0 }, weeks: [] },
  terms: [{ term: "SA1", percent: 74, grade: "B", missing: 1, papers: 6, scored: 370, outOf: 500 }],
  documents: [], notes: [
    { id: "synthetic-strength", body: "Explains science ideas clearly and enjoys helping classmates.", tags: ["talent"], status: "open", needsFollowUp: false, followUpOn: null, followUpOwner: null, followUpName: null, by: "Synthetic Teacher", createdAt: "2026-10-10" },
    { id: "synthetic-support", body: "Practise reading aloud together for ten minutes, then review progress.", tags: ["studies"], status: "open", needsFollowUp: true, followUpOn: "2026-10-15", followUpOwner: "class_teacher", followUpName: "Synthetic Teacher", by: "Synthetic Teacher", createdAt: "2026-10-10", canWork: false },
  ], history: [], today: "2026-10-12", canCollect: !schoolOnly, canManageDocuments: !schoolOnly, canManageFees: !schoolOnly, canAddNote: true, contacts: [], contactRecoveryScope: { owner: "synthetic-staff", sessionLabel: "2026-27", previewing: true },
};
if (state === "empty") { p.notes = []; p.terms = []; p.attendance = { ...p.attendance, percent: null, counted: 0 }; }
if (state === "error") { p.unavailable = ["attendance", "marks", "notes", "contacts"]; p.contacts = null; }
const directory: StudentsProps = {
  session: "2026-27", rows: Array.from({ length: 24 }, (_, n) => ({ id: n === 16 ? id : `synthetic-${n}`, name: n === 16 ? p.name : `Test Child ${n + 1}`, sr: `TEST-${n + 1}`, classLabel: p.classLabel, rollNo: String(n + 1), route: null, parent: null, phone: null, money: null, facts: { attendance: null, siblings: 0, isNew: false, route: null, yearClear: false, emi: null, concessions: [] } })),
  total: 48, window: { page: 2, pages: 2, firstRow: 25, lastRow: 48 }, q: "Test", classId: "qa", view: "school", seg: "all", classes: [{ id: "qa", label: p.classLabel }], counts: null, seesMoney: !schoolOnly, attendanceRead: true, viewKey: "synthetic-staff", canCollect: false, canAdmit: false, canRemind: false, failed: false,
};
const subscribe = (fn: () => void) => { window.addEventListener("popstate", fn); return () => window.removeEventListener("popstate", fn); };
function Fixture() {
  const path = useSyncExternalStore(subscribe, () => location.pathname);
  return <LanguageProvider language={language}><ToastProvider><NavTrail />
    {path === "/payments" ? <main><h1>Synthetic payment entry</h1><p>No payment is posted in this fixture.</p><label>Amount<input aria-label="Synthetic amount" /></label></main>
      : path === "/students" ? <VxPage label="Synthetic student acceptance"><StudentsScreen {...directory} /></VxPage> : <><Student360Backdrop /><Student360 p={p} /></>}
  </ToastProvider></LanguageProvider>;
}
document.addEventListener("click", event => {
  const a = (event.target as Element).closest("a");
  const href = a?.getAttribute("href");
  if (!href || !href.startsWith("/") || event.defaultPrevented || (event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey) return;
  event.preventDefault(); history.pushState(null, "", href); window.scrollTo(0, 0); window.dispatchEvent(new PopStateEvent("popstate"));
});
createRoot(document.getElementById("root")!).render(<Fixture />);
