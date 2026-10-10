import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { requireStaff, type CurrentStaff } from "@/platform/auth/current-staff";
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
