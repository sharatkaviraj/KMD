import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { requireStaff, type CurrentStaff } from "@/platform/auth/current-staff";
import { effectivePermissions, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import { createAdminClient } from "@/platform/supabase/admin";
import { designMenuFor, ROLE_PREVIEW_MENUS, type DesignMenu } from "@/vx/nav";

export const VIEW_AS_COOKIE = "vx_view_as";

export type Viewer = {
  /** The real person signed in. Every permission check uses this. */
  staff: CurrentStaff;
  /** The menu the shell draws: their own, or the one an admin is previewing. */
  menu: DesignMenu;
  /** Set while an administrator is seeing the app as another role. */
  previewing: DesignMenu | null;
};

/** Who is looking, and through which role's eyes (PLAN A.7). Once per request. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const staff = await requireStaff();
  const own = designMenuFor(staff.role);
  if (staff.role !== "admin") return { staff, menu: own, previewing: null };
  const raw = (await cookies()).get(VIEW_AS_COOKIE)?.value ?? "";
  const previewing = (ROLE_PREVIEW_MENUS as string[]).includes(raw) ? (raw as DesignMenu) : null;
  return { staff, menu: previewing ?? own, previewing };
});

/**
 * Top of every write on a vx screen. A previewed screen is read-only: the
 * admin sees what a teacher sees and cannot act as one.
 */
export async function assertNotPreviewing(): Promise<void> {
  const staff = await requireStaff();
  if (staff.role !== "admin") return;
  const raw = (await cookies()).get(VIEW_AS_COOKIE)?.value ?? "";
  if ((ROLE_PREVIEW_MENUS as string[]).includes(raw)) {
    throw new Error("You are seeing the app as another role. Switch back to make changes.");
  }
}

const PREVIEW_ROLE: Record<DesignMenu, StaffRole> = {
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
