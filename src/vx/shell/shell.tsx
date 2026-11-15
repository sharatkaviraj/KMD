import { approvedStaffPhotos } from "@/modules/collection/data/approved-photos";
import { assistFeaturesFor } from "@/modules/assist/data/settings";
import { Suspense, type ReactNode } from "react";

import { getDuesBadgeCount } from "@/modules/dashboard/data/shell-metrics";
import { waitingChatsFor, type WaitingChats } from "@/modules/chats/data/list";
import { viewerFor } from "@/modules/chats/data/people";
import { viewingTestSession } from "@/platform/auth/staff-scope";
import { SessionSwitchingProvider } from "@/modules/fees/platform/session-context/switching-context";
import { can, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import { CACHE_TAGS, sharedCache } from "@/platform/performance/shared-cache";
import { OfficeSyncListener } from "@/ui/shell/office-sync-listener";
import { RouteProgress } from "@/ui/shell/route-progress";
import { SessionSwitchOverlayMount } from "@/ui/shell/session-switch-overlay";
import { createAdminClient } from "@/platform/supabase/admin";
import { initials, schoolToday } from "@/vx/format";
import { inboxCount, moneyRequestsFor } from "@/vx/screens/admin/data";
import { schoolMinutes } from "@/vx/screens/admin/logic";
import { schoolNow } from "@/platform/auth/qa-clock";
import { bottomFor, groupsFor, MENU_HOME, MENU_LABEL, PREVIEW_LABEL, ROLE_PREVIEW_MENUS } from "@/vx/nav";
import { lead } from "@/vx/text";
import { NavTrail } from "@/vx/ui/back-link";
import { avatarColor } from "@/vx/ui/primitives";
import { ToastProvider } from "@/vx/ui/overlays";
import { previewPermissions, rolePreviewOf, type Viewer } from "@/vx/view-as";
import { OfflineBanner } from "@/vx/screens/system/offline-banner";
import { SessionExpiredSheet } from "@/vx/screens/system/session-expired";
import { UpdateBanner } from "@/vx/screens/system/update-banner";
import type { SessionSwitcherData } from "@/modules/fees/platform/session-context/switcher";
import { testSessionMessages } from "@/messages/setup";
import { flat } from "@/platform/i18n/language";
import { LanguageProvider } from "@/platform/i18n/use-language";

import { AssistProvider } from "@/vx/assist/context";
import { coverPhotoEnabled } from "@/lib/ai/access";

import { encodeHomeHint } from "@/platform/auth/home-hint";
import { homeHintFor } from "@/vx/home-redirect";

import { VxBottomBar } from "./bottom-bar";
import { HomeHint } from "./home-hint";
import type { BubbleState } from "./chat-bubble-logic";
import { LiveChatScope } from "./chat-live";
import { LazyChatBubble, LazyPersonBanner, LazyPreviewBanner, LazyPreviewLinks, LazySearchPalette } from "./lazy";
import { OpeningNote } from "./opening-note";
import type { PaletteItem } from "./palette";
import { SessionBar } from "./session-bar";
import { menuRoleLabel, ROLE_SUB } from "./role-line";
import type { PreviewMenu } from "./preview-links";
import { VxSidebar, type Badges } from "./sidebar";
import { needsBadgeCount } from "@/modules/needs-you/data/store";
import { sessionText } from "@/platform/helpers/session-text";

const PREVIEW_ICON = { teacher: "grad", accountant: "rupee", academic: "trend", exam: "award" } as const;
const CHOOSE_PERSON = { en: "Choose a person", hi: "व्यक्ति चुनें" };

/**
 * Where the person at the foot of the sidebar leads: their own settings, as
 * the design links it (admin → Settings, teacher → More, the others → their
 * Menu, which holds dark mode, Hindi labels, session, password and sign out).
 */
function meHref(role: StaffRole, settings: boolean): string {
  if (settings) return "/settings";
  if (role === "teacher") return "/teach/more?view=profile";
  return "/menu";
}

/** The menus with a Needs you list of their own; the admin's and coordinators' is the inbox. */
const NEEDS_MENUS: ReadonlySet<string> = new Set(["teacher", "accountant", "exam"]);

async function loadBadges(viewer: Viewer, sessionLabel: string, waitingChats: Promise<WaitingChats | null>): Promise<Badges> {
  const out: Badges = {};
  const [dues, inbox, needs, chats] = await Promise.all([
    can(viewer.staff, "fees:view") && sessionLabel ? getDuesBadgeCount(sessionLabel) : null,
    // The admin queue, counted from the same reads the Needs you page uses —
    // in the same request on Today and Needs you, so it is free there (perf fixes 1, 2).
    // Seeing One as a person counts theirs; a role preview has no queue (D-544).
    !rolePreviewOf(viewer) && can(viewer.staff, "attendance:correct") && sessionLabel
      ? schoolNow(viewer.staff)
          // The badge reads the reader's clock, as Needs you itself does, so a
          // lab seat never sees a count the list disagrees with (smoke 20 Oct).
          .then((now) => inboxCount(viewer.staff, sessionLabel, schoolToday(now), moneyRequestsFor(viewer.staff, sessionLabel), schoolMinutes(now)))
          .catch(() => null)
      : null,
    // Needs you's count (D-630): today's jobs in Do now and Today, as the list last saw them.
    // One indexed count; a role preview has no list of its own.
    !rolePreviewOf(viewer) && NEEDS_MENUS.has(viewer.menu) && sessionLabel
      ? schoolNow(viewer.staff)
          .then((now) => needsBadgeCount(viewer.staff.id, sessionLabel, schoolToday(now), now))
          .catch(() => null)
      : null,
    // Parents waiting for this person's reply (D-618), the same count the
    // chat bubble keeps fresh (one read for both, D-641).
    waitingChats.then((w) => w?.count ?? null),
  ]);
  if (dues !== null) out.dues = dues;
  if (inbox !== null) out.inbox = inbox;
  if (needs !== null) out.needs = needs;
  if (chats !== null) out.chats = chats;
  return out;
}

/**
 * "Large text" from Settings or the teacher's More tab, applied to every screen.
 *
 * Every full load and every refresh waited on this read before drawing the
 * frame (perf fix 10). Cached per staff id — the id is the key, so nobody
 * gets another person's setting — and both places that save it expire the tag.
 */
const prefersLargeText = sharedCache(
  async (staffProfileId: string): Promise<boolean> => {
    const { data, error } = await createAdminClient()
      .from("staff_ui_preferences")
      .select("large_text")
      .eq("staff_profile_id", staffProfileId)
      .maybeSingle<{ large_text: boolean }>();
    if (error) throw new Error(error.message);
    return data?.large_text === true;
  },
  ["vx-large-text"],
  { tags: [CACHE_TAGS.uiPrefs], revalidate: 300 },
);

/**
 * Whether a teacher is class teacher of any class this session. A subject
 * teacher's big middle button used to open Attendance and say "You do not
 * take attendance" (UX review 6 Nov 2026); without a class it opens Marks.
 * Cached per staff id and session; a new assignment shows within 5 minutes.
 */
const teachesAClass = sharedCache(
  async (staffProfileId: string, sessionLabel: string): Promise<boolean> => {
    const { data, error } = await createAdminClient()
      .from("class_teachers")
      .select("class_id")
      .eq("session_label", sessionLabel)
      .eq("staff_profile_id", staffProfileId)
      .eq("role", "class_teacher")
      .is("effective_to", null)
      .limit(1)
      .returns<{ class_id: string }[]>();
    if (error) throw new Error(error.message);
    return data.length > 0;
  },
  ["vx-teaches-a-class"],
  { tags: [CACHE_TAGS.classes], revalidate: 300 },
);

/**
 * The one frame every signed-in screen sits in (PLAN A.5, docs/ui/DECISIONS.md
 * UI-8): sidebar from 900px, bottom bar below it, the search palette, toasts
 * and the overlay layer. Screens draw their own top bar inside `VxPage`.
 */
export async function VxShell({
  viewer,
  sessionLabel,
  sessionIsTest,
  sessionPill = null,
  rosterStatus,
  children,
}: {
  viewer: Viewer;
  sessionLabel: string;
  sessionIsTest: boolean;
  /** The session pill, for a viewer allowed to switch (layout decides); null hides it. */
  sessionPill?: { showLive: boolean; sessions: Promise<SessionSwitcherData> } | null;
  rosterStatus?: ReactNode;
  children: ReactNode;
}) {
  const { staff, menu, previewing } = viewer;
  // A role preview draws that role's sample permissions; seeing One as a
  // person draws the person's own, which are real (D-544).
  const rolePreview = rolePreviewOf(viewer);
  // Every read at once: every full page load waits on this frame, and these
  // four used to run as three waves (6 Nov 2026, docs/ui/PERFORMANCE.md).
  const previewPermsRead = rolePreview ? previewPermissions(rolePreview) : Promise.resolve(null);
  // Parents waiting (D-618, D-641): the chat bubble on every screen, for the
  // people who answer them. Seeing One as a person shows theirs, look-only
  // (the owner, 15 Nov: "viewing as a teacher… it doesn't appear as a
  // pop-up"); a role preview has no chats of its own.
  const chatsBubble = !rolePreview && (can(staff, "chats:reply") || can(staff, "chats:all"));
  const waitingChats: Promise<WaitingChats | null> = chatsBubble
    ? viewingTestSession()
        .then((test) => waitingChatsFor(viewerFor(staff, test)))
        .catch(() => null)
    : Promise.resolve(null);
  // Whether a chat can land on this person's own desk: the admins, the fee
  // desk, the office, and a class teacher. Anybody else (a subject teacher, a
  // coordinator without a class) gets the bubble only while a parent is
  // actually waiting for them, never as an empty bubble on every screen.
  const ownDesk = can(staff, "chats:all") || can(staff, "fees:collect") || staff.role === "office";
  // A failed read keeps the attendance button and the bubble: the old behaviour, never a missing one.
  const classTeacher: Promise<boolean> =
    !rolePreview && sessionLabel && (menu === "teacher" || (chatsBubble && !ownDesk)) ? teachesAClass(staff.id, sessionLabel).catch(() => true) : Promise.resolve(true);
  const [previewPerms, large, assist, portrait, teacherHasClass] = await Promise.all([
    previewPermsRead,
    prefersLargeText(staff.id).catch(() => false),
    // The AI helper's features for this person (D-324), when a provider is configured.
    // None while seeing One as somebody else: it would ask, and spend, as them (D-544).
    viewer.person
      ? Promise.resolve([])
      : previewPermsRead
          .then((perms) => assistFeaturesFor(staff, perms ? (p: StaffPermission) => perms.has(p) : undefined))
          .catch(() => []),
    approvedStaffPhotos([staff.id]).catch(() => new Map<string, string>()),
    menu === "teacher" ? classTeacher : true,
  ]);
  const allowed = (p: StaffPermission) => (previewPerms ? previewPerms.has(p) : can(staff, p));

  const groups = groupsFor(menu, allowed);
  const tabs = bottomFor(menu, allowed, { teacherHasClass });
  // The "+" sheet's Quick substitute (photo and Bolo): never while previewing another role.
  const coverAi = !previewing && coverPhotoEnabled(staff, sessionLabel || null);
  const badges = loadBadges(viewer, sessionLabel, waitingChats);
  const bubble: Promise<BubbleState> | null = chatsBubble
    ? Promise.all([waitingChats, ownDesk || classTeacher]).then(([waiting, desk]) => ({
        waiting: waiting?.count ?? 0,
        // A failed count keeps the bubble (it asks again itself); chats switched off take it away.
        enabled: waiting ? waiting.enabled : true,
        hasDesk: desk,
      }))
    : null;
  // Whose chat number the bubble, the menus and Chats keep fresh (D-642): the
  // person (seeing One as somebody else changes it) and the year. Moving
  // between them draws a new shell without loading the page again; a number
  // looked up for one is never shown for the other, and the bubble starts
  // afresh, with that person's card.
  const chatScope = `${staff.id}|${sessionLabel}|${rolePreview ?? ""}`;
  const fees = can(staff, "fees:view");
  const homeHint = homeHintFor(viewer);

  // A rehearsal session says so on the role line, which is where the session is named now.
  const testMark = sessionIsTest && !/test/i.test(sessionLabel) ? " · test" : "";
  const roleLine = `${menuRoleLabel(menu, staff.role, rolePreview).en}${sessionLabel ? ` · ${sessionText(sessionLabel)}${testMark}` : ""}`;
  const settings = can(staff, "settings:manage");
  const me = {
    photo: portrait.get(staff.id) ?? null,
    initials: initials(staff.displayName),
    name: staff.displayName,
    sub: lead(ROLE_SUB[staff.role], staff.language),
    href: meHref(staff.role, settings),
    color: avatarColor(staff.displayName),
  };
  const previewMenus: PreviewMenu[] =
    staff.role === "admin"
      ? [
          // One real member of staff's own One first, then the roles' samples (D-544).
          ...(staff.smokeLab ? [] : [{ key: "person", label: CHOOSE_PERSON, icon: "users" as const }]),
          ...ROLE_PREVIEW_MENUS.filter((m): m is Exclude<typeof m, "admin"> => m !== "admin").map((m) => ({ key: m, label: PREVIEW_LABEL[m], icon: PREVIEW_ICON[m] })),
        ]
      : [];

  const palette: PaletteItem[] = groups.flatMap((g) =>
    g.items.map((i) => ({ label: i.label, icon: i.icon, href: i.href, group: g.title?.en ?? "" })),
  );

  return (
    <SessionSwitchingProvider>
      <ToastProvider>
        <AssistProvider features={assist}>
        <LiveChatScope who={chatScope}>
        <Suspense fallback={null}>
          <RouteProgress />
          <OpeningNote />
          <NavTrail />
          {fees ? <OfficeSyncListener sessionLabel={sessionLabel} /> : null}
        </Suspense>
        <HomeHint value={homeHint ? encodeHomeHint(staff.userId, homeHint) : null} />
        <a href="#vx-main" className="vx-skip">Skip to content</a>
        <div className={`vxt vx-shell${large ? " vx-large" : ""}`}>
          <VxSidebar
            groups={groups}
            me={me}
            roleLine={roleLine}
            sessionHref={fees ? "/preferences/session" : undefined}
            home={MENU_HOME[menu]}
            badges={badges}
            teacherSized={menu === "teacher"}
            preview={previewMenus.length ? <LazyPreviewLinks menus={previewMenus} previewing={rolePreview} /> : null}
            previewing={rolePreview}
          />
          <div className="vx-content">
            <OfflineBanner />
            <SessionSwitchOverlayMount />
            {viewer.person ? (
              // In the administrator's language, whatever the person reads in (D-544).
              <LanguageProvider language={viewer.person.actor.language}>
                <LazyPersonBanner
                  name={staff.displayName}
                  role={ROLE_SUB[staff.role]}
                  photo={me.photo}
                  initials={me.initials}
                  shown={staff.language}
                  own={staff.ownLanguage ?? staff.language}
                  mine={viewer.person.actor.language}
                />
              </LanguageProvider>
            ) : previewing ? (
              <LazyPreviewBanner label={MENU_LABEL[previewing]} />
            ) : null}
            {staff.confined ? (
              // A Preview or local deployment on the production database:
              // everybody is fenced to TEST here, an admin included (D-346).
              <div className="vx-confined" role="status">{flat(testSessionMessages.confinedBanner, staff.language)}</div>
            ) : null}
            {sessionPill || rosterStatus ? <div className="vx-workspace-bar">
              {rosterStatus ?? <span className="vx-workspace-label">{flat({ en: "Academic session", hi: "शैक्षणिक सत्र" }, staff.language)}</span>}
              {sessionPill ? <SessionBar label={sessionLabel} isTest={sessionIsTest} showLive={sessionPill.showLive} sessions={sessionPill.sessions} /> : null}
            </div> : null}
            {bubble ? (
              <Suspense fallback={null}>
                <LazyChatBubble key={chatScope} state={bubble} since={new Date().toISOString()} lookOnly={viewer.person !== null} />
              </Suspense>
            ) : null}
            <main id="vx-main" className="vx-main vx-reset">
              {children}
            </main>
          </div>
          <VxBottomBar tabs={tabs} badges={badges} coverAi={coverAi} />
        </div>
        <LazySearchPalette items={palette} />
        <UpdateBanner />
        <SessionExpiredSheet />
        <div id="vx-layer" className="vxt vx-layer" />
        </LiveChatScope>
        </AssistProvider>
      </ToastProvider>
    </SessionSwitchingProvider>
  );
}
