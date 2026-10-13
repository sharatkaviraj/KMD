import type { ReactNode } from "react";

import { LoginForm } from "@/app/login/login-form";
import { LoginScreen } from "@/app/login/login-screen";
import type { Language } from "@/platform/i18n/language";
import { TodayScreen, type TodayProps } from "@/vx/screens/admin/today";
import { DeniedScreen } from "@/vx/screens/system/denied";
import { NotFoundScreen } from "@/vx/screens/system/not-found";
import { OfflineStrip } from "@/vx/screens/system/offline-banner";
import { PasswordScreen } from "@/vx/screens/system/password-screen";
import { ExpiredSheet } from "@/vx/screens/system/expired-sheet";
import { SessionScreen } from "@/vx/screens/system/session-screen";
import { UpdateToast } from "@/vx/screens/system/update-banner";
import { Section, TopBar, VxPage } from "@/vx/ui/page";

import type { DesignView } from "../design.fixture";

/*
 * Design fidelity views for Messages, Settings and Sign-in & app states
 * (design modules `Messages`, `Settings`, `Auth`). One view per frame, keyed
 * by the frame's name; the records copy the frame's sample data, which is
 * synthetic. Nothing here reaches a database.
 */

const params = new URLSearchParams(location.search);
const language: Language = params.get("locale") === "hi" ? "hi" : params.get("locale") === "hi-en" ? "both" : "en";

/** Sheets portal into `#vx-layer`, which the real shell mounts; the fixture's shell does not. */
function Layer({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <div id="vx-layer" className="vxt vx-layer" />
    </>
  );
}

/* ---------------------------------------------------------------- Auth */

const today: TodayProps = {
  firstName: "Janmejay",
  greeting: { en: "Good afternoon", hi: "नमस्कार" },
  dayLine: "Thu 8 Oct · 434 students · Half-yearly marks in progress",
  status: null,
  today: "2026-10-08",
  money: {
    today: 38400,
    receiptsToday: 14,
    days: [{ date: "2026-10-08", amount: 38400 }, { date: "2026-10-07", amount: 29100 }],
    modes: [{ mode: "upi", amount: 24400, receipts: 9 }, { mode: "cash", amount: 14000, receipts: 5 }],
    matrix: [],
    installments: [],
    expected: 1860000,
    collected: 1220000,
    dueSoFar: 1860000,
    followUps: 6,
  },
  moneyFailed: false,
  attendance: { marked: 17, total: 19, percent: 92, schoolOpen: true },
  staffAway: 1,
  cover: { needed: 2, arranged: 1 },
  inbox: [],
  timeline: [],
  schedule: null,
  scheduleFailed: false,
  exceptions: { notMarked: ["Class 9", "12 Arts"], cover: [] },
  support: null,
  actions: [],
  links: { collect: true, attendance: true, substitutions: true, review: true, timetable: true },
  unavailable: false,
};

const todayPage = () => <TodayScreen {...today} />;

const people = [
  { id: "js", initials: "JS", name: "Janmejay Singh", role: { en: "Admin", hi: "प्रशासक" }, phoneShown: "98290 ••512", callHref: "tel:+910000000000" },
  { id: "ns", initials: "NS", name: "Ms. Neelam Sharma", role: { en: "Accountant", hi: "लेखाकार" }, phoneShown: "98290 ••207", callHref: "tel:+910000000000" },
];

const sessions = [
  { label: "2026-27", current: true, status: "active" },
  { label: "2025-26", current: false, status: "closed" },
];
const roles = [
  { menu: "teacher", label: { en: "Teacher", hi: "अध्यापक" }, home: "/teach" },
  { menu: "accountant", label: { en: "Accounts", hi: "लेखा" }, home: "/accounts" },
  { menu: "academic", label: { en: "Academics", hi: "शैक्षणिक" }, home: "/academics" },
  { menu: "exam", label: { en: "Exams", hi: "परीक्षा" }, home: "/exam-office" },
];

const notFoundLinks = [
  { label: { en: "Receipts & day close", hi: "रसीदें" }, icon: "receipt" as const, href: "/receipts" },
  { label: { en: "Dues & calls", hi: "बकाया" }, icon: "phone" as const, href: "/dues" },
  { label: { en: "Reports", hi: "रिपोर्ट" }, icon: "chart" as const, href: "/reports" },
  { label: { en: "Exams & marks", hi: "परीक्षा" }, icon: "clipboard" as const, href: "/exams" },
  { label: { en: "Messages", hi: "संदेश" }, icon: "megaphone" as const, href: "/messages" },
  { label: { en: "Settings", hi: "सेटिंग्स" }, icon: "settings" as const, href: "/settings" },
];

const signIn = (initial?: Parameters<typeof LoginForm>[0]["initial"]) => (
  <LoginScreen language={language}>
    <LoginForm language={language} initial={initial} />
  </LoginScreen>
);

const wrongPassword = { status: "error" as const, message: { en: "That email and password do not match an account.", hi: "ईमेल या पासवर्ड गलत है।" } };

const authViews: Record<string, DesignView> = {
  Auth: { render: () => signIn(), bare: true },
  "M-Auth": { render: () => signIn(), bare: true },
  "M-Auth-Error": { render: () => signIn(wrongPassword), bare: true },
  "M-Auth-Password": {
    render: () => <PasswordScreen language={language} temporary phone="9829000512" initial={{ current: "Temp4821", next: "amet2026" }} />,
    path: "/preferences/password",
  },
  "M-Auth-Session": {
    render: () => <SessionScreen language={language} name="Janmejay" sessions={sessions} viewing="2026-27" roles={roles} previewing={null} home="/" />,
    path: "/preferences/session",
  },
  "M-Auth-Update": {
    render: () => (
      <>
        {todayPage()}
        <UpdateToast onUpdate={() => undefined} onLater={() => undefined} />
      </>
    ),
    path: "/",
  },
  "DX-Auth-Offline": {
    render: () => (
      <>
        <OfflineStrip offline onRetry={() => undefined} />
        {todayPage()}
      </>
    ),
    path: "/",
  },
  "DX-Auth-Denied": {
    render: () => (
      <VxPage>
        <TopBar crumb="No access" title="You can't open this page" mSub="No access for this role" mBack="/" />
        <main>
          <Section>
            <DeniedScreen
              language={language}
              me={{ name: "Office desk", role: { en: "Fee Collector", hi: "वसूली कर्मी" } }}
              roles={[{ en: "Admin", hi: "प्रशासक" }, { en: "Accountant", hi: "लेखाकार" }]}
              people={people}
              permission="fees:setup"
              home="/accounts"
              requestHref="https://wa.me/910000000000"
            />
          </Section>
        </main>
      </VxPage>
    ),
    path: "/fee-setup",
  },
  "DX-Auth-Expired": {
    render: () => (
      <Layer>
        {todayPage()}
        <ExpiredSheet open who={{ name: "Janmejay Singh", at: "2026-10-08T07:52:00+05:30" }} href="/login?reason=expired&next=%2F" />
      </Layer>
    ),
    path: "/",
  },
  "auth-notfound": {
    render: () => (
      <VxPage>
        <TopBar title="Page not found" mSub="An old or broken link" mBack="/" />
        <main>
          <Section>
            <NotFoundScreen language={language} links={notFoundLinks} home="/" />
          </Section>
        </main>
      </VxPage>
    ),
    path: "/",
  },
};

export const views: Record<string, DesignView> = {
  ...authViews,
};
