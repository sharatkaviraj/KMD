import type { Language } from "@/platform/i18n/language";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { GuidedCoverScreen } from "@/vx/screens/timetable/guided-cover";
import "../../src/vx/vx.css";

import { QA_ABSENT } from "./guided-cover-actions";

/* Review C01: the guided cover flow on synthetic teachers and classes. Test data only. */

const T = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const BELLS = Array.from({ length: 8 }, (_, index) => {
  const start = 7 * 60 + 45 + index * 40 + (index >= 4 ? 20 : 0);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { index, starts: hhmm(start), ends: hhmm(start + 40) };
});

export function GuidedCoverFixture({ language }: { language: Language }) {
  return (
    <LanguageProvider language={language}>
      <GuidedCoverScreen
        today="2026-11-03"
        subjects={{ MATHS: { en: "Maths", hi: "गणित" } }}
        previewing={false}
        initial={{ staffProfileId: null, periods: null, choices: [], autoPreview: false, fromDraft: false, draftMissing: false }}
        setup={{
          day: "2026-11-03",
          dayRevision: 4,
          blocked: null,
          bells: BELLS,
          openPeriods: [0, 1, 2, 3, 4, 5, 6, 7],
          teachers: [
            { id: QA_ABSENT, name: "Test Teacher Asha", lessons: [{ period: 0, classLabels: ["Class 6"], subjectCode: "MATHS" }, { period: 2, classLabels: ["Class 7"], subjectCode: "MATHS" }, { period: 5, classLabels: ["Class 9 Science", "Class 9 Arts"], subjectCode: "MATHS" }], away: null, onLeave: null },
            { id: T(11), name: "Test Teacher Meera", lessons: [], away: null, onLeave: null },
            { id: T(12), name: "Test Teacher Navin", lessons: [], away: null, onLeave: [4, 5, 6, 7] },
          ],
        }}
      />
      <div id="vx-layer" />
    </LanguageProvider>
  );
}
