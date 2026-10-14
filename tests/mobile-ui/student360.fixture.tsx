import { useEffect, useState } from "react";
import { LanguageProvider } from "@/platform/i18n/use-language";
import type { Language } from "@/platform/i18n/language";
import { Student360, type Student360Fees, type Student360Props } from "@/vx/screens/admin/student360";
import "../../src/vx/vx.css";

const p: Student360Props = {
  id: "00000000-0000-4000-8000-000000000001", name: "QA Child", classLabel: "QA Class", sr: "QA-1", rollNo: "1", status: "active",
  father: null, mother: null, phone: null, address: null, dob: null, joined: null, route: null,
  tab: "overview", tabs: ["overview", "fees", "family", "attendance", "marks", "notes", "documents", "history", "info"],
  money: null, installments: null, feeSummary: null, feeBreakup: null, feeSession: null, receipts: null, family: null,
  attendance: { percent: 90, counted: 10, counts: { present: 9, absent: 1, half_day: 0, late: 0, leave: 0 }, weeks: [] },
  terms: [], documents: [],
  notes: [{ id: "qa-note", body: "QA school note", tags: ["talent"], status: "open", needsFollowUp: false, followUpOn: null, followUpOwner: null, followUpName: null, by: "QA Staff", createdAt: "2026-10-10" }],
  history: [], today: "2026-10-10", canCollect: false, canManageDocuments: false, canManageFees: false, canAddNote: false, contacts: null,
};
function read() {
  let resolve!: (value: Student360Fees | null) => void;
  let reject!: (error: Error) => void;
  const raw = new Promise<Student360Fees | null>((yes, no) => { resolve = yes; reject = no; });
  return { promise: raw.catch(() => ({ unavailable: true })), resolve, reject };
}
export function Student360Fixture({ language }: { language: Language }) {
  const [request, setRequest] = useState(read);
  useEffect(() => {
    const refresh = () => setRequest(read());
    window.addEventListener("qa:refresh", refresh); return () => window.removeEventListener("qa:refresh", refresh);
  }, []);
  return <LanguageProvider language={language}>
    <Student360 p={p} fees={request.promise} />
    {/* Above Student 360's full-screen layer, which is where the test reaches for them. */}
    <aside aria-label="Synthetic read controls" style={{ position: "fixed", top: 0, left: 0, zIndex: 100, padding: 4, display: "flex", gap: 4, opacity: 0.85 }}>
      <button onClick={() => request.resolve({ family: [{ id: "qa-sibling", name: "QA Sibling", sr: "QA-2", classLabel: "QA Class", self: false }] })}>Resolve fee read</button>
      <button onClick={() => request.reject(new Error("QA unavailable"))}>Fail fee read</button>
      <button onClick={() => request.resolve(null)}>Resolve empty fee read</button>
    </aside>
  </LanguageProvider>;
}
