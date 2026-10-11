import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { StudentsScreen, type StudentsProps } from "@/vx/screens/admin/students";
import { VxPage } from "@/vx/ui/page";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

const props: StudentsProps = {
  session: "OPS-EXPORT-2026", rows: [{
    id: "00000000-0000-4000-8000-000000000910", name: '=HYPERLINK("https://example.invalid","QA Export")',
    sr: "OPS-EXPORT-1", classLabel: "QA Class", rollNo: "1", route: "QA Bus", parent: null, phone: null,
    money: { pendingToday: 123, notDueYet: 456, lateFee: 0, percent: 5 },
    facts: { attendance: null, siblings: 0, isNew: false, route: "QA Bus", yearClear: false,
      emi: null, concessions: [] },
  }], total: 1, window: { page: 1, pages: 1, firstRow: 1, lastRow: 1 }, q: "", classId: "", view: "fees", seg: "all",
  classes: [], counts: { all: 1 }, seesMoney: true, attendanceRead: false, viewKey: "qa-export",
  canCollect: false, canAdmit: false, canRemind: false, failed: false,
};
createRoot(document.getElementById("root")!).render(<LanguageProvider language="en"><VxPage label="Synthetic export"><StudentsScreen {...props} /></VxPage></LanguageProvider>);
