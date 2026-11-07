"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { assertSignedInStaff, type CurrentStaff } from "@/platform/auth/current-staff";
import {
  encodeViewAsPerson,
  isUuid,
  VIEW_AS_LANGUAGE_COOKIE,
  VIEW_AS_PERSON_COOKIE,
  VIEW_AS_PERSON_MAX_AGE,
} from "@/platform/auth/view-as-cookie";
import { endViewAsPerson } from "@/platform/auth/view-as-session";
import type { Localized } from "@/platform/i18n/language";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import { mayViewAs } from "@/platform/auth/view-as-subject";
import { resolveStaffRole } from "@/platform/auth/permissions";
import { personHome } from "@/vx/home-redirect";
import { MENU_HOME, ROLE_PREVIEW_MENUS, type DesignMenu } from "@/vx/nav";
import { VIEW_AS_COOKIE } from "@/vx/view-as";

/**
 * "See the app as" (PLAN A.7) and "see One as a person" (D-544). Only an
 * administrator may switch, each switch is a cookie on their own browser, and
 * every write on a previewed screen is refused — by `assertNotPreviewing()`,
 * and while a person is chosen by the data clients themselves — so it can
 * show anything and change nothing.
 *
 * Every check here is on the person actually signed in (`assertSignedInStaff`):
 * while a person is chosen, the request's staff member is that person, who is
 * never an administrator.
 */
function onlyAnAdministrator(actor: CurrentStaff): CurrentStaff {
  if (actor.role !== "admin" || !actor.isActive || actor.smokeLab) {
    throw new Error("Only an administrator can see the app as somebody else.");
  }
  return actor;
}

export async function setViewAsAction(menu: string): Promise<string> {
  onlyAnAdministrator(await assertSignedInStaff());
  if (!(ROLE_PREVIEW_MENUS as string[]).includes(menu)) throw new Error("Unknown role.");
  await endViewAsPerson("switched");
  (await cookies()).set({ name: VIEW_AS_COOKIE, value: menu, path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 8 });
  revalidatePath("/", "layout");
  return MENU_HOME[menu as DesignMenu];
}

export async function clearViewAsAction(): Promise<string> {
  await assertSignedInStaff();
  (await cookies()).delete(VIEW_AS_COOKIE);
  await endViewAsPerson("back");
  revalidatePath("/", "layout");
  return "/";
}

export type ViewAsPersonResult = { ok: true; href: string } | { ok: false; message: Localized };

const REFUSED: Record<string, Localized> = {
  admin: {
    en: "Choose a member of staff who is not an administrator.",
    hi: "ऐसे स्टाफ़ सदस्य को चुनें जो प्रशासक न हो।",
  },
  inactive: {
    en: "That person is not an active member of staff any more.",
    hi: "यह व्यक्ति अब सक्रिय स्टाफ़ सदस्य नहीं है।",
  },
  test: {
    en: "A test account can only see One as another test account.",
    hi: "टेस्ट अकाउंट One को केवल दूसरे टेस्ट अकाउंट की तरह देख सकता है।",
  },
  failed: {
    en: "Could not open One as that person. Check the connection and try again.",
    hi: "उस व्यक्ति की तरह One नहीं खुल सका। कनेक्शन देखकर फिर कोशिश करें।",
  },
};

/** The database's refusal, as a sentence the administrator can act on. */
function refusalFor(message: string | undefined): Localized {
  const text = (message ?? "").toLowerCase();
  if (text.includes("not an administrator")) return REFUSED.admin;
  if (text.includes("not an active member")) return REFUSED.inactive;
  if (text.includes("test account")) return REFUSED.test;
  return REFUSED.failed;
}

/**
 * Start seeing One as `subjectId`. The database decides whether it may
 * (`vppsone.view_as_begin()`: an active administrator, an active person who is
 * not an administrator, a test administrator only as a test account), records
 * it in `vppsone.view_as_log` with a two-hour limit, and closes any view the
 * administrator already had open. Only then is the cookie set.
 */
export async function startViewAsPersonAction(subjectId: string): Promise<ViewAsPersonResult> {
  const actor = onlyAnAdministrator(await assertSignedInStaff());
  if (!isUuid(subjectId)) return { ok: false, message: REFUSED.failed };
  if (subjectId.toLowerCase() === actor.id.toLowerCase()) return { ok: false, message: REFUSED.admin };

  // The app's own rule first, for a clear sentence and for what the database
  // cannot see: on a Preview or local build every account is a test account.
  const { data: subject } = await createAdminClient()
    .from("staff_profiles")
    .select("id, role, is_active, is_test_account, preferred_start")
    .eq("id", subjectId)
    .maybeSingle<{ id: string; role: string | null; is_active: boolean; is_test_account: boolean | null; preferred_start: string | null }>();
  if (!subject || !subject.is_active) return { ok: false, message: REFUSED.inactive };
  if (!mayViewAs(actor, subject)) {
    return { ok: false, message: actor.isTestAccount && subject.is_test_account !== true ? REFUSED.test : REFUSED.admin };
  }

  const jar = await cookies();
  const { error } = await (await createClient(jar)).rpc("view_as_begin", { p_subject: subjectId });
  if (error) return { ok: false, message: refusalFor(error.message) };

  jar.delete(VIEW_AS_COOKIE);
  // Each person is first shown in their own language.
  jar.delete(VIEW_AS_LANGUAGE_COOKIE);
  jar.set({
    name: VIEW_AS_PERSON_COOKIE,
    value: encodeViewAsPerson(actor.userId, subjectId),
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: VIEW_AS_PERSON_MAX_AGE,
  });
  revalidatePath("/", "layout");
  // Straight to the screen their own One opens on: by way of `/` the router
  // renders a screen only to be sent on from it.
  return { ok: true, href: personHome({ role: resolveStaffRole(subject.role), preferredStart: subject.preferred_start }) };
}

/** Stop seeing One as somebody else and go back to the administrator's own screens. */
export async function endViewAsPersonAction(): Promise<string> {
  await assertSignedInStaff();
  await endViewAsPerson("back");
  revalidatePath("/", "layout");
  return "/";
}
