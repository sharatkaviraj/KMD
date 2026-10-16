import { createRoot } from "react-dom/client";
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../src/messages/en.json";
import { BulkStudentEditBar } from "@/modules/students-fees/ui/bulk-student-edit-bar";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { StudentsScreen, type StudentsProps } from "@/vx/screens/admin/students";
import { parseStudentFilters, quickSegment } from "@/vx/screens/admin/logic";
import { parseStudentLayout } from "@/vx/screens/admin/students-logic";
import { Student360, type Student360Props } from "@/vx/screens/admin/student360";
import { NavTrail } from "@/vx/ui/back-link";
import { VxPage } from "@/vx/ui/page";
import { usePathname, useSearchParams } from "./navigation";
import Link from "./link";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

const id = "00000000-0000-4000-8000-000000000101";
const card: Student360Props = {
  id, name: "QA Admin Child", classLabel: "QA Class", sr: "OPS-ADMIN-1", rollNo: "1", status: "active",
  father: null, mother: null, phone: null, address: null, dob: null, joined: null, route: null,
  tab: "overview", tabs: ["overview", "fees", "notes"], money: null, installments: null, feeSummary: null,
  feeBreakup: null, feeSession: null, receipts: null, family: null, attendance: { percent: null, counted: 0,
    counts: { present: 0, absent: 0, half_day: 0, late: 0, leave: 0 }, weeks: [] }, terms: [], documents: [],
  notes: [], history: [], today: "2026-10-11", canCollect: false, canManageDocuments: false,
  canManageFees: false, canAddNote: false, contacts: null,
};
function Fixture() {
  const path = usePathname();
  const params = useSearchParams();
  const [classicSelected, setClassicSelected] = useState(true);
  const language = params.get("locale") === "hi" ? "hi" : "en";
  const view = params.get("view") === "school" ? "school" : "fees";
  const props: StudentsProps = {
    session: "OPS-ADMIN-2026", rows: Array.from({ length: 12 }, (_, index) => ({
      id: index === 0 ? id : `00000000-0000-4000-8000-${String(index + 102).padStart(12, "0")}`,
      name: index === 0 ? card.name : `QA Admin Child ${index + 1}`, sr: `OPS-ADMIN-${index + 1}`,
      classLabel: "QA Class", rollNo: String(index + 1), route: "QA Bus", parent: null, phone: null,
      money: { pendingToday: 1234567, notDueYet: 7654321, lateFee: 25, percent: 5 },
      facts: { attendance: null, siblings: 0, isNew: false, route: "QA Bus", yearClear: false,
        emi: { status: "behind", monthly: 500, nextDue: "2026-10-01" }, concessions: ["QA Policy"] },
    })), total: 36, window: { page: 2, pages: 3, firstRow: 13, lastRow: 24 }, q: params.get("q") ?? "QA",
    classId: params.get("class") ?? "qa-class", view, seg: quickSegment(parseStudentFilters(params.get("seg"))),
    filters: view === "fees" ? parseStudentFilters(params.get("seg")) : [], layout: parseStudentLayout(params.get("look")) ?? "cards",
    classes: [{ id: "qa-class", label: "QA Class" }, { id: "qa-class-2", label: "Class 2" }],
    counts: { all: 36, pending: 36, late: 4 }, seesMoney: true, attendanceRead: true, viewKey: "qa-admin",
    canCollect: true, canAdmit: true, canRemind: true, failed: false,
  };
  if (params.get("screen") === "classic") return <NextIntlClientProvider locale="en" messages={en}>
    <main style={{ minHeight: "100dvh" }}><h1>Synthetic classic Fees list actions</h1>
      <BulkStudentEditBar selectedIds={classicSelected ? [id] : []} onClearSelection={() => setClassicSelected(false)}
        classOptions={[]} routeOptions={[]} reminders={{ action: async () => ({ status: "error", message: "Synthetic send refused" }),
          situationOptions: [], dates: { lastDate: "2026-11-01", today: "2026-10-11", runDateFreeSituations: [] } }} />
    </main>
  </NextIntlClientProvider>;
  return <LanguageProvider language={language}><NavTrail /><VxPage label="Synthetic admin operations">
    {path.startsWith(`/students/${id}`) ? <Student360 p={{ ...card, tab: params.get("tab") === "fees" ? "fees" : "overview", ...{ returnTo: params.get("returnTo") ?? undefined } }} />
      : path === "/notes" ? <main><h1>Synthetic notes detour</h1><Link href="/other">Synthetic other page</Link></main>
      : path === "/other" ? <main><h1>Synthetic other page</h1></main>
      : <StudentsScreen {...props} />}
  </VxPage><div id="vx-layer" className="vxt vx-layer" /></LanguageProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
