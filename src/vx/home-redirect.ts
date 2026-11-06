import { resolveStart } from "@/platform/config/start";
import type { StaffRole } from "@/platform/auth/permissions";
import { MENU_HOME, type DesignMenu } from "@/vx/nav";

/**
 * Where `/` sends this viewer, or null when `/` is their own screen (Today).
 *
 * One rule for two readers: the `/` page redirects by it, and the shell
 * remembers it in the home hint so the proxy can do the same redirect before
 * anything renders. Every other menu goes to its own home, unless the person
 * chose a start screen — except while an administrator previews another role,
 * when the previewed role's home is the answer.
 */
export function rootRedirectFor(viewer: {
  menu: DesignMenu;
  previewing: DesignMenu | null;
  staff: { role: StaffRole; preferredStart: string | null };
}): string | null {
  if (viewer.menu === "admin") return null;
  const chosen = viewer.previewing ? null : resolveStart(viewer.staff.role, viewer.staff.preferredStart)?.href;
  return chosen && chosen !== "/" ? chosen : MENU_HOME[viewer.menu];
}

/** What the home hint should say: never while previewing, whose `/` is the admin's own. */
export function homeHintFor(viewer: Parameters<typeof rootRedirectFor>[0]): string | null {
  return viewer.previewing ? null : rootRedirectFor(viewer);
}
