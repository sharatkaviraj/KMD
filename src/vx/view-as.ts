import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { requireStaff, type CurrentStaff } from "@/platform/auth/current-staff";
import { effectivePermissions, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import { VIEW_AS_READ_ONLY } from "@/platform/auth/view-as-requests";
import { flat } from "@/platform/i18n/language";
import { createAdminClient } from "@/platform/supabase/admin";
import { designMenuFor, ROLE_PREVIEW_MENUS, type DesignMenu } from "@/vx/nav";

export const VIEW_AS_COOKIE = "vx_view_as";

export type Viewer = {
  /**
   * The person the screens are drawn for. Normally the person signed in;
   * while an administrator sees One as a chosen member of staff (D-544), that
   * person — their role, permissions, classes and language — with
   * `staff.viewedBy` holding the administrator.
   */
  staff: CurrentStaff;
  /** The menu the shell draws: their own, or the one an admin is previewing. */
  menu: DesignMenu;
  /**
   * Set while nothing may be saved from this screen: an administrator seeing
   * the app as another role, or as another person (then it is that person's
   * own menu). Screens hide or disable their write buttons on it.
   */
  previewing: DesignMenu | null;
  /** Set while an administrator sees One as a chosen person: who is looking. */
  person: { actor: CurrentStaff } | null;
};

/** Who is looking, and through which role's eyes (PLAN A.7). Once per request. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const staff = await requireStaff();
  const own = designMenuFor(staff.role);
  if (staff.viewedBy) return { staff, menu: own, previewing: own, person: { actor: staff.viewedBy } };
  if (staff.role !== "admin") return { staff, menu: own, previewing: null, person: null };
  const raw = (await cookies()).get(VIEW_AS_COOKIE)?.value ?? "";
  const previewing = (ROLE_PREVIEW_MENUS as string[]).includes(raw) ? (raw as DesignMenu) : null;
  return { staff, menu: previewing ?? own, previewing, person: null };
});

/**
 * The role an administrator is previewing *without* a person: the menu whose
 * permissions stand in for the signed-in administrator's own. Null while
 * seeing One as a chosen person, whose own permissions are already on
 * `viewer.staff` — the office and view-only accounts draw the admin's menu,
 * and reading their permissions back from that menu would hand them the
 * administrator's.
 */
export function rolePreviewOf(viewer: Pick<Viewer, "previewing" | "person">): DesignMenu | null {
  return viewer.person ? null : viewer.previewing;
}

/**
 * Top of every write on a vx screen. A previewed screen is read-only: the
 * admin sees what a teacher sees and cannot act as one — whether they chose a
 * role (`vx_view_as`) or a person (`vx_view_person`, D-544). The data clients
 * refuse writes in the second case too (`platform/supabase/view-as-guard.ts`);
 * this is the clear message ahead of them.
 */
export async function assertNotPreviewing(): Promise<void> {
  const staff = await requireStaff();
  // In the administrator's language: they are the one reading it.
  if (staff.viewedBy) throw new Error(flat(VIEW_AS_READ_ONLY, staff.viewedBy.language));
  if (staff.role !== "admin") return;
  const raw = (await cookies()).get(VIEW_AS_COOKIE)?.value ?? "";
  if ((ROLE_PREVIEW_MENUS as string[]).includes(raw)) {
    throw new Error("You are seeing the app as another role. Switch back to make changes.");
  }
}

export const PREVIEW_ROLE: Record<DesignMenu, StaffRole> = {
  admin: "admin",
  teacher: "teacher",
  accountant: "accountant",
  academic: "academic_coordinator",
  exam: "exam_coordinator",
};

/**
 * What "See the app as" shows: the previewed role's permissions as the
 * editable matrix (`vppsone.role_permissions`) has them, so a change on the
 * Staff screen shows up in the preview. Falls back to the built-in map.
 */
export const previewPermissions = cache(async (menu: DesignMenu): Promise<Set<StaffPermission>> => {
  const role = PREVIEW_ROLE[menu];
  const { data, error } = await createAdminClient()
    .from("role_permissions")
    .select("permission")
    .eq("role", role)
    .returns<{ permission: string }[]>();
  const rows = !error && data && data.length > 0 ? data.map((row) => row.permission) : null;
  return new Set(effectivePermissions({ role, permissions: rows }));
});
