import { requireStaff } from "@/platform/auth/current-staff";
import { AppShell } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

/**
 * Everything signed-in lives under this group, so the guard is structural:
 * a new screen is protected because of where its file sits, not because
 * somebody remembered to add a call at the top of it.
 *
 * The *permission* for a given screen is still that screen's own
 * `requirePermission()` — this only establishes that there is a staff member.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const staff = await requireStaff();

  return <AppShell staff={staff}>{children}</AppShell>;
}
