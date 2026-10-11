import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { ToastProvider } from "@/vx/ui/overlays";
import { TimetableScreen, type TimetableState } from "@/vx/screens/timetable/timetable-screen";
import type { TimetableData } from "@/vx/screens/timetable/data";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";
const requestedRole = new URLSearchParams(location.search).get("role");
if (requestedRole) sessionStorage.setItem("qa-academic-role", requestedRole);
const requestedMode = new URLSearchParams(location.search).get('uncertain');
if (requestedMode) sessionStorage.setItem('qa-cover-mode', requestedMode);
const subscribe = (cb: () => void) => { window.addEventListener("popstate", cb); return () => window.removeEventListener("popstate", cb); };
function Fixture() {
  useSyncExternalStore(subscribe, () => location.href);
  const q = new URLSearchParams(location.search);
  const mayEdit = sessionStorage.getItem("qa-academic-role") === "academic";
  const day = q.get("day") ?? "2026-10-12";
  const data: TimetableData = {
    sessionLabel: q.get('session') ?? "TEST-2026-27", today: "2026-10-12", week: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"],
    version: { id: "qa-version", label: "QA published timetable" },
    slots: [{ day: "Monday", period: 0, classId: "qa-class", classLabel: "QA Class", subjectId: "qa-math", subjectCode: "MATH", staffProfileId: "qa-teacher", teacherShortName: "QAT", parallel: false, shared: false }],
    changes: [{ id: "qa-pending", day: "Monday", period: 0, classId: "qa-class", classLabel: "QA Class", fromSubjectCode: "MATH", fromTeacher: "QAT", subjectId: "qa-science", subjectCode: "SCI", staffProfileId: "qa-helper", teacherShortName: "QAH", createdBy: "QA Coordinator", createdAt: "2026-10-11" }],
    classes: [{ id: "qa-class", label: "QA Class", classTeacher: "QA Teacher" }],
    teachers: [{ id: "qa-teacher", name: "QA Teacher", shortName: "QAT" }, { id: "qa-helper", name: "QA Helper", shortName: "QAH" }],
    subjects: [{ id: "qa-math", code: "MATH", name: "Published Maths" }, { id: "qa-science", code: "SCI", name: "Pending Science" }],
    bells: [{ index: 0, starts: "09:00", ends: "09:40" }], leave: [], subsThisWeek: {}, me: { id: q.get('owner') ?? "qa-teacher", mayEdit, mayCover: mayEdit, mayViewCover: true },
    cover: { day, dayRevision: 1, canCommand: mayEdit && q.get("noTimetable") !== "1", hasTimetable: q.get("noTimetable") !== "1", absences: [{ id: "qa-absence", staffId: "qa-teacher", name: "QA Teacher", periods: [0], reason: null }], staff: [{ id: "qa-teacher", name: "QA Teacher" }], duties: [{ id: "qa-duty", needKey: "qa-need", period: 0, classLabels: ["QA Class"], subjectCode: "MATH", status: "assigned", coveringStaffId: "qa-helper", coveringName: "QA Helper", suggestedStaffId: null, absentNames: ["QA Teacher"], reason: null, notice: "accepted", candidates: [{ id: "qa-helper", name: "QA Helper", detail: "Same subject", blocked: false, subsThisWeek: 0 }] }] },
  };
  const state: TimetableState = { view: (q.get("view") as TimetableState["view"]) ?? "class", classId: q.get("class") ?? "qa-class", teacherId: q.get("teacher") ?? "qa-teacher", cell: null, pick: null, duty: q.get("duty"), sheet: q.get("sheet") as TimetableState["sheet"] };
  return <LanguageProvider language={q.get('lang') === 'hi' ? 'hi' : 'en'}><ToastProvider><TimetableScreen data={data} state={state} previewing={q.get('preview') === '1'} /><output id="qa-command" aria-label="Synthetic command audit" /><output id="qa-ledger" aria-label="Synthetic saved effects" /></ToastProvider></LanguageProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
