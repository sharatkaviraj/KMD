import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { Student360, type Student360Props } from "@/vx/screens/admin/student360";
import { VxPage } from "@/vx/ui/page";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

const id = "00000000-0000-4000-8000-000000000001";
// Simulate a cached server card: its original prop remains Overview after
// client tab replacement and departure. The URL is the current tab authority.
const p: Student360Props = {
  id, name: "QA Navigation Child", classLabel: "QA Class", sr: "QA-NAV-1", rollNo: "1", status: "active",
  father: null, mother: null, phone: null, address: null, dob: null, joined: null, route: null,
  tab: "overview", tabs: ["overview", "attendance", "marks", "notes", "documents", "history", "info"],
  money: null, installments: null, feeSummary: null, feeBreakup: null, feeSession: null, receipts: null, family: null,
  attendance: { percent: 90, counted: 10, counts: { present: 9, absent: 1, half_day: 0, late: 0, leave: 0 }, weeks: [] },
  terms: [], documents: [],
  notes: [{ id: "qa-navigation-note", body: "QA navigation observation", tags: ["studies"], status: "open", needsFollowUp: false, followUpOn: null, followUpOwner: null, followUpName: null, by: "QA Teacher", createdAt: "2026-10-11" }],
  history: [], today: "2026-10-11", canCollect: false, canManageDocuments: false, canManageFees: false, canAddNote: false, contacts: null,
};
const subscribe = (changed: () => void) => {
  window.addEventListener("popstate", changed);
  return () => window.removeEventListener("popstate", changed);
};
function Fixture() {
  const path = useSyncExternalStore(subscribe, () => location.pathname);
  return <LanguageProvider language="en">
    {path === "/notes" ? <main><h1>Synthetic notes board</h1><p>QA navigation observation</p></main> : <VxPage label="Synthetic Student 360"><Student360 p={p} /></VxPage>}
  </LanguageProvider>;
}
// Keep the real links and browser history, replacing only the server router.
document.addEventListener("click", (event) => {
  const anchor = (event.target as Element).closest("a");
  if (!anchor || !anchor.getAttribute("href")?.startsWith("/notes?")) return;
  event.preventDefault();
  history.pushState(null, "", anchor.href);
  window.dispatchEvent(new PopStateEvent("popstate"));
});
createRoot(document.getElementById("root")!).render(<Fixture />);
