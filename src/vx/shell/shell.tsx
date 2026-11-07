import { approvedStaffPhotos } from "@/modules/collection/data/approved-photos";
import { assistFeaturesFor } from "@/modules/assist/data/settings";
import { Suspense, type ReactNode } from "react";

import { getDuesBadgeCount } from "@/modules/dashboard/data/shell-metrics";
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
import { LazyPersonBanner, LazyPersonFrame, LazySearchPalette } from "./lazy";
import { OpeningNote } from "./opening-note";
import type { PaletteItem } from "./palette";
import { PreviewBanner } from "./preview-banner";
import { SessionBar } from "./session-bar";
import { menuRoleLabel, ROLE_SUB } from "./role-line";
import { VxSidebar, type Badges, type PreviewMenu } from "./sidebar";
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

async function loadBadges(viewer: Viewer, sessionLabel: string): Promise<Badges> {
  const out: Badges = {};
  const [dues, inbox] = await Promise.all([
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
  ]);
  if (dues !== null) out.dues = dues;
  if (inbox !== null) out.inbox = inbox;
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
    // A failed read keeps the attendance button: the old behaviour, never a missing one.
    menu === "teacher" && !rolePreview && sessionLabel ? teachesAClass(staff.id, sessionLabel).catch(() => true) : true,
  ]);
  const allowed = (p: StaffPermission) => (previewPerms ? previewPerms.has(p) : can(staff, p));

  const groups = groupsFor(menu, allowed);
  const tabs = bottomFor(menu, allowed, { teacherHasClass });
  // The "+" sheet's Quick substitute (photo and Bolo): never while previewing another role.
  const coverAi = !previewing && coverPhotoEnabled(staff, sessionLabel || null);
  const badges = loadBadges(viewer, sessionLabel);
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
            previewMenus={previewMenus}
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
              <PreviewBanner label={MENU_LABEL[previewing].en} />
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
        {viewer.person ? <LazyPersonFrame /> : null}
        </AssistProvider>
      </ToastProvider>
    </SessionSwitchingProvider>
  );
}
