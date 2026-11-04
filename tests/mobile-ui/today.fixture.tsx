import { LanguageProvider } from "@/platform/i18n/use-language";
import type { Language } from "@/platform/i18n/language";
import { scheduleNow, type ScheduleSlot } from "@/vx/screens/admin/schedule";
import { TodayScreen } from "@/vx/screens/admin/today";
import { ToastProvider } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";
import { QUICK_ACTIONS } from "@/vx/nav";
import "../../src/vx/vx.css";

/* Test data only: classes, subjects and teachers are invented. */

const CLASSES = ["Nursery", "LKG", "UKG", "1", "2", "3", "4", "5", "6A", "6B", "7A", "7B", "8A", "8B", "9A", "9B", "10A", "10B", "11 Sci", "11 Arts", "12 Sci", "12 Arts"];
const SUBJECTS = ["ENG", "HIN", "MATH", "SCI", "SST", "SKT", "COMP"];

const BELLS = Array.from({ length: 8 }, (_, index) => {
  const start = 7 * 60 + 45 + index * 40 + (index >= 4 ? 20 : 0);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { index, starts: hhmm(start), ends: hhmm(start + 40) };
});

function slotsFor(period: number): ScheduleSlot[] {
  const rows: ScheduleSlot[] = [];
  CLASSES.forEach((label, i) => {
    const classId = `c${i}`;
    if (label.startsWith("11")) {
      // One class split across subjects, each with its own teacher.
      rows.push({ period, classId, classLabel: label, subjectCode: "PHY", staffProfileId: `t-phy-${period}`, teacherShortName: "Test Physics", shared: false, parallel: true });
      rows.push({ period, classId, classLabel: label, subjectCode: "ACC", staffProfileId: `t-acc-${period}`, teacherShortName: "Test Accounts", shared: false, parallel: true });
      return;
    }
    if (label === "LKG" || label === "UKG") {
      // One teacher with several classes at once.
      rows.push({ period, classId, classLabel: label, subjectCode: "ELGA", staffProfileId: `t-elga`, teacherShortName: "Test ELGA Teacher", shared: false, parallel: false });
      return;
    }
    const subject = SUBJECTS[(i + period) % SUBJECTS.length];
    rows.push({ period, classId, classLabel: label, subjectCode: subject, staffProfileId: `t${(i * 3 + period) % 26}`, teacherShortName: `Teacher ${String.fromCharCode(65 + ((i * 3 + period) % 26))}`, shared: false, parallel: false });
  });
  return rows;
}

const SLOTS = [2, 3, 4].flatMap(slotsFor);
const NAMES = new Map(SLOTS.map((slot) => [slot.staffProfileId, `${slot.teacherShortName} Sharma`]));

export function TodayFixture({ language }: { language: Language }) {
  const params = new URLSearchParams(location.search);
  const at = params.get("at") ?? "10:05";
  // T03 states: `missing=refunds,submissions` (Needs you sources unread), `unread=board` (Today's own reads).
  const inboxMissing = (params.get("missing") ?? "").split(",").filter(Boolean);
  const todayMissing = (params.get("unread") ?? "").split(",").filter(Boolean);
  const role = params.get("desk");
  const actions = role === "admin" ? QUICK_ACTIONS.filter((action) => ["mark", "cover", "note", "certificate"].includes(action.key))
    : role === "office" ? QUICK_ACTIONS.filter((action) => action.key === "mark") : [];
  const [h, m] = at.split(":").map(Number);
  const schedule = scheduleNow({
    bells: BELLS,
    nowMinutes: h * 60 + m,
    schoolOpen: true,
    timetableRuns: true,
    slots: SLOTS,
    duties: [
      { period: 3, classIds: ["c9"], absentStaffIds: [SLOTS.find((s) => s.period === 3 && s.classId === "c9")!.staffProfileId], status: "needs_help", coveringStaffId: null },
      { period: 3, classIds: ["c14"], absentStaffIds: [SLOTS.find((s) => s.period === 3 && s.classId === "c14")!.staffProfileId], status: "assigned", coveringStaffId: "t20" },
    ],
    absences: [],
    names: NAMES,
    classRank: new Map(CLASSES.map((_, i) => [`c${i}`, i])),
  });
  return (
    <LanguageProvider language={language}>
      <ToastProvider>
        <VxPage label="Synthetic today">
          <TodayScreen
            firstName="Test"
            greeting={{ en: "Good morning", hi: "सुप्रभात" }}
            dayLine="Monday, 12 October"
            status={{ en: "Period 4 running", hi: "पीरियड 4 चल रहा है" }}
            today="2026-10-12"
            money={role === "admin" ? {
              today: 12800, receiptsToday: 7, days: [{ date: "2026-10-12", amount: 12800 }],
              modes: [{ mode: "upi", amount: 9800, receipts: 5 }, { mode: "cash", amount: 3000, receipts: 2 }],
              matrix: [], installments: [], expected: 180000, collected: 131000, dueSoFar: 150000, followUps: 6,
            } : null}
            moneyFailed={false}
            attendance={{ marked: 18, total: 22, percent: 91, schoolOpen: true }}
            staffAway={2}
            cover={{ missed: 0, needed: 2, arranged: 1 }}
            inbox={[]}
            inboxMissing={inboxMissing}
            todayMissing={todayMissing}
            timeline={[
              { time: "07:45", title: { en: "First bell" }, sub: { en: "Period 1 starts" }, state: "done" },
              { time: "08:25", title: { en: "Attendance closes" }, sub: { en: "4 not marked yet" }, state: "alert" },
              { time: "10:25", title: { en: "Period 4 · 6B MATH" }, sub: { en: "Needs a substitute" }, state: "now" },
              { time: "13:45", title: { en: "Last bell" }, state: "next" },
            ]}
            schedule={schedule}
            scheduleFailed={false}
            exceptions={todayMissing.includes("board") ? { notMarked: null, cover: null } : { notMarked: ["9A", "9B", "10A", "12 Arts"], cover: [] }}
            support={{ needsAction: 1, due: 1 }}
            actions={actions}
            links={{ collect: false, attendance: true, substitutions: true, review: inboxMissing.includes("submissions"), timetable: true }}
            unavailable={false}
          />
          <div id="vx-layer" />
        </VxPage>
      </ToastProvider>
    </LanguageProvider>
  );
}
