import { createRoot } from "react-dom/client";
import { Suspense, use, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { SessionSwitchingProvider } from "@/modules/fees/platform/session-context/switching-context";
import { RosterStatusView } from "@/platform/fees-bridge/roster-status-view";
import { MobileSessionPill } from "@/ui/shell/mobile-session-pill";
import { SessionPill } from "@/ui/shell/session-pill";
import { ShellSessionPillSkeleton } from "@/ui/shell/shell-session-pill";
import { SessionSwitchOverlayMount } from "@/ui/shell/session-switch-overlay";
import { LedgerNotice } from "@/vx/shell/ledger-notice";
import { VxBottomBar } from "@/vx/shell/bottom-bar";
import { VxSidebar } from "@/vx/shell/sidebar";
import { bottomFor, groupsFor } from "@/vx/nav";
import { VxPage, TopBar, DataList } from "@/vx/ui/page";
import { Sheet, ToastProvider } from "@/vx/ui/overlays";
import { TodayScreen } from "@/vx/screens/admin/today";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";
import "../../src/vx/shell/session-controls.css";

const params = new URLSearchParams(location.search);
const language = params.get("locale") === "hi" ? "hi" : "en";
document.documentElement.lang = language;
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");
const currentLabel = params.get("label") ?? "2026-27";
const sessions = params.has("failed") || params.has("loading") || params.has("arrives") ? [] : [
  { id: "current", session_label: "2026-27", is_current: true, status: "active" },
  { id: "test", session_label: "TEST-2026-27", is_current: false, status: "active" },
  { id: "archive", session_label: "2025-26", is_current: false, status: "active" },
];
if (params.has("only-test")) sessions.splice(0, sessions.length, { id: "test", session_label: "TEST-2026-27", is_current: false, status: "active" });
if (sessions.length && !sessions.some(row => row.session_label === currentLabel)) sessions.push({ id: "long", session_label: currentLabel, is_current: false, status: "active" });
const catalogue = params.has("delayed") ? new Promise<typeof sessions>((resolve) => setTimeout(() => resolve(sessions), 1500)) : null;
function CataloguePill({ mobile }: { mobile?: boolean }) {
  const rows = catalogue ? use(catalogue) : sessions;
  const Component = mobile ? MobileSessionPill : SessionPill;
  return <Component currentLabel={currentLabel} isTest={currentLabel.startsWith("TEST")} initialSessions={rows} appearance="one" />;
}
const badges = Promise.resolve({});
const allowAll = () => true;

function Fixture() {
  const [sheet, setSheet] = useState(false);
  const isTest = currentLabel.startsWith("TEST");
  return <NextIntlClientProvider locale={language} messages={language === "hi" ? hi : en}>
    <LanguageProvider language={language}><SessionSwitchingProvider><ToastProvider>
      <div className="vxt vx-shell">
        <VxSidebar groups={groupsFor("admin", allowAll)} home="/" roleLine="Synthetic admin" me={{ initials: "QA", name: "Synthetic admin", sub: "QA", href: "/settings", color: "#81DAE4" }} badges={badges} teacherSized={false} previewMenus={[]} previewing={null} />
        <div className="vx-content">
          <div className="vx-workspace-bar">
            <RosterStatusView language={language} status={params.has("stale") ? "stale" : params.get("status") === "error" ? "error" : params.get("status") === "pending" ? "not_ready" : "ready"} checkedAt="2026-11-02T11:30:00.000Z" />
            <div className="vx-sessionbar" data-test-session={isTest ? "true" : undefined}>
              <div className="vx-sessionbar-d"><Suspense fallback={<ShellSessionPillSkeleton currentLabel={currentLabel} isTest={isTest} appearance="one" />}><CataloguePill /></Suspense></div>
              <div className="vx-sessionbar-m"><Suspense fallback={<ShellSessionPillSkeleton currentLabel={currentLabel} isTest={isTest} appearance="one" />}><CataloguePill mobile /></Suspense></div>
            </div>
          </div>
          <main id="vx-main" className="vx-main vx-reset">
            <VxPage label="Synthetic UI acceptance">
              {params.has("list") ? <><TopBar title="Students" mSub="Synthetic roster" mAction={<button className="tap icon-btn" aria-label="Open sheet" onClick={() => setSheet(true)}>+</button>} />
                <DataList rows={Array.from({length: 30}, (_, i) => ({ id: String(i), name: `Synthetic student ${i + 1}` }))} rowKey={row => row.id} columns={[{ key: "name", label: "Student", cell: row => row.name }]} /></> :
                <TodayScreen firstName="Test" greeting={{ en: "Good morning", hi: "सुप्रभात" }} dayLine="Monday, 2 November" today="2026-11-02" status={null} money={null} moneyFailed={false} attendance={{marked: 0, total: 19, percent: null, schoolOpen: true}} staffAway={0} cover={null} inbox={[]} timeline={[]} schedule={null} scheduleFailed={false} exceptions={{notMarked: [], cover: []}} support={null} actions={[]} links={{collect: false, reports: false, attendance: true, substitutions: true, review: false, timetable: false}} unavailable={false} roleLine={{en: "Admin", hi: "प्रशासक"}} me={{initials: "QA", href: "/settings"}} notice={<LedgerNotice language={language} />} />}
            </VxPage>
          </main>
        </div>
        <VxBottomBar tabs={bottomFor("admin", allowAll)} badges={badges} />
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Synthetic sheet"><input aria-label="Note" className="inp" /><button type="button">Done</button></Sheet>
      <div id="vx-layer" className="vxt vx-layer" />
      <SessionSwitchOverlayMount />
    </ToastProvider></SessionSwitchingProvider></LanguageProvider>
  </NextIntlClientProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
