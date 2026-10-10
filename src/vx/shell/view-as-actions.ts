"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { assertStaff } from "@/platform/auth/current-staff";
import { MENU_HOME, ROLE_PREVIEW_MENUS, type DesignMenu } from "@/vx/nav";
import { VIEW_AS_COOKIE } from "@/vx/view-as";

/**
 * "See the app as" (PLAN A.7). Only an administrator may switch, the switch is
 * a cookie on their own browser, and every write on a previewed screen is
 * refused by `assertNotPreviewing()` — so it can show anything and change
 * nothing.
 */
export async function setViewAsAction(menu: string): Promise<string> {
  const staff = await assertStaff();
  if (staff.role !== "admin") throw new Error("Only an administrator can see the app as another role.");
  if (!(ROLE_PREVIEW_MENUS as string[]).includes(menu)) throw new Error("Unknown role.");
  (await cookies()).set({ name: VIEW_AS_COOKIE, value: menu, path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 8 });
  revalidatePath("/", "layout");
  return MENU_HOME[menu as DesignMenu];
}

export async function clearViewAsAction(): Promise<string> {
  await assertStaff();
  (await cookies()).delete(VIEW_AS_COOKIE);
  revalidatePath("/", "layout");
  return "/";
}
